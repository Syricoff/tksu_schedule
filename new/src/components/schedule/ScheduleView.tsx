import { useEffect, useRef, useState } from 'react';
import { BookOpen, BookMarked, MapPin, UserRound, UsersRound } from 'lucide-react';
import type { ParsedSchedule } from '../../data/normalize';
import { getDaysForWeek, getMonday, getWeeksFromData } from '../../data/normalize';

interface ScheduleViewProps {
  schedule: ParsedSchedule;
  currentWeek: Date;
  onWeekChange: (week: Date) => void;
}

const weekdays = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function weekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return `${monday.getDate()} ${months[monday.getMonth()]} - ${sunday.getDate()} ${months[sunday.getMonth()]}`;
}

export function ScheduleView({ schedule, currentWeek, onWeekChange }: ScheduleViewProps) {
  const todayCardRef = useRef<HTMLElement | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const weeks = getWeeksFromData(schedule.daySlots);
  const weekIndex = weeks.findIndex((week) => week.getTime() === currentWeek.getTime());
  const days = getDaysForWeek(schedule.daySlots, currentWeek);
  function getLessonGroups(lesson: typeof schedule.raw.lessons[number]): string[] {
    if (lesson.groupName) return [lesson.groupName];
    const groupNames = schedule.raw.groupNames ?? {};
    return (lesson.superflowGroupsIds ?? [])
      .map((groupId) => groupNames[String(groupId)] ?? groupNames[groupId])
      .filter((groupName): groupName is string => Boolean(groupName));
  }
  function goToToday() {
    const today = getMonday(new Date()).getTime();
    const closest = weeks.reduce((candidate, week) => (
      Math.abs(week.getTime() - today) < Math.abs(candidate.getTime() - today) ? week : candidate
    ), weeks[0] ?? getMonday(new Date()));
    onWeekChange(closest);
    setScrollRequest((request) => request + 1);
  }

  useEffect(() => {
    if (todayCardRef.current) {
      todayCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentWeek, scrollRequest]);
  return <section className="schedule-panel">
    <div className="schedule-nav"><div className="schedule-nav-row">
      <button className="nav-btn" disabled={weekIndex <= 0} onClick={() => onWeekChange(weeks[weekIndex - 1])}>←</button>
      <strong>{weekLabel(currentWeek)}</strong>
      <button className="nav-btn" disabled={weekIndex < 0 || weekIndex >= weeks.length - 1} onClick={() => onWeekChange(weeks[weekIndex + 1])}>→</button>
      <button className="today-btn" onClick={goToToday}>Сегодня</button>
    </div></div>
    {!days.length && <p className="empty-state">На этой неделе нет занятий.</p>}
    <div className="day-grid">{days.map((day) => {
      const date = day.split('.').map(Number);
      const dayDate = new Date(date[2], date[1] - 1, date[0]);
      const slots = schedule.daySlots[day];
      const timeIds = schedule.lessonTimeIds.filter((timeId) => Object.prototype.hasOwnProperty.call(slots, timeId));
      const hasLessons = timeIds.some((timeId) => (slots[timeId] ?? []).length > 0);
      const firstLessonIndex = timeIds.findIndex((timeId) => (slots[timeId] ?? []).length > 0);
      const lastLessonIndex = timeIds.reduce((lastIndex, timeId, index) => (
        (slots[timeId] ?? []).length > 0 ? index : lastIndex
      ), -1);
      const visibleTimeIds = hasLessons ? timeIds.slice(firstLessonIndex, lastLessonIndex + 1) : [];
      const now = new Date();
      const isToday = dayDate.getFullYear() === now.getFullYear() && dayDate.getMonth() === now.getMonth() && dayDate.getDate() === now.getDate();
      return <article ref={isToday ? todayCardRef : undefined} className={`day-card ${isToday ? 'today' : ''}`} key={day}>
        <header className="day-card-header"><strong className="day-date">{dayDate.getDate()}</strong><div className="day-meta"><div className="day-weekday">{weekdays[dayDate.getDay()]}{isToday && <span className="today-badge">сегодня</span>}</div><small className="day-fulldate">{dayDate.getDate()} {months[dayDate.getMonth()]} {dayDate.getFullYear()}</small></div></header>
        <div className="lessons">
          {hasLessons ? visibleTimeIds.map((timeId) => {
            const lessons = slots[timeId] ?? [];
            const time = schedule.lessonTimes[timeId];
            const pairNumber = timeIds.indexOf(timeId) + 1;
            return <div className={`lesson-slot ${lessons.length === 0 ? 'is-gap' : ''}`} key={timeId}><div className="lesson-time"><span className="time-num">{pairNumber} пара</span><small className="time-range">{String(time.hour_from).padStart(2, '0')}:{String(time.minute_from).padStart(2, '0')} - {String(time.hour_to).padStart(2, '0')}:{String(time.minute_to).padStart(2, '0')}</small></div><div>
              {lessons.length === 0 ? <div className="lesson-row is-empty"><div className="lesson-details"><span className="lesson-title"><BookOpen size={14} strokeWidth={1.8} aria-hidden="true" /><strong className="lesson-discipline">Нет пары</strong></span></div></div> : lessons.map((lesson, lessonIndex) => { const groups = getLessonGroups(lesson); return <div className={`lesson-row ${lesson.is_empty || lesson.self_work ? 'is-empty' : ''}`} key={`${timeId}-${lesson.id}-${lessonIndex}`}><div className="lesson-details"><span className="lesson-title"><BookOpen size={14} strokeWidth={1.8} aria-hidden="true" /><strong className="lesson-discipline">{lesson.is_empty ? 'Пустая пара' : lesson.self_work ? 'Самоподготовка' : lesson.discipline || 'Занятие'}</strong></span>{(lesson.class_type_name || lesson.classroom || groups.length || lesson.staffNames?.length) && <div className="lesson-info">{lesson.class_type_name && <span><BookMarked size={13} strokeWidth={1.8} aria-hidden="true" />{lesson.class_type_name}</span>}{lesson.classroom && <span><MapPin size={13} strokeWidth={1.8} aria-hidden="true" />{lesson.classroom.replace(/<[^>]*>/g, '')}</span>}{groups.length ? <span><UsersRound size={13} strokeWidth={1.8} aria-hidden="true" />{groups.join(', ')}</span> : null}{lesson.staffNames?.length ? <span><UserRound size={13} strokeWidth={1.8} aria-hidden="true" />{lesson.staffNames.join(', ')}</span> : null}</div>}</div></div>; })}
            </div></div>;
          }) : <div className="day-empty">На этот день нет занятий</div>}
        </div>
        </article>;
    })}</div>
  </section>;
}