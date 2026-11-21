import {describe,it,expect} from 'vitest';
import {createOpenProjectDelivery,type OpenProjectEnvelope} from '../apps/desktop/open-project-delivery.ts';

describe('createOpenProjectDelivery',()=>{
 it('buffers a cold-launch request until the renderer signals readiness',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.enqueue('C:\\Projects\\App');
  expect(delivery.deliver()).toBeUndefined();
  delivery.rendererReady();
  const envelope=delivery.deliver();
  expect(envelope?.path).toBe('C:\\Projects\\App');
  expect(delivery.deliver()).toBeUndefined();
 });
 it('delivers a warm request as soon as it is queued',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.rendererReady();
  delivery.enqueue('\\\\server\\share');
  expect(delivery.deliver()).toEqual({requestId:'open-project-1',path:'\\\\server\\share'});
 });
 it('holds requests while the backend is unavailable',()=>{
  let up=false;const delivery=createOpenProjectDelivery(()=>up);
  delivery.rendererReady();delivery.enqueue('C:\\x');
  expect(delivery.deliver()).toBeUndefined();
  up=true;
  expect(delivery.deliver()?.path).toBe('C:\\x');
 });
 it('keeps only the newest pending path',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.enqueue('C:\\older');delivery.enqueue('C:\\newer');
  delivery.rendererReady();
  const envelope=delivery.deliver();
  expect(envelope?.path).toBe('C:\\newer');
  expect(delivery.deliver()).toBeUndefined();
 });
 it('serializes a newer request behind the active one until its ack',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.rendererReady();
  delivery.enqueue('C:\\first');
  const first=delivery.deliver() as OpenProjectEnvelope;
  delivery.enqueue('C:\\second');
  expect(delivery.deliver()).toBeUndefined();
  expect(delivery.acknowledge(first.requestId)).toBe('acked');
  expect(delivery.deliver()?.path).toBe('C:\\second');
 });
 it('treats stale and duplicate acknowledgements as no-ops',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.rendererReady();delivery.enqueue('C:\\a');
  const active=delivery.deliver() as OpenProjectEnvelope;
  expect(delivery.acknowledge('open-project-99')).toBe('stale');
  expect(delivery.deliver()).toBeUndefined();
  expect(delivery.acknowledge(active.requestId)).toBe('acked');
  expect(delivery.acknowledge(active.requestId)).toBe('stale');
 });
 it('ignores acknowledgements when nothing was delivered',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.enqueue('C:\\held');
  expect(delivery.acknowledge('open-project-1')).toBe('stale');
  delivery.rendererReady();
  expect(delivery.deliver()?.path).toBe('C:\\held');
 });
 it('drops an unacked active request when the handler unmounts and never replays it',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.rendererReady();delivery.enqueue('C:\\lost');
  const active=delivery.deliver() as OpenProjectEnvelope;
  delivery.rendererNotReady();
  expect(delivery.deliver()).toBeUndefined();
  expect(delivery.acknowledge(active.requestId)).toBe('stale');
  delivery.rendererReady();
  expect(delivery.deliver()).toBeUndefined();
 });
 it('keeps a pending path across a renderer reload and delivers after remount',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.enqueue('C:\\waiting');
  delivery.rendererReady();
  const first=delivery.deliver() as OpenProjectEnvelope;
  delivery.enqueue('C:\\queued');
  delivery.rendererNotReady();
  delivery.rendererReady();
  expect(delivery.deliver()?.path).toBe('C:\\queued');
  expect(delivery.acknowledge(first.requestId)).toBe('stale');
 });
 it('issues monotonically changing request ids',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.enqueue('C:\\a');delivery.enqueue('C:\\b');
  delivery.rendererReady();
  const first=delivery.deliver() as OpenProjectEnvelope;
  delivery.acknowledge(first.requestId);
  expect(delivery.deliver()).toBeUndefined();
  delivery.enqueue('C:\\c');
  const second=delivery.deliver() as OpenProjectEnvelope;
  expect(first.requestId).not.toBe(second.requestId);
 });
 it('exposes queue state for diagnostics without paths',()=>{
  const delivery=createOpenProjectDelivery(()=>true);
  delivery.enqueue('C:\\hidden');
  expect(delivery.snapshot()).toEqual({pending:'open-project-1',handlerReady:false});
  delivery.rendererReady();
  delivery.deliver();
  expect(delivery.snapshot()).toEqual({active:'open-project-1',handlerReady:true});
 });
});
