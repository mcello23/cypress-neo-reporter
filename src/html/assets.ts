import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_ROOT = join(__dirname, '..', '..');
const PLYR_DIR = join(PACKAGE_ROOT, 'vendor', 'plyr-3.8.5');

export function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as { version?: string }).version ?? '';
  } catch {
    return '';
  }
}

export function readPlyrAssets(): { js: string; css: string; sprite: string } {
  const read = (file: string) => readFileSync(join(PLYR_DIR, file), 'utf-8');
  return {
    js: read('plyr.min.js'),
    css: read('plyr.css'),
    sprite: read('plyr.svg').replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, '')
  };
}
