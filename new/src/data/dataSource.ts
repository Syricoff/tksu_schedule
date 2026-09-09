import { ApiDataSource } from './apiDataSource';
import { StaticDataSource } from './staticDataSource';
import type { ScheduleDataSource } from './types';

export function createDataSource(mode = import.meta.env.VITE_DATA_SOURCE ?? 'static'): ScheduleDataSource {
  if (mode === 'api') return new ApiDataSource();
  return new StaticDataSource();
}