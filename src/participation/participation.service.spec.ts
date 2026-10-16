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
import { AssemblyClock } from '../assemblies/assembly.clock';
import { RunService } from '../assemblies/run.service';
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

describe('ParticipationService', () => {
  let harness: PluginTestHarness;
  let service: ParticipationService;
  let assemblyId: string;
  let codes: string[];
  let clock: Date;

  // Moves the clock and runs the jobs due by then, like the host's dispatcher
  const go = async (s: number) => {
    clock = at(s);
    return harness.jobs.runDue(clock);
  };
  const as = (n: number) => {
    harness.context.setActor(actor(n));
    return actor(n);
  };
  const assembly = async () =>
    (await harness.data
      .collection('assemblies')
      .findById(assemblyId)) as unknown as {
      phase: { key: string; endsAt: Date | null } | null;
      activeCount: number;
      cohortSize: number;
      results: { question: number }[];
    };

  beforeEach(async () => {
    harness = await createPluginTestHarness(SuperAssemblyPlugin, {
      actor: admin,
      tenant: orgA,
      organizations: [orgA, orgB],
    });
    service = harness.module.get(ParticipationService);
    clock = at(-3600);
    harness.jobs.setClock(() => clock);
    jest
      .spyOn(harness.module.get(AssemblyClock), 'now')
      .mockImplementation(() => clock);

    const assemblies = harness.module.get(AssembliesService);
    const created = await assemblies.create({
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
    });
    assemblyId = created.id;
    codes = (await assemblies.createInvitations(assemblyId, { count: 8 })).map(
      (i) => i.code,
    );
    await assemblies.schedule(assemblyId);
  });
  afterEach(() => harness.close());

  it('should preview an invitation, then join with it once', async () => {
    const ada = as(1);
    clock = at(-600);
    expect(await service.preview(ada, codes[0])).toEqual(
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

    const { id } = await service.join(ada, codes[0]);
    expect(await service.join(ada, codes[0])).toEqual({ id });
    expect(await service.join(ada, codes[1])).toEqual({ id });
    expect((await service.preview(ada, codes[0])).participationId).toBe(id);
    expect((await service.list(ada)).map((p) => p.id)).toEqual([id]);
  });

  it("should treat someone else's used code, unknown codes and other organizations as not found", async () => {
    clock = at(-600);
    await service.join(as(1), codes[0]);
    const bob = as(2);
    await expect(service.preview(bob, codes[0])).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.join(bob, codes[0])).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.join(bob, 'A'.repeat(20))).rejects.toThrow(
      NotFoundException,
    );
    harness.context.setTenant(orgB);
    await expect(service.join(bob, codes[1])).rejects.toThrow(
      NotFoundException,
    );
  });

  it("should keep each member's participation to themselves", async () => {
    clock = at(-600);
    const { id } = await service.join(as(1), codes[0]);
    await expect(service.session(as(2), id)).rejects.toThrow(NotFoundException);
    await expect(service.ready(as(2), id)).rejects.toThrow(NotFoundException);
  });

  it('should ask for a fresh "I\'m here" in the waiting room', async () => {
    const ada = as(1);
    clock = at(-600);
    const { id } = await service.join(ada, codes[0]);
    clock = at(-570);
    expect((await service.session(ada, id)).state).toBe(SessionState.WAITING);
    clock = at(-500);
    expect((await service.session(ada, id)).state).toBe(SessionState.NOT_READY);
    expect((await service.ready(ada, id)).state).toBe(SessionState.WAITING);
    clock = at(1);
    await expect(service.ready(ada, id)).rejects.toThrow(ConflictException);
  });

  it('should run a whole assembly on its jobs, ending a round early once everyone answered', async () => {
    // Four members confirm in time, one lets it lapse, one joins after the start
    const ids: Record<number, string> = {};
    clock = at(-300);
    for (const n of [1, 2, 3, 4, 5]) {
      ids[n] = (await service.join(as(n), codes[n])).id;
    }
    clock = at(-30);
    for (const n of [1, 2, 3, 4]) await service.ready(as(n), ids[n]);
    clock = at(1);
    ids[6] = (await service.join(as(6), codes[6])).id;

    // Started, launched two seconds later by the launch job
    expect(await go(1)).toEqual([]);
    expect((await service.session(as(1), ids[1])).state).toBe(
      SessionState.STARTING,
    );
    expect((await service.session(as(6), ids[6])).state).toBe(
      SessionState.LATE,
    );
    expect(await go(2)).toEqual([
      expect.objectContaining({ name: 'launch', status: 'done' }),
    ]);
    expect(await assembly()).toEqual(
      expect.objectContaining({
        cohortSize: 4,
        phase: expect.objectContaining({ key: 'q0-r1', endsAt: at(60) }),
      }),
    );
    expect((await service.session(as(5), ids[5])).state).toBe(
      SessionState.MISSED,
    );
    expect(await service.session(as(1), ids[1])).toEqual(
      expect.objectContaining({
        state: SessionState.ANSWERING,
        phase: expect.objectContaining({
          phase: 'round',
          question: 0,
          round: 1,
          endsAt: at(60),
        }),
        question: {
          index: 0,
          prompt: '<p>Four-day week?</p>',
          min: 0,
          max: 100,
        },
      }),
    );

    // Round 1: members 1–3 answer, member 4 doesn't, so it runs its full minute
    clock = at(5);
    await expect(service.respond(as(1), ids[1], 101)).rejects.toThrow(
      BadRequestException,
    );
    expect((await service.respond(as(1), ids[1], 40)).state).toBe(
      SessionState.ANSWERED,
    );
    await expect(service.respond(as(1), ids[1], 41)).rejects.toThrow(
      'You already answered this round.',
    );
    await service.respond(as(2), ids[2], 60);
    await service.respond(as(3), ids[3], 80);
    await expect(service.respond(as(5), ids[5], 50)).rejects.toThrow(
      ConflictException,
    );
    expect(await go(5)).toEqual([]);

    // Round 2: member 4 is stopped, so three answers end it early
    await go(60);
    expect(await assembly()).toEqual(
      expect.objectContaining({
        activeCount: 3,
        phase: expect.objectContaining({ key: 'q0-r2', endsAt: at(120) }),
      }),
    );
    expect((await service.session(as(4), ids[4])).state).toBe(
      SessionState.STOPPED,
    );
    clock = at(65);
    expect((await service.session(as(1), ids[1])).previous).toEqual({
      round: 1,
      mine: 40,
      neighborsAverage: 70,
      neighborsAnswered: 2,
    });
    await service.respond(as(1), ids[1], 50);
    await service.respond(as(2), ids[2], 60);
    await service.respond(as(3), ids[3], 70);
    expect(await go(65)).toEqual([
      expect.objectContaining({ name: 'advance', status: 'done' }),
    ]);
    expect((await assembly()).phase).toEqual(
      expect.objectContaining({ key: 'q0-r3', endsAt: at(125) }),
    );

    // Round 3 runs out; the report, then the results a couple of seconds later
    clock = at(70);
    await service.respond(as(1), ids[1], 55);
    await go(125);
    expect((await assembly()).phase).toEqual(
      expect.objectContaining({ key: 'q0-report', endsAt: at(155) }),
    );
    expect((await service.session(as(1), ids[1])).report).toBeNull();
    await go(127);
    const report = await service.session(as(1), ids[1]);
    expect(report.state).toBe(SessionState.REPORT);
    expect(report.report).toEqual({
      question: 0,
      rounds: [
        { round: 1, count: 3, average: 60, min: 40, max: 80, mine: 40 },
        { round: 2, count: 3, average: 60, min: 50, max: 70, mine: 50 },
        { round: 3, count: 1, average: 55, min: 55, max: 55, mine: 55 },
      ],
    });

    // Question 2 (no report after the last question), then the end
    await go(155);
    clock = at(160);
    const next = await service.session(as(1), ids[1]);
    expect(next.question).toEqual({
      index: 1,
      prompt: '<p>Six-day week?</p>',
      min: 0,
      max: 10,
    });
    await expect(service.respond(as(1), ids[1], 11)).rejects.toThrow(
      'Answer with a whole number from 0 to 10.',
    );
    await service.respond(as(1), ids[1], 7);
    await go(215);
    await go(275);
    await go(335);
    await go(337);
    const finished = await service.session(as(1), ids[1]);
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
    expect(harness.jobs.pending()).toEqual([]);

    // The admin sees the same run
    harness.context.setActor(admin);
    const progress = await harness.module
      .get(AssembliesService)
      .progress(assemblyId);
    expect(progress.counts).toEqual(
      expect.objectContaining({
        invitations: 8,
        joined: 6,
        cohort: 4,
        stopped: 1,
      }),
    );
    expect(progress.state).toBe('finished');
  });

  it('should run every job safely twice', async () => {
    clock = at(-30);
    for (const n of [1, 2, 3, 4, 5, 6]) await service.join(as(n), codes[n]);
    await go(2);
    const run = harness.module.get(RunService);
    const neighbors = () =>
      (
        [...harness.data.store.get('participants')!.values()] as unknown as {
          neighborIds: string[];
        }[]
      ).map((p) => p.neighborIds);
    const before = { neighbors: neighbors(), assembly: await assembly() };

    await run.launch(assemblyId);
    await run.advance(assemblyId, 'q0-report');
    expect(neighbors()).toEqual(before.neighbors);
    expect(await assembly()).toEqual(before.assembly);

    await go(60);
    await run.advance(assemblyId, 'q0-r1');
    expect((await assembly()).phase).toEqual(
      expect.objectContaining({ key: 'q0-r2' }),
    );
  });

  it('should schedule an overdue launch again when someone looks', async () => {
    clock = at(-30);
    const { id } = await service.join(as(1), codes[1]);
    // As if the launch job were lost
    harness.jobs.jobs.splice(0);
    clock = at(30);
    expect((await service.session(as(1), id)).state).toBe(
      SessionState.STARTING,
    );
    expect(harness.jobs.pending()).toEqual([
      expect.objectContaining({ name: 'launch' }),
    ]);
    await go(30);
    expect((await service.session(as(1), id)).state).toBe(
      SessionState.ANSWERING,
    );
  });

  it('should bring a 0.1.0 assembly over on upgrade: its phase from the clock, and its jobs', async () => {
    clock = at(-30);
    for (const n of [1, 2, 3]) await service.join(as(n), codes[n]);
    // 0.1.0 launched at the start and stored no phase
    await harness.data.collection('assemblies').update(assemblyId, {
      launchedAt: startsAt,
      phase: null,
      cohortSize: 0,
      activeCount: 0,
    } as never);
    harness.jobs.jobs.splice(0);
    for (const participant of [
      ...harness.data.store.get('participants')!.values(),
    ] as { id: string }[]) {
      await harness.data
        .collection('participants')
        .update(participant.id, { inCohort: true } as never);
    }

    clock = at(70);
    await harness.lifecycle.upgrade('org-a', { lastPluginVersion: '0.1.0' });
    expect(await assembly()).toEqual(
      expect.objectContaining({
        cohortSize: 3,
        activeCount: 0,
        phase: expect.objectContaining({ key: 'q0-r2', endsAt: at(120) }),
      }),
    );
    expect(harness.jobs.pending()).toEqual([
      expect.objectContaining({
        name: 'advance',
        key: `advance:${assemblyId}:q0-r2`,
        runAt: at(120),
      }),
    ]);
    // Running it again changes nothing
    await harness.lifecycle.upgrade('org-a', { lastPluginVersion: '0.1.0' });
    expect(harness.jobs.pending()).toHaveLength(1);
  });

  it('should tell members of canceled assemblies, and stop its jobs', async () => {
    const ada = as(1);
    clock = at(-60);
    const { id } = await service.join(ada, codes[0]);
    harness.context.setActor(admin);
    clock = at(-50);
    await harness.module.get(AssembliesService).cancel(assemblyId);
    clock = at(-40);
    expect((await service.session(ada, id)).state).toBe(SessionState.CANCELED);
    await expect(service.join(as(2), codes[1])).rejects.toThrow(
      'This assembly is canceled.',
    );
    expect(harness.jobs.pending()).toEqual([]);
  });
});
