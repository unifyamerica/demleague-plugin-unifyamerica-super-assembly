import { Injectable } from '@nestjs/common';
import type { PluginRecord } from '@unifyamerica/demleague-plugin-sdk';
import {
  AssemblyStatus,
  LAUNCH_GRACE_SEC,
  RESULTS_SETTLE_SEC,
  type Assembly,
  type QuestionResult,
  type StoredResponse,
} from './assembly.interface';
import { AssemblyStore } from './assembly.store';
import { randomGraph, seededRandom } from './neighbors';
import { questionEndsAt } from './timeline';

const seconds = (date: Date, s: number) => new Date(date.getTime() + s * 1000);

/**
 * What the original app's every-second cron did, done when someone asks instead: modules can't schedule jobs,
 * so any request about an assembly (a participant's or an org admin's) first brings it up to date. Every write
 * here is the same whoever makes it and however often (the cohort only depends on confirmations made before the
 * start, the neighbors on a generator seeded with the assembly's id, the results on answers given before a
 * round ended), so concurrent requests can't disagree, even without transactions.
 */
@Injectable()
export class RunService {
  constructor(private readonly store: AssemblyStore) {}

  async prepare(
    assembly: PluginRecord<Assembly>,
    now: Date,
  ): Promise<PluginRecord<Assembly>> {
    let current = assembly;
    if (this.isDueToLaunch(current, now)) {
      current = await this.launch(current);
    }
    return this.fillResults(current, now);
  }

  isDueToLaunch(assembly: Assembly, now: Date): boolean {
    return (
      assembly.status === AssemblyStatus.SCHEDULED &&
      assembly.startsAt !== null &&
      assembly.launchedAt === null &&
      now >= seconds(assembly.startsAt, LAUNCH_GRACE_SEC)
    );
  }

  /**
   * Picks the cohort (those who confirmed they were here within the ready window before the start) and who sees
   * whom among them. Everyone else who joined is left out.
   */
  private async launch(
    assembly: PluginRecord<Assembly>,
  ): Promise<PluginRecord<Assembly>> {
    const startsAt = assembly.startsAt!;
    const windowStart = seconds(startsAt, -assembly.readyWindowSec);
    const participants = (
      await this.store.all(this.store.participants, { assemblyId: assembly.id })
    ).sort((a, b) => a.id.localeCompare(b.id));

    const cohort = participants.filter(
      (p) =>
        p.joinedAt < startsAt &&
        p.readyAt !== null &&
        p.readyAt >= windowStart &&
        p.readyAt <= startsAt,
    );
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
      // A second launch finds everything in place and writes nothing
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

    return (
      (await this.store.assemblies.update(assembly.id, {
        launchedAt: startsAt,
      })) ?? assembly
    );
  }

  /** Computes the results of every question whose last round is over and settled. */
  private async fillResults(
    assembly: PluginRecord<Assembly>,
    now: Date,
  ): Promise<PluginRecord<Assembly>> {
    if (assembly.launchedAt === null) return assembly;

    const known = new Set(assembly.results.map((r) => r.question));
    const added: QuestionResult[] = [];
    for (let question = 0; question < assembly.questions.length; question++) {
      const ended = questionEndsAt(assembly, question);
      if (
        known.has(question) ||
        !ended ||
        now < seconds(ended, RESULTS_SETTLE_SEC)
      ) {
        continue;
      }
      added.push(await this.computeResult(assembly, question));
    }
    if (added.length === 0) return assembly;

    const results = [...assembly.results, ...added].sort(
      (a, b) => a.question - b.question,
    );
    return (
      (await this.store.assemblies.update(assembly.id, { results })) ?? assembly
    );
  }

  private async computeResult(
    assembly: PluginRecord<Assembly>,
    question: number,
  ): Promise<QuestionResult> {
    const responses = firstAnswers(
      await this.store.all(this.store.responses, {
        assemblyId: assembly.id,
        question,
      }),
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
    return { question, rounds };
  }
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
