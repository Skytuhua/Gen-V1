import { test, expect } from '@playwright/test';
import { branchGraphData, branchGraphSpec, growingQaSpec, linkedMapData, linkedMapSpec, migrationTableSpec, serveTaskFixture, taskFixture } from './task-interface-fixture';
import { validateSurface } from '../../packages/ui-catalog';
import { mkdir, writeFile } from 'node:fs/promises';

test('vertical history and horizontal lanes are distinct accessible source views', async ({ page }) => {
  const fixture = await serveTaskFixture(page, taskFixture(branchGraphSpec('vertical'), { graph: branchGraphData }));
  await page.goto('/');
  await expect(page.locator('.task-graph')).toHaveAttribute('data-orientation', 'vertical');
  await expect(page.locator('.task-node-hash').first()).toHaveText('7fe91ac');
  await page.getByRole('button', { name: /Keep retries ordered/ }).focus();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Current' })).toBeVisible();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Current' })).toContainText('await retry(source)');
  const vertical = await page.locator('.task-graph-dot').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
  expect(vertical[2].y).toBeGreaterThan(vertical[0].y + 40);
  fixture.snapshot.artifacts[0].spec = branchGraphSpec('horizontal'); fixture.snapshot.artifacts[0].revision++; await fixture.publish();
  await expect(page.locator('.task-graph')).toHaveAttribute('data-orientation', 'horizontal');
  await expect.poll(async () => {
    const horizontal = await page.locator('.task-graph-dot').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
    return horizontal[2].x - horizontal[0].x;
  }).toBeGreaterThan(100);
  await page.getByRole('button', { name: /Keep retries ordered/ }).click();
  await expect.poll(() => fixture.snapshot.userStates[0].values.selectedCommit).toBe('topic');
});

test('progressive Q&A keeps branches, edit identity and focus while deduplicating pending actions', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const snapshot = taskFixture(structuredClone(growingQaSpec), { answer: { status: 'idle' } });
  const fixture = await serveTaskFixture(page, snapshot, async command => {
    if (command.payload.actionId === 'expand') await gate;
    if (command.payload.actionId === 'ask') {
      const question = (command.payload.payload as { question: string }).question;
      const spec = structuredClone(snapshot.artifacts[0].spec!);
      spec.elements.history.children!.push('newRoot');
      spec.elements.newRoot = { type: 'Disclosure', props: { title: question, stateKey: 'newQuestionOpen', defaultOpen: true, text: 'Choose Friday while reviewing the destination, before confirming.' } };
      snapshot.artifacts[0].spec = spec; snapshot.artifacts[0].revision++;
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Can delivery be split?', exact: true }).click();
  await expect(page.locator('.disclosure-pending')).toBeVisible();
  await page.getByRole('button', { name: 'Can delivery be split?', exact: true }).click();
  await page.getByRole('button', { name: 'Can delivery be split?', exact: true }).click();
  await expect.poll(() => fixture.commands.filter(command => command.type === 'action.submit').length).toBe(1);
  await page.getByRole('textbox', { name: 'Destination note' }).fill('Keep the labels separate');
  await page.getByRole('textbox', { name: 'Destination note' }).focus();
  const identity = await page.getByRole('textbox', { name: 'Destination note' }).evaluate(node => { (node as HTMLInputElement).dataset.identity = 'retained'; return node.dataset.identity; });
  fixture.setInput('answer', { status: 'pending', answer: 'Yes. Choose a destination' }); await fixture.publish();
  await expect(page.getByText('Yes. Choose a destination', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Destination note' })).toBeFocused();
  fixture.setInput('answer', { status: 'ready', answer: 'Yes. Choose a destination for each package before confirming.' }); await fixture.publish(); release();
  await expect(page.getByText('Yes. Choose a destination for each package before confirming.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Destination note' })).toHaveAttribute('data-identity', identity!);
  await expect(page.getByRole('textbox', { name: 'Destination note' })).toHaveValue('Keep the labels separate');
  await page.getByRole('button', { name: 'Can each destination use a different date?' }).click();
  await page.getByRole('button', { name: 'Where can I see the final fee?' }).click();
  await expect(page.getByText('Yes, choose a date for each destination before confirming.')).toBeVisible();
  await expect(page.getByText('Your confirmation shows the fee before you submit.')).toBeVisible();
  const question = page.getByRole('textbox', { name: 'Ask another question' });
  // Measure both controls in the same frame while the answer-region height
  // is animating; separate protocol calls observe different layout positions.
  const { fieldBox, submitBox } = await question.evaluate(input => {
    const field = input.getBoundingClientRect(), submit = input.closest('form')!.querySelector('button[type=submit]')!.getBoundingClientRect();
    return { fieldBox: { y: field.y, height: field.height }, submitBox: { y: submit.y, height: submit.height, width: submit.width } };
  });
  expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(fieldBox!.y + fieldBox!.height);
  expect(submitBox!.width).toBeLessThan(45);
  await question.fill('Could the package wait until Friday?');
  await question.dispatchEvent('compositionstart');
  await question.press('Enter');
  expect(fixture.commands.filter(command => command.type === 'action.submit' && command.payload.actionId === 'ask')).toHaveLength(0);
  await question.dispatchEvent('compositionend');
  await question.press('Enter');
  await expect.poll(() => fixture.commands.filter(command => command.type === 'action.submit' && command.payload.actionId === 'ask').length).toBe(1);
  await expect(question).toBeFocused(); await expect(question).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Could the package wait until Friday?' })).toBeVisible();
  await expect(page.getByText('Choose Friday while reviewing the destination, before confirming.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Destination note' })).toHaveValue('Keep the labels separate');
});

test('a pending question cannot duplicate or erase a newer draft and source errors can retry', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const snapshot = taskFixture(growingQaSpec, { answer: { status: 'error', error: 'The delivery source needs another attempt.' } });
  const fixture = await serveTaskFixture(page, snapshot, async command => {
    if (command.payload.actionId === 'ask') await gate;
    if (command.payload.actionId === 'expand') { snapshot.data[0].value = { status: 'ready', answer: 'Use a separate destination for each package.' }; snapshot.data[0].revision++; }
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Can delivery be split?', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The delivery source needs another attempt.');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Use a separate destination for each package.')).toBeVisible();
  const question = page.getByRole('textbox', { name: 'Ask another question' });
  await question.fill('Can I change the date?'); await question.press('Enter');
  await expect(page.getByRole('button', { name: 'Submitting…', exact: true })).toBeDisabled();
  // Busy feedback precedes draft flush and HTTP delivery. Exercise duplicate
  // input only after the first request actually reaches the held host fixture.
  await expect.poll(() => fixture.commands.filter(command => command.type === 'action.submit' && command.payload.actionId === 'ask').length).toBe(1);
  await question.press('Enter'); await question.fill('A newer question I am still writing');
  expect(fixture.commands.filter(command => command.type === 'action.submit' && command.payload.actionId === 'ask')).toHaveLength(1);
  release(); await expect(page.getByRole('button', { name: 'Ask question', exact: true })).toBeEnabled();
  await expect(question).toHaveValue('A newer question I am still writing'); await expect(question).toBeFocused();
});

test('a differently worded nested composition uses the same registry without scenario routing', async ({ page }) => {
  const novel = { root: 'review', elements: {
    review: { type: 'Stack', props: { gap: 'md' }, children: ['intro', 'views'] },
    intro: { type: 'Text', props: { text: 'Choose a studio visit, then inspect the related release.', size: 'sm' } },
    views: { type: 'Tabs', props: { labels: ['Visit plan', 'Release notes'], stateKey: 'novelTab' }, children: ['place', 'notes'] },
    place: { type: 'MapView', props: { dataBinding: 'destinations', stateKey: 'placeChoice', label: 'A different visit plan' } },
    notes: { type: 'Stack', props: { gap: 'sm' }, children: ['network', 'explanation'] },
    network: { type: 'RelationshipGraph', props: { dataBinding: 'releases', orientation: 'horizontal', label: 'Collection dependencies' } },
    explanation: { type: 'Disclosure', props: { stateKey: 'whyOpen', title: 'Why visit the print room first?', text: 'Its samples inform the later ceramics discussion.' }, children: ['nested'] },
    nested: { type: 'Disclosure', props: { stateKey: 'bringOpen', title: 'What should I bring?', text: 'Bring the accepted sample list.' } },
  } };
  expect(() => validateSurface(novel)).not.toThrow();
  await serveTaskFixture(page, taskFixture(novel, { destinations: linkedMapData, releases: branchGraphData })); await page.goto('/');
  await page.getByRole('button', { name: 'Next place' }).click(); await expect(page.getByRole('region', { name: 'Selected place' })).toContainText('Ceramics room');
  await page.getByRole('tab', { name: 'Release notes' }).click(); await expect(page.locator('.task-graph')).toHaveAttribute('data-orientation', 'horizontal');
  await page.getByRole('button', { name: 'Why visit the print room first?' }).click(); await page.getByRole('button', { name: 'What should I bring?' }).click(); await expect(page.getByText('Bring the accepted sample list.')).toBeVisible();
  await page.getByRole('tab', { name: 'Visit plan' }).click(); await expect(page.getByRole('region', { name: 'Selected place' })).toContainText('Ceramics room');
});

test('a linked map retains selected source identity through themes and sends a scoped feedback action', async ({ page }) => {
  const fixture = await serveTaskFixture(page, taskFixture(linkedMapSpec, { places: linkedMapData })); await page.goto('/');
  await expect(page.locator('.task-map')).toBeVisible();
  await page.getByRole('button', { name: 'Select Ceramics room', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected place' })).toContainText('3 Garden Lane');
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await expect(page.locator('.task-map')).toHaveAttribute('data-map-theme', 'night');
  await expect(page.getByRole('button', { name: 'Select Ceramics room', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next place' }).click();
  await expect(page.getByRole('region', { name: 'Selected place' })).toContainText('Garden cafe');
  await page.getByRole('button', { name: 'Send feedback request' }).click();
  await expect.poll(() => fixture.commands.find(command => command.type === 'action.submit')?.payload.payload).toEqual({ scope: 'walking-plan', pointId: 'cafe' });
  await page.reload(); await expect(page.locator('.task-map')).toHaveAttribute('data-map-theme', 'night');
  await expect(page.getByRole('region', { name: 'Selected place' })).toContainText('Garden cafe');
  const carousel = page.locator('.task-map-carousel');
  await carousel.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'mouse' });
  await carousel.evaluate(node => { node.scrollLeft = node.clientWidth; });
  await expect(page.getByRole('region', { name: 'Selected place' })).toContainText('Ceramics room');
  await carousel.dispatchEvent('pointerup', { pointerId: 9, pointerType: 'mouse' });
  await expect(page.getByRole('button', { name: 'Select Ceramics room', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('an explicitly expanded table follows accepted changes locally until the user takes over', async ({ page }) => {
  const rows = Array.from({ length: 40 }, (_, index) => ({ id: `row-${index}`, name: `Person ${index + 1}`, workspace_id: index ? null : 'studio' }));
  const snapshot=taskFixture(migrationTableSpec, { rows, projects: [{ name: 'New collection' }], changes: { revision: 1, activeRowId: 'row-0', rows: [{ id: 'row-0', cells: [{ key: 'workspace_id', status: 'updated', before: null }] }] } });
  snapshot.artifacts[0].placement='expanded';
  const fixture = await serveTaskFixture(page, snapshot); await page.goto('/');
  await expect(page.locator('td[data-change="updated"]')).toHaveAttribute('data-before', 'null');
  const pageScroll = await page.locator('.conversation-scroll').evaluate(node => node.scrollTop);
  fixture.setInput('changes', { revision: 2, activeRowId: 'row-35', rows: [{ id: 'row-35', cells: [{ key: 'workspace_id', status: 'updated', before: null }] }] }); await fixture.publish();
  await expect.poll(() => page.locator('.task-table-scroll').first().evaluate(node => node.scrollTop)).toBeGreaterThan(200);
  expect(await page.locator('.conversation-scroll').evaluate(node => node.scrollTop)).toBe(pageScroll);
  await page.locator('.task-table-scroll').first().evaluate(node => { node.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true })); node.scrollTop = 0; });
  fixture.setInput('changes', { revision: 3, activeRowId: 'row-39', rows: [{ id: 'row-39', status: 'updated' }] }); await fixture.publish();
  await expect(page.locator('.task-table-scroll').first()).toHaveAttribute('data-following', 'false');
  await expect.poll(() => page.locator('.task-table-scroll').first().evaluate(node => node.scrollTop)).toBe(0);
  await page.getByRole('tab', { name: 'Projects', exact: true }).click(); await expect(page.getByText('New collection', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'People', exact: true }).click(); await expect(page.locator('.task-table-scroll').first()).toHaveAttribute('data-following', 'false');
});

test('capture one batched desktop, narrow and theme inspection of reusable task surfaces', async ({ page }) => {
  test.skip(process.env.HARNESS_CAPTURE_TASK_INTERFACES !== '1', 'Opt-in single batched visual inspection.');
  const correction = process.env.HARNESS_TASK_CAPTURE_CORRECTION === '1';
  const path = `.harness-task-interface-results/${correction ? 'visual-correction' : 'visual'}`; await mkdir(path, { recursive: true });
  const dense = { ...branchGraphData, nodes: Array.from({ length: 9 }, (_, index) => ({ id: `commit-${index}`, label: ['Merge into main', 'Keep retries ordered', 'Read current retry key', 'Rotate retry keys', 'Refresh work queue', 'Add consent state', 'Read queue expiry', 'Track completion events', 'Bump next version'][index], hash: ['7fe91ac', 'bf2c00d', 'a405ac3'][index % 3], author: ['Sam', 'Mira', 'Jules'][index % 3], time: `${index * 4}m`, lane: index > 4 ? 2 : index === 0 || index === 8 ? 0 : 1, status: index < 3 ? 'pending' : 'neutral', branch: index === 1 ? 'ordered-retries' : index === 5 ? 'consent-state' : undefined, dimmed: index === 8 })), edges: Array.from({ length: 8 }, (_, index) => ({ from: `commit-${index}`, to: `commit-${index + 1}`, status: index < 2 ? 'pending' : 'neutral' })) };
  const rows = Array.from({ length: 14 }, (_, index) => ({ id: `person-${index}`, name: ['Zoe Park', 'Omar Haddad', 'Ella Brooks', 'Kai Tanaka'][index % 4], workspace_id: index < 8 ? 'studio-collection' : null }));
  const scenarios = [
    { name: 'vertical', spec: branchGraphSpec('vertical'), inputs: { graph: dense }, values: {} },
    { name: 'horizontal', spec: branchGraphSpec('horizontal'), inputs: { graph: branchGraphData }, values: {} },
    { name: 'migration', spec: migrationTableSpec, inputs: { rows, projects: [{ name: 'New collection' }], changes: { revision: 1, activeRowId: 'person-5', rows: [{ id: 'person-5', cells: [{ key: 'workspace_id', status: 'updated', before: null }] }] } }, values: {} },
    { name: 'questions', spec: growingQaSpec, inputs: { answer: { status: 'ready', answer: 'Yes. Choose a destination for each package before confirming. Each destination can use its own delivery date.' } }, values: { deliveryOpen: true, datesOpen: true, costOpen: true } },
    { name: 'map', spec: linkedMapSpec, inputs: { places: linkedMapData }, values: { selectedPlace: 'ceramic' } },
  ];
  const metrics = [];
  for (const scenario of correction ? scenarios.filter(scenario => scenario.name === 'horizontal') : scenarios) {
    await page.unrouteAll({ behavior: 'wait' }); const snapshot = taskFixture(scenario.spec, scenario.inputs, scenario.values); await serveTaskFixture(page, snapshot);
    for (const variant of [{ width: 1536, height: 1000, theme: 'light' }, { width: 1280, height: 900, theme: 'dark' }, { width: 840, height: 900, theme: 'light' }, { width: 390, height: 844, theme: 'light' }] as const) {
      await page.setViewportSize({ width: variant.width, height: variant.height }); await page.emulateMedia({ colorScheme: variant.theme, reducedMotion: 'reduce' }); await page.goto('/');
      await expect(page.locator('.artifact-content')).toBeVisible(); await expect(page.locator('.save-state')).toHaveText('Saved'); await page.mouse.move(0, 0);
      const bounds = await page.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth > innerWidth, artifactWidth: document.querySelector('.artifact')!.getBoundingClientRect().width, proseWidth: document.querySelector('.message-content')!.getBoundingClientRect().width }));
      expect(bounds.pageOverflow).toBe(false);
      await page.screenshot({ path: `${path}/${scenario.name}-${variant.width}-${variant.theme}.png`, fullPage: true }); metrics.push({ scenario: scenario.name, ...variant, ...bounds });
    }
  }
  await writeFile(`${path}/manifest.json`, JSON.stringify({ provenance: 'Authored synthetic local renderer fixtures. No live model, GitHub, database, geographic provider, or external feedback delivery.', reducedMotion: true, references: ['merge-16.png', 'graph-14.png', 'migration-16.png', 'faq-24.png'], metrics }, null, 2));
});
