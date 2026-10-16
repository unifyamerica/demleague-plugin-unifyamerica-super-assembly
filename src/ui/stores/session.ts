import { computed, ref } from 'vue';
import { assemblyUi, useApi } from '../plugin';
import { SessionState, type Session } from '../types';

// How long to wait for a state that doesn't change on the clock (the cohort being picked, results being
// computed), and how far to spread refreshes after a phase change, so hundreds of participants don't all ask
// in the same second.
const RETRY_MS = 3000;
const SPREAD_MS = 2500;
const SETTLE_MS = 2500;

/**
 * The current user's participation in one assembly. The assembly moves on the clock, so instead of polling it
 * asks again when the current phase ends (with a little spread), and right after the user acts.
 */
export const useSessionStore = assemblyUi.defineStore('session', () => {
  const api = useApi();
  const session = ref<Session | null>(null);
  const loading = ref(false);
  // Server time minus browser time, so countdowns follow the server's clock
  const clockOffset = ref(0);
  const now = ref(Date.now());
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let currentId: string | null = null;

  const serverNow = computed(() => now.value + clockOffset.value);

  function apply(next: Session) {
    session.value = next;
    clockOffset.value = Date.parse(next.serverTime) - Date.now();
    scheduleRefresh();
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    const current = session.value;
    if (!current || !currentId) return;

    let delay: number | null = null;
    const endsAt = current.phase.endsAt
      ? Date.parse(current.phase.endsAt)
      : null;
    switch (current.state) {
      case SessionState.STARTING:
        delay = RETRY_MS;
        break;
      case SessionState.REPORT:
      case SessionState.FINISHED:
        // Results land a couple of seconds after the last round
        if (!current.report) delay = RETRY_MS;
        else if (endsAt)
          delay = endsAt - serverNow.value + Math.random() * SPREAD_MS;
        break;
      case SessionState.WAITING:
      case SessionState.NOT_READY:
      case SessionState.ANSWERING:
      case SessionState.ANSWERED:
        if (endsAt)
          delay =
            endsAt - serverNow.value + SETTLE_MS + Math.random() * SPREAD_MS;
        break;
    }
    if (delay !== null) {
      const id = currentId;
      refreshTimer = setTimeout(
        () => void load(id).catch(() => scheduleRetry()),
        Math.max(delay, 500),
      );
    }
  }

  function scheduleRetry() {
    const id = currentId;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (id)
      refreshTimer = setTimeout(
        () => void load(id).catch(() => scheduleRetry()),
        RETRY_MS * 2,
      );
  }

  async function load(id: string) {
    currentId = id;
    if (!tickTimer)
      tickTimer = setInterval(() => (now.value = Date.now()), 1000);
    loading.value = true;
    try {
      apply(await api.get<Session>(`/participations/${id}`));
    } finally {
      loading.value = false;
    }
  }

  async function ready() {
    if (!currentId) return;
    apply(await api.post<Session>(`/participations/${currentId}/ready`));
  }

  async function respond(value: number) {
    if (!currentId) return;
    apply(
      await api.post<Session>(`/participations/${currentId}/responses`, {
        value,
      }),
    );
  }

  function stop() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (tickTimer) clearInterval(tickTimer);
    refreshTimer = null;
    tickTimer = null;
    currentId = null;
  }

  function reset() {
    stop();
    session.value = null;
  }

  return { session, loading, serverNow, load, ready, respond, stop, reset };
});
