import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';

const spec: TaskSpec = { root: 'root', elements: {
  root: { type: 'Stack', props: { gap: 'sm' }, children: ['question', 'status'] },
  question: { type: 'Disclosure', props: { title: 'What should I bring?', stateKey: 'open', dataBinding: 'answer' }, children: ['note'] },
  note: { type: 'Input', props: { stateKey: 'note', label: 'Visit note' } },
  status: { type: 'Status', props: { dataBinding: 'status' } },
} };

async function fixture(page: Page, followupsPending = false) {
  const value = taskFixture(structuredClone(spec), { answer: { status: 'ready', answer: 'Bring a photo ID.', followupsPending }, status: { status: 'neutral', label: 'Ready for review' } }, { open: true, note: 'Keep this draft' });
  const host = await serveTaskFixture(page, value); await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Visit note' })).toBeVisible();
  await page.locator('.disclosure-node').first().evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  return host;
}

async function captureClose(page: Page) {
  await page.evaluate(() => {
    const region = document.querySelector('.disclosure-node .task-motion-region') as HTMLElement;
    const samples: { height: number; visibility: string; inert: boolean; phase?: string; declared: string; reduced: boolean }[] = [];
    const completed = new Promise<typeof samples>(resolve => {
      const observer = new MutationObserver(() => {
        if (region.dataset.open !== 'false') return;
        observer.disconnect(); const started = performance.now();
        const sample = () => {
          samples.push({ height: region.getBoundingClientRect().height, visibility: getComputedStyle(region.firstElementChild!).visibility, inert: region.inert, phase: region.dataset.motionPhase, declared: region.style.height, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches });
          if (performance.now() - started < 370) requestAnimationFrame(sample); else resolve(samples);
        };
        sample();
      });
      observer.observe(region, { attributes: true });
    });
    Object.assign(window, { closeSamples: completed });
  });
}

test('closing an answer retains visible outgoing pixels while immediately making its controls inert', async ({ page }) => {
  await fixture(page); await captureClose(page);
  await page.getByRole('button', { name: 'What should I bring?', exact: true }).click();
  const samples = await page.evaluate(() => (window as unknown as { closeSamples: Promise<{ height: number; visibility: string; inert: boolean }[]> }).closeSamples);
  expect(samples[0].height).toBeGreaterThan(5);
  expect(samples[0].inert).toBe(true);
  expect(samples.filter(sample => sample.height > 2).every(sample => sample.visibility === 'visible')).toBe(true);
  expect(samples.at(-1)!.height).toBeLessThan(1);
  expect(samples.at(-1)!.visibility).toBe('hidden');
});

test('an interrupted collapse reverses from its current height without replacing local controls', async ({ page }) => {
  await fixture(page);
  const field = page.getByRole('textbox', { name: 'Visit note' }), identity = await field.elementHandle();
  const button = page.getByRole('button', { name: 'What should I bring?', exact: true });
  await button.click(); await page.waitForTimeout(65); await button.click();
  await expect(field).toBeVisible(); await expect(field).toHaveValue('Keep this draft');
  expect(await field.evaluate((node, previous) => node === previous, identity)).toBe(true);
  await expect(button).toBeFocused();
  const samples = await page.locator('.disclosure-node .task-motion-region').first().evaluate(async region => {
    const values: number[] = []; const start = performance.now();
    while (performance.now() - start < 320) { values.push(region.getBoundingClientRect().height); await new Promise(requestAnimationFrame); }
    return values;
  });
  expect(samples.at(-1)!).toBeGreaterThan(0); expect(Math.min(...samples)).toBeGreaterThan(0);
});

test('reduced motion removes geometry keyframes rather than speeding the travel up', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixture(page);
  const frames = await page.evaluate(async () => {
    const path = '/src/task-motion.tsx', { animateTask } = await import(path);
    const target = document.createElement('div'); target.style.height = '200px'; document.body.append(target);
    const animation = animateTask(target, [{ opacity: .4, height: '20px', transform: 'translateY(40px)', filter: 'blur(2px)' }, { opacity: 1, height: '200px', transform: 'translateY(0)', filter: 'blur(0)' }], 320);
    const result = { keyframes: animation?.effect?.getKeyframes() ?? [], duration: animation?.effect?.getTiming().duration, height: target.getBoundingClientRect().height };
    animation?.cancel(); target.remove(); return result;
  });
  expect(frames.height).toBe(200); expect(Number(frames.duration)).toBeLessThanOrEqual(80);
  expect(frames.keyframes.every((frame: Record<string, unknown>) => !('height' in frame) && !('transform' in frame) && !('filter' in frame))).toBe(true);
  await captureClose(page); await page.getByRole('button', { name: 'What should I bring?', exact: true }).click();
  const samples = await page.evaluate(() => (window as unknown as { closeSamples: Promise<{ height: number }[]> }).closeSamples);
  expect(samples[0].height, JSON.stringify(samples)).toBe(0);
});

test('a reserved follow-up row morphs into the actual question without discarding its shell immediately', async ({ page }) => {
  const host = await fixture(page, true);
  const placeholder = page.locator('.disclosure-followups-pending'), identity = await placeholder.elementHandle();
  await expect(placeholder).toBeVisible();
  await page.evaluate(() => {
    const original = document.querySelector('.disclosure-followups-pending')!;
    const observations: { phase: string | undefined; connected: boolean; opacity: number }[] = [];
    Object.assign(window, { followupFrames: new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-followup-arrival="resolving"]') && original.isConnected) return;
        observer.disconnect(); const start = performance.now();
        const sample = () => { observations.push({ phase: (original as HTMLElement).dataset.phase, connected: original.isConnected, opacity: Number(getComputedStyle(original).opacity) }); if (performance.now() - start < 300) requestAnimationFrame(sample); else resolve(observations); };
        sample();
      }); observer.observe(document.querySelector('.disclosure-node')!, { childList: true, subtree: true, attributes: true });
    }) });
  });
  host.setInput('answer', { status: 'ready', answer: 'Bring a photo ID.', followupsPending: false });
  host.snapshot.artifacts[0].spec!.elements.question.children!.push('newQuestion');
  host.snapshot.artifacts[0].spec!.elements.newQuestion = { type: 'Disclosure', props: { title: 'Does the guest need an ID too?', stateKey: 'guestOpen', text: 'Yes. Each guest needs identification.' } };
  host.snapshot.artifacts[0].revision++; await host.publish();
  const samples = await page.evaluate(() => (window as unknown as { followupFrames: Promise<{ phase?: string; connected: boolean; opacity: number }[]> }).followupFrames);
  expect(samples[0].connected).toBe(true); expect(samples.some(frame => frame.phase === 'resolving' && frame.opacity > 0 && frame.opacity < 1)).toBe(true);
  await expect(page.getByRole('button', { name: 'Does the guest need an ID too?', exact: true })).toBeVisible();
  expect(await identity!.evaluate(node => node.isConnected)).toBe(false);
});

test('accepted status changes animate once while unchanged snapshots preserve the current state', async ({ page }) => {
  await page.addInitScript(() => {
    const records: string[] = []; Object.assign(window, { statusAnimations: records }); const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) { if (this.classList.contains('task-status') && !this.hasAttribute('aria-hidden')) records.push(this.textContent ?? ''); return animate.call(this, frames, options); };
  });
  const host = await fixture(page); await page.evaluate(() => (window as unknown as { statusAnimations: string[] }).statusAnimations.splice(0));
  host.setInput('status', { status: 'running', label: 'Checking the supplied source' }); await host.publish();
  await expect(page.getByRole('status').filter({ hasText: 'Checking the supplied source' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { statusAnimations: string[] }).statusAnimations.length)).toBe(1);
  for (let index = 0; index < 4; index++) { host.setInput('status', { status: 'running', label: 'Checking the supplied source' }); await host.publish(); }
  expect(await page.evaluate(() => (window as unknown as { statusAnimations: string[] }).statusAnimations.length)).toBe(1);
  host.setInput('status', { status: 'success', label: 'Source checked' }); await host.publish();
  await expect.poll(() => page.evaluate(() => (window as unknown as { statusAnimations: string[] }).statusAnimations.length)).toBe(2);
  host.setInput('status', { operationId: 'export-result', kind: 'pdf.export', status: 'succeeded', description: 'Export saved', result: {} }); await host.publish();
  const result = page.getByRole('status').filter({ hasText: 'Export saved' }); await expect(result).toBeVisible(); await expect(result).not.toContainText('Completed');
});

test('a renewed follow-up request interrupts its old handoff and reserves one normal-flow row', async ({ page }) => {
  const host = await fixture(page, true);
  host.setInput('answer', { status: 'ready', answer: 'Bring a photo ID.', followupsPending: false }); await host.publish();
  const placeholder = page.locator('.disclosure-followups-pending');
  await expect(placeholder).toHaveAttribute('data-phase', 'resolving');
  host.setInput('answer', { status: 'ready', answer: 'Bring a photo ID.', followupsPending: true }); await host.publish();
  await expect(placeholder).toHaveAttribute('data-phase', 'pending');
  await expect(placeholder).toHaveCSS('position', 'static');
  expect((await placeholder.boundingBox())!.height).toBeGreaterThanOrEqual(35);
  await expect(placeholder).toHaveCount(1);
});

test('the live-publication entrance hook plays once and never treats an ordinary rerender as a new artifact', async ({ page }) => {
  await fixture(page);
  const motionSource = await (await page.request.get('/src/task-motion.tsx')).text(), mainSource = await (await page.request.get('/src/main.tsx')).text();
  const reactPath = motionSource.match(/["']([^"']*\/react\.js[^"']*)["']/)![1], domPath = mainSource.match(/["']([^"']*\/react-dom_client\.js[^"']*)["']/)![1];
  await page.evaluate(async ({ reactPath, domPath }) => {
    const motionPath = '/src/task-motion.tsx';
    const reactModule = await import(reactPath), React = reactModule.default ?? reactModule, domModule = await import(domPath), createRoot = domModule.createRoot ?? domModule.default.createRoot, { useArtifactEntrance } = await import(motionPath);
    if (typeof useArtifactEntrance !== 'function') throw new Error('Missing live-publication entrance hook');
    const records: unknown[] = [], animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) { if (this.classList.contains('motion-entry-probe')) records.push(frames); return animate.call(this, frames, options); };
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    function Probe({ published }: { published: boolean }) { const ref = React.useRef(null); useArtifactEntrance(ref, published); return React.createElement('div', { ref, className: 'motion-entry-probe' }, 'A useful new surface'); }
    Object.assign(window, { entryRecords: records, renderEntry: (published: boolean) => root.render(React.createElement(Probe, { published })) });
    root.render(React.createElement(Probe, { published: false }));
  }, { reactPath, domPath });
  await expect(page.locator('.motion-entry-probe')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { entryRecords: unknown[] }).entryRecords.length)).toBe(0);
  await page.evaluate(() => (window as unknown as { renderEntry: (value: boolean) => void }).renderEntry(true));
  await expect.poll(() => page.evaluate(() => (window as unknown as { entryRecords: unknown[] }).entryRecords.length)).toBe(1);
  for (const value of [true, false, true]) await page.evaluate(value => (window as unknown as { renderEntry: (value: boolean) => void }).renderEntry(value), value);
  expect(await page.evaluate(() => (window as unknown as { entryRecords: unknown[] }).entryRecords.length)).toBe(1);
});

for(const policy of ['off','reduced'] as const)test(`app ${policy} settles active task effects and region`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await fixture(page);
 const button=page.getByRole('button',{name:'What should I bring?',exact:true});await button.click();
 const result=await page.evaluate(async policy=>{
  const path='/src/task-motion.tsx',{animateTask}=await import(path);const node=document.createElement('div');document.body.append(node);
  const animation=animateTask(node,[{opacity:0,transform:'translateY(40px)'},{opacity:1,transform:'translateY(0)'}],1000);
  const region=document.querySelector<HTMLElement>('.disclosure-node .task-motion-region')!;const before=region.getBoundingClientRect().height;
  document.documentElement.dataset.motion=policy;await Promise.resolve();const result={before,height:region.getBoundingClientRect().height,state:animation?.playState,phase:region.dataset.motionPhase};node.remove();return result;
 },policy);
 expect(result.before).toBeGreaterThan(0);expect(result.height).toBe(0);expect(result.phase).toBe('closed');expect(result.state).toBe('idle');
 await page.evaluate(()=>document.documentElement.dataset.motion='system');await expect(button).toBeFocused();expect(await page.locator('.disclosure-node .task-motion-region').first().evaluate(node=>node.getBoundingClientRect().height)).toBe(0);
});

for(const policy of ['off','reduced'] as const)test(`app ${policy} settles artifact entrance and releases its subscriptions on unmount`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await fixture(page);
 const source=await (await page.request.get('/src/task-motion.tsx')).text(),main=await (await page.request.get('/src/main.tsx')).text();
 const reactPath=source.match(/["']([^"']*\/react\.js[^"']*)["']/)![1],domPath=main.match(/["']([^"']*\/react-dom_client\.js[^"']*)["']/)![1];
 await page.evaluate(async({reactPath,domPath})=>{
  const react=await import(reactPath),React=react.default??react,dom=await import(domPath),path='/src/task-motion.tsx',{useArtifactEntrance}=await import(path);
  const Original=MutationObserver,observers=new Set<MutationObserver>();window.MutationObserver=class extends Original{observe(target:Node,options?:MutationObserverInit){if(options?.attributeFilter?.includes('data-motion'))observers.add(this);super.observe(target,options);}disconnect(){observers.delete(this);super.disconnect();}};
  const host=document.createElement('div');document.body.append(host);const root=(dom.createRoot??dom.default.createRoot)(host);
  function Probe(){const ref=React.useRef(null);useArtifactEntrance(ref,true);return React.createElement('div',{ref,className:'policy-entry',style:{height:'160px',overflow:'visible'}},React.createElement('p',null,'A new artifact'));}
  Object.assign(window,{entryPolicyObservers:observers,restartPolicyEntry:()=>root.render(React.createElement(Probe,{key:'again'})),unmountPolicyEntry:()=>{root.unmount();host.remove();window.MutationObserver=Original;}});root.render(React.createElement(Probe));
 },{reactPath,domPath});
 await expect(page.locator('.policy-entry')).toHaveAttribute('data-entry-phase','entering');
 const result=await page.locator('.policy-entry').evaluate(async(node,policy)=>{document.documentElement.dataset.motion=policy;await Promise.resolve();return {phase:(node as HTMLElement).dataset.entryPhase,height:(node as HTMLElement).style.height,overflow:(node as HTMLElement).style.overflow,animations:node.getAnimations().length};},policy);
 expect(result).toEqual({phase:'settled',height:'160px',overflow:'visible',animations:0});expect(await page.evaluate(()=>(window as unknown as {entryPolicyObservers:Set<MutationObserver>}).entryPolicyObservers.size)).toBe(0);
 await page.evaluate(()=>document.documentElement.dataset.motion='system');await expect(page.locator('.policy-entry')).toHaveAttribute('data-entry-phase','settled');
 await page.evaluate(()=>(window as unknown as {restartPolicyEntry:()=>void}).restartPolicyEntry());await expect(page.locator('.policy-entry')).toHaveAttribute('data-entry-phase','entering');expect(await page.evaluate(()=>(window as unknown as {entryPolicyObservers:Set<MutationObserver>}).entryPolicyObservers.size)).toBe(2);
 await page.evaluate(()=>(window as unknown as {unmountPolicyEntry:()=>void}).unmountPolicyEntry());await expect(page.locator('.policy-entry')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as unknown as {entryPolicyObservers:Set<MutationObserver>}).entryPolicyObservers.size)).toBe(0);
});

test('task effects release policy subscriptions on finish and cancellation and keep app Reduced opacity semantics',async({page})=>{
 await fixture(page);
 const result=await page.evaluate(async()=>{
  const path='/src/task-motion.tsx',{animateTask}=await import(path),Original=MutationObserver,active=new Set<MutationObserver>();
  window.MutationObserver=class extends Original{observe(target:Node,options?:MutationObserverInit){if(options?.attributeFilter?.includes('data-motion'))active.add(this);super.observe(target,options);}disconnect(){active.delete(this);super.disconnect();}};
  const target=document.createElement('div');document.body.append(target);
  try{
   const first=animateTask(target,[{opacity:0},{opacity:1}],1000)!;const subscribed=active.size;const finished=new Promise(resolve=>first.addEventListener('finish',resolve,{once:true}));first.finish();await finished;const afterFinish=active.size;
   const second=animateTask(target,[{opacity:0},{opacity:1}],1000)!;const cancelled=new Promise(resolve=>second.addEventListener('cancel',resolve,{once:true}));second.cancel();await cancelled;const afterCancel=active.size;
   document.documentElement.dataset.motion='reduced';const reduced=animateTask(target,[{opacity:0,transform:'translateY(30px)'},{opacity:1,transform:'translateY(0)'}],1000)!;
   const frames=reduced.effect!.getKeyframes(),duration=reduced.effect!.getTiming().duration;document.documentElement.dataset.motion='off';await Promise.resolve();const offState=reduced.playState,off=animateTask(target,[{opacity:0},{opacity:1}],1000);
   return {subscribed,afterFinish,afterCancel,frames,duration,offState,off:off===undefined,remaining:active.size};
  }finally{window.MutationObserver=Original;target.remove();}
 });
 expect(result.subscribed).toBe(1);expect(result.afterFinish).toBe(0);expect(result.afterCancel).toBe(0);expect(result.remaining).toBe(0);expect(result.off).toBe(true);expect(result.offState).toBe('idle');expect(Number(result.duration)).toBeLessThanOrEqual(80);expect(result.frames.every((frame:ComputedKeyframe)=>!('transform' in frame))).toBe(true);
});
