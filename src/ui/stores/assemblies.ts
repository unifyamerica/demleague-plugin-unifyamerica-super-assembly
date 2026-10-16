import { ref } from 'vue';
import { assemblyUi, useApi } from '../plugin';
import type {
  Assembly,
  AssemblyInput,
  ExportPage,
  Invitation,
  Page,
  Progress,
  Traits,
} from '../types';

// Org admins' assemblies (store id `unifyamerica.super-assembly/assemblies`). The API scopes everything to
// the current organization, and pages reset the store when it changes.
export const useAssembliesStore = assemblyUi.defineStore('assemblies', () => {
  const api = useApi();
  const items = ref<Assembly[]>([]);
  const total = ref(0);
  const loading = ref(false);

  async function load(page: number, limit: number) {
    loading.value = true;
    try {
      const result = await api.get<Page<Assembly>>('/assemblies', {
        params: { page, limit },
      });
      items.value = result.items;
      total.value = result.total;
    } finally {
      loading.value = false;
    }
  }

  const get = (id: string) => api.get<Assembly>(`/assemblies/${id}`);
  const create = (input: AssemblyInput) =>
    api.post<Assembly>('/assemblies', input);
  const update = (id: string, input: Partial<AssemblyInput>) =>
    api.patch<Assembly>(`/assemblies/${id}`, input);
  const remove = (id: string) => api.delete<void>(`/assemblies/${id}`);
  const schedule = (id: string) =>
    api.post<Assembly>(`/assemblies/${id}/schedule`);
  const unschedule = (id: string) =>
    api.post<Assembly>(`/assemblies/${id}/unschedule`);
  const cancel = (id: string) => api.post<Assembly>(`/assemblies/${id}/cancel`);
  const progress = (id: string) =>
    api.get<Progress>(`/assemblies/${id}/progress`);

  const invitations = (id: string, page: number, limit: number) =>
    api.get<Page<Invitation>>(`/assemblies/${id}/invitations`, {
      params: { page, limit },
    });
  const createInvitations = (
    id: string,
    input: { count: number } | { traits: Traits[] },
  ) => api.post<Invitation[]>(`/assemblies/${id}/invitations`, input);
  const removeInvitation = (id: string, invitationId: string) =>
    api.delete<void>(`/assemblies/${id}/invitations/${invitationId}`);

  /** Every page of the export, for the CSV. */
  async function exportAll(id: string): Promise<ExportPage['participants']> {
    const participants: ExportPage['participants'] = [];
    for (let page = 1; ; page++) {
      const result = await api.get<ExportPage>(`/assemblies/${id}/export`, {
        params: { page },
      });
      participants.push(...result.participants);
      if (!result.hasMore) return participants;
    }
  }

  function reset() {
    items.value = [];
    total.value = 0;
  }

  return {
    items,
    total,
    loading,
    load,
    get,
    create,
    update,
    remove,
    schedule,
    unschedule,
    cancel,
    progress,
    invitations,
    createInvitations,
    removeInvitation,
    exportAll,
    reset,
  };
});
