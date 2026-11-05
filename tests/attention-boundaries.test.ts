import Fastify from 'fastify';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store.ts';
import type {Service} from '../packages/core/service.ts';
import {registerAttentionRoutes} from '../apps/server/attention-routes.ts';
import {handleDesktopControl} from '../apps/server/desktop-controls.ts';
import {shownColumns} from '../third-party/vespin/inbox-columns.ts';
import {pluginDesktopChannelAllowed} from '../apps/desktop/window-policy.ts';
import {DESKTOP_CHANNELS} from '../packages/desktop-contract/index.ts';

const cleanup:(()=>Promise<void>|void)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
describe('attention presentation and authority boundaries',()=>{
 it('retains the upstream container-based list/reader column behavior',()=>{expect(shownColumns(false,undefined)).toBe('both');expect(shownColumns(false,'item')).toBe('both');expect(shownColumns(true,undefined)).toBe('list');expect(shownColumns(true,'item')).toBe('item');});
 it('exposes only explicit read/unread/popup commands, never source approval or raw delivery claims',async()=>{const directory=mkdtempSync(join(tmpdir(),'gen-attention-http-')),store=new Store(directory),app=Fastify();cleanup.push(()=>{store.close();rmSync(directory,{recursive:true,force:true});});cleanup.push(()=>app.close());app.setErrorHandler((_error,_request,reply)=>reply.code(400).send({error:'Invalid command'}));registerAttentionRoutes(app,{store} as Service);expect((await app.inject('/api/attention')).statusCode).toBe(200);expect((await app.inject({method:'POST',url:'/api/attention/not-present/commands',payload:{id:'bad',type:'approve',approved:true}})).statusCode).toBe(400);expect((await app.inject({method:'POST',url:'/api/attention/claim',payload:{}})).statusCode).toBe(404);expect(store.all('operation')).toEqual([]);});
 it('accepts canonical notification read/open only through exact launch-token parent messages',async()=>{const token='a'.repeat(64),send=vi.fn(),attentionRead=vi.fn(async()=>({items:[],preferences:{threadNotifications:'off' as const,inAppNotifications:true,volume:.3,preview:'title' as const,quietHours:{enabled:false,start:'22:00',end:'08:00'}}})),attentionAction=vi.fn(async()=>({threadId:'canonical-thread'})),host={stopAll:vi.fn(),saveNativeLayout:vi.fn(),attentionRead,attentionAction};expect(await handleDesktopControl({type:'harness.attention.read',requestId:'read',token:'b'.repeat(64)},token,host,send)).toBe(false);expect(await handleDesktopControl({type:'harness.attention.open',requestId:'open',token,eventId:'request:a:1',threadId:'forged'},token,host,send)).toBe(false);expect(attentionAction).not.toHaveBeenCalled();expect(await handleDesktopControl({type:'harness.attention.open',requestId:'open',token,eventId:'request:a:1'},token,host,send)).toBe(true);expect(attentionAction).toHaveBeenCalledWith('open','request:a:1');expect(send).toHaveBeenCalledWith({type:'harness.attention.open.result',requestId:'open',token,threadId:'canonical-thread'});});
 it('denies attention channels to private plugin windows',()=>{expect(pluginDesktopChannelAllowed(DESKTOP_CHANNELS.attentionOpen)).toBe(false);expect(pluginDesktopChannelAllowed(DESKTOP_CHANNELS.attentionPopupAction)).toBe(false);});
});
