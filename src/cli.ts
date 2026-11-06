#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { packageVersion } from './html/assets';
import { mergeReports } from './merge';
import { DEFAULT_REPORTS_DIR, REPORT_OUTPUTS, type ReportOutput, type ReportTheme } from './types';

const USAGE = `Usage: neo-reporter <command> [options]

Commands:
  merge [dir]            Merge the JSON reports found under dir into one report

Options:
  -h, --help             Show this help
  -v, --version          Show the version

Run neo-reporter <command> --help for the options of a command.`;

const MERGE_USAGE = `Usage: neo-reporter merge [dir] [options]

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
  --history-file <path>  Read run history from this JSONL file and add the merged run to it
  --baseline <file>      Compare with one earlier report JSON instead of run history
  --no-history           Skip run history
  -h, --help             Show this help`;

const THEMES: ReportTheme[] = ['auto', 'light', 'dark'];

class UsageError extends Error {}

function isUsageError(error: unknown): error is Error {
  return error instanceof UsageError || (error as { code?: string } | undefined)?.code?.startsWith('ERR_PARSE_ARGS_') === true;
}

function usageError(message: string, usage: string): number {
  console.error(`[neo-reporter] ${message}\n\n${usage}`);
  return 2;
}

function parseOutputs(value?: string): ReportOutput[] | undefined {
  if (!value) return undefined;
  const outputs = value.split(',').map(output => output.trim()) as ReportOutput[];
  const unknown = outputs.filter(output => !REPORT_OUTPUTS.includes(output));
  if (unknown.length) throw new UsageError(`Unknown output: ${unknown.join(', ')}`);
  return outputs;
}

function parseTheme(value?: string): ReportTheme | undefined {
  if (!value) return undefined;
  if (!THEMES.includes(value as ReportTheme)) throw new UsageError(`Unknown theme: ${value}`);
  return value as ReportTheme;
}

async function merge(args: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
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
      'history-file': { type: 'string' },
      baseline: { type: 'string' },
      'no-history': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help) {
    console.log(MERGE_USAGE);
    return 0;
  }
  if (positionals.length > 1) throw new UsageError(`Unexpected argument '${positionals[1]}'`);
  const [dir = DEFAULT_REPORTS_DIR] = positionals;
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
    history: values['no-history'] ? false : values['history-file'] ? { provider: 'file', path: values['history-file'] } : undefined,
    baseline: values.baseline
  });
  return result ? 0 : 1;
}

const COMMANDS: Record<string, { usage: string; run: (args: string[]) => Promise<number> }> = {
  merge: { usage: MERGE_USAGE, run: merge }
};

async function main([command, ...args]: string[]): Promise<number> {
  if (command === '-v' || command === '--version') {
    console.log(packageVersion());
    return 0;
  }
  if (command === '-h' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  if (!command) return usageError('Missing command', USAGE);
  if (!Object.hasOwn(COMMANDS, command)) return usageError(`Unknown command '${command}'`, USAGE);
  const { usage, run } = COMMANDS[command];
  try {
    return await run(args);
  } catch (error) {
    if (isUsageError(error)) return usageError(error.message, usage);
    throw error;
  }
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  error => {
    console.error(`[neo-reporter] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
);
