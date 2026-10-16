<script setup lang="ts">
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { computed, onMounted, ref } from 'vue';
import HtmlField from '../components/HtmlField.vue';
import {
  useConfirm,
  useCurrentOrganization,
  useI18n,
  useRouter,
  useToast,
} from '../plugin';
import { useAssembliesStore } from '../stores/assemblies';
import { fromPicker, toPicker, zoneKey } from '../time';
import {
  MAX_QUESTIONS,
  TIME_ZONES,
  type Assembly,
  type AssemblyInput,
} from '../types';

const MAX_PROMPT_LENGTH = 10_000;
const MAX_PAGE_HTML_LENGTH = 20_000;

const { t } = useI18n();
const toast = useToast();
const confirm = useConfirm();
const router = useRouter();
const organization = useCurrentOrganization();
const store = useAssembliesStore();

const id = computed(() => router.route.value.params.id ?? null);
const cloneOf = computed(() => router.route.value.query.clone ?? null);

interface FormQuestion {
  prompt: string;
  min: number | null;
  max: number | null;
}
interface Form {
  title: string;
  startsAt: Date | null;
  timeZone: string;
  roundDurationSec: number | null;
  questions: FormQuestion[];
  landingHtml: string;
  readyHtml: string;
  finishedHtml: string;
}

const blank = (): Form => ({
  title: '',
  startsAt: null,
  timeZone: 'America/New_York',
  roundDurationSec: 90,
  questions: [{ prompt: '', min: 0, max: 100 }],
  landingHtml: '',
  readyHtml: '',
  finishedHtml: '',
});

const form = ref<Form>(blank());
const saved = ref(JSON.stringify(form.value));
const loading = ref(false);
const saving = ref(false);
const status = ref<Assembly['status'] | null>(null);

const fromAssembly = (assembly: Assembly, keepStart: boolean): Form => ({
  title: assembly.title,
  startsAt:
    keepStart && assembly.startsAt
      ? toPicker(assembly.startsAt, assembly.timeZone)
      : null,
  timeZone: assembly.timeZone,
  roundDurationSec: assembly.roundDurationSec,
  questions: assembly.questions.map((q) => ({ ...q })),
  landingHtml: assembly.landingHtml,
  readyHtml: assembly.readyHtml,
  finishedHtml: assembly.finishedHtml,
});

onMounted(async () => {
  if (!organization.value) return;
  const source = id.value ?? cloneOf.value;
  if (!source) return;
  loading.value = true;
  try {
    const assembly = await store.get(source);
    // A clone gets everything but the start time, as in the original app
    form.value = fromAssembly(assembly, id.value !== null);
    if (cloneOf.value)
      form.value.title = t('pages.form.copyOf', { title: assembly.title });
    status.value = id.value ? assembly.status : null;
    saved.value = JSON.stringify(form.value);
  } catch (error) {
    toast.error(error);
  } finally {
    loading.value = false;
  }
});

const isDirty = computed(() => JSON.stringify(form.value) !== saved.value);
const questionInvalid = (q: FormQuestion) =>
  q.min !== null && q.max !== null && q.min >= q.max;
const isValid = computed(
  () =>
    form.value.title.trim().length > 0 &&
    form.value.roundDurationSec !== null &&
    form.value.questions.every(
      (q) => q.min !== null && q.max !== null && !questionInvalid(q),
    ),
);
const timeZones = TIME_ZONES.map((zone) => ({
  value: zone,
  label: t(`timeZones.${zoneKey(zone)}`),
}));

const addQuestion = () =>
  form.value.questions.push({ prompt: '', min: 0, max: 100 });
const removeQuestion = (index: number) => form.value.questions.splice(index, 1);

const toInput = (): AssemblyInput => ({
  title: form.value.title.trim(),
  startsAt: form.value.startsAt
    ? fromPicker(form.value.startsAt, form.value.timeZone)
    : null,
  timeZone: form.value.timeZone,
  roundDurationSec: form.value.roundDurationSec ?? 90,
  questions: form.value.questions.map((q) => ({
    prompt: q.prompt,
    min: q.min ?? 0,
    max: q.max ?? 0,
  })),
  landingHtml: form.value.landingHtml,
  readyHtml: form.value.readyHtml,
  finishedHtml: form.value.finishedHtml,
});

const save = async () => {
  if (!isValid.value) return;
  saving.value = true;
  try {
    const assembly = id.value
      ? await store.update(id.value, toInput())
      : await store.create(toInput());
    saved.value = JSON.stringify(form.value);
    toast.success(t('pages.form.saved'));
    await router.push({ name: 'assembly', params: { id: assembly.id } });
  } catch (error) {
    toast.error(error);
  } finally {
    saving.value = false;
  }
};

// Forms ask before dropping unsaved changes
const leave = async () => {
  if (
    isDirty.value &&
    !(await confirm({ message: t('pages.form.discard'), severity: 'warn' }))
  )
    return;
  await (id.value
    ? router.push({ name: 'assembly', params: { id: id.value } })
    : router.push({ name: 'assemblies' }));
};
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold">
        {{
          id
            ? t('pages.form.editTitle')
            : cloneOf
              ? t('pages.form.cloneTitle')
              : t('pages.form.newTitle')
        }}
      </h1>
      <p class="text-surface-500">{{ t('pages.form.subtitle') }}</p>
    </div>

    <Message v-if="!organization" severity="info" :closable="false">{{
      t('common.noOrganization')
    }}</Message>
    <Message
      v-else-if="status === 'scheduled'"
      severity="info"
      :closable="false"
    >
      {{ t('pages.form.scheduledNote') }}
    </Message>

    <form
      v-if="organization && !loading"
      class="flex flex-col gap-6"
      novalidate
      @submit.prevent="save"
    >
      <section class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label for="assembly-title" class="font-medium">{{
            t('fields.title')
          }}</label>
          <InputText
            id="assembly-title"
            v-model="form.title"
            maxlength="200"
            :invalid="!form.title.trim()"
          />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-2">
            <label for="assembly-starts-at" class="font-medium">{{
              t('fields.startsAt')
            }}</label>
            <DatePicker
              v-model="form.startsAt"
              input-id="assembly-starts-at"
              show-time
              hour-format="12"
              show-icon
              :step-minute="5"
              aria-describedby="assembly-starts-at-help"
            />
            <small id="assembly-starts-at-help" class="text-surface-500">{{
              t('pages.form.startsAtHelp')
            }}</small>
          </div>
          <div class="flex flex-col gap-2">
            <label for="assembly-time-zone" class="font-medium">{{
              t('fields.timeZone')
            }}</label>
            <Select
              v-model="form.timeZone"
              input-id="assembly-time-zone"
              :options="timeZones"
              option-label="label"
              option-value="value"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label for="assembly-round-duration" class="font-medium">{{
            t('fields.roundDuration')
          }}</label>
          <InputNumber
            v-model="form.roundDurationSec"
            input-id="assembly-round-duration"
            :min="15"
            :max="900"
            :suffix="` ${t('common.seconds')}`"
            :invalid="form.roundDurationSec === null"
            class="w-48"
            aria-describedby="assembly-round-duration-help"
          />
          <small id="assembly-round-duration-help" class="text-surface-500">
            {{ t('pages.form.roundDurationHelp') }}
          </small>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold">{{ t('pages.form.questions') }}</h2>
        <div
          v-for="(question, index) in form.questions"
          :key="index"
          class="flex flex-col gap-4 rounded-lg border border-surface-200 bg-surface-0 p-4"
        >
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">
              {{ t('pages.form.question', { n: index + 1 }) }}
            </h3>
            <Button
              v-if="form.questions.length > 1"
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              :aria-label="t('pages.form.removeQuestion', { n: index + 1 })"
              @click="removeQuestion(index)"
            />
          </div>
          <HtmlField
            :id="`question-${index}-prompt`"
            v-model="question.prompt"
            :label="t('fields.prompt')"
            :maxlength="MAX_PROMPT_LENGTH"
            :invalid="!question.prompt.trim()"
          />
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-2">
              <label :for="`question-${index}-min`" class="font-medium">{{
                t('fields.min')
              }}</label>
              <InputNumber
                v-model="question.min"
                :input-id="`question-${index}-min`"
                :use-grouping="false"
                :invalid="question.min === null || questionInvalid(question)"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label :for="`question-${index}-max`" class="font-medium">{{
                t('fields.max')
              }}</label>
              <InputNumber
                v-model="question.max"
                :input-id="`question-${index}-max`"
                :use-grouping="false"
                :invalid="question.max === null || questionInvalid(question)"
              />
            </div>
          </div>
          <small v-if="questionInvalid(question)" class="text-red-600">{{
            t('pages.form.minBelowMax')
          }}</small>
        </div>
        <Button
          v-if="form.questions.length < MAX_QUESTIONS"
          class="self-start"
          :label="t('pages.form.addQuestion')"
          icon="pi pi-plus"
          severity="secondary"
          outlined
          @click="addQuestion"
        />
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold">{{ t('pages.form.pages') }}</h2>
        <HtmlField
          id="assembly-landing"
          v-model="form.landingHtml"
          :label="t('fields.landingHtml')"
          :help="t('pages.form.landingHelp')"
          :maxlength="MAX_PAGE_HTML_LENGTH"
        />
        <HtmlField
          id="assembly-ready"
          v-model="form.readyHtml"
          :label="t('fields.readyHtml')"
          :help="t('pages.form.readyHelp')"
          :maxlength="MAX_PAGE_HTML_LENGTH"
        />
        <HtmlField
          id="assembly-finished"
          v-model="form.finishedHtml"
          :label="t('fields.finishedHtml')"
          :help="t('pages.form.finishedHelp')"
          :maxlength="MAX_PAGE_HTML_LENGTH"
        />
      </section>

      <div class="flex justify-end gap-2">
        <Button
          :label="t('buttons.cancel')"
          severity="secondary"
          outlined
          :disabled="saving"
          @click="leave"
        />
        <Button
          type="submit"
          :label="t('buttons.save')"
          icon="pi pi-check"
          :loading="saving"
          :disabled="!isValid || (id !== null && !isDirty)"
        />
      </div>
    </form>
  </div>
</template>
