import type { ScheduleDataSource } from './types';

export class ApiDataSource implements ScheduleDataSource {
  private unavailable(): never {
    throw new Error('API-источник пока не реализован');
  }

  getMeta() { return Promise.reject(this.unavailable()); }
  getStudentCatalog() { return Promise.reject(this.unavailable()); }
  getTeacherCatalog() { return Promise.reject(this.unavailable()); }
  getSchedule() { return Promise.reject(this.unavailable()); }
}