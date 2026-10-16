import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  PluginActor,
  PluginOrganization,
} from '@unifyamerica/demleague-plugin-sdk';
import {
  createPluginTestHarness,
  type PluginTestHarness,
} from '@unifyamerica/demleague-plugin-sdk/testing';
import { AssembliesService } from '../assemblies/assemblies.service';
import { SuperAssemblyPlugin } from '../super-assembly.plugin';
import { ParticipationService, SessionState } from './participation.service';

const orgA: PluginOrganization = {
  id: 'org-a',
  name: 'A',
  slug: 'a',
  description: null,
};
const orgB: PluginOrganization = {
  id: 'org-b',
  name: 'B',
  slug: 'b',
  description: null,
};
const actor = (n: number): PluginActor => ({
  id: n.toString(16).padStart(24, '0'),
  memberships: [{ organizationId: 'org-a', roles: ['member'] }],
});
const admin = actor(99);

const startsAt = new Date('2027-08-01T23:00:00.000Z');
const at = (s: number) => new Date(startsAt.getTime() + s * 1000);

// Two questions, 3 rounds of 60 s each, a 30 s report between them: round r of question q starts at
// q × 210 + (r - 1) × 60 seconds; the assembly ends at 390 s
const roundStart = (question: number, round: number) =>
  at(question * 210 + (round - 1) * 60 + 5);

describe('ParticipationService', () => {
  let harness: PluginTestHarness;
  let service: ParticipationService;
  let assemblyId: string;
  let codes: string[];

  beforeEach(async () => {
    harness = await createPluginTestHarness(SuperAssemblyPlugin, {
      actor: admin,
      tenant: orgA,
    });
    service = harness.module.get(ParticipationService);
    const assemblies = harness.module.get(AssembliesService);
    const before = at(-3600);
    const assembly = await assemblies.create(
      {
        title: 'Akron Assembly',
        startsAt: startsAt.toISOString(),
        roundDurationSec: 60,
        questions: [
          { prompt: '<p>Four-day week?</p>', min: 0, max: 100 },
          { prompt: '<p>Six-day week?</p>', min: 0, max: 10 },
        ],
        landingHtml: '<h1>Welcome</h1>',
        readyHtml: '<p>Get ready</p>',
        finishedHtml: '<p>Thanks</p>',
      },
      before,
    );
    assemblyId = assembly.id;
    codes = (
      await assemblies.createInvitations(assemblyId, { count: 8 }, before)
    ).map((i) => i.code);
    await assemblies.schedule(assemblyId, before);
  });
  afterEach(() => harness.close());

  const as = (n: number) => {
    harness.context.setActor(actor(n));
    return actor(n);
  };

  it('should preview an invitation, then join with it once', async () => {
    const ada = as(1);
    const preview = await service.preview(ada, codes[0], at(-600));
    expect(preview).toEqual(
      expect.objectContaining({
        landingHtml: '<h1>Welcome</h1>',
        participationId: null,
        used: false,
        assembly: expect.objectContaining({
          title: 'Akron Assembly',
          questionCount: 2,
          state: 'scheduled',
        }),
      }),
    );

    const { id } = await service.join(ada, codes[0], at(-600));
    // Joining again, with the same code or another one, is the same participation
    expect(await service.join(ada, codes[0], at(-500))).toEqual({ id });
    expect(await service.join(ada, codes[1], at(-500))).toEqual({ id });
    expect(
      (await service.preview(ada, codes[0], at(-500))).participationId,
    ).toBe(id);
    expect((await service.list(ada, at(-500))).map((p) => p.id)).toEqual([id]);
  });

  it("should treat someone else's used code, unknown codes and drafts as not found", async () => {
    await service.join(as(1), codes[0], at(-600));
    const bob = as(2);
    await expect(service.preview(bob, codes[0], at(-600))).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.join(bob, codes[0], at(-600))).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.join(bob, 'A'.repeat(20), at(-600))).rejects.toThrow(
      NotFoundException,
    );

    harness.context.setTenant(orgB);
    await expect(service.join(bob, codes[1], at(-600))).rejects.toThrow(
      NotFoundException,
    );
  });

  it("should keep each member's participation to themselves", async () => {
    const { id } = await service.join(as(1), codes[0], at(-600));
    await expect(service.session(as(2), id, at(-600))).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.ready(as(2), id, at(-600))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should ask for a fresh "I\'m here" in the waiting room', async () => {
    const ada = as(1);
    const { id } = await service.join(ada, codes[0], at(-600));
    expect((await service.session(ada, id, at(-570))).state).toBe(
      SessionState.WAITING,
    );
    expect((await service.session(ada, id, at(-500))).state).toBe(
      SessionState.NOT_READY,
    );
    expect((await service.ready(ada, id, at(-500))).state).toBe(
      SessionState.WAITING,
    );
    await expect(service.ready(ada, id, at(1))).rejects.toThrow(
      ConflictException,
    );
  });

  it('should run a whole assembly', async () => {
    // Four members confirm in time, one lets it lapse, one joins after the start
    const ids: Record<number, string> = {};
    for (const n of [1, 2, 3, 4, 5]) {
      ids[n] = (await service.join(as(n), codes[n], at(-300))).id;
    }
    for (const n of [1, 2, 3, 4]) await service.ready(as(n), ids[n], at(-30));
    ids[6] = (await service.join(as(6), codes[6], at(1))).id;

    // Within the launch grace nobody is picked yet
    expect((await service.session(as(1), ids[1], at(1))).state).toBe(
      SessionState.STARTING,
    );
    expect((await service.session(as(6), ids[6], at(1))).state).toBe(
      SessionState.LATE,
    );

    // Launch: the four ready members see each other (3 neighbors each, the most four can have)
    const first = await service.session(as(1), ids[1], roundStart(0, 1));
    expect(first).toEqual(
      expect.objectContaining({
        state: SessionState.ANSWERING,
        phase: expect.objectContaining({
          phase: 'round',
          question: 0,
          round: 1,
        }),
        question: {
          index: 0,
          prompt: '<p>Four-day week?</p>',
          min: 0,
          max: 100,
        },
        myAnswer: null,
        previous: null,
      }),
    );
    expect((await service.session(as(5), ids[5], roundStart(0, 1))).state).toBe(
      SessionState.MISSED,
    );
    const stored = [
      ...harness.data.store.get('participants')!.values(),
    ] as unknown as {
      id: string;
      inCohort: boolean;
      neighborIds: string[];
    }[];
    const cohort = stored.filter((p) => p.inCohort);
    expect(cohort.map((p) => p.id).sort()).toEqual(
      [ids[1], ids[2], ids[3], ids[4]].sort(),
    );
    cohort.forEach((p) => expect(p.neighborIds).toHaveLength(3));

    // Round 1: members 1–3 answer, member 4 doesn't
    await expect(
      service.respond(as(1), ids[1], 101, roundStart(0, 1)),
    ).rejects.toThrow(BadRequestException);
    expect(
      (await service.respond(as(1), ids[1], 40, roundStart(0, 1))).state,
    ).toBe(SessionState.ANSWERED);
    await expect(
      service.respond(as(1), ids[1], 41, roundStart(0, 1)),
    ).rejects.toThrow('You already answered this round.');
    await service.respond(as(2), ids[2], 60, roundStart(0, 1));
    await service.respond(as(3), ids[3], 80, roundStart(0, 1));
    await expect(
      service.respond(as(5), ids[5], 50, roundStart(0, 1)),
    ).rejects.toThrow(ConflictException);

    // Round 2: their own last answer and their neighbors' average; member 4 is stopped
    const second = await service.session(as(1), ids[1], roundStart(0, 2));
    expect(second.state).toBe(SessionState.ANSWERING);
    expect(second.previous).toEqual({
      round: 1,
      mine: 40,
      neighborsAverage: 70,
      neighborsAnswered: 2,
    });
    expect((await service.session(as(4), ids[4], roundStart(0, 2))).state).toBe(
      SessionState.STOPPED,
    );
    for (const [n, value] of [
      [1, 50],
      [2, 60],
      [3, 70],
    ]) {
      await service.respond(as(n), ids[n], value, roundStart(0, 2));
    }
    await service.respond(as(1), ids[1], 55, roundStart(0, 3));

    // The report: each round's average, range and the member's own answers
    const report = await service.session(as(1), ids[1], at(185));
    expect(report.state).toBe(SessionState.REPORT);
    expect(report.report).toEqual({
      question: 0,
      rounds: [
        { round: 1, count: 3, average: 60, min: 40, max: 80, mine: 40 },
        { round: 2, count: 3, average: 60, min: 50, max: 70, mine: 50 },
        { round: 3, count: 1, average: 55, min: 55, max: 55, mine: 55 },
      ],
    });

    // Question 2, with its own bounds, then the end
    const next = await service.session(as(1), ids[1], roundStart(1, 1));
    expect(next.question).toEqual({
      index: 1,
      prompt: '<p>Six-day week?</p>',
      min: 0,
      max: 10,
    });
    await expect(
      service.respond(as(1), ids[1], 11, roundStart(1, 1)),
    ).rejects.toThrow('Answer with a whole number from 0 to 10.');
    await service.respond(as(1), ids[1], 7, roundStart(1, 1));

    const finished = await service.session(as(1), ids[1], at(400));
    expect(finished).toEqual(
      expect.objectContaining({
        state: SessionState.FINISHED,
        assembly: expect.objectContaining({
          finishedHtml: '<p>Thanks</p>',
          state: 'finished',
        }),
        report: expect.objectContaining({ question: 1 }),
      }),
    );
    expect(finished.report?.rounds[0]).toEqual({
      round: 1,
      count: 1,
      average: 7,
      min: 7,
      max: 7,
      mine: 7,
    });

    // The admin sees the same run
    harness.context.setActor(admin);
    const progress = await harness.module
      .get(AssembliesService)
      .progress(assemblyId, at(400));
    expect(progress.counts).toEqual(
      expect.objectContaining({
        invitations: 8,
        joined: 6,
        cohort: 4,
        stopped: 1,
      }),
    );
    const exported = await harness.module
      .get(AssembliesService)
      .exportPage(assemblyId, 1);
    expect(exported.total).toBe(6);
    expect(
      exported.participants.find((p) => p.id === ids[1])?.responses,
    ).toHaveLength(4);
  });

  it('should launch the same way however often it runs', async () => {
    const ids = [];
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const { id } = await service.join(as(n), codes[n], at(-30));
      ids.push(id);
    }
    await service.session(as(1), ids[0], roundStart(0, 1));
    const neighbors = () =>
      (
        [...harness.data.store.get('participants')!.values()] as unknown as {
          neighborIds: string[];
        }[]
      ).map((p) => p.neighborIds);
    const first = neighbors();

    // A second launch (as when two requests race) picks the same cohort and neighbors
    await harness.data
      .collection('assemblies')
      .update(assemblyId, { launchedAt: null });
    await service.session(as(2), ids[1], roundStart(0, 1));
    expect(neighbors()).toEqual(first);
  });

  it('should tell members of canceled assemblies', async () => {
    const ada = as(1);
    const { id } = await service.join(ada, codes[0], at(-60));
    harness.context.setActor(admin);
    await harness.module.get(AssembliesService).cancel(assemblyId, at(-50));
    expect((await service.session(ada, id, at(-40))).state).toBe(
      SessionState.CANCELED,
    );
    await expect(service.join(as(2), codes[1], at(-40))).rejects.toThrow(
      'This assembly is canceled.',
    );
  });
});
