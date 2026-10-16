import {
  AssemblyState,
  AssemblyStatus,
  PhaseKinds,
  type Assembly,
  type AssemblyPhase,
} from './assembly.interface';

// The phases an assembly goes through, and what a page shows of them. From 0.2.0 the `advance` job moves a
// launched assembly from phase to phase (`Assembly.phase`), so a round can end early once everyone answered;
// the clock-based schedule below is only the latest each phase can end (and how 0.1.0 assemblies, which had no
// stored phase, are brought over).

export const Phase = {
  NOT_STARTED: 'not-started',
  ROUND: 'round',
  REPORT: 'report',
  FINISHED: 'finished',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

// What the API reports about the current phase
export interface PhaseAt {
  phase: Phase;
  /** 0-based; the last question once finished */
  question: number;
  /** 1-based during a round, 0 otherwise */
  round: number;
  startedAt: Date | null;
  endsAt: Date | null;
}

type Timing = Pick<
  Assembly,
  | 'startsAt'
  | 'questions'
  | 'roundDurationSec'
  | 'reportingDurationSec'
  | 'roundsPerQuestion'
>;

const at = (start: Date, seconds: number) =>
  new Date(start.getTime() + seconds * 1000);

export const roundKey = (question: number, round: number) =>
  `q${question}-r${round}`;
export const reportKey = (question: number) => `q${question}-report`;
export const FINISHED_KEY = 'finished';

/** The latest the assembly can end: every round run to its end. */
export function endsAt(timing: Timing): Date | null {
  if (!timing.startsAt) return null;
  const q = timing.questions.length;
  const rounds = q * timing.roundsPerQuestion * timing.roundDurationSec;
  return at(
    timing.startsAt,
    rounds + Math.max(q - 1, 0) * timing.reportingDurationSec,
  );
}

/** Where an assembly would be at `now` with every round run to its end (0.1.0 behavior, for migrating). */
export function phaseAt(timing: Timing, now: Date): PhaseAt {
  const {
    startsAt,
    questions,
    roundDurationSec: r,
    reportingDurationSec: p,
    roundsPerQuestion: n,
  } = timing;
  const last = Math.max(questions.length - 1, 0);
  if (!startsAt || now < startsAt) {
    return {
      phase: Phase.NOT_STARTED,
      question: 0,
      round: 0,
      startedAt: null,
      endsAt: startsAt,
    };
  }

  const offset = (now.getTime() - startsAt.getTime()) / 1000;
  const block = n * r + p;
  const question = Math.min(Math.floor(offset / block), last);
  const into = offset - question * block;
  const questionStart = question * block;

  if (questions.length > 0 && into < n * r) {
    const round = Math.floor(into / r) + 1;
    return {
      phase: Phase.ROUND,
      question,
      round,
      startedAt: at(startsAt, questionStart + (round - 1) * r),
      endsAt: at(startsAt, questionStart + round * r),
    };
  }
  if (question < last) {
    return {
      phase: Phase.REPORT,
      question,
      round: 0,
      startedAt: at(startsAt, questionStart + n * r),
      endsAt: at(startsAt, questionStart + block),
    };
  }
  return {
    phase: Phase.FINISHED,
    question: last,
    round: 0,
    startedAt: endsAt(timing),
    endsAt: null,
  };
}

/** The stored phase as a `PhaseAt`. */
export function toPhaseAt(phase: AssemblyPhase): PhaseAt {
  return {
    phase: phase.kind,
    question: phase.question,
    round: phase.round,
    startedAt: phase.startedAt,
    endsAt: phase.endsAt,
  };
}

/** The current phase: not started (until the launch), else the stored one. */
export function currentPhase(assembly: Assembly): PhaseAt {
  if (assembly.launchedAt && assembly.phase) return toPhaseAt(assembly.phase);
  return {
    phase: Phase.NOT_STARTED,
    question: 0,
    round: 0,
    startedAt: null,
    endsAt: assembly.startsAt,
  };
}

/** The phase after `phase`, starting `now`. */
export function nextPhase(
  assembly: Pick<
    Assembly,
    | 'questions'
    | 'roundDurationSec'
    | 'reportingDurationSec'
    | 'roundsPerQuestion'
  >,
  phase: AssemblyPhase,
  now: Date,
): AssemblyPhase {
  const lastQuestion = assembly.questions.length - 1;
  const round = (question: number, n: number): AssemblyPhase => ({
    key: roundKey(question, n),
    kind: PhaseKinds.ROUND,
    question,
    round: n,
    startedAt: now,
    endsAt: at(now, assembly.roundDurationSec),
  });
  if (
    phase.kind === PhaseKinds.ROUND &&
    phase.round < assembly.roundsPerQuestion
  ) {
    return round(phase.question, phase.round + 1);
  }
  if (phase.kind === PhaseKinds.ROUND && phase.question < lastQuestion) {
    return {
      key: reportKey(phase.question),
      kind: PhaseKinds.REPORT,
      question: phase.question,
      round: 0,
      startedAt: now,
      endsAt: at(now, assembly.reportingDurationSec),
    };
  }
  if (phase.kind === PhaseKinds.REPORT) {
    return round(phase.question + 1, 1);
  }
  return {
    key: FINISHED_KEY,
    kind: PhaseKinds.FINISHED,
    question: phase.question,
    round: 0,
    startedAt: now,
    endsAt: null,
  };
}

export function assemblyState(assembly: Assembly, now: Date): AssemblyState {
  if (assembly.status === AssemblyStatus.CANCELED)
    return AssemblyState.CANCELED;
  if (assembly.status === AssemblyStatus.DRAFT) return AssemblyState.DRAFT;
  if (assembly.launchedAt) {
    return assembly.phase?.kind === PhaseKinds.FINISHED
      ? AssemblyState.FINISHED
      : AssemblyState.RUNNING;
  }
  // Started, but not launched yet (the launch job runs a couple of seconds after the start)
  return assembly.startsAt && now >= assembly.startsAt
    ? AssemblyState.RUNNING
    : AssemblyState.SCHEDULED;
}
