<script setup lang="ts">
import { storeToRefs } from '@unifyamerica/demleague-plugin-sdk/vue';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable, { type DataTablePageEvent } from 'primevue/datatable';
import Message from 'primevue/message';
import { onMounted, ref } from 'vue';
import StateTag from '../components/StateTag.vue';
import {
  useAbility,
  useCurrentOrganization,
  useI18n,
  useRouter,
  useToast,
} from '../plugin';
import { useAssembliesStore } from '../stores/assemblies';
import { formatInZone } from '../time';
import { AssemblyState, type Assembly } from '../types';

const { t } = useI18n();
const { can } = useAbility();
const toast = useToast();
const router = useRouter();
const organization = useCurrentOrganization();
const store = useAssembliesStore();
const { items, total, loading } = storeToRefs(store);

// Lazy table: the server pages (the SPA's useLazyTable pattern, which plugins can't import)
const first = ref(0);
const rows = ref(25);

const load = async () => {
  try {
    await store.load(first.value / rows.value + 1, rows.value);
  } catch (error) {
    toast.error(error);
  }
};

onMounted(() => {
  store.reset();
  if (organization.value) void load();
});

const onPage = (event: DataTablePageEvent) => {
  first.value = event.first;
  rows.value = event.rows;
  void load();
};

const editable = (assembly: Assembly) =>
  assembly.state === AssemblyState.DRAFT ||
  assembly.state === AssemblyState.SCHEDULED;
const open = (assembly: Assembly) =>
  router.push({ name: 'assembly', params: { id: assembly.id } });
const edit = (assembly: Assembly) =>
  router.push({ name: 'assembly-edit', params: { id: assembly.id } });
const clone = (assembly: Assembly) =>
  router.push({ name: 'assembly-new', query: { clone: assembly.id } });
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-3">
      <div>
        <h1 class="text-2xl font-semibold">
          {{ t('pages.assemblies.title') }}
        </h1>
        <p v-if="organization" class="text-surface-500">
          {{
            t('pages.assemblies.subtitle', { organization: organization.name })
          }}
        </p>
      </div>
      <Button
        v-if="organization && can('create', 'Assembly')"
        class="ml-auto"
        :label="t('pages.assemblies.new')"
        icon="pi pi-plus"
        @click="router.push({ name: 'assembly-new' })"
      />
    </div>

    <Message v-if="!organization" severity="info" :closable="false">{{
      t('common.noOrganization')
    }}</Message>

    <DataTable
      v-else
      :value="items"
      lazy
      paginator
      :first="first"
      :rows="rows"
      :rows-per-page-options="[10, 25, 50]"
      :total-records="total"
      :loading="loading"
      data-key="id"
      @page="onPage"
    >
      <template #empty>{{ t('pages.assemblies.empty') }}</template>

      <Column :header="t('fields.title')">
        <template #body="{ data }: { data: Assembly }">
          <button
            type="button"
            class="text-left text-primary hover:underline"
            @click="open(data)"
          >
            {{ data.title }}
          </button>
        </template>
      </Column>
      <Column :header="t('fields.state')">
        <template #body="{ data }: { data: Assembly }"
          ><StateTag :state="data.state"
        /></template>
      </Column>
      <Column :header="t('fields.startsAt')">
        <template #body="{ data }: { data: Assembly }">{{
          formatInZone(data.startsAt, data.timeZone)
        }}</template>
      </Column>
      <Column :header="t('fields.questions')">
        <template #body="{ data }: { data: Assembly }">{{
          data.questions.length
        }}</template>
      </Column>
      <Column :header="t('common.actions')" class="w-36 text-right">
        <template #body="{ data }: { data: Assembly }">
          <div class="flex justify-end gap-1">
            <Button
              icon="pi pi-eye"
              text
              rounded
              :aria-label="t('buttons.view')"
              @click="open(data)"
            />
            <Button
              v-if="editable(data) && can('update', 'Assembly')"
              icon="pi pi-pencil"
              text
              rounded
              :aria-label="t('buttons.edit')"
              @click="edit(data)"
            />
            <Button
              v-if="can('create', 'Assembly')"
              icon="pi pi-copy"
              text
              rounded
              :aria-label="t('buttons.clone')"
              @click="clone(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>
  </div>
</template>
