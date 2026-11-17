it('pins a prepared memory token with source custody and after-current mode through reload and later edits', async () => {
 const queuedTarget = {...target, working: true}, stop = vi.fn(async () => {});
 const send = vi.fn(async (_input: ParentSend): Promise<void> => {throw Error('Connection lost after dispatch');});
 let composer = createSharedAgentComposers({sendParent: send, stopParent: stop});
 let release = () => {};
 try {
  await composer.prepare(queuedTarget); await composer.edit(queuedTarget, 'Original queued draft');
  await updateSourceDraft(logicalOwner, state => ({...state, sourceRefs: [source('first')], sendMode: 'AFTER_CURRENT'}));
  const before = await readSourceDraft(logicalOwner);
  await composer.submit(queuedTarget, {sourceContextVisible: true, requestContextId: 'prepared-original'});
  expect(send).toHaveBeenCalledOnce();
  const original = send.mock.calls[0][0];
  expect(original).toMatchObject({threadId: logicalOwner.threadId, content: 'Original queued draft', sourceRefs: [source('first')], sendMode: 'AFTER_CURRENT', requestContextId: 'prepared-original'});
  expect(records.get('agents-pending:task')?.value).toMatchObject({commandId: original.commandId, sourceOwner: logicalOwner, sourceGeneration: before.generation, sourceRefs: [source('first')], sendMode: 'AFTER_CURRENT', requestContextId: 'prepared-original'});
  expect((await readSourceDraft(logicalOwner)).sourceRefs).toEqual([source('first')]);
  await composer.edit(queuedTarget, 'Later authored draft');
  await updateSourceDraft(logicalOwner, state => ({...state, sourceRefs: [source('later')], sendMode: 'NOW'}));
  const later = await readSourceDraft(logicalOwner);
  composer.dispose();
  const accepted = new Promise<void>(resolve => {release = resolve;});
  send.mockImplementation(async () => accepted);
  composer = createSharedAgentComposers({sendParent: send, stopParent: stop});
  await composer.prepare(queuedTarget);
  const retry = composer.submit(queuedTarget, {sourceContextVisible: true, requestContextId: 'prepared-new-preview'});
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1][0]).toEqual(original);
  expect(composer.getSnapshot(queuedTarget).draft).toBe('Later authored draft');
  expect(await readSourceDraft(logicalOwner)).toEqual(later);
  release(); await retry;
  expect(records.get('agents-pending:task')?.value).toBeNull();
  expect(composer.getSnapshot(queuedTarget)).toMatchObject({draft: 'Later authored draft', retry: false});
  expect(await readSourceDraft(logicalOwner)).toEqual(later);
  expect(stop).not.toHaveBeenCalled();
 } finally {release(); composer.dispose();}
});
