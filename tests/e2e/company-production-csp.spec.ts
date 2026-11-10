import {expect, test} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';
import {companyCspTestHost} from './company-production-csp-host';

const external = process.env.GEN_COMPANY_CSP_URL;
let owned: Awaited<ReturnType<typeof companyCspTestHost>> | undefined;
test.beforeAll(async () => {if (!external) owned = await companyCspTestHost();});
test.afterAll(async () => {await owned?.close();});
test('production CSP permits the labeled canonical fixture to render through room, thread and inbox', async ({page}, info) => {
  const source = await readFile('apps/server/company-mode.ts', 'utf8');
  const csp = /const companyCsp = "([^"]+)"/.exec(source)![1];
  const errors: string[] = [];
  page.on('console', item => {if (item.type() === 'error') errors.push(item.text());});
  page.on('pageerror', item => errors.push(item.message));
  await page.addInitScript(() => {
    const state = window as unknown as {companyCspViolations: {directive: string; blocked: string; source: string}[]};
    state.companyCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => state.companyCspViolations.push({directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile}));
  });
  const target = external ?? `${owned!.origin}/company/communications?fixture=communications`;
  const response = await page.goto(target);
  expect(response?.headers()['content-security-policy']).toBe(csp);
  expect(csp).toContain("script-src 'self'"); expect(csp).not.toContain('unsafe-eval');
  try {
    await expect(page.getByText('Synthetic fixture · no live employees', {exact: true})).toBeVisible();
    const item = page.getByRole('article'); await expect(item).toHaveCount(1);
    const id = await item.getAttribute('data-message-id');
    await item.getByRole('button', {name: 'Open task thread'}).click();
    await expect(page.getByRole('article')).toHaveAttribute('data-message-id', id!);
    await page.getByRole('article').getByRole('button', {name: 'Addressed inbox'}).click();
    await expect(page.getByRole('article')).toHaveAttribute('data-message-id', id!);
    await expect(page.getByRole('combobox', {name: 'Addressed employee'})).toHaveValue('E11');
    await expect(page.getByText('Consumed: unavailable', {exact: true})).toBeVisible();
    expect(errors.some(value => /compiling schema|unsafe-eval|EvalError/.test(value))).toBe(false);
    const violations = await page.evaluate(() => (window as unknown as {companyCspViolations: unknown[]}).companyCspViolations);
    expect(violations).toEqual([]);
  } finally {
    await writeFile(info.outputPath('csp-observation.json'), JSON.stringify({url: target, csp, errors, violations: await page.evaluate(() => (window as unknown as {companyCspViolations: unknown[]}).companyCspViolations), messages: await page.getByRole('article').count()}, null, 2) + '\n', 'utf8');
  }
});
test('production CSP validates both the fixture and later work-plan path while malformed records fail closed', async ({page}, info) => {
  test.skip(Boolean(external), 'The sealed reproduction binary predates the later work-plan source.');
  const violations: {directive: string; blocked: string}[] = [];
  await page.addInitScript(() => {
    const state = window as unknown as {companyCspViolations: {directive: string; blocked: string}[]};
    state.companyCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => state.companyCspViolations.push({directive: event.effectiveDirective, blocked: event.blockedURI}));
  });
  const response = await page.goto(`${owned!.origin}/validation`);
  expect(response!.headers()['content-security-policy']).toBe(owned!.csp);
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as {companyCspValidation?: unknown}).companyCspValidation)).toBe('function');
  const result = await page.evaluate(() => (window as unknown as {companyCspValidation: () => Promise<{messages: number; workPlans: number; rejected: number; evalBlocked: boolean}>}).companyCspValidation());
  expect(result).toEqual({messages: 1, workPlans: 6, rejected: 2, evalBlocked: true});
  await expect.poll(() => page.evaluate(() => (window as unknown as {companyCspViolations: unknown[]}).companyCspViolations.length)).toBe(1);
  violations.push(...await page.evaluate(() => (window as unknown as {companyCspViolations: typeof violations}).companyCspViolations));
  expect(violations).toEqual([{directive: 'script-src', blocked: 'eval'}]); // Deliberate negative control in test-only entry.
  expect(owned!.inputs.some(path => /ajv\/dist\/(compile|2020)/.test(path.replaceAll('\\', '/')))).toBe(false);
  await writeFile(info.outputPath('csp-validation.json'), JSON.stringify({result, violations, csp: owned!.csp, inputs: owned!.inputs}, null, 2) + '\n', 'utf8');
});
