// Stored documents and the constants shared by the services. Statuses are const objects, not TS enums.

export const COLLECTIONS = {
  ASSEMBLIES: 'assemblies',
  INVITATIONS: 'invitations',
  PARTICIPANTS: 'participants',
  RESPONSES: 'responses',
} as const;

/** What an org admin sets. `running` and `finished` are worked out from the clock (see `assemblyState`). */
export const AssemblyStatus = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  CANCELED: 'canceled',
} as const;
export type AssemblyStatus =
  (typeof AssemblyStatus)[keyof typeof AssemblyStatus];

/** What an assembly is doing now: its status, and for a scheduled one, the clock. */
export const AssemblyState = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  FINISHED: 'finished',
  CANCELED: 'canceled',
} as const;
export type AssemblyState = (typeof AssemblyState)[keyof typeof AssemblyState];

// Fixed by the method (they were constants in the original app too); stored on each assembly so a later
// version can make them configurable without changing old assemblies
export const ROUNDS_PER_QUESTION = 3;
export const NEIGHBOR_COUNT = 4;
export const READY_WINDOW_SEC = 60;
export const REPORTING_DURATION_SEC = 30;
export const DEFAULT_ROUND_DURATION_SEC = 90;
export const MIN_ROUND_DURATION_SEC = 15;
export const MAX_ROUND_DURATION_SEC = 900;
export const MAX_QUESTIONS = 9;
export const MAX_PROMPT_LENGTH = 10_000;
export const MAX_PAGE_HTML_LENGTH = 20_000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_INVITATIONS_PER_REQUEST = 500;
export const MAX_TRAITS = 20;
export const MAX_TRAIT_LENGTH = 200;
// Joining and confirming close at the start; the launch job runs this long after it, so no ready confirmation
// can still be landing while the cohort is chosen
export const LAUNCH_GRACE_SEC = 2;
// …and a question's results are computed this long after its last round closes, for the same reason with answers
export const RESULTS_SETTLE_SEC = 2;
// A job this overdue (the dispatcher was down, say) is scheduled again when someone looks at the assembly
export const OVERDUE_SEC = 15;

export const JOBS = {
  LAUNCH: 'launch',
  ADVANCE: 'advance',
  RESULTS: 'results',
} as const;

export const PhaseKinds = {
  ROUND: 'round',
  REPORT: 'report',
  FINISHED: 'finished',
} as const;
export type PhaseKind = (typeof PhaseKinds)[keyof typeof PhaseKinds];

/** Where a launched assembly is. Moved on by the `advance` job (when the time is up, or everyone answered). */
export interface AssemblyPhase {
  // `q0-r1`, `q0-report`, `finished`: what the advance job for this phase is keyed on
  key: string;
  kind: PhaseKind;
  // 0-based question, 1-based round (0 outside rounds)
  question: number;
  round: number;
  startedAt: Date;
  // null once finished
  endsAt: Date | null;
}

export const TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
] as const;

export interface Question {
  /** HTML, sanitized when shown */
  prompt: string;
  min: number;
  max: number;
}

export interface RoundResult {
  round: number;
  count: number;
  total: number;
  min: number | null;
  max: number | null;
}

export interface QuestionResult {
  question: number;
  rounds: RoundResult[];
}

export interface Assembly {
  title: string;
  /** null while a draft doesn't have one yet */
  startsAt: Date | null;
  /** IANA zone the assembly's times are shown in */
  timeZone: string;
  roundDurationSec: number;
  reportingDurationSec: number;
  roundsPerQuestion: number;
  neighborCount: number;
  readyWindowSec: number;
  questions: Question[];
  /** HTML shown on the invitation page, in the waiting room and at the end */
  landingHtml: string;
  readyHtml: string;
  finishedHtml: string;
  status: AssemblyStatus;
  /** Set once the cohort and its neighbors are chosen */
  launchedAt: Date | null;
  /** The current phase, from the launch on */
  phase: AssemblyPhase | null;
  /** How many took part from the start, and how many still do (those who answered the first round) */
  cohortSize: number;
  activeCount: number;
  finishedAt: Date | null;
  /** By question, filled in after each question's last round */
  results: QuestionResult[];
}

export type TraitValue = string | number | boolean;
export type Traits = Record<string, TraitValue>;

export interface Invitation {
  assemblyId: string;
  /** Single use, 20 random base62 characters (~119 bits) */
  code: string;
  traits: Traits;
  /** The participant who used it */
  participantId: string | null;
  usedAt: Date | null;
}

export interface Participant {
  assemblyId: string;
  invitationId: string;
  /** The member taking part (their acting user id) */
  userId: string;
  traits: Traits;
  joinedAt: Date;
  /** Last "I'm here" before the start: within `readyWindowSec` of it puts them in the cohort */
  readyAt: Date | null;
  /** Set at launch: whether they take part, and whose answers they see */
  inCohort: boolean | null;
  neighborIds: string[];
}

export interface StoredResponse {
  assemblyId: string;
  participantId: string;
  question: number;
  round: number;
  value: number;
  respondedAt: Date;
}
