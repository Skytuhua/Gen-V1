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
 it('gates the read-only build before repo code and isolates write permission in publish',()=>{
  const build=workflow.slice(workflow.indexOf('  build:'),workflow.indexOf('  publish:'));
  const publish=workflow.slice(workflow.indexOf('  publish:'));
  expect(build).toContain("if: ${{ (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')) }}");
  expect(workflow).not.toContain('inputs.ref');
  expect(workflow).not.toMatch(/^      ref:$/m);
  expect(build).toContain('ref: ${{ github.sha }}');
  expect(build).toContain('    permissions:\n      contents: read');
  expect(build).not.toContain('contents: write');
  expect(workflow.match(/contents: write/g)).toHaveLength(1);
  expect(publish).toContain('needs: build');
  expect(publish).not.toMatch(/checkout|\.github\/actions\/setup|pnpm|node |git /);
  expect(publish).toContain('gh api @Arguments');
  expect(publish).not.toContain('gh release');
 });
 it('transfers only assets and metadata through SHA-pinned artifact actions and cross-checks identity',()=>{
  expect(workflow).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  expect(workflow).toContain('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
  expect(workflow).toContain("($installer + '.blockmap'), $feed, 'build-manifest.json'");
  expect(workflow).toContain('release-metadata.json');
  for(const field of ['tag','sha','channel','version']){
   expect(workflow).toContain('steps.release.outputs.'+field);
   expect(workflow).toContain('needs.build.outputs.'+field);
   expect(workflow).toContain('$metadata.'+field+' -cne $env:RELEASE_'+field.toUpperCase());
  }
  expect(workflow).toContain('Release metadata does not match build outputs');
  expect(workflow).toContain('Invalid release asset name');
  expect(workflow.indexOf('Invalid release asset name')).toBeLessThan(workflow.indexOf('https://uploads.github.com/'));
  expect(workflow).toContain('[Uri]::EscapeDataString($name)');
 });
 it('checks existing lightweight and annotated tags and resolves draft commitish before uploads',()=>{
  expect(workflow).toContain('git/matching-refs/tags/$encodedTag');
  expect(workflow).toContain('Where-Object { $_.ref -ceq $tagRef }');
  expect(workflow).toContain("while ($object.type -eq 'tag')");
  expect(workflow).toContain('git/tags/$($object.sha)');
  expect(workflow).toContain("$object.type -ne 'commit' -or $object.sha -cne $env:RELEASE_SHA");
  expect(workflow).toContain("if (-not $draft.draft) { throw 'Refusing to modify a published release' }");
  expect(workflow).toContain('[Uri]::EscapeDataString($draft.target_commitish)');
  expect(workflow).toContain("if ($refs.Count -eq 0 -and $draft.target_commitish -cne $env:RELEASE_SHA)");
  expect(workflow).toContain('Existing draft without a tag must target the full RELEASE_SHA exactly');
  expect(workflow).toContain('repos/$repo/commits/$targetRef');
  expect(workflow).toContain('if ($target.sha -cne $env:RELEASE_SHA)');
  for(const error of ['Existing release tag does not point to RELEASE_SHA','Existing draft target_commitish does not resolve to RELEASE_SHA']){
   expect(workflow.indexOf(error)).toBeGreaterThan(-1);
   expect(workflow.indexOf(error)).toBeLessThan(workflow.indexOf('https://uploads.github.com/'));
  }
 });
 it('fails closed on API errors or nonempty drafts and never overwrites or retargets',()=>{
  expect(workflow).toContain("if ($LASTEXITCODE -ne 0) { throw 'GitHub API request failed; refusing to continue' }");
  expect(workflow).toContain("if ($assets.Count -ne 0) { throw 'Existing draft has assets; delete the draft before retrying.");
  expect(workflow).toContain('target_commitish=$env:RELEASE_SHA; draft=$true; prerelease=');
  expect(workflow).toContain("Invoke-GitHubJson -Arguments @('-X', 'POST', \"repos/$repo/releases\", '--input', $body)");
  expect(workflow).toContain('https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=$encodedName');
  expect(workflow).toContain("'Content-Type: application/octet-stream', '--input', $file");
  expect(workflow).not.toMatch(/--clobber|gh release|git (?:tag|push|update-ref)|['"](?:DELETE|PATCH)['"]/);
  expect(readFileSync(new URL('../scripts/package-desktop.ts',import.meta.url),'utf8')).toContain("publish:'never' as const");
 });
 it('gates signing secrets behind the windows-signing environment on the read-only build job',()=>{
  const build=workflow.slice(workflow.indexOf('  build:'),workflow.indexOf('  publish:'));
  expect(build).toContain('environment: windows-signing');
  expect(build.indexOf('environment: windows-signing')).toBeLessThan(build.indexOf('pnpm desktop:package'));
 });
 it('passes the Azure signing contract to the packaging step only',()=>{
  const build=workflow.slice(workflow.indexOf('  build:'),workflow.indexOf('  publish:'));
  const pack=build.slice(build.indexOf('- name: Package the production Windows installer'),build.indexOf('- name: Verify Authenticode signatures'));
  expect(pack).toContain('HARNESS_WINDOWS_SIGNING: azure');
  for(const ref of ['secrets.AZURE_CLIENT_SECRET','secrets.AZURE_CLIENT_ID','secrets.AZURE_TENANT_ID','vars.HARNESS_AZURE_SIGNING_ENDPOINT','vars.HARNESS_AZURE_SIGNING_ACCOUNT','vars.HARNESS_AZURE_SIGNING_PROFILE','vars.HARNESS_WINDOWS_PUBLISHER_NAME'])expect(pack).toContain(ref);
 });
 it('keeps signing credentials out of the publish job',()=>{
  const publish=workflow.slice(workflow.indexOf('  publish:'));
  expect(publish).not.toMatch(/AZURE_|HARNESS_AZURE/);
 });
 it('verifies Authenticode signatures and feed checksums after packaging and before staging',()=>{
  expect(workflow.indexOf('- name: Verify Authenticode signatures and feed checksums')).toBeGreaterThan(workflow.indexOf('- name: Package the production Windows installer'));
  expect(workflow.indexOf('- name: Verify Authenticode signatures and feed checksums')).toBeLessThan(workflow.indexOf('- name: Stage release assets'));
  const verify=workflow.slice(workflow.indexOf('- name: Verify Authenticode signatures'),workflow.indexOf('- name: Stage release assets'));
  expect(verify).toContain('Get-AuthenticodeSignature');
  expect(verify).toContain("'Valid'");
  expect(verify).toContain('TimeStamperCertificate');
  expect(verify).toContain('sha512');
  expect(verify).toContain('Feed checksum does not match the signed installer');
  expect(verify).toContain('vars.HARNESS_WINDOWS_PUBLISHER_NAME');
 });
 it('retires the unsigned signing placeholder',()=>{
  expect(workflow).not.toContain('Signing hook (unsigned placeholder)');
  expect(workflow).not.toMatch(/WINDOWS_CSC/);
 });
 it('re-checks draft state before each upload and after the last upload',()=>{
  expect(workflow).toContain('$state = Invoke-GitHubJson -Arguments @("repos/$repo/releases/$releaseId")');
  expect(workflow).toContain("if ($state.draft -ne $true) { throw 'Release is no longer a draft; refusing further uploads' }");
  expect(workflow).toContain('foreach ($name in $names) {\n            Assert-Draft');
  expect(workflow.trimEnd()).toMatch(/}\n          Assert-Draft$/);
 });
});
