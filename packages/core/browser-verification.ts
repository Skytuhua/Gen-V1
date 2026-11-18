import { randomUUID } from 'node:crypto';
import { HarnessError, type Thread } from '../contracts/index.ts';
import type { ToolOwner } from '../contracts/tool-effects.ts';
import {
  BROWSER_RUN_DEADLINE_MS, BROWSER_STEP_LIMIT, BROWSER_STEP_TIMEOUT_MS,
  browserChecklistSchema, type BrowserChecklistV1, type BrowserStep,
  type VisualObservationV1,
} from '../contracts/verification.ts';
import { hostFlagEnabled } from './host-flags.ts';
import type { Store } from '../storage/store.ts';
import { VerificationArtifactStore } from './verification-artifacts.ts';
import { observationMatchesThreadOwner } from './verification-gate.ts';

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
  /** Fresh private scope allocated by the admitted backend, never an artifact root. */
  profileDir: string;
  driver: BrowserDriver;
  digests: { codeDigest: string; dependencyDigest: string; recipeDigest: string; environmentId: string };
  signal?: AbortSignal;
  /** Current host authority, in addition to the durable and run-owner checks. */
  assertCurrent?: () => void;
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

async function bounded<T>(action: () => Promise<T>, timeoutMs: number, code: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted = () => {};
  try {
    if (signal?.aborted) throw new HarnessError('CANCELLED_RUN', 'Browser verification was cancelled');
    const cancelled = new Promise<never>((_, reject) => {aborted = () => reject(new HarnessError('CANCELLED_RUN', 'Browser verification was cancelled')); signal?.addEventListener('abort', aborted, {once: true});});
    const timeout = new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new HarnessError(code, 'Browser verification exceeded its deadline')), timeoutMs);});
    return await Promise.race([action(), timeout, cancelled]);
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', aborted);}
}

export async function runBrowserChecklist(store: Store, input: BrowserRunInput, env: Readonly<Record<string, string | undefined>> = process.env): Promise<BrowserRunResult> {
  if (!hostFlagEnabled('verification.workflowV1', env))
    throw new HarnessError('CAPABILITY_DENIED', 'The verification workflow capability is disabled on this host.', {flag: 'verification.workflowV1'});
  const checklist = browserChecklistSchema.parse(input.checklist);
  if (checklist.steps.length > BROWSER_STEP_LIMIT) throw new HarnessError('BROWSER_STEP_LIMIT', 'Browser checklists are bounded to 24 steps');
  if (checklist.viewport.width > 8192 || checklist.viewport.height > 8192 || checklist.viewport.width * checklist.viewport.height > 16_777_216)
    throw new HarnessError('RESOURCE_LIMIT', 'Browser viewport exceeds the bounded screenshot dimensions');
  for (const step of checklist.steps) if ('checklistItemId' in step && !checklist.items.includes(step.checklistItemId))
    throw new HarnessError('INVALID_CHECKLIST', 'A step references an undeclared checklist item');

  const executionId = input.executionId ?? `browser-${randomUUID()}`, actionTraceId = `trace-${randomUUID()}`;
  const clock = input.nowMs ?? Date.now, deadlineAt = clock() + BROWSER_RUN_DEADLINE_MS;
  const artifacts = new VerificationArtifactStore(store), observations: VisualObservationV1[] = [];
  const deniedOrigins: string[] = [], deniedAtBoundary: string[] = [];
  const screenshots = new Map<string, string>(), assertedItems = new Set<string>();
  let session: BrowserSession | undefined, pendingLaunch: Promise<BrowserSession> | undefined, acceptingTraffic = true;
  let outcome: BrowserRunResult['outcome'] = 'PASS', collected: BrowserRunResult['collected'] = {console: [], network: []}, errorsRecorded = false;

  const isCancelled = () => outcome === 'CANCELLED';
  const assertActive = () => {
    const thread = store.get<Thread>('thread', input.owner.threadId);
    if (input.signal?.aborted || !observationMatchesThreadOwner({owner: input.owner}, thread) || thread?.runId !== input.owner.runId || thread?.epoch !== input.owner.epoch || store.get('archivedThread', input.owner.threadId))
      throw new HarnessError('CANCELLED_RUN', 'The browser verification owner was cancelled or changed');
    input.assertCurrent?.();
    if (clock() >= deadlineAt) throw new HarnessError('BROWSER_RUN_TIMEOUT', 'The browser run exceeded its overall deadline');
  };
  const activeCall = async <T>(action: () => Promise<T>, step = true): Promise<T> => {
    assertActive();
    const remaining = deadlineAt - clock(), timeout = Math.min(step ? BROWSER_STEP_TIMEOUT_MS : remaining, remaining);
    const value = await bounded(action, timeout, remaining <= timeout ? 'BROWSER_RUN_TIMEOUT' : 'BROWSER_STEP_TIMEOUT', input.signal);
    assertActive();
    return value;
  };
  const origin = () => {try {const value = session?.page.url(); return typeof value === 'string' ? value.slice(0, 2048) : 'unavailable';} catch {return 'unavailable';}};
  const record = (itemId: string, assertion: string, observed: string, outcomeValue: VisualObservationV1['outcome'], screenshotDigest: string | null, artifactRefs: string[] = [], observationKind: 'browser' | 'visual' = 'browser') => {
    if (outcomeValue === 'PASS') assertActive();
    const observedOrigin = origin();
    if (outcomeValue === 'PASS' && !sameOrigin(checklist.approvedOrigins, observedOrigin)) throw new HarnessError('INVALID_BROWSER_EVIDENCE', 'The actual page origin is unavailable or outside the approved scope');
    const observation: VisualObservationV1 = {
      version: 1, checkId: `vobs-${randomUUID()}`, executionId, owner: input.owner, ...input.digests,
      argv: ['browser-checklist', checklist.checklistId], cwdIdentity: 'browser-profile', phase: 'BROWSER', startedAt: now(), endedAt: now(),
      exitCode: outcomeValue === 'PASS' ? 0 : null, outcome: outcomeValue, artifactRefs, observationKind,
      checklistItemId: itemId, actionTraceId, origin: observedOrigin, viewport: checklist.viewport,
      assertion: assertion.slice(0, 2000), observed: observed.slice(0, 2000), screenshotDigest,
    };
    observations.push(observation);
    store.internal('visualObservation.recorded', input.owner.threadId, () => {store.put('visualObservation', observation.checkId, input.owner.threadId, observation); return observation;});
  };
  const failure = (error: unknown, action: string) => {
    const code = error instanceof HarnessError ? error.code : '';
    if (code === 'CANCELLED_RUN' || code === 'CANCELLED') {
      outcome = 'CANCELLED'; record('__cancelled__', 'Browser run completed its checklist', 'Cancelled before the checklist finished', 'CANCELLED', null);
    } else if (code === 'BROWSER_RUN_TIMEOUT') {
      if (!isCancelled()) outcome = 'FAIL';
      record('__deadline__', 'Overall browser deadline', `Exceeded ${BROWSER_RUN_DEADLINE_MS}ms`, 'FAIL', null);
    } else if (code === 'BROWSER_STEP_TIMEOUT') {
      if (!isCancelled()) outcome = 'FAIL';
      record('__step__', `${action} deadline`, 'Exceeded the 15s step deadline', 'FAIL', null);
    } else {
      if (outcome === 'PASS') outcome = 'BLOCKED';
      record('__driver__', `${action} executed`, error instanceof Error ? error.message : 'Driver evidence is unavailable', 'BLOCKED', null);
    }
  };
  const auditFailures = () => {
    const value = session!.collectedFailures();
    if (!Array.isArray(value.console) || !Array.isArray(value.network)) throw new HarnessError('INVALID_BROWSER_EVIDENCE', 'Browser error collection is unavailable');
    const bound = (items: string[]) => items.slice(0, MAX_COLLECTED).map(value => {if (typeof value !== 'string') throw new HarnessError('INVALID_BROWSER_EVIDENCE', 'Browser error collection is malformed'); return value.slice(0, 500);});
    collected = {console: bound(value.console), network: bound(value.network)};
    if (!collected.console.length && !collected.network.length) return false;
    if (!errorsRecorded) {
      errorsRecorded = true;
      const text = [...collected.console.map(item => `console: ${item}`), ...collected.network.map(item => `network: ${item}`)].join('\n');
      const prefix = Buffer.from(text), bytes = Buffer.from(new TextDecoder().decode(prefix.subarray(0, 64 * 1024), {stream: true}));
      let refs: string[] = [];
      try {refs = [artifacts.write({owner: input.owner, executionId, kind: 'LOG', bytes, truncated: bytes.length < prefix.length || value.console.length > MAX_COLLECTED || value.network.length > MAX_COLLECTED}).ref];}
      catch (error) {record('__artifact__', 'Browser failure log retained', error instanceof Error ? error.message : 'Failure log custody unavailable', 'BLOCKED', null);}
      record('__errors__', 'No console or network failures collected', text, 'FAIL', null, refs);
    }
    if (!isCancelled()) outcome = 'FAIL';
    return true;
  };
  const runStep = async (step: BrowserStep): Promise<boolean> => {
    assertActive();
    switch (step.kind) {
      case 'NAVIGATE':
        if (!sameOrigin(checklist.approvedOrigins, step.url)) {
          deniedOrigins.push(step.url); record('__origin__', 'Navigation origin must be approved', `Denied origin ${step.url}`, 'FAIL', null); outcome = 'FAIL'; return false;
        }
        await activeCall(() => session!.page.goto(step.url)); return true;
      case 'CLICK': await activeCall(() => session!.page.click(step.selector)); return true;
      case 'TYPE': await activeCall(() => session!.page.type(step.selector, step.text)); return true;
      case 'ASSERT_TEXT': {
        const text = await activeCall(() => session!.page.text(step.selector));
        if (text !== null && typeof text !== 'string') throw new HarnessError('INVALID_BROWSER_EVIDENCE', 'Browser text response is malformed');
        const pass = text !== null && text.includes(step.text); assertedItems.add(step.checklistItemId);
        record(step.checklistItemId, `Element ${step.selector} contains "${step.text.slice(0, 200)}"`, text === null ? 'selector not found' : `observed "${text.slice(0, 200)}"`, pass ? 'PASS' : 'FAIL', null);
        if (!pass) outcome = 'FAIL'; return pass;
      }
      case 'ASSERT_VISIBLE': {
        const visible = await activeCall(() => session!.page.visible(step.selector));
        if (typeof visible !== 'boolean') throw new HarnessError('INVALID_BROWSER_EVIDENCE', 'Browser visibility response is malformed');
        assertedItems.add(step.checklistItemId);
        record(step.checklistItemId, `Element ${step.selector} is visible`, visible ? 'visible' : 'not visible', visible ? 'PASS' : 'FAIL', null);
        if (!visible) outcome = 'FAIL'; return visible;
      }
      case 'ASSERT_URL': {
        const current = session!.page.url(); let pass = false;
        if (typeof current !== 'string') throw new HarnessError('INVALID_BROWSER_EVIDENCE', 'Browser URL response is malformed');
        try {pass = new URL(current).href === new URL(step.url).href;} catch {/* Invalid URLs cannot satisfy an assertion. */}
        assertActive(); assertedItems.add(step.checklistItemId);
        record(step.checklistItemId, `URL is ${step.url}`, `observed ${current}`, pass ? 'PASS' : 'FAIL', null);
        if (!pass) outcome = 'FAIL'; return pass;
      }
      case 'SCREENSHOT': {
        const bytes = await activeCall(() => session!.page.screenshot());
        if (bytes.length > MAX_ARTIFACT_BYTES) throw new HarnessError('RESOURCE_LIMIT', 'Screenshot exceeds the artifact bound');
        assertActive();
        const retained = artifacts.write({owner: input.owner, executionId, kind: 'SCREENSHOT', bytes, viewport: checklist.viewport}); screenshots.set(step.checklistItemId, retained.ref);
        record(step.checklistItemId, 'Screenshot captured at tested viewport', `sha256:${retained.sha256}`, 'PASS', retained.sha256, [retained.ref], 'visual'); return true;
      }
      case 'COLLECT_ERRORS': return !auditFailures();
    }
  };

  try {
    session = await activeCall(() => {
      pendingLaunch = input.driver.launch({profileDir: input.profileDir, viewport: checklist.viewport, approvedOrigins: checklist.approvedOrigins,
        allowOrigin: value => {
          if (!acceptingTraffic) return false;
          try {assertActive();} catch {return false;}
          const approved = sameOrigin(checklist.approvedOrigins, value);
          if (!approved && deniedAtBoundary.length < MAX_COLLECTED && !deniedAtBoundary.includes(value)) deniedAtBoundary.push(value.slice(0, 2048));
          return approved;
        }});
      return pendingLaunch;
    }, false);
    for (const step of checklist.steps) {
      try {if (!await runStep(step)) break;}
      catch (error) {failure(error, `Step ${step.kind}`); break;}
    }
    // A checklist cannot omit the console/network audit to manufacture a pass.
    try {auditFailures();} catch (error) {failure(error, 'Browser error audit');}
    try {
      const origins = session.observedOrigins();
      if (!Array.isArray(origins) || origins.length > MAX_COLLECTED || origins.some(value => typeof value !== 'string')) throw new HarnessError('INVALID_BROWSER_EVIDENCE', 'Browser traffic audit is malformed or exceeds its bounded read limit');
      for (const value of origins) if (!sameOrigin(checklist.approvedOrigins, value)) {
        deniedOrigins.push(value.slice(0, 2048)); record('__traffic__', 'Traffic origin must be approved', `Denied traffic origin ${value}`, 'FAIL', null);
        if (!isCancelled()) outcome = 'FAIL';
      }
    } catch (error) {failure(error, 'Browser origin audit');}
    if (deniedAtBoundary.length) {
      deniedOrigins.push(...deniedAtBoundary);
      // Preserve a denial after cancellation as audit evidence, without a late PASS.
      record('__boundary__', 'Unapproved traffic was denied at the request boundary', deniedAtBoundary.join(', '), isCancelled() ? 'CANCELLED' : 'PASS', null);
    }
    assertActive();
  } catch (error) {failure(error, 'Browser launch or final owner check');}
  finally {
    acceptingTraffic = false;
    if (session) try {await bounded(() => session!.close(), BROWSER_STEP_TIMEOUT_MS, 'BROWSER_CLEANUP_TIMEOUT');}
    catch (error) {record('__cleanup__', 'Owned browser resources closed', error instanceof Error ? error.message : 'Owned browser cleanup failed', 'FAIL', null); if (outcome === 'PASS') outcome = 'FAIL';}
    else if (pendingLaunch) {
      // A launch timeout cannot orphan a browser that resolves after this call.
      // The outer managed executor also retains and settles this owned handle.
      void pendingLaunch.then(late => bounded(() => late.close(), BROWSER_STEP_TIMEOUT_MS, 'BROWSER_CLEANUP_TIMEOUT')).catch(() => {});
    }
  }
  if (outcome === 'PASS') try {assertActive();} catch (error) {failure(error, 'Browser cleanup owner check');}
  for (const itemId of checklist.items) {
    if (isCancelled()) continue;
    const itemObs = observations.filter(obs => obs.checklistItemId === itemId);
    const requiredShot = checklist.steps.some(step => step.kind === 'SCREENSHOT' && step.checklistItemId === itemId && step.required);
    if (!assertedItems.has(itemId)) {
      record(itemId, 'Checklist item requires an executed assertion', itemObs.length ? 'Only screenshot evidence was produced; a capture alone cannot verify behavior' : 'No observation was produced for this item', 'BLOCKED', null);
      if (outcome === 'PASS') outcome = 'BLOCKED';
    } else if (requiredShot && !screenshots.has(itemId)) {
      record(itemId, 'Required visual assertion needs a screenshot', 'No screenshot was captured for this item', 'BLOCKED', null);
      if (outcome === 'PASS') outcome = 'BLOCKED';
    }
  }
  return {observations, collected, deniedOrigins, outcome};
}
