import { describe, expect, it } from 'vitest';
import {
	AGENT_FILE_POLICY_DEFAULTS,
	agentFileRuleSchema,
	agentFilePolicySchema,
	parseAgentFilePolicyRules,
} from '../packages/contracts/agent-file-policy.ts';
import { compileFilePolicy, filePolicyDenies } from '../packages/core/file-policy.ts';

describe('agent-file-policy defaults', () => {
	const matcher = compileFilePolicy(AGENT_FILE_POLICY_DEFAULTS);
	it('blocks shipped secret names anywhere under the root', () => {
		for (const path of ['.env', 'app/.env', '.env.local', 'a/b/certs/tls.pem', 'x/id_rsa', 'y/id_ed25519', 'deploy/api.key'])
			expect(matcher.deniesPath(path), path).toBe(true);
	});
	it('intentionally blocks .env.example', () => {
		expect(matcher.deniesPath('.env.example')).toBe(true);
	});
	it('handles secrets directories at any depth only via **', () => {
		expect(matcher.deniesPath('secrets/config.json')).toBe(true);
		expect(matcher.deniesPath('a/secrets/config.json')).toBe(true);
		expect(compileFilePolicy(['secrets/**']).deniesPath('a/secrets/b.txt')).toBe(false);
	});
	it('keeps ordinary siblings readable', () => {
		for (const path of ['src/app.ts', 'README.md', 'envelope.json', 'env/config.ts', 'keys.txt'])
			expect(matcher.deniesPath(path), path).toBe(false);
	});
});

describe('rule matching semantics', () => {
	it('matches basename rules against the final segment only', () => {
		const m = compileFilePolicy(['*.log']);
		expect(m.deniesPath('deep/dir/app.log')).toBe(true);
		expect(m.deniesPath('log/app.ts')).toBe(false);
	});
	it('matches path rules against the full root-relative path', () => {
		const m = compileFilePolicy(['config/private.json', 'a/*/b.txt', 'x/**/y.ts']);
		expect(m.deniesPath('config/private.json')).toBe(true);
		expect(m.deniesPath('other/config/private.json')).toBe(false);
		expect(m.deniesPath('a/mid/b.txt')).toBe(true);
		expect(m.deniesPath('x/y.ts')).toBe(true);
		expect(m.deniesPath('x/p/q/y.ts')).toBe(true);
		expect(m.deniesPath('x/p/q/z.ts')).toBe(false);
	});
	it('supports ? as a single character', () => {
		const m = compileFilePolicy(['.env.?']);
		expect(m.deniesPath('.env.1')).toBe(true);
		expect(m.deniesPath('.env.12')).toBe(false);
	});
	it('folds case locale-independently and normalizes NFC', () => {
		const m = compileFilePolicy(['.ENV']);
		expect(m.deniesPath('Src/.env')).toBe(true);
		expect(compileFilePolicy(['Sécret/**'.normalize('NFD')]).deniesPath('sécret/x'.normalize('NFC'))).toBe(true);
	});
	it('requires whole-segment ** and complete matches', () => {
		const m = compileFilePolicy(['sec**ts']);
		expect(m.deniesPath('secxts')).toBe(true);
		expect(m.deniesPath('a/secretss')).toBe(false);
	});
});

describe('grammar rejection', () => {
	const bad = ['/etc/passwd', 'C:\\win\\k', '..\\up', 'src/../x', 'a//b', 'a/', '!not', '{a,b}', '[ab].ts', '#comment', '  spaced', ''];
	for (const rule of bad) it(`rejects ${JSON.stringify(rule)}`, () => {
		expect(agentFileRuleSchema.safeParse(rule).success).toBe(false);
	});
	it('rejects over-long rules and oversized rule sets', () => {
		expect(agentFileRuleSchema.safeParse('a'.repeat(257)).success).toBe(false);
		expect(agentFilePolicySchema.safeParse({ revision: 0, rules: Array(101).fill('x') }).success).toBe(false);
	});
	it('parses editor text with blank lines, duplicates and line-numbered errors', () => {
		const { rules, errors } = parseAgentFilePolicyRules('.env\n\n.env\n/etc/x\n*.pem\n');
		expect(rules).toEqual(['.env', '*.pem']);
		expect(errors).toEqual([{ line: 4, message: 'Rules are relative to the project root.' }]);
	});
});

describe('union and edge cases', () => {
	it('denies when any applicable scope matches', () => {
		const global = compileFilePolicy(['*.key']);
		const project = compileFilePolicy(['confidential/**']);
		expect(filePolicyDenies([global, project], 'confidential/x')).toBe(true);
		expect(filePolicyDenies([global, project], 'a/k.key')).toBe(true);
		expect(filePolicyDenies([global, project], 'a/k.txt')).toBe(false);
	});
	it('empty policy allows everything', () => {
		expect(filePolicyDenies([compileFilePolicy([])], '.env')).toBe(false);
		expect(compileFilePolicy([]).size).toBe(0);
	});
	it('invalid persisted rules cannot inject matchers', () => {
		const m = compileFilePolicy(['!hax', 'also*.fine']);
		expect(m.size).toBe(1);
		expect(m.deniesPath('also1.fine')).toBe(true);
	});
});
