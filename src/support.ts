/// <reference types="cypress" preserve="true" />
import { PLUGIN_FLAG, RECORD_TASK } from './task';

export type StepPhase = 'VISIT' | 'FIND' | 'STEP' | 'CHECK' | 'INFO';

declare global {
  namespace Cypress {
    interface Chainable {
      step(message: string, phase?: StepPhase): Chainable<void>;
      addTestContext(context: { title: string; value: unknown }): Chainable<void>;
      businessGoal(goal: string, persona?: string): Chainable<void>;
    }
  }
}

interface RecordedStep {
  phase: StepPhase;
  message: string;
  timestamp: string;
}

interface RecordedNetworkFailure {
  status: number;
  url: string;
  timestamp: string;
}

const DIAGNOSTICS_LIMIT = 20;
const FAILED_REQUEST_STATUS = 500;

const currentTestSteps: RecordedStep[] = [];
const currentTestNetworkFailures: RecordedNetworkFailure[] = [];
const currentTestConsoleErrors: string[] = [];
let currentBusinessGoal: { goal: string; persona: string } | null = null;
let currentTestStartedAt = '';
let previousAttemptEndedAt = Date.now();
let currentAttemptLeadMs = 0;
let missingPluginLogged = false;

function pluginRegistered(): boolean {
  const cypress = Cypress as unknown as { expose?: (key: string) => unknown; env: (key: string) => unknown };
  return Boolean(cypress.expose ? cypress.expose(PLUGIN_FLAG) : cypress.env(PLUGIN_FLAG));
}

function pushDiagnostic<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > DIAGNOSTICS_LIMIT) list.shift();
}

function describeConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'message' in arg) return String((arg as Error).stack || (arg as Error).message);
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

Cypress.on('window:before:load', win => {
  const originalConsoleError = win.console.error.bind(win.console);
  win.console.error = (...args: unknown[]) => {
    pushDiagnostic(currentTestConsoleErrors, args.map(describeConsoleArg).join(' ').slice(0, 500));
    originalConsoleError(...args);
  };
  new win.PerformanceObserver(list => {
    for (const entry of list.getEntries() as Array<PerformanceResourceTiming & { responseStatus?: number }>) {
      const status = entry.responseStatus ?? 0;
      if (status >= FAILED_REQUEST_STATUS) {
        pushDiagnostic(currentTestNetworkFailures, { status, url: entry.name.slice(0, 300), timestamp: new Date().toISOString() });
      }
    }
  }).observe({ type: 'resource', buffered: true });
});

Cypress.on('uncaught:exception', err => {
  pushDiagnostic(currentTestConsoleErrors, `Uncaught ${err.name}: ${err.message}`.slice(0, 500));
});

beforeEach(() => {
  currentTestSteps.length = 0;
  currentTestNetworkFailures.length = 0;
  currentTestConsoleErrors.length = 0;
  currentBusinessGoal = null;
  currentAttemptLeadMs = Date.now() - previousAttemptEndedAt;
  currentTestStartedAt = new Date().toISOString();
});

afterEach(function () {
  const endedAt = Date.now();
  const attempt = { leadMs: currentAttemptLeadMs, durationMs: endedAt - Date.parse(currentTestStartedAt) };
  previousAttemptEndedAt = endedAt;
  const test = this.currentTest;
  if (!test) return;
  const failed = test.state === 'failed';
  if (!failed && currentTestSteps.length === 0 && !currentBusinessGoal) return;
  if (!pluginRegistered()) {
    if (!missingPluginLogged) {
      missingPluginLogged = true;
      Cypress.log({
        name: 'neo-reporter',
        message: ['Steps are not recorded: call neoReporter(on, config) in setupNodeEvents and return the config.']
      });
    }
    return;
  }
  cy.task(
    RECORD_TASK,
    {
      spec: Cypress.spec.relative,
      fullTitle: test.titlePath().join(' › '),
      startedAt: currentTestStartedAt,
      attempt,
      businessGoal: currentBusinessGoal,
      steps: [...currentTestSteps],
      code: failed ? test.body : undefined,
      firstError: failed && test.err ? test.err.stack || `${test.err.name}: ${test.err.message}` : undefined,
      network: failed ? [...currentTestNetworkFailures] : undefined,
      consoleErrors: failed ? [...currentTestConsoleErrors] : undefined
    },
    { log: false }
  );
});

Cypress.Commands.add('step', (message: string, phase: StepPhase = 'INFO'): Cypress.Chainable<void> => {
  injectRunnerStyles();
  const label = (String(phase || '').replace(/[^\w]/g, '').toUpperCase() || 'INFO') as StepPhase;
  currentTestSteps.push({ phase: label, message, timestamp: new Date().toISOString() });

  Cypress.log({
    name: label,
    displayName: label,
    message: [message],
    consoleProps: (): Record<string, unknown> => ({
      Phase: label,
      Step: message,
      Timestamp: new Date().toISOString()
    })
  });
  return cy.then(() => {}) as unknown as Cypress.Chainable<void>;
});

Cypress.Commands.add('addTestContext', (context: { title: string; value: unknown }): Cypress.Chainable<void> => {
  const value = typeof context.value === 'string' ? context.value : JSON.stringify(context.value, null, 2);
  return cy.step(`${context.title}\n${value}`, 'INFO');
});

Cypress.Commands.add('businessGoal', (goal: string, persona = 'Business User'): Cypress.Chainable<void> => {
  injectRunnerStyles();
  currentBusinessGoal = { goal, persona };
  Cypress.log({
    name: 'GOAL',
    displayName: 'GOAL',
    message: [`[${persona}] ${goal}`],
    consoleProps: (): Record<string, unknown> => ({
      Persona: persona,
      BusinessGoal: goal
    })
  });
  return cy.then(() => {}) as unknown as Cypress.Chainable<void>;
});

const RUNNER_STYLES = `
  /* Base pill badge styling for custom step commands */
  .reporter li[class*="command-name-"][class*="goal" i] .command-method,
  .reporter li[class*="command-name-"][class*="visit" i] .command-method,
  .reporter li[class*="command-name-"][class*="find" i] .command-method,
  .reporter li[class*="command-name-"][class*="step" i] .command-method,
  .reporter li[class*="command-name-"][class*="check" i] .command-method,
  .reporter li[class*="command-name-"][class*="info" i] .command-method,
  li[class*="command-name-"][class*="goal" i] .command-method,
  li[class*="command-name-"][class*="visit" i] .command-method,
  li[class*="command-name-"][class*="find" i] .command-method,
  li[class*="command-name-"][class*="step" i] .command-method,
  li[class*="command-name-"][class*="check" i] .command-method,
  li[class*="command-name-"][class*="info" i] .command-method {
    min-width: -webkit-fit-content !important;
    min-width: -moz-fit-content !important;
    min-width: fit-content !important;
    margin-right: 8px !important;
  }

  .reporter li[class*="command-name-"][class*="goal" i] .command-method span,
  .reporter li[class*="command-name-"][class*="visit" i] .command-method span,
  .reporter li[class*="command-name-"][class*="find" i] .command-method span,
  .reporter li[class*="command-name-"][class*="step" i] .command-method span,
  .reporter li[class*="command-name-"][class*="check" i] .command-method span,
  .reporter li[class*="command-name-"][class*="info" i] .command-method span,
  li[class*="command-name-"][class*="goal" i] .command-method span,
  li[class*="command-name-"][class*="visit" i] .command-method span,
  li[class*="command-name-"][class*="find" i] .command-method span,
  li[class*="command-name-"][class*="step" i] .command-method span,
  li[class*="command-name-"][class*="check" i] .command-method span,
  li[class*="command-name-"][class*="info" i] .command-method span {
    display: inline-block !important;
    font-weight: 700 !important;
    font-size: 11px !important;
    line-height: 15px !important;
    padding: 1px 7px !important;
    border-radius: 4px !important;
    letter-spacing: 0.5px !important;
    text-transform: uppercase !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3) !important;
  }

  .reporter li[class*="command-name-"][class*="goal" i] .command-wrapper,
  li[class*="command-name-"][class*="goal" i] .command-wrapper {
    background: linear-gradient(90deg, rgba(30, 64, 175, 0.40) 0%, rgba(14, 116, 222, 0.15) 100%) !important;
    border-left: 4px solid #38bdf8 !important;
    border-radius: 4px !important;
    margin: 4px 0 !important;
    padding: 3px 0 !important;
  }
  .reporter li[class*="command-name-"][class*="goal" i] .command-method span,
  li[class*="command-name-"][class*="goal" i] .command-method span {
    background: linear-gradient(135deg, #0284c7, #1d4ed8) !important;
    color: #ffffff !important;
    border: 1px solid rgba(255, 255, 255, 0.35) !important;
  }
  .reporter li[class*="command-name-"][class*="goal" i] .command-message,
  li[class*="command-name-"][class*="goal" i] .command-message {
    color: #f8fafc !important;
    font-weight: 600 !important;
    font-size: 12px !important;
  }
  .reporter li[class*="command-name-"][class*="goal" i] .command-number,
  li[class*="command-name-"][class*="goal" i] .command-number {
    color: #38bdf8 !important;
    font-weight: 700 !important;
  }

  .reporter li[class*="command-name-"][class*="visit" i] .command-wrapper,
  li[class*="command-name-"][class*="visit" i] .command-wrapper {
    background: rgba(37, 99, 235, 0.14) !important;
    border-left: 4px solid #3b82f6 !important;
    border-radius: 3px !important;
    margin: 2px 0 !important;
  }
  .reporter li[class*="command-name-"][class*="visit" i] .command-method span,
  li[class*="command-name-"][class*="visit" i] .command-method span {
    background-color: #2563eb !important;
    color: #ffffff !important;
  }
  .reporter li[class*="command-name-"][class*="visit" i] .command-message,
  li[class*="command-name-"][class*="visit" i] .command-message {
    color: #bfdbfe !important;
    font-weight: 500 !important;
  }

  .reporter li[class*="command-name-"][class*="find" i] .command-wrapper,
  li[class*="command-name-"][class*="find" i] .command-wrapper {
    background: rgba(147, 51, 234, 0.14) !important;
    border-left: 4px solid #a855f7 !important;
    border-radius: 3px !important;
    margin: 2px 0 !important;
  }
  .reporter li[class*="command-name-"][class*="find" i] .command-method span,
  li[class*="command-name-"][class*="find" i] .command-method span {
    background-color: #9333ea !important;
    color: #ffffff !important;
  }
  .reporter li[class*="command-name-"][class*="find" i] .command-message,
  li[class*="command-name-"][class*="find" i] .command-message {
    color: #e9d5ff !important;
    font-weight: 500 !important;
  }

  .reporter li[class*="command-name-"][class*="step" i] .command-wrapper,
  li[class*="command-name-"][class*="step" i] .command-wrapper {
    background: rgba(234, 88, 12, 0.14) !important;
    border-left: 4px solid #f97316 !important;
    border-radius: 3px !important;
    margin: 2px 0 !important;
  }
  .reporter li[class*="command-name-"][class*="step" i] .command-method span,
  li[class*="command-name-"][class*="step" i] .command-method span {
    background-color: #ea580c !important;
    color: #ffffff !important;
  }
  .reporter li[class*="command-name-"][class*="step" i] .command-message,
  li[class*="command-name-"][class*="step" i] .command-message {
    color: #fed7aa !important;
    font-weight: 500 !important;
  }

  .reporter li[class*="command-name-"][class*="check" i] .command-wrapper,
  li[class*="command-name-"][class*="check" i] .command-wrapper {
    background: rgba(5, 150, 105, 0.16) !important;
    border-left: 4px solid #10b981 !important;
    border-radius: 3px !important;
    margin: 2px 0 !important;
  }
  .reporter li[class*="command-name-"][class*="check" i] .command-method span,
  li[class*="command-name-"][class*="check" i] .command-method span {
    background-color: #059669 !important;
    color: #ffffff !important;
  }
  .reporter li[class*="command-name-"][class*="check" i] .command-message,
  li[class*="command-name-"][class*="check" i] .command-message {
    color: #a7f3d0 !important;
    font-weight: 500 !important;
  }

  .reporter li[class*="command-name-"][class*="info" i] .command-wrapper,
  li[class*="command-name-"][class*="info" i] .command-wrapper {
    background: rgba(8, 145, 178, 0.15) !important;
    border-left: 4px solid #06b6d4 !important;
    border-radius: 3px !important;
    margin: 2px 0 !important;
  }
  .reporter li[class*="command-name-"][class*="info" i] .command-method span,
  li[class*="command-name-"][class*="info" i] .command-method span {
    background-color: #0891b2 !important;
    color: #ffffff !important;
  }
  .reporter li[class*="command-name-"][class*="info" i] .command-message,
  li[class*="command-name-"][class*="info" i] .command-message {
    color: #cffafe !important;
    font-weight: 500 !important;
  }

  html.neo-steps-only li.command:not([class~="command-name-GOAL"]):not([class~="command-name-VISIT"]):not([class~="command-name-FIND"]):not([class~="command-name-STEP"]):not([class~="command-name-CHECK"]):not([class~="command-name-INFO"]) {
    display: none !important;
  }
`;

const STEPS_ONLY_CLASS = 'neo-steps-only';

const toggleStepsOnlyView = (): void => {
  const roots: HTMLElement[] = [];
  for (const win of [window.top, window]) {
    try {
      const root = win?.document?.documentElement as HTMLElement | undefined;
      if (root && !roots.includes(root)) roots.push(root);
    } catch (error) {
      void error;
    }
  }
  const enabled = roots.some(root => root.classList.contains(STEPS_ONLY_CLASS));
  roots.forEach(root => root.classList.toggle(STEPS_ONLY_CLASS, !enabled));
};

const installStepsOnlyToggle = (doc: Document): void => {
  const root = doc.documentElement as HTMLElement | null;
  if (!root || root.dataset.neoStepsToggle === 'true') return;
  root.dataset.neoStepsToggle = 'true';
  doc.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (String(event.key).toLowerCase() !== 's') return;
    event.preventDefault();
    toggleStepsOnlyView();
  });
};

const injectRunnerStyles = (): void => {
  if (typeof window === 'undefined') return;
  try {
    const doc = window.top?.document;
    if (!doc) return;
    let style = doc.getElementById('neo-runner-styles') as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = 'neo-runner-styles';
      (doc.head || doc.documentElement).appendChild(style);
    }
    if (style.textContent !== RUNNER_STYLES) style.textContent = RUNNER_STYLES;
    installStepsOnlyToggle(doc);
  } catch (error) {
    void error;
  }
};
