import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {DesktopBrowserDock,DesktopBrowserToolbar} from '../apps/web/src/DesktopBrowser';
import type {DesktopBrowserState} from '../packages/desktop-contract';

const state:DesktopBrowserState={url:'https://reading.example/one',title:'Synthetic reading page',canGoBack:false,canGoForward:false,loading:false};

it('keeps the native page error visible independently of toolbar action state',()=>{
 const html=renderToStaticMarkup(createElement(DesktopBrowserToolbar,{state:{...state,error:'Synthetic native page failure'}}));
 expect(html).toContain('role="alert"');expect(html).toContain('Synthetic native page failure');expect(html).toContain('value="https://reading.example/one"');
});

it('renders the native reading title and loading controls without creating a browser',()=>{
 const html=renderToStaticMarkup(createElement(DesktopBrowserToolbar,{state:{...state,loading:true}}));
 expect(html).toContain('<strong>Synthetic reading page</strong>');expect(html).toContain('aria-label="Stop browser loading"');expect(html).not.toContain('role="alert"');expect(html).not.toMatch(/<iframe|<webview/);
});

it('leaves the dock absent and toolbar address empty without a native provider',()=>{
 expect(renderToStaticMarkup(createElement(DesktopBrowserDock))).toBe('');
 const html=renderToStaticMarkup(createElement(DesktopBrowserToolbar));
 expect(html).toContain('<strong>Browser</strong>');expect(html).toContain('value=""');expect(html).not.toContain('role="alert"');
});
