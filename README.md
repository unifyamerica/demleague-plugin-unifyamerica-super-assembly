# Super Assembly (`unifyamerica.super-assembly`)

A DemLeagueOS module for **Super Assemblies**: timed sessions where an organization's members estimate the
answer to a question over three short rounds. Between rounds each participant sees their own last answer and
the average of a few network neighbors' answers; after each question everyone sees how the group's answers
moved. Org admins create and schedule assemblies, hand out single-use invitations and export the data.

It's the modular rewrite of the Dynamic Norms Super Assembly app (NestJS + MySQL with static pages). That app
stays in the private `unifyamerica/demleague-plugin-super-assembly` repository for reference.

Built on [`@unifyamerica/demleague-plugin-sdk`](https://github.com/unifyamerica/demleague-plugin-sdk) 0.5
(scheduled jobs, luxon and the `v-safe-html` directive come from it). See the SDK's
[Plugin Developer Guide](https://github.com/unifyamerica/demleague-plugin-sdk/blob/main/PLUGIN_DEVELOPER_GUIDE.md)
for the contract this module follows.

## How an assembly runs

```
draft ──schedule──▶ scheduled ──launch job──▶ running ──last round ends──▶ finished
  ▲                    │                            (any time before finished) ──▶ canceled
  └──back to draft─────┘ (before the start, nobody joined)
```

1. **Joining.** A member opens their invitation link (`/apps/unifyamerica/super-assembly/join/<code>?org=<slug>`)
   and joins. The code is single use: it's tied to them from then on. Participants are members of the
   organization with an account; there are no anonymous participants and no cookies.
2. **Waiting room.** Before the start, members confirm "I'm here". Only those who confirmed in the minute before
   the start (`readyWindowSec`, 60 s) make the **cohort**. Joining counts as a first confirmation.
3. **Launch.** Two seconds after the start, the cohort is picked and each member gets 4 neighbors from a random
   regular graph (a ring, then a Maslov–Sneppen shuffle, as in the original app). Members who joined late or
   didn't confirm are told why they can't take part.
4. **Rounds.** Each question runs 3 rounds of at most `roundDurationSec` (90 s by default): a round ends early
   as soon as everyone still taking part has answered. From round 2 a participant sees their own last answer and
   their neighbors' average. Whoever skips round 1 of the first question is **stopped** (and no longer waited
   for).
5. **Reports.** After each question's third round, a 30 s report shows each round's average and range, with the
   participant's own answers. The last question has no report: the assembly finishes and shows it with the
   closing page.

### Jobs move it along

The original app advanced every assembly from a one-second cron. Here the host's scheduled jobs do it, on one
API instance at a time (`src/assemblies/run.service.ts`, `assembly.jobs.ts`):

| Job | When | What it does |
| --- | --- | --- |
| `launch` | 2 s after the start (scheduled when the assembly is, moved with its start, canceled with it) | Picks the cohort and neighbors, opens round 1 |
| `advance` | When the current phase ends, or right away once everyone has answered a round (the job is moved to now) | Opens the next round, report or question, or finishes |
| `results` | 2 s after a question's last round (so answers in flight land) | Adds the question's results |

Jobs run at least once, so each one checks the state first: `advance` only moves the phase it was scheduled for
(its key is the phase's), `launch` only an assembly not launched yet (and its neighbors come from a generator
seeded with the assembly's id), `results` only a question without results. Opening a page also schedules a
job again if it's well overdue. Turning the module back on, or upgrading it, gives every scheduled assembly the
jobs it needs (`onEnabled`, `onUpgraded`); 0.1.0 assemblies, which had no stored phase, get the phase their
clock-based schedule put them in.

The participant page asks the API again when the current phase ends (with a couple of seconds' random spread)
and right after the user acts; only while waiting for the others to answer does it check every few seconds, to
notice a round ending early.

## Data (per organization)

| Collection | One per | Fields |
| --- | --- | --- |
| `assemblies` | assembly | title, `startsAt`, `timeZone`, durations, `questions` (`prompt` HTML, `min`, `max`; up to 9), `landingHtml` / `readyHtml` / `finishedHtml`, `status` (`draft`, `scheduled`, `canceled`), `launchedAt`, `phase` (`key`, `kind`: round, report or finished, `question`, `round`, `startedAt`, `endsAt`), `cohortSize`, `activeCount`, `finishedAt`, `results` (per question and round: count, total, min, max) |
| `invitations` | invitation | `assemblyId`, `code` (20 base62 characters from `crypto.getRandomValues`), `traits`, `participantId`, `usedAt` |
| `participants` | member in an assembly | `assemblyId`, `invitationId`, `userId`, `traits`, `joinedAt`, `readyAt`, `inCohort`, `neighborIds` |
| `responses` | answer | `assemblyId`, `participantId`, `question`, `round`, `value`, `respondedAt` |

`running` and `finished` aren't stored: they come from `launchedAt` and `phase`.

## Endpoints

All under `/plugins/unifyamerica/super-assembly`, authenticated, in the request's organization.

| Method | Path | Ability | Purpose |
| --- | --- | --- | --- |
| GET, POST | `/assemblies` | read / create `Assembly` | List (paged), create a draft |
| GET, PATCH, DELETE | `/assemblies/:id` | read / update / delete `Assembly` | Get; edit (until someone joins); delete a draft |
| POST | `/assemblies/:id/schedule`, `/unschedule`, `/cancel` | update `Assembly` | Status changes |
| GET, POST | `/assemblies/:id/invitations` | read / update `Assembly` | List (paged); create `{ count }` or `{ traits: [...] }` |
| DELETE | `/assemblies/:id/invitations/:invitationId` | update `Assembly` | Delete an unused invitation |
| GET | `/assemblies/:id/progress` | read `Assembly` | Phase, counts, results |
| GET | `/assemblies/:id/export` | read `Assembly` | Participants and answers, 50 at a time (the UI builds the CSV) |
| GET | `/join/:code` | read `Participation` | Preview an invitation |
| GET, POST | `/participations` | read / create `Participation` | My assemblies; join with a code |
| GET | `/participations/:id` | read `Participation` | My current state (one combined call) |
| POST | `/participations/:id/ready` | update `Participation` | "I'm here", until the start |
| POST | `/participations/:id/responses` | create `Participation` | Answer the current round |

`Assembly` is granted to `org_admin` (`manage`), `Participation` to `member` (`read`, `create`, `update`; org
admins are members too). Members only ever reach their own participations (others' are 404).

## Pages

| Path (under `/apps/unifyamerica/super-assembly`) | Name | Ability | Menu |
| --- | --- | --- | --- |
| `''` | `home` | read `Participation` | Super Assembly › My assemblies |
| `join/:code` | `join` | create `Participation` | |
| `sessions/:id` | `session` | read `Participation` | |
| `manage` | `assemblies` | read `Assembly` | Super Assembly › Manage assemblies |
| `manage/new` (`?clone=<id>`) | `assembly-new` | create `Assembly` | |
| `manage/:id` | `assembly` | read `Assembly` | |
| `manage/:id/edit` | `assembly-edit` | update `Assembly` | |

The pages follow the SPA's look (PrimeVue + Tailwind, like the Users and Settings pages). Admin-written HTML
(questions, invitation, waiting room and closing pages) is rendered with the SDK's sanitizing `v-safe-html`
directive. Times are set and shown in the assembly's own time zone with luxon (from the SDK).

## Installing (for the DemLeagueOS core team)

The registry entry this module needs in `api/namespace-registry.json`:

```json
"unifyamerica.super-assembly": {
  "package": "@unifyamerica/demleague-plugin-unifyamerica-super-assembly",
  "owner": "Unify America <contact email>",
  "tier": "first-party",
  "enabled": true,
  "approvedPermissions": ["data:read", "data:write"],
  "approvedAbilityGrants": {
    "Assembly": { "organization": { "org_admin": ["manage"] } },
    "Participation": { "organization": { "member": ["read", "create", "update"] } }
  },
  "approvedUiSlots": ["main-menu"],
  "approvedJobs": ["launch", "advance", "results"],
  "limits": {
    "requestsPerMinute": 6000,
    "requestsPerMinutePerUser": 120,
    "dbOperationsPerMinute": 12000,
    "requestTimeoutMs": 15000,
    "maxDocumentBytes": 262144,
    "maxDocuments": 1000000,
    "maxStorageBytes": 2147483648,
    "jobsPerMinute": 600,
    "maxConcurrentJobs": 4
  },
  "notes": "Super Assemblies (rewrite of the Dynamic Norms app)"
}
```

Fill in the owner's contact email. Why the limits are raised: an assembly of 300 members with 3 questions is about 3,300 documents (300
invitations, 300 participants, 2,700 answers), so the default 10,000 documents would last three assemblies; an
assembly with 9 questions of HTML is up to ~150 KB (default 64 KB); and 300 participants refreshing at a phase
change plus answering is a burst of about 1,000 requests and 4,000 DB operations in a few seconds. An assembly
schedules a launch, an advance per phase (4 per question) and a result per question, so 600 jobs a minute leaves
room for many at once; 4 concurrent jobs per instance keep one module from hogging the dispatcher. No public
endpoints, no calls to other modules, no exports, no events, no recurring schedules.

Then pin the exact version in `api/package.json` and `frontend/package.json`, add `SuperAssemblyPlugin` to
`api/src/plugins.config.ts` and the `./ui` entry to `frontend/src/plugins.config.ts` (no stylesheet), and add
the module's collections to the seed.

## Development

```bash
npm install            # needs a read:packages token in ~/.npmrc (see the SDK README)
npm test               # Jest (API) + Vitest (UI)
npm run lint && npm run type-check && npm run build
```

Release by pushing a `v<version>` tag (the org's release workflow publishes it); never `npm publish`.

## Known limits

- **Timing:** a phase changes within a second or two of when it's due (the host's job precision), and a
  participant who answered notices an early end within a few seconds (no push channel yet).
- **Duplicate answers.** Two answers sent at the same moment can both be stored (there are no unique indexes);
  only the first counts, everywhere.
- **Edits stop once someone joins** (as in the original app): participants agreed to what they saw.
