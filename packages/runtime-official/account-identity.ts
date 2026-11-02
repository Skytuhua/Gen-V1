import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk';
import type { AccountIdentity } from '../contracts/authentication.ts';
import { HarnessError } from '../contracts/index.ts';
import { officialRuntimeHome } from './environment.ts';
import { secureDirectory, within } from './manifest.ts';

type Provider = 'cursor-sdk' | 'claude-code';
const field = (value: unknown): string | null => typeof value === 'string' && value.trim() && value.length <= 320 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
const mismatch = () => new HarnessError('ACCOUNT_IDENTITY_MISMATCH', 'The authenticated account differs from this private profile. Keep the existing connection and add another local account for a different sign-in.');
const path = (dataDir: string, provider: Provider) => join(officialRuntimeHome(dataDir, provider), 'harness-account-identity.json');

export function cursorIdentity(value: { userId?: number; userEmail?: string }): AccountIdentity {
  if (!Number.isSafeInteger(value.userId) || value.userId! <= 0) throw new HarnessError('OFFICIAL_SUBSCRIPTION_REQUIRED', 'Cursor did not supply an authenticated user identity.');
  return { availability: 'verified', subject: String(value.userId), email: field(value.userEmail), organization: null, subscription: null };
}
/** Email and organization are authenticated metadata, never an immutable subject. */
export function claudeIdentity(value: AccountInfo): AccountIdentity {
  return { availability: field(value.email) ? 'metadata' : 'unavailable', subject: null, email: field(value.email), organization: field(value.organization), subscription: field(value.subscriptionType) };
}
export async function readOfficialIdentity(dataDir: string, provider: Provider): Promise<AccountIdentity | null> {
  const file = path(dataDir, provider);
  try {
    const info = await lstat(file, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.size > 4096n || !within(await realpath(resolve(dataDir)), await realpath(file))) throw mismatch();
    const value = JSON.parse(await readFile(file, 'utf8')) as AccountIdentity;
    if (!value || !['verified', 'metadata'].includes(value.availability) || (provider === 'cursor-sdk' ? value.availability !== 'verified' || typeof value.subject !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value.subject) : value.subject !== null || !field(value.email))) throw mismatch();
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export function assertSameIdentity(previous: AccountIdentity | null, current: AccountIdentity): void {
  if (!previous) return;
  if (previous.availability === 'verified') { if (current.availability !== 'verified' || previous.subject !== current.subject) throw mismatch(); }
  else if (!current.email || previous.email?.toLowerCase() !== current.email.toLowerCase() || previous.organization !== current.organization) throw mismatch();
}
export async function bindOfficialIdentity(dataDir: string, provider: Provider, identity: AccountIdentity): Promise<void> {
  const previous = await readOfficialIdentity(dataDir, provider); assertSameIdentity(previous, identity);
  if (identity.availability === 'unavailable' || previous) return;
  const file = path(dataDir, provider); await secureDirectory(dataDir, dirname(file));
  try { await writeFile(file, JSON.stringify(identity), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; assertSameIdentity(await readOfficialIdentity(dataDir, provider), identity); }
}
