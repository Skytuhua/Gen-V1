import {useEffect, useState} from 'react';
import {skillBindingSchema, skillBindingsSchema, type SkillBinding} from './composer-commands';
import {journalCompareAndSwap, journalReadRecord, journalSubscribe, journalWrite} from './journal';
export const skillDraftKey = (threadId: string) => 'draft-skills:' + threadId;
export const readSkillBindings = (value: unknown): SkillBinding[] => value === undefined ? [] : skillBindingsSchema.parse(value);
export async function clearAcceptedSkills(key: string, accepted: readonly SkillBinding[]) {
  const sent = new Set(accepted.map(binding => binding.id)); if (!sent.size) return;
  for (let attempt = 0; attempt < 8; attempt++) {
    const record = await journalReadRecord<unknown>(key), current = readSkillBindings(record?.value), remaining = current.filter(binding => !sent.has(binding.id));
    if (remaining.length === current.length) return;
    if (await journalCompareAndSwap(key, record?.generation, remaining)) return;
  }
  throw Error('Message accepted; skill draft is still changing. Retry to finish saving.');
}
/** Only the new-thread/non-host fallback uses this hook. Existing hosted views use the shared owner. */
export function useComposerSkills(threadId: string, enabled: boolean) {
  const key = skillDraftKey(threadId), [state, setState] = useState<{skills: SkillBinding[]; ready: boolean; error: string}>({skills: [], ready: false, error: ''});
  useEffect(() => {
    if (!enabled) return;
    let active = true; const accept = (value: unknown) => {if (active) {try {setState({skills: readSkillBindings(value), ready: true, error: ''});} catch {setState(previous => ({...previous, ready: false, error: 'Selected skills could not be recovered. Keep this workspace open.'}));}}};
    const stop = journalSubscribe(key, accept); void journalReadRecord(key).then(record => accept(record?.value)).catch(() => {if (active) setState(previous => ({...previous, ready: false, error: 'Selected skills could not be recovered. Keep this workspace open.'}));});
    return () => {active = false; stop();};
  }, [key, enabled]);
  const edit = async (update: (current: SkillBinding[]) => SkillBinding[]) => {
    try {const current = readSkillBindings((await journalReadRecord(key))?.value); await journalWrite(key, skillBindingsSchema.parse(update(current)));}
    catch (cause) {setState(previous => ({...previous, error: 'Selected skills could not be saved. Keep this workspace open.'})); throw cause;}
  };
  return {...state, add: (binding: SkillBinding) => edit(current => [...current, skillBindingSchema.parse(binding)]), remove: (id: string) => edit(current => current.filter(binding => binding.id !== id))};
}
