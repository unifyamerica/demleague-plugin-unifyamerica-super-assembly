import { Injectable } from '@nestjs/common';
import {
  JobsProxy,
  PluginLogger,
  type PluginRecord,
} from '@unifyamerica/demleague-plugin-sdk';
import {
  AssemblyStatus,
  JOBS,
  LAUNCH_GRACE_SEC,
  OVERDUE_SEC,
  PhaseKinds,
  RESULTS_SETTLE_SEC,
  type Assembly,
  type AssemblyPhase,
  type QuestionResult,
  type StoredResponse,
} from './assembly.interface';
import { AssemblyClock } from './assembly.clock';
import { AssemblyStore } from './assembly.store';
import { randomGraph, seededRandom } from './neighbors';
import {
  FINISHED_KEY,
  nextPhase,
  Phase,
  phaseAt,
  reportKey,
  roundKey,
} from './timeline';

const seconds = (date: Date, s: number) => new Date(date.getTime() + s * 1000);

export const launchKey = (assemblyId: string) => `launch:${assemblyId}`;
export const advanceKey = (assemblyId: string, phaseKey: string) =>
  `advance:${assemblyId}:${phaseKey}`;
export const resultsKey = (assemblyId: string, question: number) =>
  `results:${assemblyId}:q${question}`;

/**
 * Runs assemblies with the module's jobs: `launch` picks the cohort and opens the first round at the start,
 * `advance` moves to the next phase when the current one ends (or as soon as everyone has answered a round), and
 * `results` adds a question's results once its answers are in. Every job checks the state it's about to change,
 * so running one twice (jobs run at least once) changes nothing.
 */
@Injectable()
export class RunService {
  constructor(
    private readonly store: AssemblyStore,
    private readonly jobs: JobsProxy,
    private readonly clock: AssemblyClock,
    private readonly logger: PluginLogger,
  ) {}

  // 👉 Scheduling

  async scheduleLaunch(assembly: PluginRecord<Assembly>): Promise<void> {
    if (!assembly.startsAt) return;
    const runAt = seconds(assembly.startsAt, LAUNCH_GRACE_SEC);
    // A new start time moves the pending launch; otherwise there's none yet (or it ran)
    const moved = await this.jobs.reschedule(launchKey(assembly.id), runAt);
    if (!moved) {
      await this.jobs.schedule(JOBS.LAUNCH, {
        runAt,
        key: launchKey(assembly.id),
        payload: { assemblyId: assembly.id },
      });
    }
  }

  async cancelLaunch(assemblyId: string): Promise<void> {
    await this.jobs.cancel(launchKey(assemblyId));
  }

  private async scheduleAdvance(
    assemblyId: string,
    phase: AssemblyPhase,
  ): Promise<void> {
    if (!phase.endsAt) return;
    await this.jobs.schedule(JOBS.ADVANCE, {
      runAt: phase.endsAt,
      key: advanceKey(assemblyId, phase.key),
      payload: { assemblyId, phaseKey: phase.key },
    });
  }

  private async scheduleResults(
    assemblyId: string,
    question: number,
  ): Promise<void> {
    await this.jobs.schedule(JOBS.RESULTS, {
      delayMs: RESULTS_SETTLE_SEC * 1000,
      key: resultsKey(assemblyId, question),
      payload: { assemblyId, question },
    });
  }

  /**
   * Schedules a job again if it's well overdue (e.g. the dispatcher was down, or a record from before jobs). Cheap
   * when nothing is overdue, so pages call it whenever they load an assembly.
   */
  async healOverdue(assembly: PluginRecord<Assembly>): Promise<void> {
    if (assembly.status !== AssemblyStatus.SCHEDULED) return;
    const now = this.clock.now();
    if (!assembly.launchedAt) {
      if (
        assembly.startsAt &&
        now > seconds(assembly.startsAt, LAUNCH_GRACE_SEC + OVERDUE_SEC)
      ) {
        await this.scheduleLaunch(assembly);
      }
      return;
    }
    const { phase } = assembly;
    if (phase?.endsAt && now > seconds(phase.endsAt, OVERDUE_SEC)) {
      await this.scheduleAdvance(assembly.id, phase);
    }
  }

  // 👉 Jobs

  /** Picks the cohort (those who confirmed they're here in the ready window) and who sees whom, and opens round 1. */
  async launch(assemblyId: string): Promise<void> {
    const assembly = await this.store.assemblies.findById(assemblyId);
    const now = this.clock.now();
    if (
      !assembly ||
      assembly.status !== AssemblyStatus.SCHEDULED ||
      assembly.launchedAt ||
      !assembly.startsAt ||
      now < seconds(assembly.startsAt, LAUNCH_GRACE_SEC)
    ) {
      return;
    }
    const startsAt = assembly.startsAt;
    const windowStart = seconds(startsAt, -assembly.readyWindowSec);
    const participants = (
      await this.store.all(this.store.participants, { assemblyId })
    ).sort((a, b) => a.id.localeCompare(b.id));
    const cohort = participants.filter(
      (p) =>
        p.joinedAt < startsAt &&
        p.readyAt !== null &&
        p.readyAt >= windowStart &&
        p.readyAt <= startsAt,
    );
    // Seeded with the assembly's id: a second run picks the same neighbors
    const graph = randomGraph(
      assembly.neighborCount,
      cohort.length,
      seededRandom(assembly.id),
    );
    const neighborsOf = new Map(
      cohort.map((p, i) => [p.id, graph[i].map((n) => cohort[n].id)]),
    );
    for (const participant of participants) {
      const inCohort = neighborsOf.has(participant.id);
      const neighborIds = neighborsOf.get(participant.id) ?? [];
      if (
        participant.inCohort === inCohort &&
        participant.neighborIds.join() === neighborIds.join()
      ) {
        continue;
      }
      await this.store.participants.update(participant.id, {
        inCohort,
        neighborIds,
      });
    }

    // Round 1 runs from the start; with nobody ready, the assembly is over
    const phase: AssemblyPhase =
      cohort.length > 0
        ? {
            key: roundKey(0, 1),
            kind: PhaseKinds.ROUND,
            question: 0,
            round: 1,
            startedAt: startsAt,
            endsAt: seconds(startsAt, assembly.roundDurationSec),
          }
        : {
            key: FINISHED_KEY,
            kind: PhaseKinds.FINISHED,
            question: assembly.questions.length - 1,
            round: 0,
            startedAt: now,
            endsAt: null,
          };
    await this.store.assemblies.update(assemblyId, {
      launchedAt: now,
      phase,
      cohortSize: cohort.length,
      activeCount: cohort.length,
      finishedAt: phase.kind === PhaseKinds.FINISHED ? now : null,
    });
    this.logger.info(
      `Assembly ${assemblyId} launched with ${cohort.length} of ${participants.length} participants`,
    );
    await this.scheduleAdvance(assemblyId, phase);
  }

  /** Ends phase `phaseKey` (if it's still the current one) and starts the next. */
  async advance(assemblyId: string, phaseKey: string): Promise<void> {
    const assembly = await this.store.assemblies.findById(assemblyId);
    if (
      !assembly ||
      assembly.status !== AssemblyStatus.SCHEDULED ||
      !assembly.phase ||
      assembly.phase.key !== phaseKey ||
      assembly.phase.kind === PhaseKinds.FINISHED
    ) {
      return;
    }
    const now = this.clock.now();
    const current = assembly.phase;
    const next = nextPhase(assembly, current, now);
    const changes: Partial<Assembly> = { phase: next };

    // Whoever didn't answer the very first round is stopped: they no longer count towards "everyone answered"
    if (current.key === roundKey(0, 1)) {
      changes.activeCount = await this.respondents(assemblyId, 0, 1);
    }
    if (next.kind === PhaseKinds.FINISHED) changes.finishedAt = now;

    const updated = await this.store.assemblies.update(assemblyId, changes);
    if (!updated) return;
    if (
      current.kind === PhaseKinds.ROUND &&
      current.round === assembly.roundsPerQuestion
    ) {
      await this.scheduleResults(assemblyId, current.question);
    }
    await this.scheduleAdvance(assemblyId, next);
  }

  /** Adds question `question`'s results (once). */
  async computeResults(assemblyId: string, question: number): Promise<void> {
    const assembly = await this.store.assemblies.findById(assemblyId);
    if (
      !assembly ||
      question >= assembly.questions.length ||
      assembly.results.some((r) => r.question === question)
    ) {
      return;
    }
    const responses = firstAnswers(
      await this.store.all(this.store.responses, { assemblyId, question }),
    );
    const rounds = Array.from(
      { length: assembly.roundsPerQuestion },
      (_, i) => {
        const values = responses
          .filter((r) => r.round === i + 1)
          .map((r) => r.value);
        return {
          round: i + 1,
          count: values.length,
          total: values.reduce((sum, v) => sum + v, 0),
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
        };
      },
    );
    const results: QuestionResult[] = [
      ...assembly.results,
      { question, rounds },
    ].sort((a, b) => a.question - b.question);
    await this.store.assemblies.update(assemblyId, { results });
  }

  /** Ends the current round now if everyone still taking part has answered it. */
  async endRoundIfAllAnswered(assembly: PluginRecord<Assembly>): Promise<void> {
    const { phase } = assembly;
    if (phase?.kind !== PhaseKinds.ROUND) return;
    const expected =
      phase.key === roundKey(0, 1) ? assembly.cohortSize : assembly.activeCount;
    const answered = await this.respondents(
      assembly.id,
      phase.question,
      phase.round,
    );
    if (expected > 0 && answered >= expected) {
      await this.jobs.reschedule(
        advanceKey(assembly.id, phase.key),
        this.clock.now(),
      );
    }
  }

  private async respondents(
    assemblyId: string,
    question: number,
    round: number,
  ): Promise<number> {
    const responses = await this.store.all(this.store.responses, {
      assemblyId,
      question,
      round,
    });
    return new Set(responses.map((r) => r.participantId)).size;
  }

  // 👉 Lifecycle: bringing assemblies up to date

  /**
   * Makes sure every scheduled assembly has the jobs it needs (turned back on, upgraded), and gives assemblies from
   * 0.1.0 (no stored phase) the phase their clock-based schedule put them in.
   */
  async catchUp(): Promise<void> {
    const scheduled = await this.store.all(this.store.assemblies, {
      status: AssemblyStatus.SCHEDULED,
    });
    const now = this.clock.now();
    for (const assembly of scheduled) {
      let current = assembly;
      if (assembly.launchedAt && !assembly.phase) {
        current = (await this.migrate(assembly, now)) ?? assembly;
      }
      if (!current.launchedAt) {
        await this.scheduleLaunch(current);
      } else if (current.phase && current.phase.kind !== PhaseKinds.FINISHED) {
        await this.scheduleAdvance(current.id, current.phase);
      }
      for (const question of missingResults(current)) {
        await this.scheduleResults(current.id, question);
      }
    }
  }

  private async migrate(
    assembly: PluginRecord<Assembly>,
    now: Date,
  ): Promise<PluginRecord<Assembly> | null> {
    const at = phaseAt(assembly, now);
    const participants = await this.store.all(this.store.participants, {
      assemblyId: assembly.id,
    });
    const cohortSize = participants.filter((p) => p.inCohort).length;
    const phase: AssemblyPhase =
      at.phase === Phase.ROUND
        ? {
            key: roundKey(at.question, at.round),
            kind: PhaseKinds.ROUND,
            question: at.question,
            round: at.round,
            startedAt: at.startedAt!,
            endsAt: at.endsAt,
          }
        : at.phase === Phase.REPORT
          ? {
              key: reportKey(at.question),
              kind: PhaseKinds.REPORT,
              question: at.question,
              round: 0,
              startedAt: at.startedAt!,
              endsAt: at.endsAt,
            }
          : {
              key: FINISHED_KEY,
              kind: PhaseKinds.FINISHED,
              question: at.question,
              round: 0,
              startedAt: at.startedAt ?? now,
              endsAt: null,
            };
    const pastFirstRound = phase.key !== roundKey(0, 1);
    return this.store.assemblies.update(assembly.id, {
      phase,
      cohortSize,
      activeCount: pastFirstRound
        ? await this.respondents(assembly.id, 0, 1)
        : cohortSize,
      finishedAt: phase.kind === PhaseKinds.FINISHED ? phase.startedAt : null,
      results: assembly.results ?? [],
    });
  }
}

/** The questions whose last round is over but whose results aren't in. */
function missingResults(assembly: Assembly): number[] {
  const { phase } = assembly;
  if (!phase) return [];
  const done =
    phase.kind === PhaseKinds.FINISHED
      ? assembly.questions.length
      : phase.question;
  return Array.from({ length: done }, (_, q) => q).filter(
    (q) => !assembly.results.some((r) => r.question === q),
  );
}

/**
 * Each participant's first answer per question and round. A double submit racing the "already answered"
 * check can store two (there are no unique indexes); the first counts.
 */
export function firstAnswers<T extends StoredResponse>(responses: T[]): T[] {
  const seen = new Set<string>();
  return [...responses]
    .sort((a, b) => a.respondedAt.getTime() - b.respondedAt.getTime())
    .filter((r) => {
      const key = `${r.participantId}:${r.question}:${r.round}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
