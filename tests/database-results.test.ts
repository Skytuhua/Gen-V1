import { describe, expect, it } from 'vitest';
import { cellText, rowsTsv } from '../apps/web/src/database/QueryResultGrid';
import { latestQueryRecord } from '../apps/web/src/database/QueryResultCard';
import { boundedInteractionData, INTERACTION_DATA_SCHEMAS } from '../packages/ui-catalog/interactions';
import type { DatabaseQueryResultV1 } from '../packages/contracts/database';

const result = (overrides: Partial<DatabaseQueryResultV1> = {}): DatabaseQueryResultV1 => ({
	version: 1, engine: 'sqlite', connectionLabel: 'Local', sqlSha256: 'abc',
	columns: [{ name: 'id', type: 'integer' }, { name: 'note', type: 'text' }],
	rows: [[1, 'a'], [2, null], [3, { kind: 'bytes', length: 2048, sha256: 'x', previewHex: '00' }]],
	rowCount: 3, truncated: false, elapsedMs: 12, executedAt: '2026-11-21T15:00:00Z', ...overrides,
});

describe('QueryResultGrid helpers', () => {
	it('renders NULL, bytes and truncated cells as text', () => {
		expect(cellText(null)).toBe('NULL');
		expect(cellText({ kind: 'bytes', length: 2048, sha256: 'x', previewHex: '00' })).toBe('<bytes 2.0 KB>');
		expect(cellText({ kind: 'truncated', preview: 'ab', length: 90 })).toBe('ab');
		expect(cellText(4.5)).toBe('4.5');
	});
	it('serializes rows as TSV', () => {
		const tsv = rowsTsv(result());
		expect(tsv.split('\n')).toHaveLength(4);
		expect(tsv).toContain('id\tnote');
		expect(tsv).toContain('2\tNULL');
	});
});

describe('latestQueryRecord', () => {
	it('picks the newest database-query record for the thread and validates shape', () => {
		const data = [
			{ id: '1', threadId: 't1', revision: 1, value: result(), provenance: 'database-query', createdAt: '2026-11-21T15:00:00Z' },
			{ id: '2', threadId: 't1', revision: 1, value: result({ rowCount: 9 }), provenance: 'database-query', createdAt: '2026-11-21T15:05:00Z' },
			{ id: '3', threadId: 't1', revision: 1, value: { nope: true }, provenance: 'database-query', createdAt: '2026-11-21T15:10:00Z' },
			{ id: '4', threadId: 't2', revision: 1, value: result(), provenance: 'database-query', createdAt: '2026-11-21T15:20:00Z' },
		];
		expect(latestQueryRecord(data, 't1')).toBeUndefined(); // newest t1 record is malformed -> not surfaced
		expect(latestQueryRecord(data.slice(0, 2), 't1')?.rowCount).toBe(9);
		expect(latestQueryRecord(data, 't2')?.rowCount).toBe(3);
		expect(latestQueryRecord(data, 't3')).toBeUndefined();
	});
});

describe('QueryResult catalog data', () => {
	const bound = { engine: 'sqlite', connectionLabel: 'Local', columns: [{ name: 'id', type: 'integer' }], rows: [[1], [null]], rowCount: 2, elapsedMs: 4, executedAt: 't' };
	it('accepts a bounded result', () => {
		expect(boundedInteractionData('QueryResult', bound)).toBe(true);
		expect(INTERACTION_DATA_SCHEMAS.QueryResult.safeParse(bound).success).toBe(true);
	});
	it('rejects unbounded payloads and ragged rows', () => {
		expect(boundedInteractionData('QueryResult', { ...bound, rows: [] })).toBe(true); // zero rows fine for bounds
		expect(INTERACTION_DATA_SCHEMAS.QueryResult.safeParse({ ...bound, rows: [[1, 'extra']] }).success).toBe(false);
		expect(boundedInteractionData('QueryResult', { ...bound, columns: Array.from({ length: 41 }, (_, i) => ({ name: `${i}`, type: 'x' })) })).toBe(false);
	});
});
