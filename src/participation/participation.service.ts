import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PluginActor,
  PluginRecord,
} from '@unifyamerica/demleague-plugin-sdk';
import {
  AssemblyState,
  AssemblyStatus,
  type Assembly,
  type Invitation,
  type Participant,
} from '../assemblies/assembly.interface';
import { AssemblyStore } from '../assemblies/assembly.store';
import { AssemblyClock } from '../assemblies/assembly.clock';
import { firstAnswers, RunService } from '../assemblies/run.service';
import {
  assemblyState,
  currentPhase,
  Phase,
  roundKey,
  type PhaseAt,
} from '../assemblies/timeline';

/** Where a participant is, which decides what their page shows. */
export const SessionState = {
  /** Before the start, and they confirmed they're here within the ready window */
  WAITING: 'waiting',
  /** Before the start, without a recent confirmation: they'll be left out unless they confirm */
  NOT_READY: 'not-ready',
  /** Just started: the cohort is being picked */
  STARTING: 'starting',
  /** Joined after the start */
  LATE: 'late',
  /** Joined in time but hadn't confirmed they were here at the start */
  MISSED: 'missed',
  ANSWERING: 'answering',
  /** Answered this round, waiting for it to end */
  ANSWERED: 'answered',
  /** Didn't answer the first round */
  STOPPED: 'stopped',
  /** Between questions: the last question's results */
  REPORT: 'report',
  FINISHED: 'finished',
  CANCELED: 'canceled',
} as const;
export type SessionState = (typeof SessionState)[keyof typeof SessionState];

const summary = (assembly: PluginRecord<Assembly>, now: Date) => ({
  id: assembly.id,
  title: assembly.title,
  startsAt: assembly.startsAt,
  timeZone: assembly.timeZone,
  questionCount: assembly.questions.length,
  roundsPerQuestion: assembly.roundsPerQuestion,
  roundDurationSec: assembly.roundDurationSec,
  readyWindowSec: assembly.readyWindowSec,
  state: assemblyState(assembly, now),
});

const average = (values: number[]) =>
  values.length
    ? Math.floor(values.reduce((sum, v) => sum + v, 0) / values.length)
    : null;

@Injectable()
export class ParticipationService {
  constructor(
    private readonly store: AssemblyStore,
    private readonly run: RunService,
    private readonly clock: AssemblyClock,
  ) {}

  /** The current user's assemblies, newest first. */
  async list(actor: PluginActor, now = this.clock.now()) {
    const { items } = await this.store.participants.find({
      filter: { userId: actor.id },
      sort: { joinedAt: -1 },
      limit: 100,
    });
    const assemblies = items.length
      ? await this.store.all(this.store.assemblies, {
          id: { $in: [...new Set(items.map((p) => p.assemblyId))] },
        })
      : [];
    const byId = new Map(assemblies.map((a) => [a.id, a]));
    return items.flatMap((participant) => {
      const assembly = byId.get(participant.assemblyId);
      return assembly
        ? [
            {
              id: participant.id,
              joinedAt: participant.joinedAt,
              assembly: summary(assembly, now),
            },
          ]
        : [];
    });
  }

  /** What an invitation link shows before joining. Unknown codes, and others' used ones, are not found. */
  async preview(actor: PluginActor, code: string, now = this.clock.now()) {
    const { invitation, assembly, existing } = await this.resolveInvitation(
      actor,
      code,
    );
    return {
      assembly: summary(assembly, now),
      landingHtml: assembly.landingHtml,
      participationId: existing?.id ?? null,
      used: invitation.participantId !== null,
    };
  }

  /** Joins with an invitation code. Joining again (same code or another one) returns the same participation. */
  async join(
    actor: PluginActor,
    code: string,
    now = this.clock.now(),
  ): Promise<{ id: string }> {
    const { invitation, assembly, existing } = await this.resolveInvitation(
      actor,
      code,
    );
    if (existing) return { id: existing.id };

    const state = assemblyState(assembly, now);
    if (state === AssemblyState.FINISHED || state === AssemblyState.CANCELED) {
      throw new ConflictException(`This assembly is ${state}.`);
    }
    // Joining counts as a first "I'm here", as it did in the original app
    const beforeStart = assembly.startsAt !== null && now < assembly.startsAt;
    const participant = await this.store.participants.insert({
      assemblyId: assembly.id,
      invitationId: invitation.id,
      userId: actor.id,
      traits: invitation.traits,
      joinedAt: now,
      readyAt: beforeStart ? now : null,
      inCohort: null,
      neighborIds: [],
    });
    await this.store.invitations.update(invitation.id, {
      participantId: participant.id,
      usedAt: now,
    });
    return { id: participant.id };
  }

  async session(actor: PluginActor, id: string, now = this.clock.now()) {
    const found = await this.findOwn(actor, id);
    const assembly = await this.loadAssembly(found.assemblyId);
    return this.buildSession(assembly, found, now);
  }

  /** "I'm here": keeps a place in the cohort, until the start. */
  async ready(actor: PluginActor, id: string, now = this.clock.now()) {
    const participant = await this.findOwn(actor, id);
    const assembly = await this.loadAssembly(participant.assemblyId);
    if (
      assembly.status !== AssemblyStatus.SCHEDULED ||
      !assembly.startsAt ||
      now >= assembly.startsAt
    ) {
      throw new ConflictException('This assembly has already started.');
    }
    const updated = await this.store.participants.update(participant.id, {
      readyAt: now,
    });
    return this.buildSession(assembly, updated ?? participant, now);
  }

  async respond(
    actor: PluginActor,
    id: string,
    value: number,
    now = this.clock.now(),
  ) {
    const participant = await this.findOwn(actor, id);
    const assembly = await this.loadAssembly(participant.assemblyId);
    const session = await this.buildSession(assembly, participant, now);
    if (session.state !== SessionState.ANSWERING || !session.question) {
      throw new ConflictException(
        session.state === SessionState.ANSWERED
          ? 'You already answered this round.'
          : 'There is no round to answer right now.',
      );
    }
    const { min, max } = session.question;
    if (value < min || value > max) {
      throw new BadRequestException(
        `Answer with a whole number from ${min} to ${max}.`,
      );
    }
    await this.store.responses.insert({
      assemblyId: assembly.id,
      participantId: participant.id,
      question: session.phase.question,
      round: session.phase.round,
      value,
      respondedAt: now,
    });
    // The last answer the round waited for ends it now, instead of at its time
    await this.run.endRoundIfAllAnswered(assembly);
    return this.buildSession(assembly, participant, now);
  }

  // Others' participations are reported as not found, so ids can't be probed
  private async findOwn(
    actor: PluginActor,
    id: string,
  ): Promise<PluginRecord<Participant>> {
    const participant = await this.store.participants.findById(id);
    if (!participant || participant.userId !== actor.id) {
      throw new NotFoundException('Participation not found');
    }
    return participant;
  }

  private async loadAssembly(
    assemblyId: string,
  ): Promise<PluginRecord<Assembly>> {
    const assembly = await this.store.assemblies.findById(assemblyId);
    if (!assembly) throw new NotFoundException('Assembly not found');
    await this.run.healOverdue(assembly);
    return assembly;
  }

  private async resolveInvitation(actor: PluginActor, code: string) {
    const notFound = () =>
      new NotFoundException('This invitation link is not valid.');
    const { items } = await this.store.invitations.find({
      filter: { code },
      limit: 1,
    });
    const invitation: PluginRecord<Invitation> | undefined = items[0];
    if (!invitation) throw notFound();

    const assembly = await this.store.assemblies.findById(
      invitation.assemblyId,
    );
    if (!assembly || assembly.status === AssemblyStatus.DRAFT) throw notFound();

    const { items: mine } = await this.store.participants.find({
      filter: { assemblyId: assembly.id, userId: actor.id },
      limit: 1,
    });
    const existing: PluginRecord<Participant> | undefined = mine[0];
    // Someone else's code: as if it didn't exist
    if (invitation.participantId && invitation.participantId !== existing?.id)
      throw notFound();
    return { invitation, assembly, existing };
  }

  private async buildSession(
    assembly: PluginRecord<Assembly>,
    participant: PluginRecord<Participant>,
    now: Date,
  ) {
    const phase = currentPhase(assembly);
    const responses = firstAnswers(
      await this.store.all(this.store.responses, {
        participantId: participant.id,
      }),
    );
    const answerTo = (question: number, round: number) =>
      responses.find((r) => r.question === question && r.round === round)
        ?.value ?? null;
    const state = this.stateOf(assembly, participant, phase, answerTo, now);

    const showsQuestion =
      state === SessionState.ANSWERING ||
      state === SessionState.ANSWERED ||
      state === SessionState.REPORT ||
      state === SessionState.FINISHED;
    const question = showsQuestion
      ? assembly.questions[phase.question]
      : undefined;

    // From the second round: their own last answer and their neighbors' average
    let previous: {
      round: number;
      mine: number | null;
      neighborsAverage: number | null;
      neighborsAnswered: number;
    } | null = null;
    if (
      (state === SessionState.ANSWERING || state === SessionState.ANSWERED) &&
      phase.round > 1
    ) {
      const neighbors = participant.neighborIds.length
        ? firstAnswers(
            await this.store.all(this.store.responses, {
              participantId: { $in: participant.neighborIds },
              question: phase.question,
              round: phase.round - 1,
            }),
          ).map((r) => r.value)
        : [];
      previous = {
        round: phase.round - 1,
        mine: answerTo(phase.question, phase.round - 1),
        neighborsAverage: average(neighbors),
        neighborsAnswered: neighbors.length,
      };
    }

    // The question's results, once computed (a couple of seconds after its last round)
    let report = null;
    if (state === SessionState.REPORT || state === SessionState.FINISHED) {
      const result = assembly.results.find(
        (r) => r.question === phase.question,
      );
      report = result
        ? {
            question: phase.question,
            rounds: result.rounds.map((r) => ({
              round: r.round,
              count: r.count,
              average: r.count
                ? Math.round((r.total / r.count) * 100) / 100
                : null,
              min: r.min,
              max: r.max,
              mine: answerTo(phase.question, r.round),
            })),
          }
        : null;
    }

    return {
      id: participant.id,
      assembly: {
        ...summary(assembly, now),
        readyHtml: assembly.readyHtml,
        finishedHtml:
          state === SessionState.FINISHED ? assembly.finishedHtml : '',
      },
      state,
      serverTime: now,
      readyAt: participant.readyAt,
      phase,
      question: question ? { index: phase.question, ...question } : null,
      myAnswer: phase.round > 0 ? answerTo(phase.question, phase.round) : null,
      previous,
      report,
    };
  }

  private stateOf(
    assembly: PluginRecord<Assembly>,
    participant: PluginRecord<Participant>,
    phase: PhaseAt,
    answerTo: (question: number, round: number) => number | null,
    now: Date,
  ): SessionState {
    if (assembly.status !== AssemblyStatus.SCHEDULED)
      return SessionState.CANCELED;
    const startsAt = assembly.startsAt!;
    if (phase.phase === Phase.NOT_STARTED && now < startsAt) {
      const fresh =
        participant.readyAt !== null &&
        now.getTime() - participant.readyAt.getTime() <=
          assembly.readyWindowSec * 1000;
      return fresh ? SessionState.WAITING : SessionState.NOT_READY;
    }
    if (participant.joinedAt >= startsAt) return SessionState.LATE;
    if (!assembly.launchedAt) return SessionState.STARTING;
    if (!participant.inCohort) return SessionState.MISSED;
    if (phase.phase === Phase.FINISHED) return SessionState.FINISHED;

    const pastFirstRound = assembly.phase?.key !== roundKey(0, 1);
    if (pastFirstRound && answerTo(0, 1) === null) return SessionState.STOPPED;
    if (phase.phase === Phase.REPORT) return SessionState.REPORT;
    return answerTo(phase.question, phase.round) === null
      ? SessionState.ANSWERING
      : SessionState.ANSWERED;
  }
}

export type Session = Awaited<ReturnType<ParticipationService['session']>>;
