// DatabaseConnectionService (T04): saved connection profiles and per-thread
// attachments behind the data.databaseBrowserV1 flag. Passwords persist only
// as 'databaseSecret' entities — never on the connection record, in snapshots
// or in command receipts — and resolve exclusively inside DatabaseGateway.
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { z } from 'zod';
import { HarnessError, type HostCommand, type Thread } from '../contracts/index.ts';
import { assertNotStorage, canonical } from './security.ts';
import { capabilityEnabled } from './capability-flags.ts';
import { databaseConnectionV1Schema, databaseAttachmentV1Schema, databaseEngineSchema, databaseTlsSchema,
	type DatabaseAttachmentV1, type DatabaseConnectionV1 } from '../contracts/database.ts';
import type { Store } from '../storage/store.ts';
import type { DatabaseGateway } from '../capabilities/database-gateway.ts';

const networkInputSchema = z.strictObject({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535),
	database: z.string().min(1).max(128), user: z.string().min(1).max(128), tls: databaseTlsSchema,
	password: z.string().min(1).max(4096).optional() });
const sqliteInputSchema = z.strictObject({ path: z.string().min(1).max(4096) });
const createSchema = z.strictObject({ label: z.string().min(1).max(80), engine: databaseEngineSchema,
	sqlite: sqliteInputSchema.optional(), network: networkInputSchema.optional() });
const updateSchema = createSchema.extend({ id: z.string().uuid(), password: z.string().min(1).max(4096).optional() });

const secretKind = 'databaseSecret';
const secretRefId = (connectionId: string) => `dbconn:${connectionId}`;

interface DatabaseSecret { value: string }

export class DatabaseConnectionService {
	constructor(
		private readonly store: Store,
		private readonly gatewayFactory: () => DatabaseGateway,
	) {}

	private requireFlag(): void {
		if (!capabilityEnabled('data.databaseBrowserV1')) throw new HarnessError('CAPABILITY_DENIED', 'Database browsing is not enabled on this host.');
	}
	private requireMainThread(threadId: string): void {
		const thread = this.store.get<Thread>('thread', threadId);
		if (!thread) throw new HarnessError('NOT_FOUND', 'The task is unavailable.');
		if (thread.sideParentId || thread.kind === 'delegate') throw new HarnessError('CAPABILITY_DENIED', 'Side and delegate conversations cannot manage database connections.');
	}
	private putSecret(connectionId: string, password: string): void {
		this.store.put(secretKind, connectionId, null, { value: password } satisfies DatabaseSecret);
	}
	private async buildConnection(id: string, input: z.infer<typeof createSchema>, createdAt: string): Promise<DatabaseConnectionV1> {
		const base = { id, version: 1 as const, label: input.label, engine: input.engine, createdAt, updatedAt: new Date().toISOString() };
		if (input.engine === 'sqlite') {
			if (!input.sqlite) throw new HarnessError('INVALID_INPUT', 'A SQLite connection needs a file path.');
			const path = await canonical(input.sqlite.path);
			assertNotStorage(path, this.store.dataDir);
			const stat = statSync(path, { bigint: true });
			if (!stat.isFile()) throw new HarnessError('INVALID_INPUT', 'The SQLite path is not a file.');
			return databaseConnectionV1Schema.parse({ ...base, sqlite: { path, identity: { dev: stat.dev.toString(), ino: stat.ino.toString() } } });
		}
		if (!input.network) throw new HarnessError('INVALID_INPUT', 'A network connection needs host settings.');
		const { password: _password, ...network } = input.network;
		return databaseConnectionV1Schema.parse({ ...base, network: { ...network, secretRefId: secretRefId(id) } });
	}

	connection(id: string): DatabaseConnectionV1 | null {
		const row = this.store.get<DatabaseConnectionV1>('databaseConnection', id);
		return row ? databaseConnectionV1Schema.parse(row) : null;
	}
	connections(): DatabaseConnectionV1[] {
		return this.store.all<DatabaseConnectionV1>('databaseConnection').map(row => databaseConnectionV1Schema.parse(row));
	}
	allAttachments(): DatabaseAttachmentV1[] {
		return this.store.all<DatabaseAttachmentV1>('databaseAttachment').map(row => databaseAttachmentV1Schema.parse(row));
	}
	attachments(threadId: string): DatabaseAttachmentV1[] {
		return this.store.all<DatabaseAttachmentV1>('databaseAttachment', threadId).map(row => databaseAttachmentV1Schema.parse(row));
	}
	attachment(attachmentId: string): DatabaseAttachmentV1 | null {
		const row = this.store.get<DatabaseAttachmentV1>('databaseAttachment', attachmentId);
		return row ? databaseAttachmentV1Schema.parse(row) : null;
	}
	attachmentFor(threadId: string, attachmentId: string): { attachment: DatabaseAttachmentV1; connection: DatabaseConnectionV1 } {
		this.requireFlag();
		const attachment = this.attachment(attachmentId);
		if (!attachment || attachment.threadId !== threadId) throw new HarnessError('CAPABILITY_DENIED', 'The database attachment is unavailable on this task.');
		const connection = this.connection(attachment.connectionId);
		if (!connection) throw new HarnessError('NOT_FOUND', 'The database connection was removed.');
		return { attachment, connection };
	}
	gateway(): DatabaseGateway { return this.gatewayFactory(); }
	resolvePassword = async (refId: string): Promise<string> => {
		const secret = this.store.get<DatabaseSecret>(secretKind, refId.replace(/^dbconn:/, ''));
		if (!secret) throw new HarnessError('DATABASE_AUTH_FAILED', 'The connection credential is unavailable.');
		return secret.value;
	};

	async command(command: HostCommand): Promise<unknown> {
		this.requireFlag();
		const p = command.payload as Record<string, unknown>;
		const type = command.type;
		if (type === 'database.connection.create' || type === 'database.connection.update') {
			const input = type.endsWith('create') ? createSchema.parse(p) : updateSchema.parse(p);
			const id = type.endsWith('create') ? randomUUID() : (input as z.infer<typeof updateSchema>).id;
			const prior = type.endsWith('update') ? this.connection(id) : null;
			if (type.endsWith('update') && !prior) throw new HarnessError('NOT_FOUND', 'The database connection is unavailable.');
			const record = await this.buildConnection(id, input, prior?.createdAt ?? new Date().toISOString());
			const password = type.endsWith('create') ? input.network?.password : (input as z.infer<typeof updateSchema>).password;
			return this.store.command(command, () => {
				this.store.put('databaseConnection', id, null, record);
				if (password) this.putSecret(id, password);
				return record;
			});
		}
		if (type === 'database.connection.delete') {
			const id = z.string().uuid().parse(p.id);
			if (!this.connection(id)) throw new HarnessError('NOT_FOUND', 'The database connection is unavailable.');
			return this.store.command(command, () => {
				for (const attachment of this.store.all<DatabaseAttachmentV1>('databaseAttachment').filter(row => row.connectionId === id)) {
					this.store.remove('databaseAttachment', attachment.id);
				}
				this.store.remove('databaseConnection', id);
				this.store.remove(secretKind, id);
				void this.gatewayFactory().close(id);
				return { deleted: true };
			});
		}
		if (type === 'database.connection.test') {
			const saved = p.id !== undefined ? this.connection(z.string().uuid().parse(p.id)) : undefined;
			if (p.id !== undefined && !saved) throw new HarnessError('NOT_FOUND', 'The database connection is unavailable.');
			if (saved) return this.gatewayFactory().test(saved).then(result => ({ ok: true as const, ...result }));
			const input = createSchema.parse(p);
			const scratchId = randomUUID();
			const record = await this.buildConnection(scratchId, input, new Date().toISOString());
			if (input.network?.password) { const password = input.network.password; this.store.internal('database.test', null, () => this.store.put(secretKind, scratchId, null, { value: password })); }
			try {
				return { ok: true as const, ...await this.gatewayFactory().test(record) };
			} finally {
				this.store.internal('database.test', null, () => this.store.remove(secretKind, scratchId));
			}
		}
		if (type === 'database.attach') {
			const threadId = z.string().min(1).parse(p.threadId ?? command.threadId);
			this.requireMainThread(threadId);
			const connectionId = z.string().uuid().parse(p.connectionId);
			if (!this.connection(connectionId)) throw new HarnessError('NOT_FOUND', 'The database connection is unavailable.');
			const record: DatabaseAttachmentV1 = { id: randomUUID(), version: 1, threadId, connectionId, writable: p.writable === true, createdAt: new Date().toISOString() };
			return this.store.command(command, () => { this.store.put('databaseAttachment', record.id, threadId, record); return record; });
		}
		if (type === 'database.detach') {
			const attachment = this.attachment(z.string().uuid().parse(p.attachmentId));
			if (!attachment) throw new HarnessError('NOT_FOUND', 'The database attachment is unavailable.');
			const caller = z.string().min(1).parse(command.threadId ?? attachment.threadId);
			this.requireMainThread(caller);
			if (caller !== attachment.threadId) throw new HarnessError('CAPABILITY_DENIED', 'A task can only detach its own database attachments.');
			return this.store.command(command, () => { this.store.remove('databaseAttachment', attachment.id); return { detached: true }; });
		}
		throw new HarnessError('INVALID_INPUT', `Unknown database command: ${type}`);
	}
}
