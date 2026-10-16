import {
  installTestPluginHost,
  uninstallTestPluginHost,
  type TestPluginHost,
} from '@unifyamerica/demleague-plugin-sdk/vue/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { afterEach, describe, expect, it } from 'vitest';
import type { InvitationPreview } from '../types';
import JoinPage from './JoinPage.vue';

const organization = {
  id: 'o1',
  name: 'Akron',
  slug: 'akron',
  description: null,
};
const code = 'ABCDEFGHIJKLMNOPQRST';

const preview = (
  overrides: Partial<InvitationPreview> = {},
): InvitationPreview => ({
  assembly: {
    id: 'a1',
    title: 'Akron Assembly',
    startsAt: '2027-08-01T23:00:00.000Z',
    timeZone: 'America/New_York',
    questionCount: 2,
    roundsPerQuestion: 3,
    roundDurationSec: 60,
    readyWindowSec: 60,
    state: 'scheduled',
  },
  landingHtml: '<h1>Welcome</h1><img src="x" onerror="alert(1)">',
  participationId: null,
  used: false,
  ...overrides,
});

const render = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(JoinPage, { global: { plugins: [pinia, PrimeVue] } });
};

describe('JoinPage', () => {
  let host: TestPluginHost;
  afterEach(() => uninstallTestPluginHost());

  const install = (responses: Record<string, unknown>) => {
    host = installTestPluginHost({ organization, responses });
    host.currentRoute.value = { name: 'join', params: { code }, query: {} };
  };

  it('shows the welcome (sanitized) and joins', async () => {
    install({
      [`GET /join/${code}`]: preview(),
      'POST /participations': { id: 'p1' },
    });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.html()).toContain('<h1>Welcome</h1>');
    expect(wrapper.html()).not.toContain('onerror');
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(host.requests.at(-1)).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/participations',
        body: { code },
      }),
    );
    expect(host.navigations).toEqual([
      { name: 'session', params: { id: 'p1' } },
    ]);
  });

  it('continues an existing participation', async () => {
    install({ [`GET /join/${code}`]: preview({ participationId: 'p9' }) });
    const wrapper = render();
    await flushPromises();
    await wrapper.find('button').trigger('click');
    expect(host.navigations).toEqual([
      { name: 'session', params: { id: 'p9' } },
    ]);
  });

  it('says when a link is not valid', async () => {
    install({});
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain('pages.join.invalid');
  });
});
