import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const PACKAGE_ROOT = join(__dirname, '..', '..');

export function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as { version?: string }).version ?? '';
  } catch {
    return '';
  }
}

export function readPlyrAssets(): { js: string; css: string; sprite: string } {
  const plyrDist = dirname(createRequire(join(PACKAGE_ROOT, 'package.json')).resolve('plyr/dist/plyr.css'));
  const read = (file: string) => readFileSync(join(plyrDist, file), 'utf-8');
  return {
    js: read('plyr.min.js'),
    css: read('plyr.css'),
    sprite: read('plyr.svg').replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, '')
  };
}
