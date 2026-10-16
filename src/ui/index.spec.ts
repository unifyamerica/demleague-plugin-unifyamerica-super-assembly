import { describe, expect, it } from 'vitest';
import ui from './index';

describe('UI definition', () => {
  it('is valid for the manifest (define() throws otherwise)', () => {
    expect(ui.namespace).toBe('unifyamerica.super-assembly');
    expect(ui.routes.map((route) => route.name)).toEqual([
      'home',
      'join',
      'session',
      'assemblies',
      'assembly-new',
      'assembly',
      'assembly-edit',
    ]);
  });

  it('keeps managing assemblies to the Assembly subject (org admins)', () => {
    const subjects = Object.fromEntries(
      ui.routes.map((route) => [route.name, route.ability?.subject]),
    );
    expect(subjects).toEqual({
      home: 'Participation',
      join: 'Participation',
      session: 'Participation',
      assemblies: 'Assembly',
      'assembly-new': 'Assembly',
      assembly: 'Assembly',
      'assembly-edit': 'Assembly',
    });
  });
});
