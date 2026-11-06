import type { ReporterOptions, ReportSummary, TestData } from './types';

const REDACTED = '[redacted]';

const DEFAULT_PATTERNS = [
  /(?<=\bset-cookie["']?\s*:\s*\[\s*(?:"[^"]*",\s*)*")[^"\r\n]+/gi,
  /(?<=\b(?:authorization|cookie)["']?\s*:[\s[]*["']?)[^"'\s[][^"'\r\n]*/gi,
  /(?<=\bBearer\s+)[\w.~+/-]+=*/g,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /(?<=:\/\/)[^\s/?#@]+(?=@)/g,
  /(?<="[^"\r\n]*(?:pass(?:word)?|secret|token|api[-_]?key|client_secret)[^"\r\n]*"\s*:\s*")(?:[^"\\\r\n]|\\.)+/gi,
  /(?<=[?&#](?:token|access_token|sig|code|key|password)=)[^&#\s"'<>]+/gi
];

export function applyRedaction(
  summary: ReportSummary,
  { redact = {}, includeTestCode = true }: Pick<ReporterOptions, 'redact' | 'includeTestCode'> = {}
): ReportSummary {
  if (!redact && includeTestCode) return summary;
  const patterns = redact
    ? [...DEFAULT_PATTERNS, ...(redact.patterns ?? []).map(pattern => (pattern.global ? pattern : new RegExp(pattern, `${pattern.flags}g`)))]
    : [];
  const clean = (text: string): string => {
    const masked = patterns.reduce((result, pattern) => result.replace(pattern, REDACTED), text);
    return redact && redact.replace ? redact.replace(masked) : masked;
  };
  const cleanUrl = (url: string) => clean(redact ? url.split(/[?#]/)[0] : url);
  const cleanTest = (test: TestData): TestData => ({
    ...test,
    displayError: test.displayError && clean(test.displayError),
    attempts: test.attempts?.map(attempt =>
      attempt.error
        ? {
            ...attempt,
            error: {
              ...attempt.error,
              message: attempt.error.message && clean(attempt.error.message),
              stack: attempt.error.stack && clean(attempt.error.stack)
            }
          }
        : attempt
    ),
    businessGoal: test.businessGoal && {
      goal: clean(test.businessGoal.goal),
      persona: test.businessGoal.persona && clean(test.businessGoal.persona)
    },
    steps: test.steps?.map(step => ({ ...step, message: clean(step.message) })),
    code: includeTestCode && test.code ? clean(test.code) : undefined,
    network: test.network?.map(request => ({ ...request, url: cleanUrl(request.url) })),
    consoleErrors: test.consoleErrors?.map(clean)
  });
  return {
    ...summary,
    environment: summary.environment && cleanUrl(summary.environment),
    specs: summary.specs.map(spec => ({ ...spec, tests: spec.tests.map(cleanTest) }))
  };
}
