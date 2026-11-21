import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const requirements = 'third-party/hermes-agent/runtime-requirements';

it('hash-pins the entire existing Hermes runtime closure without changing versions', () => {
 const original = read(requirements + '.txt').split('\n').filter(line => line && !line.startsWith('#'));
 const hashed = read(requirements + '-hashed.txt').replace(/\\\r?\n/g, '').split('\n').filter(line => line && !line.startsWith('#'));
 expect(hashed.map(line => line.split(/\s+/)[0])).toEqual(original);
 for (const line of hashed) expect(line).toMatch(/^[A-Za-z0-9._-]+==[0-9][^\s]*\s+(?:--hash=sha256:[a-f0-9]{64}\s*)+$/);
 const action = read('.github/actions/setup/action.yml');
 expect(action).toContain('python -m pip install --disable-pip-version-check --no-warn-script-location --require-hashes --target .harness-hermes-python-deps -r ' + requirements + '-hashed.txt');
 expect(action).toContain("hashFiles('" + requirements + ".txt', '" + requirements + "-hashed.txt', 'third-party/integrations/PYTHON_LOCK.json')");
});

it('keeps the upgraded SoupSieve inventory and integration byte total consistent', () => {
 const lock = JSON.parse(read('third-party/integrations/PYTHON_LOCK.json'));
 expect(lock.python).toBe('3.14');
 const soup = lock.distributions.find((item: {name: string}) => item.name === 'soupsieve');
 expect(soup.version).toBe('4.1.2');
 expect(soup.sourceUrl).toMatch(/\/soupsieve-4\.1\.2-py3-none-any\.whl$/);
 expect(soup.wheelSha256).toBe('96b4115212a3abee1f572d62da706cca090b088cb5effa278db5702122e63a2c');
 expect(lock.files.some((file: {path: string}) => file.path.includes('soupsieve-3.0.4'))).toBe(false);
 expect(lock.files.some((file: {path: string}) => file.path.endsWith('/soupsieve-4.1.2.dist-info/METADATA'))).toBe(true);
 expect(lock.files.reduce((total: number, file: {bytes: number}) => total + file.bytes, 0)).toBe(lock.bytes);
});
