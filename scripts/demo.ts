import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateHtmlReport, generateJUnitXml, generateMarkdownSummary, reportFileBase } from '../src';
import { sampleSummary } from '../test/fixtures/summary';

const outputDir = resolve(__dirname, '..', 'demo');
const summary = sampleSummary();
const base = join(outputDir, reportFileBase(summary.suiteLabel ?? summary.projectName));

mkdirSync(outputDir, { recursive: true });
writeFileSync(`${base}.html`, generateHtmlReport(summary));
writeFileSync(`${base}.junit.xml`, generateJUnitXml(summary));
writeFileSync(`${base}.summary.md`, generateMarkdownSummary(summary, 'https://example.com/E2E-regression.html'));
console.log(`Demo report: ${base}.html`);
