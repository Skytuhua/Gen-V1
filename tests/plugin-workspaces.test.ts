import {describe,expect,it} from 'vitest';
import {pluginManifestSchema,pluginWorkspaceContributionSchema} from '../packages/plugins/contracts.ts';
import {pluginFrameSource} from '../packages/plugins/frame-protocol.ts';

const manifest={id:'sample-plugin',name:'Sample',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.4 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/index.mjs'};
const workspace={id:'overview',title:'Overview',icon:'network',entryView:'overview-map',defaultLayout:'overview'};
describe('installed plug-in workspace contributions',()=>{
  it('preserves old manifests and validates additive bounded metadata',()=>{
    expect(pluginManifestSchema.parse(manifest).workspaces).toBeUndefined();
    expect(pluginManifestSchema.parse({...manifest,workspaces:[workspace]}).workspaces).toEqual([workspace]);
    expect(()=>pluginManifestSchema.parse({...manifest,workspaces:[workspace,workspace]})).toThrow();
    expect(()=>pluginWorkspaceContributionSchema.parse({...workspace,entryView:'https://example.com'})).toThrow();
    expect(()=>pluginWorkspaceContributionSchema.parse({...workspace,authority:{kind:'local'}})).toThrow();
  });
  it('constructs a fixed scoped workspace frame without arbitrary URLs or native authority',()=>{
    expect(pluginFrameSource('sample-plugin','session-123','dark',undefined,workspace)).toBe('/plugins/sample-plugin/frame?session=session-123&theme=dark&workspace=overview&view=overview-map');
    expect(()=>pluginFrameSource('sample-plugin','session-123','dark',{scopeId:'scope',surfaceId:'surface'},workspace)).toThrow();
    expect(()=>pluginFrameSource('sample-plugin','session-123','dark',undefined,{...workspace,id:'../personal'})).toThrow();
  });
});
