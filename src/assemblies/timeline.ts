import {
  AssemblyState,
  AssemblyStatus,
  type Assembly,
} from './assembly.interface';

// ℹ️ There are no scheduled jobs for modules (yet), so nothing advances an assembly: where it is follows from
// its start time and durations alone. Each question runs `roundsPerQuestion` rounds, then a report, except the
// last one, which ends the assembly. Every request can work it out and gets the same answer.

export const Phase = {
  NOT_STARTED: 'not-started',
  ROUND: 'round',
  REPORT: 'report',
  FINISHED: 'finished',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

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

/** When the last round of the last question ends. */
export function endsAt(timing: Timing): Date | null {
  if (!timing.startsAt) return null;
  const q = timing.questions.length;
  const rounds = q * timing.roundsPerQuestion * timing.roundDurationSec;
  return at(
    timing.startsAt,
    rounds + Math.max(q - 1, 0) * timing.reportingDurationSec,
  );
}

/** When question `question`'s last round ends. */
export function questionEndsAt(timing: Timing, question: number): Date | null {
  if (!timing.startsAt) return null;
  const block =
    timing.roundsPerQuestion * timing.roundDurationSec +
    timing.reportingDurationSec;
  return at(
    timing.startsAt,
    question * block + timing.roundsPerQuestion * timing.roundDurationSec,
  );
}

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

export function assemblyState(assembly: Assembly, now: Date): AssemblyState {
  if (assembly.status === AssemblyStatus.CANCELED)
    return AssemblyState.CANCELED;
  if (assembly.status === AssemblyStatus.DRAFT) return AssemblyState.DRAFT;
  const { phase } = phaseAt(assembly, now);
  if (phase === Phase.NOT_STARTED) return AssemblyState.SCHEDULED;
  return phase === Phase.FINISHED
    ? AssemblyState.FINISHED
    : AssemblyState.RUNNING;
}
