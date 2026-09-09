export type ScheduleKind = 'student' | 'teacher';

export interface SchedulePeriod {
  month: number;
  year: number;
}

export interface ScheduleMeta {
  generated: string;
  months: SchedulePeriod[];
  groups_count?: number;
  staff_count?: number;
}

export interface StudentCourse {
  name: string;
  items: Record<string, { id: string | number; name: string }>;
}

export interface StudentDepartment {
  name: string;
  items: Record<string, StudentCourse>;
}

export type StudentCatalog = Record<string, StudentDepartment>;

export interface StudentGroup {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  courseId: string;
  courseName: string;
}

export interface Teacher {
  id?: string | number;
  fullName?: string;
  shortName: string;
}

export interface TeacherCatalog {
  departments: Record<string, string>;
  staff: Record<string, Record<string, Teacher>>;
}

export interface RawSchedule {
  start_date: string;
  end_date: string;
  lessonTimes: LessonTime[];
  lessonTimesEnabled: Record<string, number[]>;
  lessons: Lesson[];
  groupNames?: Record<string, string>;
  subgroupNames?: Record<string, string>;
  [key: string]: unknown;
}

export interface LessonTime {
  id: number;
  hour_from: number;
  minute_from: number;
  hour_to: number;
  minute_to: number;
}

export interface Lesson {
  id: number;
  date: string;
  lesson_time_id: number;
  discipline?: string;
  classroom?: string;
  class_type_name?: string;
  staffNames?: string[];
  groupName?: string;
  superflowGroupsIds?: Array<string | number>;
  superflowSubgroupsIds?: Array<string | number>;
  is_empty?: number;
  self_work?: number;
  modified?: number;
  [key: string]: unknown;
}

export interface ScheduleDataSource {
  getMeta(): Promise<ScheduleMeta>;
  getStudentCatalog(): Promise<StudentCatalog>;
  getTeacherCatalog(): Promise<TeacherCatalog>;
  getSchedule(
    kind: ScheduleKind,
    entityId: string,
    period: SchedulePeriod,
  ): Promise<RawSchedule>;
}