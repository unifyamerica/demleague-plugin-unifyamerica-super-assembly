import {
  installTestPluginHost,
  uninstallTestPluginHost,
  type TestPluginHost,
} from '@unifyamerica/demleague-plugin-sdk/vue/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import SessionPage from './SessionPage.vue';

const organization = {
  id: 'o1',
  name: 'Akron',
  slug: 'akron',
  description: null,
};
const serverTime = '2027-08-01T23:01:10.000Z';

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'p1',
  assembly: {
    id: 'a1',
    title: 'Akron Assembly',
    startsAt: '2027-08-01T23:00:00.000Z',
    timeZone: 'America/New_York',
    questionCount: 2,
    roundsPerQuestion: 3,
    roundDurationSec: 60,
    readyWindowSec: 60,
    state: 'running',
    readyHtml: '<p>Get ready</p>',
    finishedHtml: '',
  },
  state: 'answering',
  serverTime,
  readyAt: '2027-08-01T22:59:30.000Z',
  phase: {
    phase: 'round',
    question: 0,
    round: 2,
    startedAt: '2027-08-01T23:01:00.000Z',
    endsAt: '2027-08-01T23:02:00.000Z',
  },
  question: {
    index: 0,
    prompt: '<p>Four-day week?<script>alert(1)</script></p>',
    min: 0,
    max: 100,
  },
  myAnswer: null,
  previous: { round: 1, mine: 40, neighborsAverage: 70, neighborsAnswered: 2 },
  report: null,
  ...overrides,
});

const render = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(SessionPage, { global: { plugins: [pinia, PrimeVue] } });
};

describe('SessionPage', () => {
  let host: TestPluginHost;
  afterEach(() => {
    uninstallTestPluginHost();
    vi.useRealTimers();
  });

  const install = (responses: Record<string, unknown>) => {
    host = installTestPluginHost({ organization, responses });
    host.currentRoute.value = {
      name: 'session',
      params: { id: 'p1' },
      query: {},
    };
  };

  it("shows the round's question (sanitized), the last answers and takes an answer", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    vi.setSystemTime(new Date(serverTime));
    install({
      'GET /participations/p1': session(),
      'POST /participations/p1/responses': session({
        state: 'answered',
        myAnswer: 55,
      }),
    });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain('pages.session.progress');
    expect(wrapper.html()).toContain('<p>Four-day week?</p>');
    expect(wrapper.html()).not.toContain('script');
    expect(wrapper.text()).toContain('40%');
    expect(wrapper.text()).toContain('70%');

    await wrapper.find('#answer').setValue('55');
    await wrapper.find('#answer').trigger('blur');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(host.requests.at(-1)).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/participations/p1/responses',
        body: { value: 55 },
      }),
    );
    expect(wrapper.text()).toContain('pages.session.answered');
  });

  it('asks members in the waiting room to confirm they are here', async () => {
    install({
      'GET /participations/p1': session({
        state: 'not-ready',
        phase: {
          phase: 'not-started',
          question: 0,
          round: 0,
          startedAt: null,
          endsAt: '2099-01-01T00:00:00.000Z',
        },
        question: null,
        previous: null,
        readyAt: null,
      }),
      'POST /participations/p1/ready': session({ state: 'waiting' }),
    });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.html()).toContain('<p>Get ready</p>');
    expect(wrapper.text()).toContain('pages.session.notReady');
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toContain(
      'POST /participations/p1/ready',
    );
  });

  it("explains why someone can't take part", async () => {
    install({
      'GET /participations/p1': session({
        state: 'stopped',
        question: null,
        previous: null,
      }),
    });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain('pages.session.closed.stopped');
  });

  it('shows the results between questions', async () => {
    install({
      'GET /participations/p1': session({
        state: 'report',
        phase: {
          phase: 'report',
          question: 0,
          round: 0,
          startedAt: '2027-08-01T23:03:00.000Z',
          endsAt: '2027-08-01T23:03:30.000Z',
        },
        previous: null,
        report: {
          question: 0,
          rounds: [
            { round: 1, count: 3, average: 60, min: 40, max: 80, mine: 40 },
            { round: 2, count: 3, average: 60, min: 50, max: 70, mine: 50 },
            { round: 3, count: 3, average: 58, min: 55, max: 60, mine: 55 },
          ],
        },
      }),
    });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain('pages.session.results');
    expect(wrapper.find('svg[role="img"]').exists()).toBe(true);
    expect(wrapper.findAll('circle')).toHaveLength(3);
  });

  it('shows API errors as toasts', async () => {
    install({});
    render();
    await flushPromises();
    expect(host.toasts).toEqual([
      {
        severity: 'error',
        detail: 'No test response for GET /participations/p1',
      },
    ]);
  });
});
