import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  formatInZone,
  fromPicker,
  toPicker,
  zoneKey,
} from './time';

describe('time helpers', () => {
  it("reads the picker's wall-clock time in the assembly's zone, whatever the browser's", () => {
    // 7:00 PM as picked, in New York in August (EDT, UTC-4)
    expect(fromPicker(new Date(2027, 7, 1, 19, 0), 'America/New_York')).toBe(
      '2027-08-01T23:00:00.000Z',
    );
    // …and in winter (EST, UTC-5)
    expect(fromPicker(new Date(2027, 0, 15, 19, 0), 'America/New_York')).toBe(
      '2027-01-16T00:00:00.000Z',
    );
  });

  it('shows a stored time back in the picker as the same wall-clock time', () => {
    const picked = toPicker('2027-08-01T23:00:00.000Z', 'America/New_York');
    expect([
      picked.getFullYear(),
      picked.getMonth(),
      picked.getDate(),
      picked.getHours(),
      picked.getMinutes(),
    ]).toEqual([2027, 7, 1, 19, 0]);
    expect(fromPicker(picked, 'America/New_York')).toBe(
      '2027-08-01T23:00:00.000Z',
    );
  });

  it("formats times in the assembly's zone", () => {
    expect(formatInZone('2027-08-01T23:00:00.000Z', 'America/Chicago')).toBe(
      'Aug 1, 2027, 6:00 PM CDT',
    );
    expect(formatInZone(null, 'UTC')).toBe('—');
  });

  it('formats countdowns', () => {
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(400)).toBe('0:01');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('makes message keys of zone names', () => {
    expect(zoneKey('America/New_York')).toBe('America_New_York');
  });
});
