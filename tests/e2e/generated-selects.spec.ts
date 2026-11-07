import {expect, test, type Page} from '@playwright/test';
import {resolve} from 'node:path';

const fixture = '/@fs/' + resolve('tests/e2e/generated-selects.html').replaceAll('\\', '/');
test.beforeEach(async ({page}) => {
  await page.route('**/api/**', route => route.fulfill({status: 404}));
  await page.goto(fixture);
});
async function choose(page: Page, name: string, label: string) {
  await page.getByRole('combobox', {name, exact: true}).click();
  await page.getByRole('option', {name: label, exact: true}).click();
}

test('catalog keyboard selection commits strings, Escape cancels and neighboring editors retain identity', async ({page}) => {
  const trigger = page.getByRole('combobox', {name: 'Catalog choice', exact: true});
  const draft = page.getByRole('textbox', {name: 'Neighboring draft'}), editor = page.getByRole('textbox', {name: 'Neighboring editor'});
  await draft.fill('Unsubmitted neighboring draft');
  const original = await editor.elementHandle();
  await trigger.focus(); await trigger.press('ArrowDown');
  await expect(page.getByRole('listbox', {name: 'Catalog choice'})).toBeVisible();
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('False string'); await expect(trigger).toBeFocused();
  await expect(page.getByLabel('Catalog state')).toHaveText('{"catalog":"false"}');
  await trigger.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Escape');
  await expect(trigger).toHaveText('False string'); await expect(trigger).toBeFocused();
  await expect(draft).toHaveValue('Unsubmitted neighboring draft');
  expect(await editor.evaluate((node, old) => node === old, original)).toBe(true);
  await expect(editor).toHaveText('Keep this editor');
});

test('schema enum indices retain false, null, numbers, strings, objects and arrays and optional omission', async ({page}) => {
  for (const [label, value] of [['false', false], ['—', null], ['0', 0], ['{ "id": 1 }', {id: 1}], ['[ 1, false ]', [1, false]]] as const) {
    // Duplicate displayed 0 labels intentionally exercise the exact index, not string coercion.
    await page.getByRole('combobox', {name: 'Optional choice', exact: true}).click();
    await page.getByRole('option', {name: label, exact: true}).first().click();
    await expect.poll(async () => JSON.parse(await page.getByLabel('Enum state').innerText())).toEqual({optional: value});
  }
  await page.getByRole('combobox', {name: 'Optional choice', exact: true}).click();
  await page.getByRole('option', {name: '0', exact: true}).nth(1).click();
  await expect(page.getByLabel('Enum state')).toHaveText('{"optional":"0"}');
  await choose(page, 'Optional choice', 'Choose…');
  await expect(page.getByLabel('Enum state')).toHaveText('{}');
  await choose(page, 'Object choice', '{ "id": 2 }');
  await choose(page, 'Array choice', '[ 2, null ]');
  await choose(page, 'Boolean choice', 'false');
  await expect(page.getByLabel('Enum state')).toHaveText('{"object":{"id":2},"array":[2,null],"boolean":false}');
});

test('required enum blocks form submission, selecting false is valid and clearing restores validation', async ({page}) => {
  const trigger = page.getByRole('combobox', {name: 'Required choice', exact: true});
  await page.getByRole('button', {name: 'Submit enums'}).click();
  await expect(trigger).toBeFocused(); await expect(trigger).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Submitted enums')).toHaveText('');
  await choose(page, 'Required choice', 'false');
  await expect(page.getByLabel('Submitted enums')).toHaveText('');
  await page.getByRole('button', {name: 'Submit enums'}).click();
  await expect(page.getByLabel('Submitted enums')).toHaveText('{"required":false}');
  await choose(page, 'Required choice', '—');
  await page.getByRole('button', {name: 'Submit enums'}).click();
  await expect(page.getByLabel('Submitted enums')).toHaveText('{"required":null}');
  await choose(page, 'Required choice', 'Choose…');
  await page.getByRole('button', {name: 'Submit enums'}).click();
  await expect(trigger).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Submitted enums')).toHaveText('{"required":null}');
});

test('disabled owners close an open enum without committing and optional containers retain their draft', async ({page}) => {
  await choose(page, 'Optional choice', 'false');
  await page.getByRole('combobox', {name: 'Optional choice', exact: true}).click();
  await page.getByRole('checkbox', {name: 'Disable fields', exact: true}).check();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('combobox', {name: 'Catalog choice', exact: true})).toBeDisabled();
  await expect(page.getByRole('combobox', {name: 'Optional choice', exact: true})).toBeDisabled();
  await expect(page.getByLabel('Enum state')).toHaveText('{"optional":false}');
  await page.getByRole('checkbox', {name: 'Disable fields', exact: true}).uncheck();
  await page.getByRole('checkbox', {name: 'Include Nested', exact: true}).check();
  await choose(page, 'Nested choice', 'b');
  await page.getByRole('checkbox', {name: 'Include Nested', exact: true}).uncheck();
  await expect(page.getByRole('combobox', {name: 'Nested choice', exact: true})).toHaveCount(0);
  await expect(page.getByLabel('Enum state')).toHaveText('{"optional":false}');
  await page.getByRole('checkbox', {name: 'Include Nested', exact: true}).check();
  await expect(page.getByRole('combobox', {name: 'Nested choice', exact: true})).toHaveText('b');
});

test('long catalog options remain reachable within a narrow short viewport in both themes', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 420});
  await page.goto(fixture + '?overflow=1');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const trigger = page.getByRole('combobox', {name: 'Catalog choice', exact: true});
    await trigger.click();
    const popup = page.getByRole('listbox', {name: 'Catalog choice'});
    await expect(popup).toBeVisible();
    const box = (await popup.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390); expect(box.y + box.height).toBeLessThanOrEqual(420);
    await page.keyboard.press('End');
    await expect(page.getByRole('option', {name: 'Choice 80 with a long supplied label', exact: true})).toBeInViewport();
    await page.screenshot({path: info.outputPath(`GENERATED-SELECTS-${theme}-overflow.png`)});
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Catalog state')).toHaveText('{"catalog":"choice-79"}');
  }
});
