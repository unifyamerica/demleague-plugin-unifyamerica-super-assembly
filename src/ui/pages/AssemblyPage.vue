<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import HtmlContent from '../components/HtmlContent.vue';
import InvitationsPanel from '../components/InvitationsPanel.vue';
import RoundChart from '../components/RoundChart.vue';
import StateTag from '../components/StateTag.vue';
import { download, toCsv } from '../csv';
import {
  useAbility,
  useConfirm,
  useCurrentOrganization,
  useI18n,
  useRouter,
  useToast,
} from '../plugin';
import { useAssembliesStore } from '../stores/assemblies';
import { formatCountdown, formatInZone, zoneKey } from '../time';
import { AssemblyState, type Assembly, type Progress } from '../types';

// While running, the progress refreshes this often (an org admin watching, not every participant)
const PROGRESS_REFRESH_MS = 5000;

const { t } = useI18n();
const { can } = useAbility();
const toast = useToast();
const confirm = useConfirm();
const router = useRouter();
const organization = useCurrentOrganization();
const store = useAssembliesStore();

const id = computed(() => router.route.value.params.id);
const assembly = ref<Assembly | null>(null);
const progress = ref<Progress | null>(null);
const busy = ref(false);
const exporting = ref(false);
const tab = ref('overview');
let timer: ReturnType<typeof setTimeout> | null = null;

const state = computed(() => assembly.value?.state ?? null);
const canUpdate = computed(() => can('update', 'Assembly'));
const editable = computed(
  () =>
    state.value === AssemblyState.DRAFT ||
    state.value === AssemblyState.SCHEDULED,
);
const hasRun = computed(
  () =>
    state.value === AssemblyState.RUNNING ||
    state.value === AssemblyState.FINISHED,
);

const loadProgress = async () => {
  if (timer) clearTimeout(timer);
  try {
    progress.value = await store.progress(id.value);
    if (progress.value.state !== assembly.value?.state)
      assembly.value = await store.get(id.value);
  } catch (error) {
    toast.error(error);
    return;
  }
  if (
    progress.value.state === AssemblyState.RUNNING ||
    progress.value.state === AssemblyState.SCHEDULED
  ) {
    timer = setTimeout(loadProgress, PROGRESS_REFRESH_MS);
  }
};

const load = async () => {
  try {
    assembly.value = await store.get(id.value);
    if (assembly.value.state !== AssemblyState.DRAFT) await loadProgress();
  } catch (error) {
    toast.error(error);
  }
};

onMounted(() => {
  if (organization.value) void load();
});
onUnmounted(() => timer && clearTimeout(timer));

const act = async (action: () => Promise<Assembly>, success: string) => {
  busy.value = true;
  try {
    assembly.value = await action();
    toast.success(success);
    if (assembly.value.state !== AssemblyState.DRAFT) await loadProgress();
  } catch (error) {
    toast.error(error);
  } finally {
    busy.value = false;
  }
};

const schedule = () =>
  act(() => store.schedule(id.value), t('pages.assembly.scheduled'));
const unschedule = () =>
  act(() => store.unschedule(id.value), t('pages.assembly.unscheduled'));
const cancel = async () => {
  if (
    !(await confirm({
      message: t('pages.assembly.confirmCancel'),
      severity: 'danger',
    }))
  )
    return;
  await act(() => store.cancel(id.value), t('pages.assembly.canceled'));
};
const remove = async () => {
  if (
    !(await confirm({
      message: t('pages.assembly.confirmDelete'),
      severity: 'danger',
      confirmText: t('buttons.delete'),
    }))
  ) {
    return;
  }
  try {
    await store.remove(id.value);
    toast.success(t('pages.assembly.deleted'));
    await router.push({ name: 'assemblies' });
  } catch (error) {
    toast.error(error);
  }
};

const exportCsv = async () => {
  exporting.value = true;
  try {
    const participants = await store.exportAll(id.value);
    download(`super-assembly-${id.value}.csv`, toCsv(participants));
  } catch (error) {
    toast.error(error);
  } finally {
    exporting.value = false;
  }
};

const phaseEndsIn = computed(() =>
  progress.value?.phase.endsAt
    ? Date.parse(progress.value.phase.endsAt) -
      Date.parse(progress.value.serverTime)
    : 0,
);
const chartRounds = (question: number) =>
  progress.value?.results
    .find((r) => r.question === question)
    ?.rounds.map((r) => ({
      round: r.round,
      average: r.count ? Math.round((r.total / r.count) * 100) / 100 : null,
      min: r.min,
      max: r.max,
    })) ?? null;
</script>

<template>
  <div class="flex flex-col gap-4">
    <Message v-if="!organization" severity="info" :closable="false">{{
      t('common.noOrganization')
    }}</Message>

    <template v-else-if="assembly">
      <div class="flex flex-wrap items-start gap-3">
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-semibold">{{ assembly.title }}</h1>
            <StateTag :state="assembly.state" />
          </div>
          <p class="text-surface-500">
            {{ formatInZone(assembly.startsAt, assembly.timeZone) }}
          </p>
        </div>
        <div class="ml-auto flex flex-wrap gap-2">
          <Button
            v-if="editable && canUpdate"
            :label="t('buttons.edit')"
            icon="pi pi-pencil"
            severity="secondary"
            outlined
            @click="
              router.push({
                name: 'assembly-edit',
                params: { id: assembly.id },
              })
            "
          />
          <Button
            v-if="can('create', 'Assembly')"
            :label="t('buttons.clone')"
            icon="pi pi-copy"
            severity="secondary"
            outlined
            @click="
              router.push({
                name: 'assembly-new',
                query: { clone: assembly.id },
              })
            "
          />
          <Button
            v-if="hasRun"
            :label="t('pages.assembly.export')"
            icon="pi pi-download"
            severity="secondary"
            outlined
            :loading="exporting"
            @click="exportCsv"
          />
          <Button
            v-if="state === 'draft' && canUpdate"
            :label="t('pages.assembly.schedule')"
            icon="pi pi-calendar"
            :loading="busy"
            @click="schedule"
          />
          <Button
            v-if="state === 'scheduled' && canUpdate"
            :label="t('pages.assembly.unschedule')"
            icon="pi pi-undo"
            severity="secondary"
            outlined
            :loading="busy"
            @click="unschedule"
          />
          <Button
            v-if="(state === 'scheduled' || state === 'running') && canUpdate"
            :label="t('pages.assembly.cancel')"
            icon="pi pi-ban"
            severity="danger"
            outlined
            :loading="busy"
            @click="cancel"
          />
          <Button
            v-if="state === 'draft' && can('delete', 'Assembly')"
            :label="t('buttons.delete')"
            icon="pi pi-trash"
            severity="danger"
            text
            @click="remove"
          />
        </div>
      </div>

      <Tabs v-model:value="tab">
        <TabList>
          <Tab value="overview">{{ t('pages.assembly.overview') }}</Tab>
          <Tab value="invitations">{{ t('pages.assembly.invitations') }}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="overview">
            <div class="flex flex-col gap-6 py-4">
              <div
                v-if="progress"
                class="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
              >
                <div
                  v-for="key in [
                    'invitations',
                    'joined',
                    'ready',
                    'cohort',
                    'stopped',
                    'answeredThisRound',
                  ] as const"
                  :key="key"
                  class="rounded-lg border border-surface-200 bg-surface-0 p-3"
                >
                  <p class="text-sm text-surface-500">
                    {{ t(`progress.${key}`) }}
                  </p>
                  <p class="text-2xl font-semibold tabular-nums">
                    {{ progress.counts[key] }}
                  </p>
                </div>
              </div>
              <p
                v-if="progress?.phase.phase === 'round'"
                class="text-surface-600"
              >
                {{
                  t('progress.round', {
                    question: progress.phase.question + 1,
                    round: progress.phase.round,
                    time: formatCountdown(phaseEndsIn),
                  })
                }}
              </p>

              <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3">
                <dt class="font-medium text-surface-500">
                  {{ t('fields.timeZone') }}
                </dt>
                <dd>{{ t(`timeZones.${zoneKey(assembly.timeZone)}`) }}</dd>
                <dt class="font-medium text-surface-500">
                  {{ t('fields.roundDuration') }}
                </dt>
                <dd>
                  {{ assembly.roundDurationSec }} {{ t('common.seconds') }}
                </dd>
                <dt class="font-medium text-surface-500">
                  {{ t('pages.assembly.ends') }}
                </dt>
                <dd>{{ formatInZone(assembly.endsAt, assembly.timeZone) }}</dd>
              </dl>

              <section
                v-for="(question, index) in assembly.questions"
                :key="index"
                class="flex flex-col gap-2"
              >
                <h2 class="font-semibold">
                  {{ t('pages.form.question', { n: index + 1 }) }}
                  <span class="font-normal text-surface-500"
                    >({{ question.min }}–{{ question.max }})</span
                  >
                </h2>
                <HtmlContent :html="question.prompt" />
                <RoundChart
                  v-if="chartRounds(index)"
                  :rounds="chartRounds(index)!"
                  :min="question.min"
                  :max="question.max"
                />
              </section>
            </div>
          </TabPanel>
          <TabPanel value="invitations">
            <InvitationsPanel
              :assembly-id="assembly.id"
              :can-change="
                canUpdate && state !== 'finished' && state !== 'canceled'
              "
            />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </template>
  </div>
</template>
