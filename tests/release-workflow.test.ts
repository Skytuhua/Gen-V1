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
  expect(workflow).toContain("if ($channel -eq 'stable' -and $isPrerelease)");
  expect(workflow.indexOf('Validate release identity')).toBeLessThan(workflow.indexOf('pnpm desktop:package'));
 });
 it('defaults dispatch and tag pushes to prerelease regardless of the version suffix',()=>{
  expect(workflow).toContain('default: prerelease');
  const push=workflow.slice(workflow.indexOf("if ($env:RELEASE_EVENT -eq 'push')"),workflow.indexOf("if ($channel -notin"));
  expect(push).toContain("$channel = 'prerelease'");
  expect(push).not.toContain('$isPrerelease');
  expect(workflow).not.toContain("($channel -eq 'prerelease') -ne $isPrerelease");
  expect(workflow).not.toContain('Prerelease channel requires a semver prerelease version');
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
 it('checks lightweight and peeled annotated tags before either release upload or creation',()=>{
  expect(workflow).toContain('git ls-remote --tags "https://github.com/$repo.git" $tagRef ($tagRef + \'^{}\')');
  expect(workflow).toContain("if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing release tag' }");
  expect(workflow).toContain('if ($tagRefs.Count -gt 0)');
  expect(workflow).toContain("-ceq ($tagRef + '^{}')");
  expect(workflow).toContain('if ($tagCommit.Count -eq 0)');
  expect(workflow).toContain("-ceq $tagRef");
  expect(workflow).toContain("$tagCommit.Count -ne 1 -or ($tagCommit[0] -split '\\s+')[0] -cne $env:RELEASE_SHA");
  const guard=workflow.indexOf('Existing release tag does not point to RELEASE_SHA');
  expect(guard).toBeGreaterThan(-1);
  expect(guard).toBeLessThan(workflow.indexOf('gh release upload'));
  expect(guard).toBeLessThan(workflow.indexOf("$createArgs ="));
 });
 it('resolves an existing draft target as a commit and fails closed without retargeting',()=>{
  expect(workflow).toContain('[string]::IsNullOrWhiteSpace($existing[0].target_commitish)');
  expect(workflow).toContain('[Uri]::EscapeDataString($existing[0].target_commitish)');
  expect(workflow).toContain('gh api "repos/$repo/commits/$targetRef" --jq \'.sha\'');
  expect(workflow).toContain("if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve existing draft target_commitish' }");
  expect(workflow).toContain('if ($targetSha -cne $env:RELEASE_SHA)');
  expect(workflow.indexOf('Existing draft target_commitish does not resolve to RELEASE_SHA')).toBeLessThan(workflow.indexOf('gh release upload'));
  expect(workflow).not.toMatch(/gh release edit|git update-ref|git push/);
 });
});
