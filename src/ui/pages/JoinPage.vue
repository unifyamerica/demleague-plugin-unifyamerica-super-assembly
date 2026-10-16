<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import { onMounted, ref } from 'vue';
import HtmlContent from '../components/HtmlContent.vue';
import {
  useApi,
  useCurrentOrganization,
  useI18n,
  useRouter,
  useToast,
} from '../plugin';
import { formatInZone } from '../time';
import { AssemblyState, type InvitationPreview } from '../types';

const { t } = useI18n();
const api = useApi();
const toast = useToast();
const router = useRouter();
const organization = useCurrentOrganization();

const preview = ref<InvitationPreview | null>(null);
const failed = ref(false);
const joining = ref(false);

const code = () => router.route.value.params.code;

onMounted(async () => {
  if (!organization.value) return;
  try {
    preview.value = await api.get<InvitationPreview>(`/join/${code()}`);
  } catch {
    failed.value = true;
  }
});

const join = async () => {
  joining.value = true;
  try {
    const { id } = await api.post<{ id: string }>('/participations', {
      code: code(),
    });
    await router.push({ name: 'session', params: { id } });
  } catch (error) {
    toast.error(error);
  } finally {
    joining.value = false;
  }
};

const openExisting = (id: string) =>
  router.push({ name: 'session', params: { id } });
const closed = (state: AssemblyState) =>
  state === AssemblyState.FINISHED || state === AssemblyState.CANCELED;
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6">
    <Message v-if="!organization" severity="info" :closable="false">{{
      t('common.noOrganization')
    }}</Message>
    <Message v-else-if="failed" severity="warn" :closable="false">{{
      t('pages.join.invalid')
    }}</Message>

    <template v-else-if="preview">
      <div>
        <h1 class="text-2xl font-semibold">{{ preview.assembly.title }}</h1>
        <p class="text-surface-500">
          {{
            t('pages.join.startsAt', {
              time: formatInZone(
                preview.assembly.startsAt,
                preview.assembly.timeZone,
              ),
            })
          }}
        </p>
      </div>

      <HtmlContent v-if="preview.landingHtml" :html="preview.landingHtml" />

      <p class="text-surface-600">
        {{
          t('pages.join.howItWorks', {
            questions: preview.assembly.questionCount,
            rounds: preview.assembly.roundsPerQuestion,
          })
        }}
      </p>

      <Message
        v-if="closed(preview.assembly.state)"
        severity="info"
        :closable="false"
      >
        {{ t(`pages.join.closed.${preview.assembly.state}`) }}
      </Message>
      <div v-else class="flex justify-end">
        <Button
          v-if="preview.participationId"
          :label="t('pages.join.continue')"
          icon="pi pi-arrow-right"
          @click="openExisting(preview.participationId)"
        />
        <Button
          v-else
          :label="t('pages.join.join')"
          icon="pi pi-sign-in"
          :loading="joining"
          @click="join"
        />
      </div>
    </template>
  </div>
</template>
