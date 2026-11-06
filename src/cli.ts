#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertTimeZone } from './format';
import { checkGate, FAIL_ON, QUARANTINE_FILE_NAME, readQuarantine, type FailOn, type GateOptions } from './gate';
import { packageVersion } from './html/assets';
import { mergeReports } from './merge';
import { notify, type Webhooks } from './notify';
import { DEFAULT_REPORTS_DIR, REPORT_OUTPUTS, type ReportOutput, type ReportSummary, type ReportTheme } from './types';

const USAGE = `Usage: neo-reporter <command> [options]

Commands:
  merge [dir]            Merge the JSON reports found under dir into one report
  gate <report.json>     Exit 1 when a report fails the quality gate
  notify <report.json>   Post a short run summary to Slack or Microsoft Teams

Options:
  -h, --help             Show this help
  -v, --version          Show the version

Run neo-reporter <command> --help for the options of a command.`;

const GATE_HELP = `  --fail-on <when>       new: exit 1 on new failures (needs run history); failed: on any failure
  --min-pass-rate <n>    Exit 1 when the pass rate is below n percent
  --quarantine <file>    Tests that do not count (default: ${QUARANTINE_FILE_NAME} when present)`;

const NOTIFY_HELP = `  --slack <url>          Slack incoming webhook (default: $NEO_SLACK_WEBHOOK)
  --teams <url>          Microsoft Teams Workflows webhook (default: $NEO_TEAMS_WEBHOOK)`;

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
  --report-url <url>     Link the Markdown and chat summaries point to
  --history-file <path>  Read run history from this JSONL file and add the merged run to it
  --baseline <file>      Compare with one earlier report JSON instead of run history
  --no-history           Skip run history
${GATE_HELP}
${NOTIFY_HELP}
  -h, --help             Show this help

Exits 1 when nothing was merged or the merged run fails the gate. A failed post only warns.`;

const GATE_USAGE = `Usage: neo-reporter gate <report.json> [options]

Checks a JSON report against the quality gate. Pass --fail-on, --min-pass-rate or both.

Options:
${GATE_HELP}
  -h, --help             Show this help

Exit codes: 0 the gate passed, 1 it failed or the report cannot be checked, 2 usage error.`;

const NOTIFY_USAGE = `Usage: neo-reporter notify <report.json> [options]

Posts a short summary of a JSON report to Slack and/or Microsoft Teams.

Options:
${NOTIFY_HELP}
  --report-url <url>     Link the summary points to
  -h, --help             Show this help

Exit codes: 0 posted, 1 a post failed or the report cannot be read, 2 usage error.`;

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

function parseTimeZone(value?: string): string | undefined {
  try {
    assertTimeZone(value);
  } catch {
    throw new UsageError(`Unknown time zone: ${value}`);
  }
  return value;
}

const GATE_OPTIONS = {
  'fail-on': { type: 'string' },
  'min-pass-rate': { type: 'string' },
  quarantine: { type: 'string' }
} as const;

const NOTIFY_OPTIONS = {
  slack: { type: 'string' },
  teams: { type: 'string' }
} as const;

function parseGate(values: { 'fail-on'?: string; 'min-pass-rate'?: string; quarantine?: string }): GateOptions | null {
  const failOn = values['fail-on'] as FailOn | undefined;
  if (failOn !== undefined && !FAIL_ON.includes(failOn)) throw new UsageError(`Unknown --fail-on value: ${failOn}. Use ${FAIL_ON.join(' or ')}.`);
  const rate = values['min-pass-rate'];
  const minPassRate = rate === undefined ? undefined : rate.trim() ? Number(rate) : NaN;
  if (minPassRate !== undefined && !(minPassRate >= 0 && minPassRate <= 100)) {
    throw new UsageError(`--min-pass-rate must be a number from 0 to 100, got ${values['min-pass-rate']}`);
  }
  if (failOn === undefined && minPassRate === undefined) {
    if (values.quarantine !== undefined) throw new UsageError('--quarantine needs --fail-on or --min-pass-rate');
    return null;
  }
  return { failOn, minPassRate, quarantine: readQuarantine(values.quarantine) };
}

function parseWebhooks(values: { slack?: string; teams?: string }): Webhooks {
  return { slack: values.slack ?? process.env.NEO_SLACK_WEBHOOK, teams: values.teams ?? process.env.NEO_TEAMS_WEBHOOK };
}

function readReport(positionals: string[]): ReportSummary {
  if (positionals.length !== 1) throw new UsageError('Pass exactly one report JSON file');
  const file = resolve(positionals[0]);
  const summary = JSON.parse(readFileSync(file, 'utf-8')) as ReportSummary;
  if (!Array.isArray(summary?.specs)) throw new Error(`${file} is not a neo-reporter JSON report`);
  return summary;
}

async function merge(args: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ...GATE_OPTIONS,
      ...NOTIFY_OPTIONS,
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
  const gateOptions = parseGate(values);
  const result = await mergeReports({
    reportRoot: resolve(dir),
    outputDir: values.out,
    reportName: values.name,
    projectName: values.project,
    teamName: values.team,
    showTeamName: values['hide-team'] ? false : undefined,
    timeZone: parseTimeZone(values['time-zone']),
    theme: parseTheme(values.theme),
    outputs: parseOutputs(values.outputs),
    reportUrl: values['report-url'],
    history: values['no-history'] ? false : values['history-file'] ? { provider: 'file', path: values['history-file'] } : undefined,
    baseline: values.baseline
  });
  if (!result) return 1;
  await notify(result.summary, parseWebhooks(values), values['report-url']);
  return !gateOptions || checkGate(result.summary, gateOptions) ? 0 : 1;
}

async function gate(args: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { ...GATE_OPTIONS, help: { type: 'boolean', short: 'h' } }
  });
  if (values.help) {
    console.log(GATE_USAGE);
    return 0;
  }
  const options = parseGate(values);
  if (!options) throw new UsageError('Pass --fail-on, --min-pass-rate or both');
  return checkGate(readReport(positionals), options) ? 0 : 1;
}

async function notifyRun(args: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { ...NOTIFY_OPTIONS, 'report-url': { type: 'string' }, help: { type: 'boolean', short: 'h' } }
  });
  if (values.help) {
    console.log(NOTIFY_USAGE);
    return 0;
  }
  const webhooks = parseWebhooks(values);
  if (!webhooks.slack && !webhooks.teams) throw new UsageError('Pass --slack or --teams, or set NEO_SLACK_WEBHOOK or NEO_TEAMS_WEBHOOK');
  return (await notify(readReport(positionals), webhooks, values['report-url'])) ? 0 : 1;
}

const COMMANDS: Record<string, { usage: string; run: (args: string[]) => Promise<number> }> = {
  merge: { usage: MERGE_USAGE, run: merge },
  gate: { usage: GATE_USAGE, run: gate },
  notify: { usage: NOTIFY_USAGE, run: notifyRun }
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
