<script setup lang="ts">
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import { computed, onMounted, ref } from 'vue';
import StateTag from '../components/StateTag.vue';
import {
  useApi,
  useCurrentOrganization,
  useI18n,
  useRouter,
  useToast,
} from '../plugin';
import { formatInZone } from '../time';
import type { Participation } from '../types';

const { t } = useI18n();
const api = useApi();
const toast = useToast();
const router = useRouter();
const organization = useCurrentOrganization();

const participations = ref<Participation[]>([]);
const loading = ref(false);
const link = ref('');

// A pasted invitation link or the bare code
const code = computed(
  () =>
    link.value.trim().match(/[A-Za-z0-9]{20}(?=[^A-Za-z0-9]*(?:\?|$))/)?.[0] ??
    null,
);

onMounted(async () => {
  participations.value = [];
  if (!organization.value) return;
  loading.value = true;
  try {
    participations.value = await api.get<Participation[]>('/participations');
  } catch (error) {
    toast.error(error);
  } finally {
    loading.value = false;
  }
});

const open = () => {
  if (code.value)
    void router.push({ name: 'join', params: { code: code.value } });
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold">{{ t('pages.home.title') }}</h1>
      <p v-if="organization" class="text-surface-500">
        {{ t('pages.home.subtitle', { organization: organization.name }) }}
      </p>
    </div>

    <Message v-if="!organization" severity="info" :closable="false">
      {{ t('common.noOrganization') }}
    </Message>

    <template v-else>
      <form class="flex flex-col gap-2" @submit.prevent="open">
        <label for="invitation-link" class="font-medium">{{
          t('pages.home.joinLabel')
        }}</label>
        <div class="flex flex-wrap gap-2">
          <InputText
            id="invitation-link"
            v-model="link"
            class="min-w-64 flex-1"
            maxlength="500"
            :placeholder="t('pages.home.joinPlaceholder')"
            aria-describedby="invitation-link-help"
          />
          <Button
            type="submit"
            :label="t('buttons.continue')"
            icon="pi pi-arrow-right"
            :disabled="!code"
          />
        </div>
        <small id="invitation-link-help" class="text-surface-500">{{
          t('pages.home.joinHelp')
        }}</small>
      </form>

      <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold">{{ t('pages.home.mine') }}</h2>
        <p v-if="!loading && !participations.length" class="text-surface-500">
          {{ t('pages.home.empty') }}
        </p>
        <ul class="grid gap-3 sm:grid-cols-2">
          <li
            v-for="participation in participations"
            :key="participation.id"
            class="flex flex-col gap-2 rounded-lg border border-surface-200 bg-surface-0 p-4"
          >
            <div class="flex items-start justify-between gap-2">
              <h3 class="font-semibold">{{ participation.assembly.title }}</h3>
              <StateTag :state="participation.assembly.state" />
            </div>
            <p class="text-sm text-surface-500">
              {{
                formatInZone(
                  participation.assembly.startsAt,
                  participation.assembly.timeZone,
                )
              }}
            </p>
            <RouterLink
              :to="
                router.to({ name: 'session', params: { id: participation.id } })
              "
              class="self-start text-primary hover:underline"
            >
              {{ t('pages.home.open') }}
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
