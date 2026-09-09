import { useState } from 'react';
import type { StudentGroup } from '../../data/types';

interface StudentSelectorProps {
  groups: StudentGroup[];
  selectedId: string | null;
  savedGroups: StudentGroup[];
  onSelect: (group: StudentGroup) => void;
  onToggleSaved: (group: StudentGroup) => void;
}

export function StudentSelector({ groups, selectedId, savedGroups, onSelect, onToggleSaved }: StudentSelectorProps) {
  const [departmentId, setDepartmentId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const departments = Array.from(new Map(groups.map((group) => [group.departmentId, group.departmentName])));
  const courses = Array.from(new Map(
    groups.filter((group) => group.departmentId === departmentId).map((group) => [group.courseId, group.courseName]),
  ));
  const visibleGroups = groups.filter((group) => (
    (!departmentId || group.departmentId === departmentId) &&
    (!courseId || group.courseId === courseId) &&
    (!query || group.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  ));

  function selectGroup(group: StudentGroup) {
    setDepartmentId(group.departmentId);
    setCourseId(group.courseId);
    setQuery('');
    onSelect(group);
  }

  return (
    <aside className="selector-panel sidebar-panel">
      <div className="sidebar-section"><label className="field-label sidebar-title" htmlFor="group-search">Поиск группы</label>
      <input id="group-search" className="form-control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например, Б-ИСиТ-11" /></div>
      {query.length >= 2 && (
        <div className="search-results">
          {visibleGroups.slice(0, 12).map((group) => (
            <button key={group.id} onClick={() => selectGroup(group)}>{group.name}<small>{group.departmentName}</small></button>
          ))}
          {!visibleGroups.length && <span>Ничего не найдено</span>}
        </div>
      )}
      <button className="mobile-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
        <span>Выбор из каталога</span><span aria-hidden="true">{filtersOpen ? '−' : '+'}</span>
      </button>
      <div className={`catalog-filters ${filtersOpen ? 'open' : ''}`}>
      <div className="sidebar-section"><label className="field-label sidebar-title" htmlFor="department">Факультет / институт</label>
      <select id="department" className="form-select" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setCourseId(''); }}>
        <option value="">Все факультеты</option>
        {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></div>
      <div className="sidebar-section"><label className="field-label sidebar-title" htmlFor="course">Курс</label>
      <select id="course" className="form-select" value={courseId} disabled={!departmentId} onChange={(event) => setCourseId(event.target.value)}>
        <option value="">Все курсы</option>
        {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></div>
      <div className="sidebar-section"><label className="field-label sidebar-title" htmlFor="group">Группа</label>
      <select id="group" className="form-select" value={selectedId ?? ''} onChange={(event) => {
        const group = groups.find((item) => item.id === event.target.value);
        if (group) selectGroup(group);
      }}>
        <option value="">Выберите группу</option>
        {visibleGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></div>
      </div>
      {savedGroups.length > 0 && <div className="saved-groups">
        <p className="field-label">Сохранённые группы</p>
        {savedGroups.map((group) => <button className={`saved-group-item ${group.id === selectedId ? 'active' : ''}`} key={group.id} onClick={() => selectGroup(group)}>{group.name}</button>)}
      </div>}
      {selectedId && <button className="save-button" onClick={() => {
        const group = groups.find((item) => item.id === selectedId);
        if (group) onToggleSaved(group);
      }}>{savedGroups.some((group) => group.id === selectedId) ? 'Убрать из сохранённых' : 'Сохранить группу'}</button>}
    </aside>
  );
}