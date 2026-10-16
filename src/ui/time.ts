import { DateTime } from '@unifyamerica/demleague-plugin-sdk/vue';

// An assembly's times are set and shown in its own time zone, whatever the viewer's. The date picker works in
// the browser's zone, so a picked date is read as wall-clock fields and placed in the assembly's zone.

/** The wall-clock time `date` shows in the browser, as that time in `zone` (UTC ISO). */
export function fromPicker(date: Date, zone: string): string {
  return DateTime.fromObject(
    {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    },
    { zone },
  )
    .toUTC()
    .toISO()!;
}

/** The reverse: a Date the picker shows with the wall-clock time `iso` has in `zone`. */
export function toPicker(iso: string, zone: string): Date {
  const local = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
  return new Date(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
}

/** "Aug 1, 2027, 7:00 PM EDT" in the assembly's zone. */
export function formatInZone(
  iso: string | null,
  zone: string,
  locale = 'en-US',
): string {
  if (!iso) return '—';
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(zone)
    .setLocale(locale)
    .toFormat('LLL d, yyyy, h:mm a ZZZZ');
}

/** "1:05" for a countdown, never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** A time zone's message key (`America/New_York` → `America_New_York`). */
export const zoneKey = (zone: string): string => zone.replace(/\//g, '_');
