import {describe, expect, it} from 'vitest';
import {parsePluginFrameRequest, pluginFrameSource, pluginFrameReply} from '../packages/plugins/frame-protocol.ts';

describe('isolated plugin frame protocol', () => {
  it('accepts only bounded requests bound to this plugin and frame session', () => {
    const input = {type:'gen.plugin.request',session:'session-123',id:'request-1',pluginId:'sample-plugin',operation:'conversation.load',input:{scopeId:'project-a'}};
    expect(parsePluginFrameRequest(input,'sample-plugin','session-123')).toEqual(input);
    expect(parsePluginFrameRequest({...input,pluginId:'another-plugin'},'sample-plugin','session-123')).toBeNull();
    expect(parsePluginFrameRequest({...input,session:'old-session'},'sample-plugin','session-123')).toBeNull();
    expect(parsePluginFrameRequest({...input,operation:'../commands'},'sample-plugin','session-123')).toBeNull();
    expect(parsePluginFrameRequest({...input,token:'credential'},'sample-plugin','session-123')).toBeNull();
    expect(parsePluginFrameRequest({...input,input:'x'.repeat(1024*1024+1)},'sample-plugin','session-123')).toBeNull();
  });

  it('constructs a fixed local frame route without renderer URLs', () => {
    expect(pluginFrameSource('sample-plugin','session-123','dark')).toBe('/plugins/sample-plugin/frame?session=session-123&theme=dark');
    expect(()=>pluginFrameSource('../personal','session-123','dark')).toThrow();
    expect(pluginFrameSource('a'.repeat(65),'session-123','dark')).toContain('/plugins/'+'a'.repeat(65)+'/frame');
  });

  it('returns bounded sanitized failures without leaking host errors', () => {
    expect(pluginFrameReply('request-1',null,Error('Bearer private-token'))).toEqual({type:'gen.plugin.reply',id:'request-1',ok:false,error:'This plug-in request could not complete. Your saved work is retained.'});
  });
});
