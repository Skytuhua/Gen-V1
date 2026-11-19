import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const workflow=readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');
const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');
const staging=(value:string)=>value.slice(value.indexOf('      - name: Stage pinned integration wheels'),value.indexOf('      - name: Package the production Windows installer'));

describe('draft desktop release workflow',()=>{
 it('retains the installed-memory job staging steps verbatim',()=>{
  expect(staging(workflow)).toBe(staging(ci));
 });
 it('pins checkout without persisting credentials and limits write permission to the job',()=>{
  expect(workflow).toContain('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
  expect(workflow).toContain('persist-credentials: false');
  expect(workflow).toContain('permissions:\n  contents: read');
  expect(workflow).toContain('    permissions:\n      contents: write');
  expect(workflow).toContain("python: 'true'");
 });
 it('validates tag, canonical semver and channel before building',()=>{
  expect(workflow).toContain("tags: ['v*']");
  expect(workflow).toContain('options: [stable, prerelease]');
  expect(workflow).toContain('semver.valid(process.env.RELEASE_VERSION) !== process.env.RELEASE_VERSION');
  expect(workflow).toContain("$env:RELEASE_REF -cne $tag");
  expect(workflow).toContain("($channel -eq 'prerelease') -ne $isPrerelease");
  expect(workflow.indexOf('Validate release identity')).toBeLessThan(workflow.indexOf('pnpm desktop:package'));
 });
 it('requires all four artifacts and refuses published, ambiguous or channel-mismatched releases',()=>{
  expect(workflow).toContain("($installer + '.blockmap'), $feed, 'build-manifest.json'");
  expect(workflow).toContain('Missing release artifact:');
  expect(workflow).toContain("if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing releases' }");
  expect(workflow).toContain("if ($existing.Count -gt 1) { throw 'Ambiguous existing release' }");
  expect(workflow).toContain("if (-not $existing[0].draft) { throw 'Refusing to modify a published release' }");
  expect(workflow).toContain("throw 'Existing draft channel mismatch'");
  expect(workflow.indexOf('Refusing to modify a published release')).toBeLessThan(workflow.indexOf('gh release upload'));
  expect(workflow).toContain('gh release upload $env:RELEASE_TAG @assets --clobber --repo $repo');
  expect(workflow).toContain("'--draft', '--repo', $repo, '--target', $env:RELEASE_SHA");
  expect(workflow).toContain("$createArgs += '--prerelease'");
  expect(workflow).toContain("$repo = 'skytuhua-org/Gen-V1'");
  expect(workflow).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
  expect(workflow).not.toMatch(/git (?:tag|push)|gh release (?:edit|delete)/);
  expect(readFileSync(new URL('../scripts/package-desktop.ts',import.meta.url),'utf8')).toContain("publish:'never' as const");
 });
});
