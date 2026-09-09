import type {
  RawSchedule,
  ScheduleDataSource,
  ScheduleKind,
  ScheduleMeta,
  SchedulePeriod,
  StudentCatalog,
  TeacherCatalog,
} from './types';

export class DataSourceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DataSourceError';
  }
}

export class StaticDataSource implements ScheduleDataSource {
  constructor(private readonly baseUrl = `${import.meta.env.BASE_URL}data`) {}

  async getMeta(): Promise<ScheduleMeta> {
    return this.getJson<ScheduleMeta>('meta.json');
  }

  async getStudentCatalog(): Promise<StudentCatalog> {
    const payload = await this.getJson<StudentCatalog | { groups: StudentCatalog }>('students.json');
    if ('groups' in payload && payload.groups && typeof payload.groups === 'object') {
      return payload.groups as StudentCatalog;
    }
    return payload as StudentCatalog;
  }

  async getTeacherCatalog(): Promise<TeacherCatalog> {
    return this.getJson<TeacherCatalog>('teachers.json');
  }

  async getSchedule(
    kind: ScheduleKind,
    entityId: string,
    period: SchedulePeriod,
  ): Promise<RawSchedule> {
    const folder = kind === 'student' ? 's' : 't';
    const path = `${folder}/${encodeURIComponent(entityId)}/${period.month}_${period.year}.json`;
    return this.getJson<RawSchedule>(path);
  }

  private async getJson<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${path}`);
    } catch (error) {
      throw new DataSourceError(`Не удалось загрузить ${path}`, error);
    }
    if (!response.ok) {
      throw new DataSourceError(`Источник данных вернул ${response.status} для ${path}`);
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new DataSourceError(`Некорректный JSON в ${path}`, error);
    }
  }
}