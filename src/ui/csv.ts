import type { ExportPage } from './types';

const HEADERS = [
  'participantId',
  'userId',
  'code',
  'traits',
  'joinedAt',
  'readyAt',
  'inCohort',
  'neighborIds',
  'question',
  'round',
  'value',
  'respondedAt',
];

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  // Quote what would break a row, and neutralize spreadsheet formulas
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** One row per answer (questions and rounds 1-based), and one for a participant who gave none. */
export function toCsv(participants: ExportPage['participants']): string {
  const rows = participants.flatMap((p) => {
    const base = [
      p.id,
      p.userId,
      p.code,
      JSON.stringify(p.traits),
      p.joinedAt,
      p.readyAt,
      p.inCohort === null ? '' : p.inCohort,
      p.neighborIds.join(' '),
    ];
    if (p.responses.length === 0) return [[...base, '', '', '', '']];
    return p.responses.map((r) => [
      ...base,
      r.question + 1,
      r.round,
      r.value,
      r.respondedAt,
    ]);
  });
  return (
    [HEADERS, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') +
    '\r\n'
  );
}

export function download(fileName: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
