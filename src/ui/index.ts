import en from './i18n/en';
import { assemblyUi } from './plugin';

/**
 * The plugin's SPA UI, bundled by the DemLeagueOS SPA (`frontend/src/plugins.config.ts`). Its pages live under
 * `/apps/unifyamerica/super-assembly` and work in the user's current organization: members take part from
 * the home page and invitation links, org admins manage assemblies under `manage`.
 */
export default assemblyUi.define({
  routes: [
    {
      path: '',
      name: 'home',
      component: () => import('./pages/HomePage.vue'),
      ability: { action: 'read', subject: 'Participation' },
      titleKey: 'pages.home.title',
    },
    {
      path: 'join/:code',
      name: 'join',
      component: () => import('./pages/JoinPage.vue'),
      ability: { action: 'create', subject: 'Participation' },
      titleKey: 'pages.join.title',
    },
    {
      path: 'sessions/:id',
      name: 'session',
      component: () => import('./pages/SessionPage.vue'),
      ability: { action: 'read', subject: 'Participation' },
      titleKey: 'pages.session.title',
    },
    {
      path: 'manage',
      name: 'assemblies',
      component: () => import('./pages/AssembliesPage.vue'),
      ability: { action: 'read', subject: 'Assembly' },
      titleKey: 'pages.assemblies.title',
    },
    {
      path: 'manage/new',
      name: 'assembly-new',
      component: () => import('./pages/AssemblyFormPage.vue'),
      ability: { action: 'create', subject: 'Assembly' },
      titleKey: 'pages.form.newTitle',
    },
    {
      path: 'manage/:id',
      name: 'assembly',
      component: () => import('./pages/AssemblyPage.vue'),
      ability: { action: 'read', subject: 'Assembly' },
      titleKey: 'pages.assembly.title',
    },
    {
      path: 'manage/:id/edit',
      name: 'assembly-edit',
      component: () => import('./pages/AssemblyFormPage.vue'),
      ability: { action: 'update', subject: 'Assembly' },
      titleKey: 'pages.form.editTitle',
    },
  ],
  // One group: members see "My assemblies", org admins also "Manage assemblies"
  mainMenu: [
    {
      labelKey: 'nav.superAssembly',
      icon: 'pi pi-users',
      children: [
        { labelKey: 'nav.myAssemblies', icon: 'pi pi-comments', to: 'home' },
        { labelKey: 'nav.manage', icon: 'pi pi-sliders-h', to: 'assemblies' },
      ],
    },
  ],
  i18n: { en },
});
