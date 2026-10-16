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
import { ParticipationService } from '../participation/participation.service';
import { SuperAssemblyPlugin } from '../super-assembly.plugin';
import {
  AssemblyState,
  AssemblyStatus,
  COLLECTIONS,
} from './assembly.interface';
import { AssemblyClock } from './assembly.clock';
import { AssembliesService, createInvitationCode } from './assemblies.service';

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
const admin: PluginActor = {
  id: 'a'.repeat(24),
  memberships: [{ organizationId: 'org-a', roles: ['org_admin'] }],
};
const member: PluginActor = {
  id: 'b'.repeat(24),
  memberships: [{ organizationId: 'org-a', roles: ['member'] }],
};

const now = new Date('2027-08-01T12:00:00.000Z');
const inAnHour = new Date('2027-08-01T13:00:00.000Z').toISOString();
const complete = {
  title: 'Akron Assembly - Proposal 24',
  startsAt: inAnHour,
  timeZone: 'America/New_York',
  roundDurationSec: 60,
  questions: [{ prompt: '<p>What are the chances?</p>', min: 0, max: 100 }],
  landingHtml: '<h1>Welcome</h1>',
};

describe('AssembliesService', () => {
  let harness: PluginTestHarness;
  let service: AssembliesService;

  beforeEach(async () => {
    harness = await createPluginTestHarness(SuperAssemblyPlugin, {
      actor: admin,
      tenant: orgA,
    });
    service = harness.module.get(AssembliesService);
    harness.jobs.setClock(() => now);
    jest
      .spyOn(harness.module.get(AssemblyClock), 'now')
      .mockImplementation(() => now);
  });
  afterEach(() => harness.close());

  it('should create a draft with the method defaults, in the request organization', async () => {
    const assembly = await service.create({ title: '  Draft  ' }, now);
    expect(assembly).toEqual(
      expect.objectContaining({
        title: 'Draft',
        startsAt: null,
        status: AssemblyStatus.DRAFT,
        state: AssemblyState.DRAFT,
        roundDurationSec: 90,
        reportingDurationSec: 30,
        roundsPerQuestion: 3,
        neighborCount: 4,
        readyWindowSec: 60,
        questions: [],
        results: [],
        organizationId: 'org-a',
      }),
    );
  });

  it('should list assemblies newest start first', async () => {
    await service.create(
      { ...complete, title: 'Earlier', startsAt: now.toISOString() },
      now,
    );
    await service.create({ ...complete, title: 'Later' }, now);
    const page = await service.list({}, now);
    expect(page.items.map((a) => a.title)).toEqual(['Later', 'Earlier']);
    expect(page.total).toBe(2);
  });

  it('should only schedule a complete assembly with invitations', async () => {
    const draft = await service.create(
      { title: 'x', questions: [{ prompt: '', min: 5, max: 5 }] },
      now,
    );
    await expect(service.schedule(draft.id, now)).rejects.toThrow(
      new BadRequestException(
        "It needs a start time. Question 1 needs a prompt. Question 1's minimum must be below its maximum. It needs at least one invitation.",
      ),
    );

    const assembly = await service.create(complete, now);
    await expect(service.schedule(assembly.id, now)).rejects.toThrow(
      'It needs at least one invitation.',
    );
    await service.createInvitations(assembly.id, { count: 2 }, now);
    await expect(service.schedule(assembly.id, now)).resolves.toEqual(
      expect.objectContaining({
        status: AssemblyStatus.SCHEDULED,
        state: AssemblyState.SCHEDULED,
      }),
    );
    await expect(service.schedule(assembly.id, now)).rejects.toThrow(
      ConflictException,
    );
  });

  it('should keep a scheduled assembly complete when editing it', async () => {
    const assembly = await service.create(complete, now);
    await service.createInvitations(assembly.id, { count: 1 }, now);
    await service.schedule(assembly.id, now);

    await expect(
      service.update(assembly.id, { questions: [] }, now),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.update(assembly.id, { title: 'Renamed' }, now),
    ).resolves.toEqual(expect.objectContaining({ title: 'Renamed' }));
  });

  it("should refuse edits once someone joined, or once it's running", async () => {
    const assembly = await service.create(complete, now);
    const [invitation] = await service.createInvitations(
      assembly.id,
      { count: 1 },
      now,
    );
    await service.schedule(assembly.id, now);

    harness.context.setActor(member);
    await harness.module
      .get(ParticipationService)
      .join(member, invitation.code, now);
    harness.context.setActor(admin);

    await expect(
      service.update(assembly.id, { title: 'x' }, now),
    ).rejects.toThrow(
      "Members have joined this assembly, so it can't be edited.",
    );
    await expect(service.unschedule(assembly.id, now)).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.update(assembly.id, { title: 'x' }, new Date(inAnHour)),
    ).rejects.toThrow("This assembly is running, so it can't be edited.");
  });

  it('should go back to draft before the start, and cancel until it finishes', async () => {
    const assembly = await service.create(complete, now);
    await service.createInvitations(assembly.id, { count: 1 }, now);
    await service.schedule(assembly.id, now);

    await expect(service.unschedule(assembly.id, now)).resolves.toEqual(
      expect.objectContaining({ status: AssemblyStatus.DRAFT }),
    );
    await expect(service.cancel(assembly.id, now)).resolves.toEqual(
      expect.objectContaining({ state: AssemblyState.CANCELED }),
    );
    await expect(service.cancel(assembly.id, now)).rejects.toThrow(
      'This assembly is already canceled.',
    );
  });

  it('should delete a draft with its invitations, but nothing else', async () => {
    const assembly = await service.create(complete, now);
    await service.createInvitations(assembly.id, { count: 3 }, now);
    await service.remove(assembly.id);

    await expect(service.get(assembly.id, now)).rejects.toThrow(
      NotFoundException,
    );
    const live = [
      ...harness.data.store.get(COLLECTIONS.INVITATIONS)!.values(),
    ].filter((i) => (i as { isEnabled?: boolean }).isEnabled !== false);
    expect(live).toHaveLength(0);

    const scheduled = await service.create(complete, now);
    await service.createInvitations(scheduled.id, { count: 1 }, now);
    await service.schedule(scheduled.id, now);
    await expect(service.remove(scheduled.id)).rejects.toThrow(
      ConflictException,
    );
  });

  it('should schedule the launch for the start, move it with the start, and cancel it', async () => {
    const assembly = await service.create(complete, now);
    await service.createInvitations(assembly.id, { count: 1 }, now);
    await service.schedule(assembly.id, now);
    const launch = () =>
      harness.jobs.jobs.filter((job) => job.name === 'launch');
    expect(launch()).toEqual([
      expect.objectContaining({
        status: 'pending',
        key: `launch:${assembly.id}`,
        runAt: new Date('2027-08-01T13:00:02.000Z'),
        payload: { assemblyId: assembly.id },
        organizationId: 'org-a',
      }),
    ]);

    await service.update(
      assembly.id,
      { startsAt: '2027-08-01T14:00:00.000Z' },
      now,
    );
    expect(launch()).toEqual([
      expect.objectContaining({ runAt: new Date('2027-08-01T14:00:02.000Z') }),
    ]);

    await service.unschedule(assembly.id, now);
    expect(launch()).toEqual([expect.objectContaining({ status: 'canceled' })]);
  });

  describe('invitations', () => {
    it('should generate unique single-use codes', async () => {
      const assembly = await service.create(complete, now);
      const invitations = await service.createInvitations(
        assembly.id,
        { count: 50 },
        now,
      );
      const codes = invitations.map((i) => i.code);
      expect(new Set(codes).size).toBe(50);
      expect(codes.every((code) => /^[A-Za-z0-9]{20}$/.test(code))).toBe(true);
      expect(createInvitationCode()).not.toBe(createInvitationCode());
    });

    it('should keep the traits of each invitation, and check them', async () => {
      const assembly = await service.create(complete, now);
      const [invitation] = await service.createInvitations(
        assembly.id,
        { traits: [{ smoker: 'no', age: 34, voter: true }] },
        now,
      );
      expect(invitation.traits).toEqual({ smoker: 'no', age: 34, voter: true });

      await expect(
        service.createInvitations(
          assembly.id,
          { traits: [{ code: 'abc' }] },
          now,
        ),
      ).rejects.toThrow('Invitation codes are generated');
      await expect(
        service.createInvitations(
          assembly.id,
          { traits: [{ $where: 1 }] },
          now,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createInvitations(
          assembly.id,
          { traits: [{ nested: { a: 1 } }] },
          now,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createInvitations(assembly.id, {}, now),
      ).rejects.toThrow('Send either a count or a list of traits.');
    });

    it('should only delete unused invitations', async () => {
      const assembly = await service.create(complete, now);
      const [used, unused] = await service.createInvitations(
        assembly.id,
        { count: 2 },
        now,
      );
      await service.schedule(assembly.id, now);
      await harness.module
        .get(ParticipationService)
        .join(member, used.code, now);

      await expect(
        service.removeInvitation(assembly.id, used.id),
      ).rejects.toThrow(ConflictException);
      await service.removeInvitation(assembly.id, unused.id);
      expect(
        (await service.listInvitations(assembly.id, {})).items.map((i) => i.id),
      ).toEqual([used.id]);
    });
  });

  it("should keep each organization's assemblies apart", async () => {
    const assembly = await service.create(complete, now);
    harness.context.setTenant(orgB);
    await expect(service.get(assembly.id, now)).rejects.toThrow(
      NotFoundException,
    );
    expect((await service.list({}, now)).items).toEqual([]);
  });
});
