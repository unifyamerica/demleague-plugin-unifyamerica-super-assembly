import {
  AssemblyState,
  AssemblyStatus,
  PhaseKinds,
  type Assembly,
  type AssemblyPhase,
} from './assembly.interface';
import {
  assemblyState,
  currentPhase,
  endsAt,
  nextPhase,
  Phase,
  phaseAt,
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
const phase = (overrides: Partial<AssemblyPhase>): AssemblyPhase => ({
  key: 'q0-r1',
  kind: PhaseKinds.ROUND,
  question: 0,
  round: 1,
  startedAt: startsAt,
  endsAt: after(60),
  ...overrides,
});

describe('nextPhase', () => {
  const now = after(42);

  it('should go through the rounds, a report, the next question, then finish', () => {
    expect(nextPhase(timing, phase({}), now)).toEqual(
      phase({ key: 'q0-r2', round: 2, startedAt: now, endsAt: after(102) }),
    );
    expect(nextPhase(timing, phase({ key: 'q0-r3', round: 3 }), now)).toEqual({
      key: 'q0-report',
      kind: PhaseKinds.REPORT,
      question: 0,
      round: 0,
      startedAt: now,
      endsAt: after(72),
    });
    expect(
      nextPhase(
        timing,
        phase({ key: 'q0-report', kind: PhaseKinds.REPORT, round: 0 }),
        now,
      ),
    ).toEqual(
      phase({ key: 'q1-r1', question: 1, startedAt: now, endsAt: after(102) }),
    );
    expect(
      nextPhase(timing, phase({ key: 'q1-r3', question: 1, round: 3 }), now),
    ).toEqual({
      key: 'finished',
      kind: PhaseKinds.FINISHED,
      question: 1,
      round: 0,
      startedAt: now,
      endsAt: null,
    });
  });
});

describe('currentPhase and assemblyState', () => {
  const assembly = (overrides: Partial<Assembly>) =>
    ({
      ...timing,
      status: AssemblyStatus.SCHEDULED,
      launchedAt: null,
      phase: null,
      ...overrides,
    }) as Assembly;

  it('should be scheduled until the start, then starting until the launch', () => {
    expect(currentPhase(assembly({}))).toEqual(
      expect.objectContaining({ phase: Phase.NOT_STARTED, endsAt: startsAt }),
    );
    expect(assemblyState(assembly({}), after(-10))).toBe(
      AssemblyState.SCHEDULED,
    );
    expect(assemblyState(assembly({}), after(1))).toBe(AssemblyState.RUNNING);
  });

  it('should follow the stored phase once launched', () => {
    const running = assembly({
      launchedAt: after(2),
      phase: phase({ key: 'q0-r2', round: 2 }),
    });
    expect(currentPhase(running)).toEqual({
      phase: Phase.ROUND,
      question: 0,
      round: 2,
      startedAt: startsAt,
      endsAt: after(60),
    });
    expect(assemblyState(running, after(500))).toBe(AssemblyState.RUNNING);
    const finished = assembly({
      launchedAt: after(2),
      phase: phase({
        key: 'finished',
        kind: PhaseKinds.FINISHED,
        endsAt: null,
      }),
    });
    expect(assemblyState(finished, after(500))).toBe(AssemblyState.FINISHED);
  });

  it('should keep drafts and canceled assemblies as they are', () => {
    expect(
      assemblyState(assembly({ status: AssemblyStatus.DRAFT }), after(10)),
    ).toBe(AssemblyState.DRAFT);
    expect(
      assemblyState(assembly({ status: AssemblyStatus.CANCELED }), after(10)),
    ).toBe(AssemblyState.CANCELED);
  });
});

describe('the clock-based schedule (the latest end, and 0.1.0 assemblies)', () => {
  it('should end after every round has run to its end', () => {
    expect(endsAt(timing)).toEqual(after(390));
    expect(endsAt({ ...timing, startsAt: null })).toBeNull();
  });

  it.each([
    [-1, Phase.NOT_STARTED, 0, 0],
    [59, Phase.ROUND, 0, 1],
    [179, Phase.ROUND, 0, 3],
    [195, Phase.REPORT, 0, 0],
    [389, Phase.ROUND, 1, 3],
    [390, Phase.FINISHED, 1, 0],
  ])(
    'at %ss should be %s, question %i, round %i',
    (s, expected, question, round) => {
      expect(phaseAt(timing, after(s))).toEqual(
        expect.objectContaining({ phase: expected, question, round }),
      );
    },
  );
});
