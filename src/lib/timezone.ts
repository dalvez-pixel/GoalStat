export type TimezonePreference = 'gmt-6' | 'local';

export const DEFAULT_GMT_MINUS_6_TZ = 'Etc/GMT+6';

export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_GMT_MINUS_6_TZ;
  } catch {
    return DEFAULT_GMT_MINUS_6_TZ;
  }
}

export function resolveIanaTimeZone(pref: TimezonePreference): string {
  if (pref === 'gmt-6') return DEFAULT_GMT_MINUS_6_TZ;
  return getBrowserTimeZone();
}

export function getShortOffsetLabel(timeZone: string): string {
  if (timeZone === DEFAULT_GMT_MINUS_6_TZ) return 'GMT-6';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (raw) return raw.replace('UTC', 'GMT');
  } catch {
    // Fallback below
  }
  return timeZone;
}

export function formatTime24h(
  value: string | Date,
  timeZone: string,
  withSeconds = false
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hour12: false,
      hourCycle: 'h23',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hour12: false,
      hourCycle: 'h23',
    }).format(date);
  }
}

export function getYmdInTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function classifyMatchDayInTimeZone(
  kickoffIso: string,
  status: string,
  timeZone: string,
  fallbackDay?: 'today' | 'tomorrow'
): 'today' | 'tomorrow' | null {
  if (status === 'live') return 'today';

  const d = new Date(kickoffIso);
  if (Number.isNaN(d.getTime())) return fallbackDay ?? null;

  const now = new Date();
  const todayYmd = getYmdInTimeZone(now, timeZone);
  const tomorrowYmd = getYmdInTimeZone(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
    timeZone
  );
  const matchYmd = getYmdInTimeZone(d, timeZone);

  if (matchYmd === todayYmd) return 'today';
  if (matchYmd === tomorrowYmd) return 'tomorrow';

  if (fallbackDay === 'today' || fallbackDay === 'tomorrow') {
    const diffHours = (d.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (diffHours >= -8 && diffHours <= 48) {
      return fallbackDay;
    }
  }
  return null;
}
