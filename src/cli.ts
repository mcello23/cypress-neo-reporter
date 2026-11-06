#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { mergeReports } from './merge';
import { DEFAULT_REPORTS_DIR, REPORT_OUTPUTS, type ReportOutput, type ReportTheme } from './types';

const USAGE = `Usage: neo-reporter merge [dir] [options]

Merges the JSON reports found under dir (default: ${DEFAULT_REPORTS_DIR}) into one report.

Options:
  --out <dir>            Where to write the merged report (default: dir)
  --name <name>          Report name, also used for file names
  --project <name>       Project name shown in the header
  --team <name>          Team name shown in the header
  --hide-team            Leave the team name out
  --time-zone <zone>     IANA time zone for every time in the report
  --theme <theme>        auto, light or dark
  --outputs <list>       Comma-separated: html,markdown,junit,json (default: html,markdown)
  --report-url <url>     Link the Markdown summary points to
  --no-history           Skip Azure DevOps run history
  -h, --help             Show this help`;

const THEMES: ReportTheme[] = ['auto', 'light', 'dark'];

function parseOutputs(value?: string): ReportOutput[] | undefined {
  if (!value) return undefined;
  const outputs = value.split(',').map(output => output.trim()) as ReportOutput[];
  const unknown = outputs.filter(output => !REPORT_OUTPUTS.includes(output));
  if (unknown.length) throw new Error(`Unknown output: ${unknown.join(', ')}`);
  return outputs;
}

function parseTheme(value?: string): ReportTheme | undefined {
  if (!value) return undefined;
  if (!THEMES.includes(value as ReportTheme)) throw new Error(`Unknown theme: ${value}`);
  return value as ReportTheme;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      name: { type: 'string' },
      project: { type: 'string' },
      team: { type: 'string' },
      'hide-team': { type: 'boolean' },
      'time-zone': { type: 'string' },
      theme: { type: 'string' },
      outputs: { type: 'string' },
      'report-url': { type: 'string' },
      'no-history': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  const [command, dir = DEFAULT_REPORTS_DIR] = positionals;
  if (values.help || command !== 'merge') {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const result = await mergeReports({
    reportRoot: resolve(dir),
    outputDir: values.out,
    reportName: values.name,
    projectName: values.project,
    teamName: values.team,
    showTeamName: values['hide-team'] ? false : undefined,
    timeZone: values['time-zone'],
    theme: parseTheme(values.theme),
    outputs: parseOutputs(values.outputs),
    reportUrl: values['report-url'],
    history: values['no-history'] ? false : undefined
  });
  return result ? 0 : 1;
}

main().then(
  code => {
    process.exitCode = code;
  },
  error => {
    console.error(`[neo-reporter] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
);
