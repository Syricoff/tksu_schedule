import { useEffect, useState } from 'react';
import { ScheduleView } from '../components/schedule/ScheduleView';
import { StudentSelector } from '../components/students/StudentSelector';
import { SelectedTeacher, TeacherSelector } from '../components/teachers/TeacherSelector';
import { createDataSource } from '../data/dataSource';
import { getMonday, mergeScheduleData, parseScheduleData, type ParsedSchedule } from '../data/normalize';
import type { ScheduleKind, ScheduleMeta, StudentCatalog, StudentGroup, TeacherCatalog } from '../data/types';
import { cacheSchedule, getCachedSchedule } from '../storage/scheduleCache';
import { readJson, readStorage, storageKeys, writeStorage } from '../storage/storage';
import { createPlatform } from '../platform/platform';
import './app.css';

type Tab = 'students' | 'teachers';
const dataSource = createDataSource();
const platform = createPlatform();

function readTab(): Tab {
  const hash = window.location.hash.slice(1);
  if (hash === 'teachers' || hash === 'students') return hash;
  return readStorage(storageKeys.activeTab) === 'teachers' ? 'teachers' : 'students';
}

function flattenGroups(catalog: StudentCatalog): StudentGroup[] {
  return Object.entries(catalog).flatMap(([departmentId, department]) => Object.entries(department.items ?? {}).flatMap(([courseId, course]) => Object.values(course.items ?? {}).map((group) => ({
    id: String(group.id), name: group.name, departmentId, departmentName: department.name, courseId, courseName: course.name,
  }))));
}

function closestWeek(schedule: ParsedSchedule): Date {
  const weeks = Object.keys(schedule.daySlots).map((day) => {
    const [date, month, year] = day.split('.').map(Number);
    return getMonday(new Date(year, month - 1, date));
  });
  const today = getMonday(new Date()).getTime();
  return weeks.reduce((closest, week) => Math.abs(week.getTime() - today) < Math.abs(closest.getTime() - today) ? week : closest, weeks[0] ?? getMonday(new Date()));
}

export function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [meta, setMeta] = useState<ScheduleMeta | null>(null);
  const [students, setStudents] = useState<StudentCatalog | null>(null);
  const [teachers, setTeachers] = useState<TeacherCatalog | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StudentGroup | null>(null);
  const [selectedTeacher, setSelectedTeacher] = useState<SelectedTeacher | null>(null);
  const [savedGroups, setSavedGroups] = useState<StudentGroup[]>(() => readJson(storageKeys.savedGroups, []));
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null);
  const [currentWeek, setCurrentWeek] = useState(getMonday(new Date()));
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { dataSource.getMeta().then(setMeta).catch(() => setMeta(null)); }, []);

  useEffect(() => {
    platform.ready();
    platform.setBackHandler(() => setTab('students'));
    const onHashChange = () => setTab(readTab());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (tab === 'teachers') platform.showBackButton();
    else platform.hideBackButton();
    if (window.location.hash !== `#${tab}`) window.location.hash = tab;
  }, [tab]);

  useEffect(() => {
    setError(null);
    const load = tab === 'students' ? dataSource.getStudentCatalog().then(setStudents) : dataSource.getTeacherCatalog().then(setTeachers);
    load.catch((reason: Error) => setError(reason.message));
    writeStorage(storageKeys.activeTab, tab);
  }, [tab]);

  useEffect(() => {
    if (!students || selectedGroup) return;
    const selectedId = readStorage(storageKeys.studentGroup);
    const restored = [...flattenGroups(students), ...savedGroups].find((group) => group.id === selectedId);
    if (restored) setSelectedGroup(restored);
  }, [students, selectedGroup, savedGroups]);

  useEffect(() => {
    if (!teachers || selectedTeacher) return;
    const selectedId = readStorage(storageKeys.teacher);
    for (const [departmentId, members] of Object.entries(teachers.staff)) {
      const teacher = members[selectedId ?? ''];
      if (teacher) {
        setSelectedTeacher({ id: selectedId!, name: teacher.shortName, departmentId, departmentName: teachers.departments[departmentId] ?? 'Кафедра' });
        break;
      }
    }
  }, [teachers, selectedTeacher]);

  useEffect(() => {
    const selected = tab === 'students' ? selectedGroup : selectedTeacher;
    if (!selected || !meta?.months.length) return;
    const kind: ScheduleKind = tab === 'students' ? 'student' : 'teacher';
    let cancelled = false;
    setLoadingSchedule(true); setError(null);
    Promise.all(meta.months.map(async (period) => {
      try {
        const raw = await dataSource.getSchedule(kind, selected.id, period);
        cacheSchedule(kind, selected.id, period, raw);
        return parseScheduleData(raw);
      } catch {
        const cached = getCachedSchedule(kind, selected.id, period);
        return cached ? parseScheduleData(cached.data) : null;
      }
    })).then((parsed) => {
      if (cancelled) return;
      const merged = mergeScheduleData(parsed.filter((item): item is ParsedSchedule => item !== null));
      if (!merged) throw new Error('Расписание для выбранной группы недоступно');
      setSchedule(merged); setCurrentWeek(closestWeek(merged));
    }).catch((reason: Error) => { if (!cancelled) { setSchedule(null); setError(reason.message); } })
      .finally(() => { if (!cancelled) setLoadingSchedule(false); });
    return () => { cancelled = true; };
  }, [selectedGroup, selectedTeacher, tab, meta]);

  const groups = students ? flattenGroups(students) : [];
  const allSavedGroups = savedGroups.map((saved) => groups.find((group) => group.id === saved.id) ?? saved);
  function selectGroup(group: StudentGroup) { setSelectedGroup(group); writeStorage(storageKeys.studentGroup, group.id); }
  function toggleSaved(group: StudentGroup) {
    const next = savedGroups.some((item) => item.id === group.id) ? savedGroups.filter((item) => item.id !== group.id) : [...savedGroups, group];
    setSavedGroups(next); writeStorage(storageKeys.savedGroups, JSON.stringify(next));
  }

  function selectTeacher(teacher: SelectedTeacher) {
    setSelectedTeacher(teacher);
    writeStorage(storageKeys.teacher, teacher.id);
  }

  return <main className="app-shell">
    <header className="app-header"><div className="app-header-inner"><span className="header-logo" role="img" aria-label="Логотип КГУ" /><div><h1>Расписание</h1><small>КГУ им. К.Э. Циолковского</small></div></div></header>
    <p className="intro">Выберите группу или преподавателя, чтобы увидеть занятия по неделям.</p>
    <nav className="tab-switcher" aria-label="Тип расписания"><button className={`tab-btn ${tab === 'students' ? 'active' : ''}`} onClick={() => setTab('students')}>Обучающиеся</button><button className={`tab-btn ${tab === 'teachers' ? 'active' : ''}`} onClick={() => setTab('teachers')}>Преподаватели</button></nav>
    {error && <p className="error" role="alert">{error}</p>}
    {tab === 'students' && students && <div className="workspace"><StudentSelector groups={groups} selectedId={selectedGroup?.id ?? null} savedGroups={allSavedGroups} onSelect={selectGroup} onToggleSaved={toggleSaved} /><div className="schedule-area">{loadingSchedule && <p className="empty-state">Загрузка расписания...</p>}{!loadingSchedule && schedule && <ScheduleView schedule={schedule} currentWeek={currentWeek} onWeekChange={setCurrentWeek} />}{!loadingSchedule && !schedule && !error && <p className="empty-state">Выберите группу для просмотра расписания.</p>}</div></div>}
    {tab === 'students' && !students && !error && <p className="empty-state">Загрузка каталога групп...</p>}
    {tab === 'teachers' && teachers && <div className="workspace"><TeacherSelector catalog={teachers} selectedId={selectedTeacher?.id ?? null} onSelect={selectTeacher} /><div className="schedule-area">{loadingSchedule && <p className="empty-state">Загрузка расписания...</p>}{!loadingSchedule && schedule && <ScheduleView schedule={schedule} currentWeek={currentWeek} onWeekChange={setCurrentWeek} />}{!loadingSchedule && !schedule && !error && <p className="empty-state">Выберите преподавателя для просмотра расписания.</p>}</div></div>}
    {tab === 'teachers' && !teachers && !error && <p className="empty-state">Загрузка каталога преподавателей...</p>}
    <footer className="app-footer"><span>© 2026 — КГУ им. К.Э. Циолковского</span><span>Создано — <a href="https://syricoff.github.io/" target="_blank" rel="noreferrer">Syricoff</a></span>{meta && <span className="footer-data">Данные обновлены {meta.generated}</span>}</footer>
  </main>;
}