import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import type { ToolOwner } from '../contracts/tool-effects.ts';
import {
  BROWSER_RUN_DEADLINE_MS, BROWSER_STEP_LIMIT, BROWSER_STEP_TIMEOUT_MS,
  browserChecklistSchema, type BrowserChecklistV1, type BrowserStep,
  type VisualObservationV1,
} from '../contracts/verification.ts';
import { hostFlagEnabled } from './host-flags.ts';
import type { Store } from '../storage/store.ts';

/** M06 browser QA: a fresh browser profile under the verification owner runs a
 * strict step union — NAVIGATE, CLICK, TYPE, ASSERT_TEXT, ASSERT_VISIBLE,
 * ASSERT_URL, SCREENSHOT, COLLECT_ERRORS. No arbitrary evaluate, no inherited
 * logged-in profile. Origins are enforced for navigation, popups and traffic
 * from the approved execution profile, not only the typed NAVIGATE input. */

const now = () => new Date().toISOString();
const MAX_COLLECTED = 100;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export interface BrowserPage {
  url(): string;
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  text(selector: string): Promise<string | null>;
  visible(selector: string): Promise<boolean>;
  screenshot(): Promise<Buffer>;
}

export interface BrowserSession {
  page: BrowserPage;
  /** Console errors, page errors and request failures collected so far. */
  collectedFailures(): { console: string[]; network: string[] };
  /** Origins observed for navigations, popups and resource traffic. */
  observedOrigins(): string[];
  close(): Promise<void>;
}

/** The only browser entry point: a fresh profile directory the driver owns.
 * Drivers must not reuse an existing user profile or its credentials.
 * `allowOrigin` is the request-time policy hook: the driver MUST consult it for
 * every navigation, popup and subresource request and abort the request before
 * it is sent when the hook returns false. Post-hoc observation in
 * `observedOrigins` is the audit layer, not the enforcement layer — an origin
 * that appears there means traffic already reached it, which fails the run. */
export interface BrowserDriver {
  launch(options: { profileDir: string; viewport: { width: number; height: number }; approvedOrigins: readonly string[]; allowOrigin: (origin: string) => boolean }): Promise<BrowserSession>;
}

export interface BrowserRunInput {
  owner: ToolOwner;
  executionId?: string;
  checklist: BrowserChecklistV1;
  /** Immutable artifact directory for screenshots and bounded logs. */
  artifactDir: string;
  driver: BrowserDriver;
  digests: { codeDigest: string; dependencyDigest: string; recipeDigest: string; environmentId: string };
  nowMs?: () => number;
}

export interface BrowserRunResult {
  observations: VisualObservationV1[];
  collected: { console: string[]; network: string[] };
  deniedOrigins: string[];
  outcome: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED';
}

function sameOrigin(approved: readonly string[], value: string): boolean {
  let origin: string;
  try { origin = new URL(value).origin; } catch { return false; }
  return approved.some(item => {
    try { return new URL(item).origin === origin; } catch { return false; }
  });
}

function deadline(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new HarnessError('BROWSER_STEP_TIMEOUT', 'A browser step exceeded its deadline')), timeoutMs));
}

export async function runBrowserChecklist(store: Store, input: BrowserRunInput, env: Readonly<Record<string, string | undefined>> = process.env): Promise<BrowserRunResult> {
  if (!hostFlagEnabled('verification.workflowV1', env))
    throw new HarnessError('CAPABILITY_DENIED', 'The verification workflow capability is disabled on this host.', { flag: 'verification.workflowV1' });
  const checklist = browserChecklistSchema.parse(input.checklist);
  if (checklist.steps.length > BROWSER_STEP_LIMIT) throw new HarnessError('BROWSER_STEP_LIMIT', 'Browser checklists are bounded to 24 steps');
  const asserted = new Set(checklist.steps.filter(step => 'checklistItemId' in step).map(step => (step as { checklistItemId: string }).checklistItemId));
  for (const item of asserted) if (!checklist.items.includes(item)) throw new HarnessError('INVALID_CHECKLIST', 'A step references an undeclared checklist item');

  const executionId = input.executionId ?? `browser-${randomUUID()}`;
  const actionTraceId = `trace-${randomUUID()}`;
  const clock = input.nowMs ?? Date.now;
  const deadlineAt = clock() + BROWSER_RUN_DEADLINE_MS;
  await mkdir(input.artifactDir, { recursive: true });

  const observations: VisualObservationV1[] = [];
  const deniedOrigins: string[] = [];
  let outcome: BrowserRunResult['outcome'] = 'PASS';
  const deniedAtBoundary: string[] = [];
  const session = await input.driver.launch({
    profileDir: join(input.artifactDir, 'profile'), viewport: checklist.viewport, approvedOrigins: checklist.approvedOrigins,
    allowOrigin: origin => {
      const approved = sameOrigin(checklist.approvedOrigins, origin);
      if (!approved && !deniedAtBoundary.includes(origin)) deniedAtBoundary.push(origin);
      return approved;
    },
  });

  const screenshots = new Map<string, string>();
  const writeShot = async (itemId: string, data: Buffer): Promise<string> => {
    if (data.length > MAX_ARTIFACT_BYTES) throw new HarnessError('RESOURCE_LIMIT', 'Screenshot exceeds the artifact bound');
    const name = `${executionId}-${itemId}-${screenshots.size}.png`;
    await writeFile(join(input.artifactDir, name), data);
    const digest = createHash('sha256').update(data).digest('hex');
    screenshots.set(itemId, name);
    return digest;
  };

  const record = (itemId: string, assertion: string, observed: string, outcomeValue: VisualObservationV1['outcome'], screenshotDigest: string | null, artifactRefs: string[] = []) => {
    const observation: VisualObservationV1 = {
      version: 1, checkId: `vobs-${randomUUID()}`, executionId, owner: input.owner,
      ...input.digests, argv: ['browser-checklist', checklist.checklistId], cwdIdentity: 'browser-profile',
      phase: 'BROWSER', startedAt: now(), endedAt: now(), exitCode: outcomeValue === 'PASS' ? 0 : null,
      outcome: outcomeValue, artifactRefs, observationKind: 'visual',
      checklistItemId: itemId, actionTraceId, origin: session.page.url(), viewport: checklist.viewport,
      assertion, observed, screenshotDigest,
    };
    observations.push(observation);
    store.internal('visualObservation.recorded', input.owner.threadId, () => {
      store.put('visualObservation', observation.checkId, input.owner.threadId, observation);
      return observation;
    });
  };

  // Items verified by an executed behavioral assertion, not by capture alone.
  const assertedItems = new Set<string>();
  const runStep = async (step: BrowserStep): Promise<'ok' | 'stop'> => {
    if (clock() > deadlineAt) { outcome = 'FAIL'; record('__deadline__', 'Overall browser deadline', `Exceeded ${BROWSER_RUN_DEADLINE_MS}ms`, 'FAIL', null); return 'stop'; }
    if ('checklistItemId' in step && step.kind.startsWith('ASSERT_')) assertedItems.add(step.checklistItemId);
    switch (step.kind) {
      case 'NAVIGATE': {
        if (!sameOrigin(checklist.approvedOrigins, step.url)) {
          deniedOrigins.push(step.url);
          record('__origin__', `Navigation origin must be approved: ${step.url}`, `Denied origin ${step.url}`, 'FAIL', null);
          outcome = 'FAIL';
          return 'stop';
        }
        await Promise.race([session.page.goto(step.url), deadline(BROWSER_STEP_TIMEOUT_MS)]);
        return 'ok';
      }
      case 'CLICK': await Promise.race([session.page.click(step.selector), deadline(BROWSER_STEP_TIMEOUT_MS)]); return 'ok';
      case 'TYPE': await Promise.race([session.page.type(step.selector, step.text), deadline(BROWSER_STEP_TIMEOUT_MS)]); return 'ok';
      case 'ASSERT_TEXT': {
        const text = await Promise.race([session.page.text(step.selector), deadline(BROWSER_STEP_TIMEOUT_MS)]);
        const pass = text !== null && text.includes(step.text);
        record(step.checklistItemId, `Element ${step.selector} contains "${step.text.slice(0, 200)}"`, text === null ? 'selector not found' : `observed "${text.slice(0, 200)}"`, pass ? 'PASS' : 'FAIL', null);
        if (!pass) { outcome = 'FAIL'; return 'stop'; }
        return 'ok';
      }
      case 'ASSERT_VISIBLE': {
        const visible = await Promise.race([session.page.visible(step.selector), deadline(BROWSER_STEP_TIMEOUT_MS)]);
        record(step.checklistItemId, `Element ${step.selector} is visible`, visible ? 'visible' : 'not visible', visible ? 'PASS' : 'FAIL', null);
        if (!visible) { outcome = 'FAIL'; return 'stop'; }
        return 'ok';
      }
      case 'ASSERT_URL': {
        const current = session.page.url();
        const pass = current === step.url || current.startsWith(step.url);
        record(step.checklistItemId, `URL is ${step.url}`, `observed ${current}`, pass ? 'PASS' : 'FAIL', null);
        if (!pass) { outcome = 'FAIL'; return 'stop'; }
        return 'ok';
      }
      case 'SCREENSHOT': {
        const data = await Promise.race([session.page.screenshot(), deadline(BROWSER_STEP_TIMEOUT_MS)]);
        const digest = await writeShot(step.checklistItemId, data);
        record(step.checklistItemId, 'Screenshot captured at tested viewport', `sha256:${digest}`, 'PASS', digest, [join(input.artifactDir, screenshots.get(step.checklistItemId)!)]);
        return 'ok';
      }
      case 'COLLECT_ERRORS': {
        const { console: consoleErrors, network } = session.collectedFailures();
        const failures = [...consoleErrors.slice(0, MAX_COLLECTED), ...network.slice(0, MAX_COLLECTED)];
        if (failures.length) {
          record('__errors__', 'No console or network failures collected', failures.slice(0, 10).join(' | '), 'FAIL', null);
          outcome = 'FAIL';
          return 'stop';
        }
        return 'ok';
      }
    }
  };

  try {
    for (const step of checklist.steps) {
      try {
        if ((await runStep(step)) === 'stop') break;
      } catch (error) {
        if (error instanceof HarnessError && error.code === 'CANCELLED_RUN') { outcome = 'CANCELLED'; break; }
        if (error instanceof HarnessError && error.code === 'BROWSER_STEP_TIMEOUT') {
          record(`__step__`, `Step ${step.kind} deadline`, 'Exceeded the 15s step deadline', 'FAIL', null);
          outcome = 'FAIL';
          break;
        }
        record('__driver__', `Step ${step.kind} executed`, error instanceof Error ? error.message.slice(0, 500) : 'driver error', 'BLOCKED', null);
        outcome = 'BLOCKED';
        break;
      }
    }
    // Origin policy also covers popups and resource traffic the steps triggered.
    for (const origin of session.observedOrigins()) {
      if (!sameOrigin(checklist.approvedOrigins, origin)) {
        deniedOrigins.push(origin);
        record('__traffic__', `Traffic origin must be approved`, `Denied traffic origin ${origin}`, 'FAIL', null);
        outcome = 'FAIL';
      }
    }
    // Request-time denial is evidence the origin policy held; traffic that
    // actually reached an unapproved origin still fails the run above.
    if (deniedAtBoundary.length) {
      deniedOrigins.push(...deniedAtBoundary);
      record('__boundary__', 'Unapproved traffic was denied at the request boundary', deniedAtBoundary.join(', '), 'PASS', null);
    }
    // A required screenshot that never ran leaves its item BLOCKED, never PASS;
    // a screenshot alone cannot verify an item — each needs an executed
    // behavioral assertion, plus its required screenshot when declared.
    for (const itemId of checklist.items) {
      if (outcome === 'CANCELLED') continue;
      const itemObs = observations.filter(obs => obs.checklistItemId === itemId);
      const requiredShot = checklist.steps.some(s => s.kind === 'SCREENSHOT' && s.checklistItemId === itemId && s.required);
      if (!assertedItems.has(itemId)) {
        record(itemId, 'Checklist item requires an executed assertion', itemObs.length ? 'Only screenshot evidence was produced; a capture alone cannot verify behavior' : 'No observation was produced for this item', 'BLOCKED', null);
        if (outcome === 'PASS') outcome = 'BLOCKED';
      } else if (requiredShot && !screenshots.has(itemId)) {
        record(itemId, 'Required visual assertion needs a screenshot', 'No screenshot was captured for this item', 'BLOCKED', null);
        if (outcome === 'PASS') outcome = 'BLOCKED';
      }
    }
  } finally {
    await session.close().catch(() => {});
  }
  return { observations, collected: session.collectedFailures(), deniedOrigins, outcome };
}
