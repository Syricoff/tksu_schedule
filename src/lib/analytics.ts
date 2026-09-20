export interface GoatCounterCountVars {
  path?: string;
  title?: string;
  referrer?: string;
  event?: boolean;
}

export interface GoatCounter {
  count?: (vars?: GoatCounterCountVars) => void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

export function sendCount(vars: GoatCounterCountVars): void {
  if (typeof window === 'undefined') return;

  if (window.goatcounter?.count) {
    window.goatcounter.count(vars);
    return;
  }

  // Queue if goatcounter script is still loading
  let attempts = 0;
  const interval = setInterval(() => {
    attempts += 1;
    if (window.goatcounter?.count) {
      clearInterval(interval);
      window.goatcounter.count(vars);
    } else if (attempts >= 30) {
      clearInterval(interval);
    }
  }, 100);
}

export function trackGroupSelect(groupName: string): void {
  sendCount({
    path: `event-group/${groupName}`,
    title: groupName,
    event: true,
  });
}

export function trackTeacherSelect(teacherName: string): void {
  sendCount({
    path: `event-teacher/${teacherName}`,
    title: teacherName,
    event: true,
  });
}
