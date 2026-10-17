import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  JobHandler,
  ModuleLifecycleProxy,
  PluginValidationError,
  type PluginJob,
} from '@unifyamerica/demleague-plugin-sdk';
import { RunService } from './run.service';

const assemblyIdOf = (payload: unknown): string => {
  const id = (payload as { assemblyId?: unknown } | null)?.assemblyId;
  if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) {
    throw new PluginValidationError('The job needs an assemblyId');
  }
  return id;
};

/** The module's jobs, and its lifecycle hooks (which bring assemblies' jobs up to date). */
@Injectable()
export class AssemblyJobs implements OnModuleInit {
  constructor(
    private readonly run: RunService,
    private readonly lifecycle: ModuleLifecycleProxy,
  ) {}

  onModuleInit(): void {
    // Turned (back) on, or upgraded: every scheduled assembly gets the jobs it needs
    this.lifecycle.onEnabled(() => this.run.catchUp());
    this.lifecycle.onUpgraded(() => this.run.catchUp());
  }

  @JobHandler('launch')
  async launch(job: PluginJob): Promise<void> {
    await this.run.launch(assemblyIdOf(job.payload));
  }

  @JobHandler('advance')
  async advance(job: PluginJob): Promise<void> {
    const phaseKey = (job.payload as { phaseKey?: unknown } | null)?.phaseKey;
    if (typeof phaseKey !== 'string') {
      throw new PluginValidationError('The job needs a phaseKey');
    }
    await this.run.advance(assemblyIdOf(job.payload), phaseKey);
  }

  @JobHandler('results')
  async results(job: PluginJob): Promise<void> {
    const question = (job.payload as { question?: unknown } | null)?.question;
    if (
      typeof question !== 'number' ||
      !Number.isInteger(question) ||
      question < 0
    ) {
      throw new PluginValidationError('The job needs a question');
    }
    await this.run.computeResults(assemblyIdOf(job.payload), question);
  }
}
