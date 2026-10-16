import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

const participant = {
  id: 'p1',
  userId: 'u1',
  code: 'ABCDEFGHIJKLMNOPQRST',
  traits: { smoker: 'no' },
  joinedAt: '2027-08-01T22:55:00.000Z',
  readyAt: '2027-08-01T22:59:30.000Z',
  inCohort: true,
  neighborIds: ['p2', 'p3'],
  responses: [
    {
      question: 0,
      round: 1,
      value: 40,
      respondedAt: '2027-08-01T23:00:20.000Z',
    },
    {
      question: 0,
      round: 2,
      value: 55,
      respondedAt: '2027-08-01T23:01:20.000Z',
    },
  ],
};

describe('toCsv', () => {
  it('writes one row per answer, with 1-based questions', () => {
    const lines = toCsv([participant]).trim().split('\r\n');
    expect(lines[0]).toBe(
      'participantId,userId,code,traits,joinedAt,readyAt,inCohort,neighborIds,question,round,value,respondedAt',
    );
    expect(lines[1]).toBe(
      'p1,u1,ABCDEFGHIJKLMNOPQRST,"{""smoker"":""no""}",2027-08-01T22:55:00.000Z,2027-08-01T22:59:30.000Z,true,p2 p3,1,1,40,2027-08-01T23:00:20.000Z',
    );
    expect(lines).toHaveLength(3);
  });

  it('keeps participants without answers, and quotes JSON traits', () => {
    const lines = toCsv([
      { ...participant, responses: [], traits: { note: '=HYPERLINK("x")' } },
    ])
      .trim()
      .split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"{""note"":""=HYPERLINK(\\""x\\"")""}"');
    expect(lines[1].endsWith(',,,,')).toBe(true);
  });
});
