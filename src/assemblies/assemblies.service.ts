import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PluginPage,
  PluginRecord,
} from '@unifyamerica/demleague-plugin-sdk';
import {
  AssemblyState,
  AssemblyStatus,
  DEFAULT_ROUND_DURATION_SEC,
  MAX_TRAIT_LENGTH,
  MAX_TRAITS,
  NEIGHBOR_COUNT,
  READY_WINDOW_SEC,
  REPORTING_DURATION_SEC,
  ROUNDS_PER_QUESTION,
  type Assembly,
  type Invitation,
  type Traits,
} from './assembly.interface';
import { AssemblyStore } from './assembly.store';
import type {
  CreateAssemblyDto,
  ListAssembliesQueryDto,
  UpdateAssemblyDto,
} from './dto/assembly.dto';
import type { CreateInvitationsDto } from './dto/invitation.dto';
import { firstAnswers, RunService } from './run.service';
import { assemblyState, endsAt, Phase, phaseAt } from './timeline';

const CODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 20;
const TRAIT_KEY = /^[A-Za-z_][A-Za-z0-9_ -]{0,49}$/;
const EXPORT_PAGE_SIZE = 50;

/** A single-use invitation code: 20 base62 characters from a cryptographic source (~119 bits). */
export function createInvitationCode(): string {
  // 248 is the largest multiple of 62 under 256, so rejecting bytes above it keeps every character equally likely
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < 248 && code.length < CODE_LENGTH)
        code += CODE_ALPHABET[byte % 62];
    }
  }
  return code;
}

/** Why an assembly can't be scheduled yet, empty when it can. */
export function scheduleProblems(
  assembly: Assembly,
  invitationCount: number,
  now: Date,
): string[] {
  const problems: string[] = [];
  if (!assembly.title.trim()) problems.push('It needs a title.');
  if (!assembly.startsAt) problems.push('It needs a start time.');
  else if (assembly.startsAt <= now)
    problems.push('Its start time must be in the future.');
  if (assembly.questions.length === 0)
    problems.push('It needs at least one question.');
  assembly.questions.forEach((question, i) => {
    if (!question.prompt.trim())
      problems.push(`Question ${i + 1} needs a prompt.`);
    if (question.min >= question.max) {
      problems.push(`Question ${i + 1}'s minimum must be below its maximum.`);
    }
  });
  if (invitationCount === 0) problems.push('It needs at least one invitation.');
  return problems;
}

export function checkTraits(entries: Record<string, unknown>[]): Traits[] {
  return entries.map((entry, i) => {
    const keys = Object.keys(entry);
    if (keys.length > MAX_TRAITS) {
      throw new BadRequestException(
        `Invitation ${i + 1} has more than ${MAX_TRAITS} traits.`,
      );
    }
    for (const key of keys) {
      const value = entry[key];
      if (key === 'code') {
        throw new BadRequestException(
          'Invitation codes are generated: leave "code" out of the traits.',
        );
      }
      if (!TRAIT_KEY.test(key)) {
        throw new BadRequestException(
          `Invitation ${i + 1}: "${key}" isn't a valid trait name.`,
        );
      }
      const valid =
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= MAX_TRAIT_LENGTH);
      if (!valid) {
        throw new BadRequestException(
          `Invitation ${i + 1}: "${key}" must be text (up to ${MAX_TRAIT_LENGTH} characters), a number or true/false.`,
        );
      }
    }
    return entry as Traits;
  });
}

export const toAssemblyView = (
  assembly: PluginRecord<Assembly>,
  now: Date,
) => ({
  ...assembly,
  state: assemblyState(assembly, now),
  endsAt: endsAt(assembly),
});
export type AssemblyView = ReturnType<typeof toAssemblyView>;

@Injectable()
export class AssembliesService {
  constructor(
    private readonly store: AssemblyStore,
    private readonly run: RunService,
  ) {}

  async list(
    query: ListAssembliesQueryDto,
    now = new Date(),
  ): Promise<PluginPage<AssemblyView>> {
    const limit = query.limit ?? 25;
    const page = await this.store.assemblies.find({
      filter: query.status ? { status: query.status } : {},
      sort: { startsAt: -1, createdAt: -1 },
      limit,
      skip: ((query.page ?? 1) - 1) * limit,
    });
    return { ...page, items: page.items.map((a) => toAssemblyView(a, now)) };
  }

  async find(id: string): Promise<PluginRecord<Assembly>> {
    const assembly = await this.store.assemblies.findById(id);
    if (!assembly) throw new NotFoundException('Assembly not found');
    return assembly;
  }

  async get(id: string, now = new Date()): Promise<AssemblyView> {
    return toAssemblyView(
      await this.run.prepare(await this.find(id), now),
      now,
    );
  }

  async create(
    dto: CreateAssemblyDto,
    now = new Date(),
  ): Promise<AssemblyView> {
    const assembly = await this.store.assemblies.insert({
      title: dto.title.trim(),
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      timeZone: dto.timeZone ?? 'America/New_York',
      roundDurationSec: dto.roundDurationSec ?? DEFAULT_ROUND_DURATION_SEC,
      reportingDurationSec: REPORTING_DURATION_SEC,
      roundsPerQuestion: ROUNDS_PER_QUESTION,
      neighborCount: NEIGHBOR_COUNT,
      readyWindowSec: READY_WINDOW_SEC,
      questions: (dto.questions ?? []).map(({ prompt, min, max }) => ({
        prompt,
        min,
        max,
      })),
      landingHtml: dto.landingHtml ?? '',
      readyHtml: dto.readyHtml ?? '',
      finishedHtml: dto.finishedHtml ?? '',
      status: AssemblyStatus.DRAFT,
      launchedAt: null,
      results: [],
    });
    return toAssemblyView(assembly, now);
  }

  /** Only before anyone joined, as in the original app: participants agreed to what they saw. */
  async update(
    id: string,
    dto: UpdateAssemblyDto,
    now = new Date(),
  ): Promise<AssemblyView> {
    const assembly = await this.find(id);
    await this.assertEditable(assembly, now);

    const changes: Partial<Assembly> = {};
    if (dto.title !== undefined) changes.title = dto.title.trim();
    if (dto.startsAt !== undefined)
      changes.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.timeZone !== undefined) changes.timeZone = dto.timeZone;
    if (dto.roundDurationSec !== undefined)
      changes.roundDurationSec = dto.roundDurationSec;
    if (dto.questions !== undefined) {
      changes.questions = dto.questions.map(({ prompt, min, max }) => ({
        prompt,
        min,
        max,
      }));
    }
    if (dto.landingHtml !== undefined) changes.landingHtml = dto.landingHtml;
    if (dto.readyHtml !== undefined) changes.readyHtml = dto.readyHtml;
    if (dto.finishedHtml !== undefined) changes.finishedHtml = dto.finishedHtml;

    // A scheduled assembly has to stay complete
    if (assembly.status === AssemblyStatus.SCHEDULED) {
      const problems = scheduleProblems(
        { ...assembly, ...changes },
        await this.store.invitations.count({ assemblyId: id }),
        now,
      );
      if (problems.length) throw new BadRequestException(problems.join(' '));
    }

    const updated = await this.store.assemblies.update(id, changes);
    if (!updated) throw new NotFoundException('Assembly not found');
    return toAssemblyView(updated, now);
  }

  async remove(id: string): Promise<void> {
    const assembly = await this.find(id);
    if (assembly.status !== AssemblyStatus.DRAFT) {
      throw new ConflictException(
        'Only drafts can be deleted: cancel it instead.',
      );
    }
    if ((await this.store.participants.count({ assemblyId: id })) > 0) {
      throw new ConflictException(
        'Members have joined this assembly: cancel it instead.',
      );
    }
    for (const invitation of await this.store.all(this.store.invitations, {
      assemblyId: id,
    })) {
      await this.store.invitations.remove(invitation.id);
    }
    await this.store.assemblies.remove(id);
  }

  async schedule(id: string, now = new Date()): Promise<AssemblyView> {
    const assembly = await this.find(id);
    if (assembly.status !== AssemblyStatus.DRAFT) {
      throw new ConflictException('Only drafts can be scheduled.');
    }
    const problems = scheduleProblems(
      assembly,
      await this.store.invitations.count({ assemblyId: id }),
      now,
    );
    if (problems.length) throw new BadRequestException(problems.join(' '));
    return this.setStatus(id, AssemblyStatus.SCHEDULED, now);
  }

  async unschedule(id: string, now = new Date()): Promise<AssemblyView> {
    const assembly = await this.find(id);
    if (assemblyState(assembly, now) !== AssemblyState.SCHEDULED) {
      throw new ConflictException(
        "Only an assembly that hasn't started can go back to draft.",
      );
    }
    if ((await this.store.participants.count({ assemblyId: id })) > 0) {
      throw new ConflictException(
        'Members have joined this assembly: cancel it instead.',
      );
    }
    return this.setStatus(id, AssemblyStatus.DRAFT, now);
  }

  async cancel(id: string, now = new Date()): Promise<AssemblyView> {
    const state = assemblyState(await this.find(id), now);
    if (state === AssemblyState.CANCELED || state === AssemblyState.FINISHED) {
      throw new ConflictException(`This assembly is already ${state}.`);
    }
    return this.setStatus(id, AssemblyStatus.CANCELED, now);
  }

  // Invitations

  async listInvitations(
    id: string,
    { page = 1, limit = 25 }: { page?: number; limit?: number },
  ) {
    await this.find(id);
    return this.store.invitations.find({
      filter: { assemblyId: id },
      sort: { createdAt: 1 },
      limit,
      skip: (page - 1) * limit,
    });
  }

  async createInvitations(
    id: string,
    dto: CreateInvitationsDto,
    now = new Date(),
  ): Promise<PluginRecord<Invitation>[]> {
    const state = assemblyState(await this.find(id), now);
    if (state === AssemblyState.CANCELED || state === AssemblyState.FINISHED) {
      throw new ConflictException(`This assembly is ${state}.`);
    }
    if ((dto.count === undefined) === (dto.traits === undefined)) {
      throw new BadRequestException('Send either a count or a list of traits.');
    }
    const traits = dto.traits
      ? checkTraits(dto.traits)
      : Array.from({ length: dto.count! }, () => ({}));

    const created: PluginRecord<Invitation>[] = [];
    for (const entry of traits) {
      created.push(
        await this.store.invitations.insert({
          assemblyId: id,
          code: createInvitationCode(),
          traits: entry,
          participantId: null,
          usedAt: null,
        }),
      );
    }
    return created;
  }

  async removeInvitation(id: string, invitationId: string): Promise<void> {
    await this.find(id);
    const invitation = await this.store.invitations.findById(invitationId);
    if (!invitation || invitation.assemblyId !== id) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.participantId) {
      throw new ConflictException(
        'This invitation was used, so it stays with the data.',
      );
    }
    await this.store.invitations.remove(invitationId);
  }

  // Progress and data

  async progress(id: string, now = new Date()) {
    const assembly = await this.run.prepare(await this.find(id), now);
    const phase = phaseAt(assembly, now);
    const participants = await this.store.all(this.store.participants, {
      assemblyId: id,
    });
    const cohort = participants.filter((p) => p.inCohort);
    // Before the start: who confirmed they're here within the ready window; after: who made the cohort
    const readySince = new Date(now.getTime() - assembly.readyWindowSec * 1000);
    const ready =
      phase.phase === Phase.NOT_STARTED
        ? participants.filter((p) => p.readyAt && p.readyAt >= readySince)
            .length
        : cohort.length;

    const answered = async (question: number, round: number) =>
      new Set(
        (
          await this.store.all(this.store.responses, {
            assemblyId: id,
            question,
            round,
          })
        ).map((r) => r.participantId),
      ).size;
    // As in the original app, whoever doesn't answer the first round is stopped once it's over
    const firstRoundOver =
      assembly.launchedAt !== null &&
      !(
        phase.phase === Phase.ROUND &&
        phase.question === 0 &&
        phase.round === 1
      );

    return {
      state: assemblyState(assembly, now),
      serverTime: now,
      phase,
      counts: {
        invitations: await this.store.invitations.count({ assemblyId: id }),
        joined: participants.length,
        ready,
        cohort: cohort.length,
        stopped: firstRoundOver
          ? Math.max(cohort.length - (await answered(0, 1)), 0)
          : 0,
        answeredThisRound:
          phase.phase === Phase.ROUND
            ? await answered(phase.question, phase.round)
            : 0,
      },
      results: assembly.results,
    };
  }

  /** A page of participants with their invitation and answers, for the CSV export. */
  async exportPage(id: string, page = 1) {
    await this.find(id);
    const participants = await this.store.participants.find({
      filter: { assemblyId: id },
      sort: { createdAt: 1 },
      limit: EXPORT_PAGE_SIZE,
      skip: (page - 1) * EXPORT_PAGE_SIZE,
    });
    const ids = participants.items.map((p) => p.id);
    const invitations = ids.length
      ? await this.store.all(this.store.invitations, {
          id: { $in: participants.items.map((p) => p.invitationId) },
        })
      : [];
    const responses = ids.length
      ? firstAnswers(
          await this.store.all(this.store.responses, {
            participantId: { $in: ids },
          }),
        )
      : [];
    const codeOf = new Map(invitations.map((i) => [i.id, i.code]));

    return {
      page,
      total: participants.total,
      hasMore: page * EXPORT_PAGE_SIZE < participants.total,
      participants: participants.items.map((p) => ({
        id: p.id,
        userId: p.userId,
        code: codeOf.get(p.invitationId) ?? null,
        traits: p.traits,
        joinedAt: p.joinedAt,
        readyAt: p.readyAt,
        inCohort: p.inCohort,
        neighborIds: p.neighborIds,
        responses: responses
          .filter((r) => r.participantId === p.id)
          .map(({ question, round, value, respondedAt }) => ({
            question,
            round,
            value,
            respondedAt,
          })),
      })),
    };
  }

  private async assertEditable(
    assembly: PluginRecord<Assembly>,
    now: Date,
  ): Promise<void> {
    const state = assemblyState(assembly, now);
    if (state !== AssemblyState.DRAFT && state !== AssemblyState.SCHEDULED) {
      throw new ConflictException(
        `This assembly is ${state}, so it can't be edited.`,
      );
    }
    if (
      (await this.store.participants.count({ assemblyId: assembly.id })) > 0
    ) {
      throw new ConflictException(
        "Members have joined this assembly, so it can't be edited.",
      );
    }
  }

  private async setStatus(
    id: string,
    status: AssemblyStatus,
    now: Date,
  ): Promise<AssemblyView> {
    const updated = await this.store.assemblies.update(id, { status });
    if (!updated) throw new NotFoundException('Assembly not found');
    return toAssemblyView(updated, now);
  }
}
