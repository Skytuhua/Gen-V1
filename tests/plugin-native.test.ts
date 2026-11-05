import {expect,it} from 'vitest';
import {desktopSurfaceKey,parseDesktopSurface} from '../packages/desktop-contract';
import {pluginDesktopChannelAllowed,needsEditorHandoff,nativeTitlebarOptions,nativeTitlebarTheme,requireExistingDetachedSurface,trustedDesktopSubframe} from '../apps/desktop/window-policy.ts';
import {pluginFrameSource} from '../packages/plugins/frame-protocol.ts';
it('permits only canonical plug-in documents and the explicit generated-widget destination in native subframes',()=>{
 const origin='http://127.0.0.1:4317',widget='http://localhost:4318',frame=new URL(pluginFrameSource('sample-plugin','session','dark'),origin).href;
 expect(trustedDesktopSubframe(frame,origin,widget)).toBe(true);
 expect(trustedDesktopSubframe(new URL(pluginFrameSource('sample-plugin','fresh-session','light',{scopeId:'project',surfaceId:'plan',resourceId:'order'}),origin).href,origin,widget)).toBe(true);
 expect(trustedDesktopSubframe(widget+'/widget/artifact-id/1?ticket=one#token=two&mountId=three',origin,widget)).toBe(true);
 for(const raw of ['https://outside.invalid/',origin+'/unreviewed.html',origin+'/',origin+'/plugins/sample-plugin/frontend/index.html',frame+'&session=duplicate',frame+'&url=https://outside.invalid/',frame+'#replacement',frame.replace('theme=dark','theme=invalid'),'data:text/html,untrusted','about:blank',widget+'/',widget+'/widget/artifact-id/0','http://127.0.0.1:4318/widget/artifact-id/1','http://user@localhost:4318/widget/artifact-id/1'])expect(trustedDesktopSubframe(raw,origin,widget),raw).toBe(false);
});
it('retains plugin, scope, surface and resource in native custody',()=>{
 const surface={kind:'plugin',pluginId:'example-plugin',scopeId:'project-a',surfaceId:'plan',resourceId:'order-a'} as const;
 expect(parseDesktopSurface(surface)).toEqual(surface);expect(desktopSurfaceKey(surface)).toBe('plugin|example-plugin|project-a|plan|order-a');
 expect(()=>parseDesktopSurface({...surface,threadId:'personal'})).toThrow();
 expect(()=>parseDesktopSurface({...surface,url:'http://127.0.0.1:4317'})).toThrow();
 expect(needsEditorHandoff(surface,{kind:'main'})).toBe(true);expect(needsEditorHandoff(surface,{...surface,scopeId:'other-project'})).toBe(false);
});
it('denies personal account, browser and layout IPC from plugin windows',()=>{
 expect(pluginDesktopChannelAllowed('harness-desktop:context')).toBe(true);
 for(const suffix of ['sign-in','browser','apply-layout','capture-layout','update'])expect(pluginDesktopChannelAllowed('harness-desktop:'+suffix)).toBe(false);
});
it('uses real Windows titlebar overlays and accepts only a bounded theme',()=>{
 expect(nativeTitlebarOptions('win32')).toMatchObject({titleBarStyle:'hidden',titleBarOverlay:{height:42}});expect(nativeTitlebarOptions('linux')).toEqual({});
 expect(nativeTitlebarTheme('light')).toEqual({color:'#ffffff',symbolColor:'#1f1f1f',height:42});expect(()=>nativeTitlebarTheme('url(secret)')).toThrow();
});
it('denies new detached editors while preserving exact existing child recovery',()=>{
 const existing={kind:'plugin',pluginId:'example-plugin',scopeId:'project',surfaceId:'plan',resourceId:'order'} as const;
 expect(()=>requireExistingDetachedSurface(existing,[existing])).not.toThrow();
 expect(()=>requireExistingDetachedSurface({...existing,resourceId:'other'},[existing])).toThrow(/unavailable/);
 expect(()=>requireExistingDetachedSurface({kind:'thread',threadId:'new'},[existing])).toThrow(/unavailable/);
 expect(existing.resourceId).toBe('order');
});
