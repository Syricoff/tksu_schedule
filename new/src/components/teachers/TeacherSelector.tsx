import { useState } from 'react';
import type { TeacherCatalog } from '../../data/types';

export interface SelectedTeacher {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
}

interface TeacherSelectorProps {
  catalog: TeacherCatalog;
  selectedId: string | null;
  onSelect: (teacher: SelectedTeacher) => void;
}

export function TeacherSelector({ catalog, selectedId, onSelect }: TeacherSelectorProps) {
  const [departmentId, setDepartmentId] = useState('');
  const [query, setQuery] = useState('');
  const departments = Object.entries(catalog.departments).filter(([id]) => catalog.staff[id]);
  const teachers = Object.entries(catalog.staff).flatMap(([id, members]) => Object.entries(members).map(([teacherId, teacher]) => ({
    id: teacherId,
    name: teacher.shortName,
    fullName: teacher.fullName ?? teacher.shortName,
    departmentId: id,
    departmentName: catalog.departments[id] ?? 'Кафедра',
  })));
  const visibleTeachers = teachers.filter((teacher) => (
    (!departmentId || teacher.departmentId === departmentId) &&
    (!query || `${teacher.name} ${teacher.fullName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  ));

  function selectTeacher(teacher: typeof teachers[number]) {
    setDepartmentId(teacher.departmentId);
    setQuery('');
    onSelect(teacher);
  }

  return <aside className="selector-panel sidebar-panel">
    <div className="sidebar-section"><label className="field-label sidebar-title" htmlFor="teacher-search">Поиск преподавателя</label>
    <input id="teacher-search" className="form-control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Фамилия или инициалы" /></div>
    {query.length >= 2 && <div className="search-results">
      {visibleTeachers.slice(0, 15).map((teacher) => <button key={`${teacher.departmentId}-${teacher.id}`} onClick={() => selectTeacher(teacher)}>{teacher.name}<small>{teacher.departmentName}</small></button>)}
      {!visibleTeachers.length && <span>Ничего не найдено</span>}
    </div>}
    <div className="sidebar-section"><label className="field-label sidebar-title" htmlFor="teacher-department">Кафедра</label>
    <select id="teacher-department" className="form-select" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
      <option value="">Все кафедры</option>
      {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></div>
    <div className="sidebar-section"><label className="field-label sidebar-title" htmlFor="teacher">Преподаватель</label>
    <select id="teacher" className="form-select" value={selectedId ?? ''} onChange={(event) => {
      const teacher = teachers.find((item) => item.id === event.target.value);
      if (teacher) selectTeacher(teacher);
    }}>
      <option value="">Выберите преподавателя</option>
      {visibleTeachers.map((teacher) => <option key={`${teacher.departmentId}-${teacher.id}`} value={teacher.id}>{teacher.name}</option>)}
    </select></div>
  </aside>;
}