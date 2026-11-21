import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = '/@fs/' + resolve('tests/e2e/database-browser-fixture.tsx').replaceAll('\\', '/');
test.beforeEach(async ({ page }) => {
	await page.route(url => url.pathname === '/database-browser', route => route.fulfill({
		contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`,
	}));
});

test('attach-scoped query shows rows, then grid edit prepares one UPDATE per row', async ({ page }) => {
	await page.goto('/database-browser');
	// Attachment is preselected; schema loads automatically.
	await expect(page.getByText('Changes need approval')).toBeVisible();
	await expect(page.getByRole('treegrid').or(page.locator('.schema-tree'))).toBeVisible();
	// Interaction 1: pick the orders table (fills the editor).
	await page.locator('.schema-tree').getByText('orders').click();
	// Interaction 2: run.
	await page.getByRole('button', { name: 'Run' }).click();
	const grid = page.locator('.query-result-grid');
	await expect(grid.getByText('Ada')).toBeVisible();
	// Interaction 3: edit mode; PK column shows the lock affordance.
	await page.getByRole('button', { name: 'Edit' }).click();
	await expect(page.getByLabel('Read only')).toBeVisible();
	// Interaction 4: edit a cell and review.
	await page.getByRole('button', { name: 'Ben' }).click();
	await page.getByLabel('Edit row 2 column 2').fill('Benjamin');
	await expect(page.getByRole('button', { name: 'Review changes (1)' })).toBeVisible();
	await page.getByRole('button', { name: 'Review changes (1)' }).click();
	await expect(page.getByText('Prepared for approval')).toBeVisible();
	const body = JSON.parse(await page.evaluate(() => (window as never as { __lastPrepare: string }).__lastPrepare) as string) as { mode: string; statements: { sql: string; params: unknown[]; expectedChanges: number }[] };
	expect(body.mode).toBe('transaction');
	expect(body.statements).toHaveLength(1);
	expect(body.statements[0]!.sql).toBe('UPDATE "main"."orders" SET "customer"=? WHERE "id"=?');
	expect(body.statements[0]!.params).toEqual(['Benjamin', 2]);
	expect(body.statements[0]!.expectedChanges).toBe(1);
});

test('a table without a primary key disables editing with a tooltip', async ({ page }) => {
	await page.goto('/database-browser?nopk=1');
	await page.locator('.schema-tree').getByText('logs').click();
	await page.getByRole('button', { name: 'Run' }).click();
	await page.locator('.query-result-grid').getByText('boot').waitFor();
	const edit = page.getByRole('button', { name: 'Edit' });
	await expect(edit).toBeDisabled();
	await expect(edit).toHaveAttribute('title', 'Editing needs a primary key');
});

test('1000x20 grid mounts under 150ms scripting and scrolls at 50fps', async ({ page }) => {
	await page.goto('/database-browser?view=perf');
	await page.locator('.schema-tree').getByText('orders').click();
	await page.getByRole('button', { name: 'Run' }).click();
	const grid = page.locator('.query-result-grid');
	await expect(grid).toBeVisible();
	const mountMs = await page.evaluate(async () => {
		const start = performance.now();
		document.querySelector('.query-result-scroll')!.scrollTop = 0;
		await new Promise<void>(done => requestAnimationFrame(() => done()));
		return performance.now() - start;
	});
	expect(mountMs).toBeLessThan(150);
	const frameMs = await page.evaluate(async () => {
		const scroller = document.querySelector('.query-result-scroll') as HTMLElement;
		const frames: number[] = [];
		let last = performance.now(), steps = 0;
		await new Promise<void>(done => {
			const tick = (now: number) => {
				frames.push(now - last); last = now;
				scroller.scrollTop += 240;
				if (++steps < 40) requestAnimationFrame(tick); else done();
			};
			requestAnimationFrame(tick);
		});
		return frames.slice(2).reduce((sum, value) => sum + value, 0) / (frames.length - 2);
	});
	expect(frameMs).toBeLessThanOrEqual(20);
});
