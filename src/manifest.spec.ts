import { validateManifest } from '@unifyamerica/demleague-plugin-sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SUPER_ASSEMBLY_MANIFEST } from './manifest';

describe('SUPER_ASSEMBLY_MANIFEST', () => {
  it('should be valid', () => {
    expect(validateManifest(SUPER_ASSEMBLY_MANIFEST)).toEqual([]);
  });

  it('should match the package version', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../package.json'), 'utf8'),
    ) as { version: string };
    expect(SUPER_ASSEMBLY_MANIFEST.version).toBe(pkg.version);
  });
});
