// The API's responses as JSON (dates as ISO strings). Declared here: the UI can't import the server code.

export const AssemblyStatus = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  CANCELED: 'canceled',
} as const;
export type AssemblyStatus =
  (typeof AssemblyStatus)[keyof typeof AssemblyStatus];

export const AssemblyState = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  FINISHED: 'finished',
  CANCELED: 'canceled',
} as const;
export type AssemblyState = (typeof AssemblyState)[keyof typeof AssemblyState];

export const SessionState = {
  WAITING: 'waiting',
  NOT_READY: 'not-ready',
  STARTING: 'starting',
  LATE: 'late',
  MISSED: 'missed',
  ANSWERING: 'answering',
  ANSWERED: 'answered',
  STOPPED: 'stopped',
  REPORT: 'report',
  FINISHED: 'finished',
  CANCELED: 'canceled',
} as const;
export type SessionState = (typeof SessionState)[keyof typeof SessionState];

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
export const MAX_QUESTIONS = 9;

export interface Question {
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
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  roundDurationSec: number;
  reportingDurationSec: number;
  roundsPerQuestion: number;
  neighborCount: number;
  readyWindowSec: number;
  questions: Question[];
  landingHtml: string;
  readyHtml: string;
  finishedHtml: string;
  status: AssemblyStatus;
  state: AssemblyState;
  launchedAt: string | null;
  phase: {
    key: string;
    kind: 'round' | 'report' | 'finished';
    question: number;
    round: number;
    startedAt: string;
    endsAt: string | null;
  } | null;
  cohortSize: number;
  activeCount: number;
  finishedAt: string | null;
  results: QuestionResult[];
  createdAt: string;
  updatedAt: string;
}

export interface AssemblyInput {
  title: string;
  startsAt: string | null;
  timeZone: string;
  roundDurationSec: number;
  questions: Question[];
  landingHtml: string;
  readyHtml: string;
  finishedHtml: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  skip: number;
}

export type Traits = Record<string, string | number | boolean>;

export interface Invitation {
  id: string;
  assemblyId: string;
  code: string;
  traits: Traits;
  participantId: string | null;
  usedAt: string | null;
  createdAt: string;
}

export interface Phase {
  phase: 'not-started' | 'round' | 'report' | 'finished';
  question: number;
  round: number;
  startedAt: string | null;
  endsAt: string | null;
}

export interface Progress {
  state: AssemblyState;
  serverTime: string;
  phase: Phase;
  counts: {
    invitations: number;
    joined: number;
    ready: number;
    cohort: number;
    stopped: number;
    answeredThisRound: number;
  };
  results: QuestionResult[];
}

export interface ExportPage {
  page: number;
  total: number;
  hasMore: boolean;
  participants: {
    id: string;
    userId: string;
    code: string | null;
    traits: Traits;
    joinedAt: string;
    readyAt: string | null;
    inCohort: boolean | null;
    neighborIds: string[];
    responses: {
      question: number;
      round: number;
      value: number;
      respondedAt: string;
    }[];
  }[];
}

export interface AssemblySummary {
  id: string;
  title: string;
  startsAt: string | null;
  timeZone: string;
  questionCount: number;
  roundsPerQuestion: number;
  roundDurationSec: number;
  readyWindowSec: number;
  state: AssemblyState;
}

export interface Participation {
  id: string;
  joinedAt: string;
  assembly: AssemblySummary;
}

export interface InvitationPreview {
  assembly: AssemblySummary;
  landingHtml: string;
  participationId: string | null;
  used: boolean;
}

export interface ReportRound {
  round: number;
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
  mine: number | null;
}

export interface Session {
  id: string;
  assembly: AssemblySummary & { readyHtml: string; finishedHtml: string };
  state: SessionState;
  serverTime: string;
  readyAt: string | null;
  phase: Phase;
  question: (Question & { index: number }) | null;
  myAnswer: number | null;
  previous: {
    round: number;
    mine: number | null;
    neighborsAverage: number | null;
    neighborsAnswered: number;
  } | null;
  report: { question: number; rounds: ReportRound[] } | null;
}
