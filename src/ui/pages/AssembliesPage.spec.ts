import {
  installTestPluginHost,
  uninstallTestPluginHost,
  type TestPluginHost,
} from '@unifyamerica/demleague-plugin-sdk/vue/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Assembly } from '../types';
import AssembliesPage from './AssembliesPage.vue';

const organization = {
  id: 'o1',
  name: 'Akron',
  slug: 'akron',
  description: null,
};

const assembly = (overrides: Partial<Assembly> = {}): Assembly => ({
  id: 'a1',
  title: 'Akron Assembly - Proposal 24',
  startsAt: '2027-08-01T23:00:00.000Z',
  endsAt: '2027-08-01T23:06:30.000Z',
  timeZone: 'America/New_York',
  roundDurationSec: 60,
  reportingDurationSec: 30,
  roundsPerQuestion: 3,
  neighborCount: 4,
  readyWindowSec: 60,
  questions: [{ prompt: '<p>?</p>', min: 0, max: 100 }],
  landingHtml: '',
  readyHtml: '',
  finishedHtml: '',
  status: 'scheduled',
  state: 'scheduled',
  launchedAt: null,
  results: [],
  createdAt: '2027-07-01T00:00:00.000Z',
  updatedAt: '2027-07-01T00:00:00.000Z',
  ...overrides,
});

const render = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(AssembliesPage, { global: { plugins: [pinia, PrimeVue] } });
};

describe('AssembliesPage', () => {
  let host: TestPluginHost;
  // DataTable's paginator watches the viewport; jsdom has no matchMedia
  beforeAll(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });
  afterEach(() => uninstallTestPluginHost());

  it("lists the organization's assemblies in their time zone, a page at a time", async () => {
    host = installTestPluginHost({
      organization,
      responses: {
        'GET /assemblies': {
          items: [
            assembly(),
            assembly({
              id: 'a2',
              title: 'Old one',
              state: 'finished',
              status: 'scheduled',
            }),
          ],
          total: 2,
          limit: 25,
          skip: 0,
        },
      },
    });
    const wrapper = render();
    await flushPromises();

    expect(host.requests[0]).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/assemblies',
        params: { page: 1, limit: 25 },
      }),
    );
    expect(wrapper.text()).toContain('Akron Assembly - Proposal 24');
    expect(wrapper.text()).toContain('Aug 1, 2027, 7:00 PM EDT');
    // Only drafts and scheduled assemblies can be edited
    expect(wrapper.findAll('[aria-label="buttons.edit"]')).toHaveLength(1);
  });

  it('opens a clone of an assembly in the form', async () => {
    host = installTestPluginHost({
      organization,
      responses: {
        'GET /assemblies': {
          items: [assembly()],
          total: 1,
          limit: 25,
          skip: 0,
        },
      },
    });
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[aria-label="buttons.clone"]').trigger('click');
    expect(host.navigations).toEqual([
      { name: 'assembly-new', query: { clone: 'a1' } },
    ]);
  });

  it('hides creating for those who may not', async () => {
    host = installTestPluginHost({
      organization,
      abilities: ['read Assembly'],
      responses: {
        'GET /assemblies': { items: [], total: 0, limit: 25, skip: 0 },
      },
    });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).not.toContain('pages.assemblies.new');
    expect(wrapper.text()).toContain('pages.assemblies.empty');
  });
});
