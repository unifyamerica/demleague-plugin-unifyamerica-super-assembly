<script setup lang="ts">
import { storeToRefs } from '@unifyamerica/demleague-plugin-sdk/vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import ProgressBar from 'primevue/progressbar';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import HtmlContent from '../components/HtmlContent.vue';
import RoundChart from '../components/RoundChart.vue';
import {
  useCurrentOrganization,
  useI18n,
  useRouter,
  useToast,
} from '../plugin';
import { useSessionStore } from '../stores/session';
import { formatCountdown, formatInZone } from '../time';
import { SessionState } from '../types';

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const organization = useCurrentOrganization();
const store = useSessionStore();
const { session, serverNow } = storeToRefs(store);

const answer = ref<number | null>(null);
const sending = ref(false);
const notFound = ref(false);

onMounted(async () => {
  store.reset();
  if (!organization.value) return;
  try {
    await store.load(router.route.value.params.id);
  } catch (error) {
    notFound.value = true;
    toast.error(error);
  }
});
onUnmounted(() => store.stop());

const state = computed(() => session.value?.state ?? null);
const phaseEndsIn = computed(() =>
  session.value?.phase.endsAt
    ? Date.parse(session.value.phase.endsAt) - serverNow.value
    : 0,
);
// Until when the last "I'm here" keeps their place (checked at the start)
const readyFor = computed(() =>
  session.value?.readyAt
    ? Date.parse(session.value.readyAt) +
      session.value.assembly.readyWindowSec * 1000 -
      serverNow.value
    : 0,
);
const isReady = computed(
  () => state.value === SessionState.WAITING && readyFor.value > 0,
);
const isPercent = computed(
  () =>
    session.value?.question?.min === 0 && session.value.question.max === 100,
);
const roundLabel = computed(() =>
  session.value
    ? t('pages.session.progress', {
        question: session.value.phase.question + 1,
        questions: session.value.assembly.questionCount,
        round: session.value.phase.round,
        rounds: session.value.assembly.roundsPerQuestion,
      })
    : '',
);
const roundProgress = computed(() => {
  const duration = (session.value?.assembly.roundDurationSec ?? 1) * 1000;
  return Math.min(100, Math.max(0, 100 - (phaseEndsIn.value / duration) * 100));
});

// A new round starts with an empty answer
watch(
  () => [session.value?.phase.question, session.value?.phase.round],
  () => (answer.value = null),
);

const confirmReady = async () => {
  try {
    await store.ready();
  } catch (error) {
    toast.error(error);
  }
};

const submit = async () => {
  if (answer.value === null) return;
  sending.value = true;
  try {
    await store.respond(answer.value);
  } catch (error) {
    toast.error(error);
  } finally {
    sending.value = false;
  }
};
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6">
    <Message v-if="!organization" severity="info" :closable="false">{{
      t('common.noOrganization')
    }}</Message>
    <Message v-else-if="notFound" severity="warn" :closable="false">{{
      t('pages.session.notFound')
    }}</Message>

    <template v-else-if="session">
      <div>
        <h1 class="text-2xl font-semibold">{{ session.assembly.title }}</h1>
        <p class="text-surface-500">
          {{
            formatInZone(session.assembly.startsAt, session.assembly.timeZone)
          }}
        </p>
      </div>

      <!-- Waiting room -->
      <template
        v-if="
          state === SessionState.WAITING || state === SessionState.NOT_READY
        "
      >
        <HtmlContent
          v-if="session.assembly.readyHtml"
          :html="session.assembly.readyHtml"
        />
        <div
          class="flex flex-col gap-3 rounded-lg border border-surface-200 bg-surface-0 p-4"
        >
          <p class="text-lg">
            {{ t('pages.session.startsIn') }}
            <span class="font-semibold tabular-nums">{{
              formatCountdown(phaseEndsIn)
            }}</span>
          </p>
          <Message v-if="isReady" severity="success" :closable="false">
            {{ t('pages.session.ready', { time: formatCountdown(readyFor) }) }}
          </Message>
          <Message v-else severity="warn" :closable="false">{{
            t('pages.session.notReady')
          }}</Message>
          <Button
            class="self-start"
            :label="t('pages.session.imHere')"
            icon="pi pi-check"
            :severity="isReady ? 'secondary' : 'primary'"
            @click="confirmReady"
          />
          <small class="text-surface-500">{{
            t('pages.session.readyHelp')
          }}</small>
        </div>
      </template>

      <Message
        v-else-if="state === SessionState.STARTING"
        severity="info"
        :closable="false"
      >
        {{ t('pages.session.starting') }}
      </Message>

      <!-- A round -->
      <template
        v-else-if="
          (state === SessionState.ANSWERING ||
            state === SessionState.ANSWERED) &&
          session.question
        "
      >
        <div class="flex flex-col gap-2">
          <div
            class="flex items-center justify-between text-sm text-surface-600"
          >
            <span>{{ roundLabel }}</span>
            <span
              class="font-semibold tabular-nums"
              :class="{ 'text-red-600': phaseEndsIn < 16_000 }"
            >
              {{ formatCountdown(phaseEndsIn) }}
            </span>
          </div>
          <ProgressBar :value="roundProgress" :show-value="false" class="h-2" />
        </div>

        <HtmlContent :html="session.question.prompt" class="text-lg" />

        <div v-if="session.previous" class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-lg border border-surface-200 bg-surface-0 p-4">
            <p class="text-sm text-surface-500">
              {{ t('pages.session.yourLast') }}
            </p>
            <p class="text-2xl font-semibold text-orange-600">
              {{ session.previous.mine ?? '—'
              }}<span v-if="isPercent && session.previous.mine !== null"
                >%</span
              >
            </p>
          </div>
          <div class="rounded-lg border border-surface-200 bg-surface-0 p-4">
            <p class="text-sm text-surface-500">
              {{ t('pages.session.neighbors') }}
            </p>
            <p class="text-2xl font-semibold text-primary">
              {{ session.previous.neighborsAverage ?? '—'
              }}<span
                v-if="isPercent && session.previous.neighborsAverage !== null"
                >%</span
              >
            </p>
          </div>
        </div>

        <form
          v-if="state === SessionState.ANSWERING"
          class="flex flex-col gap-2"
          @submit.prevent="submit"
        >
          <label for="answer" class="font-medium">
            {{
              t('pages.session.answerLabel', {
                min: session.question.min,
                max: session.question.max,
              })
            }}
          </label>
          <div class="flex flex-wrap gap-2">
            <InputNumber
              v-model="answer"
              input-id="answer"
              :min="session.question.min"
              :max="session.question.max"
              :use-grouping="false"
              :suffix="isPercent ? '%' : undefined"
              class="w-40"
            />
            <Button
              type="submit"
              :label="t('pages.session.submit')"
              icon="pi pi-send"
              :loading="sending"
              :disabled="answer === null"
            />
          </div>
        </form>
        <Message v-else severity="success" :closable="false">
          {{ t('pages.session.answered', { value: session.myAnswer ?? '' }) }}
        </Message>
      </template>

      <!-- Results between questions, and at the end -->
      <template
        v-else-if="
          state === SessionState.REPORT || state === SessionState.FINISHED
        "
      >
        <HtmlContent
          v-if="
            state === SessionState.FINISHED && session.assembly.finishedHtml
          "
          :html="session.assembly.finishedHtml"
        />
        <div
          class="flex flex-col gap-3 rounded-lg border border-surface-200 bg-surface-0 p-4"
        >
          <h2 class="font-semibold">
            {{
              t('pages.session.results', {
                question: session.phase.question + 1,
              })
            }}
          </h2>
          <HtmlContent
            v-if="session.question"
            :html="session.question.prompt"
            class="text-surface-600"
          />
          <RoundChart
            v-if="session.report && session.question"
            :rounds="session.report.rounds"
            :min="session.question.min"
            :max="session.question.max"
          />
          <p v-else class="text-surface-500">
            {{ t('pages.session.computing') }}
          </p>
          <p v-if="state === SessionState.REPORT" class="text-surface-600">
            {{ t('pages.session.nextQuestionIn') }}
            <span class="font-semibold tabular-nums">{{
              formatCountdown(phaseEndsIn)
            }}</span>
          </p>
        </div>
      </template>

      <!-- Closed for them: late, left out, stopped or canceled -->
      <Message v-else severity="info" :closable="false">{{
        t(`pages.session.closed.${state}`)
      }}</Message>
    </template>
  </div>
</template>
