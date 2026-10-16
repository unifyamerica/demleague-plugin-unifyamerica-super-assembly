# Super Assembly (`unifyamerica.super-assembly`)

A DemLeagueOS module for **Super Assemblies**: timed sessions where an organization's members estimate the
answer to a question over three short rounds. Between rounds each participant sees their own last answer and
the average of a few network neighbors' answers; after each question everyone sees how the group's answers
moved. Org admins create and schedule assemblies, hand out single-use invitations and export the data.

It's the modular rewrite of the Dynamic Norms Super Assembly app (NestJS + MySQL with static pages). That app
stays in the private `unifyamerica/demleague-plugin-super-assembly` repository for reference.

Built on [`@unifyamerica/demleague-plugin-sdk`](https://github.com/unifyamerica/demleague-plugin-sdk) 0.4
(luxon and the `v-safe-html` directive come from it). See the SDK's
[Plugin Developer Guide](https://github.com/unifyamerica/demleague-plugin-sdk/blob/main/PLUGIN_DEVELOPER_GUIDE.md)
for the contract this module follows.

## How an assembly runs

```
draft ──schedule──▶ scheduled ──start time──▶ running ──last round ends──▶ finished
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
4. **Rounds.** Each question runs 3 rounds of `roundDurationSec` (90 s by default). From round 2 a participant
   sees their own last answer and their neighbors' average. Whoever skips round 1 of the first question is
   **stopped**.
5. **Reports.** After each question's third round, a 30 s report shows each round's average and range, with the
   participant's own answers. The last question has no report: the assembly finishes and shows it with the
   closing page.

### No scheduler: the clock decides

Modules can't run scheduled jobs (yet), and the original app advanced every assembly from a one-second cron.
Here **where an assembly is follows from its start time and durations alone** (`src/assemblies/timeline.ts`),
so any request can work it out. The few writes that have to happen once are made by whichever request comes
first (`RunService.prepare`), and they're the same whoever makes them: the cohort only depends on confirmations
made before the start, the neighbors on a generator seeded with the assembly's id, and the results on answers
given before a round ended. That keeps concurrent requests from disagreeing without transactions.

Because the schedule is known in advance, the participant page asks the API again **only when a phase ends**
(with a couple of seconds' random spread), and right after the user acts, instead of polling every 1.5 s.

## Data (per organization)

| Collection | One per | Fields |
| --- | --- | --- |
| `assemblies` | assembly | title, `startsAt`, `timeZone`, durations, `questions` (`prompt` HTML, `min`, `max`; up to 9), `landingHtml` / `readyHtml` / `finishedHtml`, `status` (`draft`, `scheduled`, `canceled`), `launchedAt`, `results` (per question and round: count, total, min, max) |
| `invitations` | invitation | `assemblyId`, `code` (20 base62 characters from `crypto.getRandomValues`), `traits`, `participantId`, `usedAt` |
| `participants` | member in an assembly | `assemblyId`, `invitationId`, `userId`, `traits`, `joinedAt`, `readyAt`, `inCohort`, `neighborIds` |
| `responses` | answer | `assemblyId`, `participantId`, `question`, `round`, `value`, `respondedAt` |

`running` and `finished` aren't stored: they're worked out from the clock.

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
  "limits": {
    "requestsPerMinute": 6000,
    "requestsPerMinutePerUser": 120,
    "dbOperationsPerMinute": 12000,
    "requestTimeoutMs": 15000,
    "maxDocumentBytes": 262144,
    "maxDocuments": 1000000,
    "maxStorageBytes": 2147483648
  },
  "notes": "Super Assemblies (rewrite of the Dynamic Norms app)"
}
```

Fill in the owner's contact email. Why the limits are raised: an assembly of 300 members with 3 questions is about 3,300 documents (300
invitations, 300 participants, 2,700 answers), so the default 10,000 documents would last three assemblies; an
assembly with 9 questions of HTML is up to ~150 KB (default 64 KB); and 300 participants refreshing at a phase
change plus answering is a burst of about 1,000 requests and 4,000 DB operations in a few seconds. No public
endpoints, no calls to other modules, no exports, no events.

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

- **No early end of a round.** The original app ended a round as soon as everyone had answered. Without
  scheduled jobs or atomic updates that can't be done safely, so rounds always run their full length. Module
  scheduling would bring it back.
- **Duplicate answers.** Two answers sent at the same moment can both be stored (there are no unique indexes);
  only the first counts, everywhere.
- **Edits stop once someone joins** (as in the original app): participants agreed to what they saw.
