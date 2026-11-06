import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = '/@fs/' + resolve('tests/e2e/ui-shell-controls-fixture.tsx').replaceAll('\\', '/');
test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/ui-shell-controls', route => route.fulfill({
    contentType: 'text/html', body: `<html data-theme="dark" data-native-titlebar="true"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`,
  }));
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'synthetic-controls' } }));
  await page.route('**/api/resources/*/tree*', route => route.fulfill({ json: { entries: [] } }));
  await page.goto('/ui-shell-controls');
});

test('required validation retains visible focus and blocks submission until corrected', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1&required=1');
  const trigger=page.getByRole('combobox',{name:'Choice',exact:true});
  await page.getByRole('button',{name:'Submit choice'}).click();
  await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-invalid','true');
  await expect(page.getByLabel('Result')).toHaveText('');
  await expect(page.getByText('Choose an option.',{exact:true})).toBeVisible();
  await trigger.click();await page.getByRole('option',{name:'Alpha',exact:true}).click();
  await expect(trigger).not.toHaveAttribute('aria-invalid','true');
  await page.getByRole('button',{name:'Submit choice'}).click();await expect(page.getByLabel('Result')).toContainText('"a"');
});

test('a fieldset disabling an open Select closes it and blocks a queued selection', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1');
  const trigger=page.getByRole('combobox',{name:'Choice',exact:true});await trigger.click();
  const delta=page.getByRole('option',{name:'Delta',exact:true});
  await delta.evaluate(node=>{const fieldset=document.querySelector('[data-testid="choice-fieldset"]') as HTMLFieldSetElement;fieldset.disabled=true;(node as HTMLElement).click();});
  await expect(trigger).toHaveText('Charlie');await expect(page.getByRole('listbox',{name:'Choice'})).toHaveCount(0);
  await page.getByTestId('choice-fieldset').evaluate(node=>{(node as HTMLFieldSetElement).disabled=false;});
  await expect(trigger).toBeEnabled();await trigger.click();await page.getByRole('option',{name:'Delta',exact:true}).click();await expect(trigger).toHaveText('Delta');
});

test('a fieldset disabling an open ActionMenu blocks queued actions and closes through re-enabling', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1');
  const trigger = page.getByRole('button', { name: 'Actions', exact: true });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Alpha', exact: true }).evaluate(node => {
    (document.querySelector('[data-testid="action-fieldset"]') as HTMLFieldSetElement).disabled = true;
    (node as HTMLElement).click();
  });
  await expect(page.getByLabel('Result')).toHaveText('');
  await expect(page.getByRole('menu', { name: 'Actions' })).toHaveCount(0);
  await page.getByTestId('action-fieldset').evaluate(node => { (node as HTMLFieldSetElement).disabled = false; });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Alpha', exact: true }).click();
  await expect(page.getByLabel('Result')).toHaveText('alpha');
});

test('Panels supports keyboard typeahead, invokes the existing tool owner and returns focus', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Panels', exact: true });
  await trigger.focus();
  await trigger.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Panels' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('t');
  await page.keyboard.press('e');
  await expect(page.getByRole('menuitem', { name: 'Add Terminal panel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Last tool' })).toHaveText('terminal');
  await expect(trigger).toBeFocused();
  await expect(menu).toHaveCount(0);
});

test('Select skips disabled choices, preserves form name/disabled semantics and resets to its initial value', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1');
  const trigger = page.getByRole('combobox', { name: 'Choice' });
  await trigger.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Charlie' })).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText('Delta');
  await page.getByRole('button', { name: 'Submit choice' }).click();
  await expect(page.getByRole('status', { name: 'Result' })).toHaveText('[["choice","d"]]');
  await page.getByRole('button', { name: 'Reset choice' }).click();
  await expect(trigger).toContainText('Charlie');
  await page.getByRole('button', { name: 'Toggle disabled' }).click();
  await expect(trigger).toBeDisabled();
  await page.getByRole('button', { name: 'Submit choice' }).click();
  await expect(page.getByRole('status', { name: 'Result' })).toHaveText('[]');
});

test('menu arrows wrap enabled rows, typeahead and checkbox selection do not submit a form', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1');
  const trigger = page.getByRole('button', { name: 'Actions', exact: true });
  await trigger.focus();
  await trigger.press('ArrowUp');
  const delta = page.getByRole('menuitemcheckbox', { name: 'Delta' });
  await expect(delta).toBeFocused();
  await expect(delta).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Alpha', exact: true })).toBeFocused();
  await page.keyboard.press('d');
  await page.keyboard.press('Space');
  await expect(page.getByRole('status', { name: 'Result' })).toHaveText('delta');
  await expect(trigger).toBeFocused();
});

test('IME keys leave menu selection and modal ownership unchanged, then Escape unwinds one layer at a time', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1&modal=1');
  const opener = page.getByRole('button', { name: 'Open controls dialog' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Controls dialog' });
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Background action' })).not.toBeFocused();
  const trigger = page.getByRole('combobox', { name: 'Choice' });
  await trigger.click();
  const option = page.getByRole('option', { name: 'Charlie' });
  expect(await option.evaluate(node => Boolean(node.closest('dialog:modal')))).toBe(true);
  await option.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await option.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await option.dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true });
  await expect(option).toBeFocused();
  await expect(trigger).toContainText('Charlie');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(dialog).toBeVisible();
  await trigger.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Tab leaves a popup for the next field and outside focus does not get stolen', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1');
  const trigger = page.getByRole('combobox', { name: 'Choice' });
  await trigger.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Following field' })).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.getByRole('button', { name: 'Background action' }).click();
  await expect(page.getByRole('button', { name: 'Background action' })).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('IME legacy keycode cannot dismiss Select or ActionMenu', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1');
  const select = page.getByRole('combobox', { name: 'Choice' });
  await select.click();
  await page.getByRole('option', { name: 'Charlie' }).dispatchEvent('keydown', { key: 'Escape', keyCode: 229 });
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  const menu = page.getByRole('button', { name: 'Actions', exact: true });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Alpha', exact: true }).dispatchEvent('keydown', { key: 'Escape', keyCode: 229 });
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
});

test('disabling an open Select closes it through re-enabling', async ({ page }) => {
  await page.goto('/ui-shell-controls?primitives=1');
  const trigger = page.getByRole('combobox', { name: 'Choice' });
  await trigger.click();
  await page.getByRole('button', { name: 'Toggle disabled' }).dispatchEvent('click');
  await expect(trigger).toBeDisabled();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle disabled' }).dispatchEvent('click');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

for (const theme of ['dark', 'light']) test(`selected, hovered and focused states stay distinct with spaced 32px rows in ${theme}`, async ({ page }, testInfo) => {
  await page.goto('/ui-shell-controls?primitives=1');
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
  await page.getByRole('combobox', { name: 'Choice' }).click();
  const selected = page.getByRole('option', { name: 'Charlie' });
  const other = page.getByRole('option', { name: 'Delta' });
  await other.hover();
  const selectedStyle = await selected.evaluate(node => getComputedStyle(node).backgroundColor);
  const hoverStyle = await other.evaluate(node => getComputedStyle(node).backgroundColor);
  expect(selectedStyle).not.toBe(hoverStyle);
  await page.keyboard.press('End');
  expect(await other.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
  const first = await page.getByRole('option', { name: 'Alpha', exact: true }).boundingBox();
  const second = await page.getByRole('option', { name: 'Beta unavailable' }).boundingBox();
  expect(first!.height).toBeGreaterThanOrEqual(32);
  expect(second!.y - first!.y - first!.height).toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: testInfo.outputPath(`select-${theme}.png`) });
});

test('a large selected catalog is visible on the first modal popup frame in a short window', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto('/ui-shell-controls?primitives=1&modal=1&large=1');
  await page.getByRole('button', { name: 'Open controls dialog' }).click();
  await page.getByRole('combobox', { name: 'Choice' }).click();
  const popup = page.getByRole('listbox', { name: 'Choice' });
  const geometry = await page.getByRole('option', { name: 'Option 99', exact: true }).evaluate(node => {
    const row = node.getBoundingClientRect(), list = node.closest('[role="listbox"]')!.getBoundingClientRect();
    return { top: row.top, bottom: row.bottom, listTop: list.top, listBottom: list.bottom, listLeft: list.left, listRight: list.right };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.listTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.listBottom);
  expect(geometry.listTop).toBeGreaterThanOrEqual(50);
  expect(geometry.listBottom).toBeLessThanOrEqual(312);
  expect(geometry.listLeft).toBeGreaterThanOrEqual(8);
  expect(geometry.listRight).toBeLessThanOrEqual(312);
  const dialog = page.getByRole('dialog', { name: 'Controls dialog' });
  expect(await dialog.evaluate(node => getComputedStyle(node, '::backdrop').backdropFilter)).toBe('blur(6px)');
  expect(await dialog.evaluate(node => getComputedStyle(node).filter)).toBe('none');
  await expect(popup).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('modal-select-short.png') });
});

test('the actual resource selector renders first-party options and retains its value/callback', async ({ page }) => {
  const trigger = page.getByRole('combobox', { name: 'Granted resource' });
  await trigger.click();
  await expect(page.getByRole('listbox', { name: 'Granted resource' })).toBeVisible();
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText('Beta grant');
  await trigger.click();
  await expect(page.getByRole('option', { name: 'Beta grant' })).toHaveAttribute('aria-selected', 'true');
});

test('Panels failures stay visible and Layouts keeps its saved-layout controls', async ({ page }) => {
  await page.goto('/ui-shell-controls?failure=1');
  await page.getByRole('button', { name: 'Panels', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Files panel' }).click();
  await expect(page.getByRole('alert')).toHaveText('The owner rejected this tool.');
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Profile name' })).toHaveValue('My workspace');
  await expect(page.getByRole('button', { name: 'Save as new', exact: true })).toBeVisible();
});

test('Panels fits a short window with a visible scrollbar and reachable last action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 300 });
  const trigger = page.getByRole('button', { name: 'Panels', exact: true });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Panels' });
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(240);
  expect(bounds!.width).toBeLessThanOrEqual(320);
  expect(bounds!.y).toBeGreaterThanOrEqual(50);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(292);
  expect(await menu.evaluate(node => getComputedStyle(node).scrollbarWidth)).not.toBe('none');
  await page.keyboard.press('End');
  const last = page.getByRole('menuitem', { name: 'Add Linked pull requests panel' });
  await expect(last).toBeFocused();
  expect(await last.evaluate(node => {
    const row = node.getBoundingClientRect(), list = node.closest('[role="menu"]')!.getBoundingClientRect();
    return row.top >= list.top && row.bottom <= list.bottom;
  })).toBe(true);
});
