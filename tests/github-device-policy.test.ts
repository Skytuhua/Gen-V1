import {expect,it,vi} from 'vitest';
import {GITHUB_DEVICE_URL,githubDevicePopup} from '../apps/desktop/github-device-policy.ts';
import type {DesktopSurface} from '../packages/desktop-contract/index.ts';
const appUrl='http://127.0.0.1:4317/?desktopWindow=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source={surface:{kind:'main'} as DesktopSurface,expectedUrl:appUrl,currentUrl:appUrl},popup={url:GITHUB_DEVICE_URL,referrer:{url:appUrl}};
it.each<DesktopSurface>([{kind:'main'},{kind:'thread',threadId:'thread'},{kind:'workspace',tab:'pull-request'},{kind:'workspace',tab:'linked-pull-requests'}])('opens the fixed device page from eligible app surface %j and denies the popup',surface=>{
 const open=vi.fn();expect(githubDevicePopup(popup,{...source,surface},open)).toEqual({action:'deny'});expect(open).toHaveBeenCalledExactlyOnceWith();
});
it.each([
 'https://github.com/login/device/','https://github.com/login/device?','https://github.com/login/device?code=ABCD','https://github.com/login/device#','https://github.com/login/device#code',
 'https://user@github.com/login/device','https://user:password@github.com/login/device','https://github.com:443/login/device','https://github.com:444/login/device','https://github.com./login/device',
 'https://github.com.evil.example/login/device','https://g?thub.com/login/device','https://github.com/login/%64evice','https://github.com/login/../login/device','https://github.com//login/device',
 'http://github.com/login/device','HTTPS://github.com/login/device','https://GitHub.com/login/device',' https://github.com/login/device','https://github.com/login/device\n','https://github.com/login/device\\',
 'javascript:alert(1)','file:///login/device','https://github.com/login/oauth/authorize','https://evil.example/',
])('denies nonliteral device destination %s',url=>{
 const open=vi.fn();expect(githubDevicePopup({...popup,url},source,open)).toEqual({action:'deny'});expect(open).not.toHaveBeenCalled();
});
it.each<DesktopSurface>([{kind:'browser',browserId:'browser'},{kind:'plugin',pluginId:'company',scopeId:'company',surfaceId:'workspace'},{kind:'artifact',threadId:'thread',artifactId:'artifact'},{kind:'workspace',tab:'files'},{kind:'plan',threadId:'thread'},{kind:'usage',threadId:'thread'},{kind:'agent',threadId:'thread',agentId:'child'},{kind:'navigation'}])('denies ineligible native surface %j',surface=>{
 const open=vi.fn();expect(githubDevicePopup(popup,{...source,surface},open)).toEqual({action:'deny'});expect(open).not.toHaveBeenCalled();
});
it.each(['','about:blank','https://evil.example/','http://127.0.0.1:4317/plugins/company/frame','http://127.0.0.1:4317/?desktopWindow=another','http://127.0.0.1:4317/?desktopWindow=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#spoof'])('denies a popup without the exact initiating first-party app URL: %s',url=>{
 const open=vi.fn();expect(githubDevicePopup({...popup,referrer:{url}},source,open)).toEqual({action:'deny'});expect(open).not.toHaveBeenCalled();
});
it('refuses a navigated app renderer even with the original referrer',()=>{
 const open=vi.fn();expect(githubDevicePopup(popup,{...source,currentUrl:'https://evil.example/'},open)).toEqual({action:'deny'});expect(open).not.toHaveBeenCalled();
});
it('denies popups even when the injected fixed opener throws or rejects',async()=>{
 expect(githubDevicePopup(popup,source,()=>{throw Error('OS refused');})).toEqual({action:'deny'});
 expect(githubDevicePopup(popup,source,()=>Promise.reject(Error('OS refused')))).toEqual({action:'deny'});await Promise.resolve();
});

it.each(['','about:blank','file:///startup.html','http://127.0.0.1:4317/plugins/company/frame','http://127.0.0.1:4317/notification','https://evil.example/?desktopWindow=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])('refuses a non-app source even if all source URL fields match: %s',url=>{
 const open=vi.fn();expect(githubDevicePopup({...popup,referrer:{url}},{...source,expectedUrl:url,currentUrl:url},open)).toEqual({action:'deny'});expect(open).not.toHaveBeenCalled();
});
