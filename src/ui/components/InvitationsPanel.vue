<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable, { type DataTablePageEvent } from 'primevue/datatable';
import InputNumber from 'primevue/inputnumber';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { onMounted, ref } from 'vue';
import { useCurrentOrganization, useI18n, useToast } from '../plugin';
import { useAssembliesStore } from '../stores/assemblies';
import type { Invitation, Traits } from '../types';

const props = defineProps<{ assemblyId: string; canChange: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const toast = useToast();
const organization = useCurrentOrganization();
const store = useAssembliesStore();

const items = ref<Invitation[]>([]);
const total = ref(0);
const first = ref(0);
const rows = ref(25);
const loading = ref(false);
const count = ref<number | null>(10);
const traitsText = ref('');
const creating = ref(false);

const load = async () => {
  loading.value = true;
  try {
    const page = await store.invitations(
      props.assemblyId,
      first.value / rows.value + 1,
      rows.value,
    );
    items.value = page.items;
    total.value = page.total;
  } catch (error) {
    toast.error(error);
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const onPage = (event: DataTablePageEvent) => {
  first.value = event.first;
  rows.value = event.rows;
  void load();
};

// What a member opens: the module's join page, in this organization
const linkFor = (code: string) =>
  `${window.location.origin}/apps/unifyamerica/super-assembly/join/${code}?org=${encodeURIComponent(organization.value?.slug ?? '')}`;

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('invitations.copied'));
  } catch {
    toast.error(t('invitations.copyFailed'));
  }
};

const copyAllUnused = async () => {
  const unused = items.value
    .filter((i) => !i.participantId)
    .map((i) => linkFor(i.code));
  await copy(unused.join('\n'));
};

const create = async (input: { count: number } | { traits: Traits[] }) => {
  creating.value = true;
  try {
    const created = await store.createInvitations(props.assemblyId, input);
    toast.success(t('invitations.created', { count: created.length }));
    traitsText.value = '';
    await load();
    emit('changed');
  } catch (error) {
    toast.error(error);
  } finally {
    creating.value = false;
  }
};

const generate = () => count.value && create({ count: count.value });

// One JSON object of traits per line (e.g. {"smoker": "no"}), or a JSON array of them
const importTraits = () => {
  const text = traitsText.value.trim();
  let traits: unknown;
  try {
    traits = text.startsWith('[')
      ? JSON.parse(text)
      : text
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
  } catch {
    toast.error(t('invitations.badTraits'));
    return;
  }
  if (
    !Array.isArray(traits) ||
    !traits.every((x) => x && typeof x === 'object' && !Array.isArray(x))
  ) {
    toast.error(t('invitations.badTraits'));
    return;
  }
  void create({ traits: traits as Traits[] });
};

const remove = async (invitation: Invitation) => {
  try {
    await store.removeInvitation(props.assemblyId, invitation.id);
    await load();
    emit('changed');
  } catch (error) {
    toast.error(error);
  }
};
</script>

<template>
  <div class="flex flex-col gap-6 py-4">
    <div v-if="canChange" class="grid gap-6 lg:grid-cols-2">
      <form class="flex flex-col gap-2" @submit.prevent="generate">
        <label for="invitation-count" class="font-medium">{{
          t('invitations.generate')
        }}</label>
        <div class="flex gap-2">
          <InputNumber
            v-model="count"
            input-id="invitation-count"
            :min="1"
            :max="500"
            class="w-32"
          />
          <Button
            type="submit"
            :label="t('invitations.generateButton')"
            icon="pi pi-plus"
            :loading="creating"
            :disabled="!count"
          />
        </div>
        <small class="text-surface-500">{{
          t('invitations.generateHelp')
        }}</small>
      </form>
      <form class="flex flex-col gap-2" @submit.prevent="importTraits">
        <label for="invitation-traits" class="font-medium">{{
          t('invitations.import')
        }}</label>
        <Textarea
          id="invitation-traits"
          v-model="traitsText"
          rows="3"
          auto-resize
          class="font-mono text-sm"
          placeholder='{"smoker": "no", "age": 34}'
          aria-describedby="invitation-traits-help"
        />
        <small id="invitation-traits-help" class="text-surface-500">{{
          t('invitations.importHelp')
        }}</small>
        <Button
          type="submit"
          class="self-start"
          :label="t('invitations.importButton')"
          icon="pi pi-upload"
          severity="secondary"
          outlined
          :loading="creating"
          :disabled="!traitsText.trim()"
        />
      </form>
    </div>

    <DataTable
      :value="items"
      lazy
      paginator
      :first="first"
      :rows="rows"
      :rows-per-page-options="[25, 50, 100]"
      :total-records="total"
      :loading="loading"
      data-key="id"
      @page="onPage"
    >
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium">{{
            t('invitations.total', { count: total })
          }}</span>
          <Button
            :label="t('invitations.copyUnused')"
            icon="pi pi-copy"
            size="small"
            text
            :disabled="!items.some((i) => !i.participantId)"
            @click="copyAllUnused"
          />
        </div>
      </template>
      <template #empty>{{ t('invitations.empty') }}</template>
      <Column :header="t('fields.code')">
        <template #body="{ data }: { data: Invitation }"
          ><code>{{ data.code }}</code></template
        >
      </Column>
      <Column :header="t('fields.traits')">
        <template #body="{ data }: { data: Invitation }">
          <div class="flex flex-wrap gap-1">
            <Tag
              v-for="(value, key) in data.traits"
              :key="key"
              :value="`${key}: ${value}`"
              severity="secondary"
            />
          </div>
        </template>
      </Column>
      <Column :header="t('fields.status')">
        <template #body="{ data }: { data: Invitation }">
          <Tag
            :value="
              data.participantId
                ? t('invitations.used')
                : t('invitations.unused')
            "
            :severity="data.participantId ? 'success' : 'secondary'"
          />
        </template>
      </Column>
      <Column :header="t('common.actions')" class="w-28 text-right">
        <template #body="{ data }: { data: Invitation }">
          <div class="flex justify-end gap-1">
            <Button
              icon="pi pi-link"
              text
              rounded
              :aria-label="t('invitations.copyLink')"
              @click="copy(linkFor(data.code))"
            />
            <Button
              v-if="canChange && !data.participantId"
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              :aria-label="t('buttons.delete')"
              @click="remove(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>
  </div>
</template>
