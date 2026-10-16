import {
  type PluginManifest,
  SDK_API_VERSION,
} from '@unifyamerica/demleague-plugin-sdk/manifest';

// ℹ️ Imported by the UI too, so it only uses the NestJS-free `/manifest` entry
export const SUPER_ASSEMBLY_MANIFEST: PluginManifest = {
  sdkApiVersion: SDK_API_VERSION,
  namespace: 'unifyamerica.super-assembly',
  version: '0.2.0',
  displayName: 'Super Assembly',
  description:
    "Timed assemblies where members estimate answers to questions over three rounds, seeing their network neighbors' previous answers between rounds",
  // Only its own data: participants are identified by their acting user id, so no user lookups are needed
  permissions: ['data:read', 'data:write'],
  endpoints: [
    // Org admins: assemblies, invitations, progress and the data export
    { method: 'GET', path: '/assemblies', summary: 'List assemblies' },
    { method: 'POST', path: '/assemblies', summary: 'Create an assembly' },
    { method: 'GET', path: '/assemblies/:id', summary: 'Get an assembly' },
    {
      method: 'PATCH',
      path: '/assemblies/:id',
      summary: 'Edit an assembly before anyone joined',
    },
    {
      method: 'DELETE',
      path: '/assemblies/:id',
      summary: 'Delete a draft nobody joined',
    },
    {
      method: 'POST',
      path: '/assemblies/:id/schedule',
      summary: 'Schedule a complete assembly',
    },
    {
      method: 'POST',
      path: '/assemblies/:id/unschedule',
      summary: 'Move a scheduled assembly back to draft',
    },
    {
      method: 'POST',
      path: '/assemblies/:id/cancel',
      summary: 'Cancel an assembly',
    },
    {
      method: 'GET',
      path: '/assemblies/:id/invitations',
      summary: "List an assembly's invitations",
    },
    {
      method: 'POST',
      path: '/assemblies/:id/invitations',
      summary: 'Create invitations',
    },
    {
      method: 'DELETE',
      path: '/assemblies/:id/invitations/:invitationId',
      summary: 'Delete an unused invitation',
    },
    {
      method: 'GET',
      path: '/assemblies/:id/progress',
      summary: 'Live state, counts and results',
    },
    {
      method: 'GET',
      path: '/assemblies/:id/export',
      summary: 'Participants and responses, a page at a time',
    },
    // Members: joining with an invitation code and taking part
    {
      method: 'GET',
      path: '/join/:code',
      summary: 'Preview the assembly an invitation is for',
    },
    {
      method: 'GET',
      path: '/participations',
      summary: "The current user's assemblies",
    },
    {
      method: 'POST',
      path: '/participations',
      summary: 'Join an assembly with an invitation code',
    },
    {
      method: 'GET',
      path: '/participations/:id',
      summary: 'The current state of my participation',
    },
    {
      method: 'POST',
      path: '/participations/:id/ready',
      summary: "Confirm I'm here, before the start",
    },
    {
      method: 'POST',
      path: '/participations/:id/responses',
      summary: 'Answer the current round',
    },
  ],
  collections: ['assemblies', 'invitations', 'participants', 'responses'],
  // The host runs these on one API instance when they're due; each checks the state before changing it
  jobs: {
    launch: {
      summary: 'Pick the cohort and its neighbors, and open the first round',
      timeoutMs: 30_000,
      maxAttempts: 5,
    },
    advance: {
      summary: 'Close the current phase and open the next',
      timeoutMs: 10_000,
      maxAttempts: 5,
    },
    results: {
      summary: "Add a question's results once its answers are in",
      timeoutMs: 20_000,
      maxAttempts: 5,
    },
  },
  // Turned (back) on or upgraded: scheduled assemblies get the jobs they need
  lifecycle: { onEnabled: true, onUpgraded: true },
  abilities: {
    // Org admins run assemblies; members only see them through their own participation
    Assembly: { organization: { org_admin: ['manage'] } },
    // Members join (with an invitation), confirm they're ready and answer
    Participation: { organization: { member: ['read', 'create', 'update'] } },
  },
  ui: { slots: ['main-menu'] },
  // Raised for assemblies of hundreds of participants: one assembly of 300 people and 3 questions is about
  // 3,300 documents (invitations, participants, 2,700 responses), and an assembly with 9 questions of HTML is
  // up to ~150 KB. Requests stay well under the platform maximums because the UI only polls at phase changes.
  limits: {
    requestsPerMinute: 6000,
    requestsPerMinutePerUser: 120,
    dbOperationsPerMinute: 12000,
    requestTimeoutMs: 15000,
    maxDocumentBytes: 256 * 1024,
    maxDocuments: 1_000_000,
    maxStorageBytes: 2 * 1024 * 1024 * 1024,
    // Per assembly: a launch, an advance per phase (3 rounds and a report per question) and a result per question
    jobsPerMinute: 600,
    maxConcurrentJobs: 4,
  },
};
