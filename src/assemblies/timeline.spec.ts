import {
  AssemblyState,
  AssemblyStatus,
  type Assembly,
} from './assembly.interface';
import {
  assemblyState,
  endsAt,
  Phase,
  phaseAt,
  questionEndsAt,
} from './timeline';

const startsAt = new Date('2027-08-01T23:00:00.000Z');
const after = (s: number) => new Date(startsAt.getTime() + s * 1000);
// Two questions: 3 × 60 s rounds each, a 30 s report between them
const timing = {
  startsAt,
  questions: [
    { prompt: 'One?', min: 0, max: 100 },
    { prompt: 'Two?', min: 0, max: 100 },
  ],
  roundDurationSec: 60,
  reportingDurationSec: 30,
  roundsPerQuestion: 3,
};

describe('phaseAt', () => {
  it('should not have started before the start time', () => {
    expect(phaseAt(timing, after(-1))).toEqual({
      phase: Phase.NOT_STARTED,
      question: 0,
      round: 0,
      startedAt: null,
      endsAt: startsAt,
    });
  });

  it.each([
    [0, 0, 1, 0, 60],
    [59, 0, 1, 0, 60],
    [60, 0, 2, 60, 120],
    [179, 0, 3, 120, 180],
    [210, 1, 1, 210, 270],
    [389, 1, 3, 330, 390],
  ])(
    'at %ss should be question %i, round %i',
    (s, question, round, from, to) => {
      expect(phaseAt(timing, after(s))).toEqual({
        phase: Phase.ROUND,
        question,
        round,
        startedAt: after(from),
        endsAt: after(to),
      });
    },
  );

  it('should report between questions', () => {
    expect(phaseAt(timing, after(195))).toEqual({
      phase: Phase.REPORT,
      question: 0,
      round: 0,
      startedAt: after(180),
      endsAt: after(210),
    });
  });

  it('should finish after the last round, without a report', () => {
    expect(endsAt(timing)).toEqual(after(390));
    expect(phaseAt(timing, after(390))).toEqual({
      phase: Phase.FINISHED,
      question: 1,
      round: 0,
      startedAt: after(390),
      endsAt: null,
    });
    expect(phaseAt(timing, after(100_000)).phase).toBe(Phase.FINISHED);
  });

  it("should know when each question's last round ends", () => {
    expect(questionEndsAt(timing, 0)).toEqual(after(180));
    expect(questionEndsAt(timing, 1)).toEqual(after(390));
  });

  it('should never start without a start time', () => {
    expect(phaseAt({ ...timing, startsAt: null }, after(10)).phase).toBe(
      Phase.NOT_STARTED,
    );
    expect(endsAt({ ...timing, startsAt: null })).toBeNull();
  });
});

describe('assemblyState', () => {
  const assembly = { ...timing, status: AssemblyStatus.SCHEDULED } as Assembly;

  it('should follow the clock once scheduled', () => {
    expect(assemblyState(assembly, after(-10))).toBe(AssemblyState.SCHEDULED);
    expect(assemblyState(assembly, after(10))).toBe(AssemblyState.RUNNING);
    expect(assemblyState(assembly, after(400))).toBe(AssemblyState.FINISHED);
  });

  it('should keep drafts and canceled assemblies as they are', () => {
    expect(
      assemblyState({ ...assembly, status: AssemblyStatus.DRAFT }, after(10)),
    ).toBe(AssemblyState.DRAFT);
    expect(
      assemblyState(
        { ...assembly, status: AssemblyStatus.CANCELED },
        after(10),
      ),
    ).toBe(AssemblyState.CANCELED);
  });
});
