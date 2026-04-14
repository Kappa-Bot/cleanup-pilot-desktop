import { AppDatabase } from "./db";
import { SchedulerSettings } from "./types";

export interface SchedulerStatus {
  enabled: boolean;
  cadence: "weekly";
  dayOfWeek: number;
  time: string;
  nextRunAt?: number;
}

function parseTimeToMinutes(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return 10 * 60;
  }
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return hour * 60 + minute;
}

function computeNextWeeklyRun(dayOfWeek: number, time: string): number {
  const now = new Date();
  const nowDay = now.getDay();
  const targetMinutes = parseTimeToMinutes(time);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let daysAhead = dayOfWeek - nowDay;
  if (daysAhead < 0 || (daysAhead === 0 && targetMinutes <= currentMinutes)) {
    daysAhead += 7;
  }

  const next = new Date(now);
  next.setDate(now.getDate() + daysAhead);
  next.setHours(Math.floor(targetMinutes / 60), targetMinutes % 60, 0, 0);
  return next.getTime();
}

export class SchedulerService {
  constructor(private readonly db: AppDatabase) {}

  set(settings: SchedulerSettings): SchedulerStatus {
    const normalized: SchedulerSettings = {
      enabled: settings.enabled,
      cadence: "weekly",
      dayOfWeek: Math.max(0, Math.min(6, settings.dayOfWeek)),
      time: settings.time
    };
    this.db.setSchedulerState(normalized);
    return this.get();
  }

  get(): SchedulerStatus {
    const saved = this.db.getSchedulerState();
    return {
      ...saved,
      nextRunAt: saved.enabled ? computeNextWeeklyRun(saved.dayOfWeek, saved.time) : undefined
    };
  }
}
