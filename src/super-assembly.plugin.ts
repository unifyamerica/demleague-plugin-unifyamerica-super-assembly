import { PluginModule } from '@unifyamerica/demleague-plugin-sdk';
import { AssembliesController } from './assemblies/assemblies.controller';
import { AssembliesService } from './assemblies/assemblies.service';
import { AssemblyClock } from './assemblies/assembly.clock';
import { AssemblyJobs } from './assemblies/assembly.jobs';
import { AssemblyStore } from './assemblies/assembly.store';
import { RunService } from './assemblies/run.service';
import { SUPER_ASSEMBLY_MANIFEST } from './manifest';
import { ParticipationController } from './participation/participation.controller';
import { ParticipationService } from './participation/participation.service';

@PluginModule({
  manifest: SUPER_ASSEMBLY_MANIFEST,
  controllers: [AssembliesController, ParticipationController],
  providers: [
    AssemblyClock,
    AssemblyStore,
    RunService,
    AssembliesService,
    ParticipationService,
    AssemblyJobs,
  ],
})
export class SuperAssemblyPlugin {}
