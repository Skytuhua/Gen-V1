import { journalCompareAndSwap, journalReadRecord } from '../journal';
import type { DatabaseQueryResultV1 } from '../../../../packages/contracts/database.ts';
import { cellText } from './QueryResultGrid';

/** Quoted data attachment: appends a bounded quoted block of the result to the
 * thread's composer draft (`draft:<threadId>`), the same journal slot the
 * conversation composer reads. Retries on concurrent edits via compare-and-swap. */
export async function sendResultToChat(threadId: string, result: DatabaseQueryResultV1): Promise<void> {
	const key = `draft:${threadId}`;
	const preview = [result.columns.map(column => column.name).join('\t'), ...result.rows.slice(0, 20).map(row => row.map(cellText).join('\t'))].join('\n');
	const quote = `\n\nQuery result · ${result.connectionLabel} · ${result.engine} · ${result.rowCount} rows · ${result.elapsedMs} ms${result.truncated ? ' · truncated' : ''}\n\`\`\`\n${preview}${result.rows.length > 20 ? `\n… ${result.rows.length - 20} more rows` : ''}\n\`\`\``;
	for (let attempt = 0; attempt < 8; attempt++) {
		const record = await journalReadRecord<string>(key);
		const next = `${record?.value ?? ''}${quote}`;
		if (await journalCompareAndSwap(key, record?.generation, next)) return;
	}
	throw Error('The draft changed in another window. Retry.');
}
