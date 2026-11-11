import {expect, it} from 'vitest';
import {detachedSurface, pendingSurface} from '../apps/web/src/desktop-context';

type Desktop = NonNullable<Parameters<typeof detachedSurface>[0]>;
it('uses the canonical desktop owner and pending surfaces for the exact thread', () => {
 const surface = {kind: 'thread' as const, threadId: 'selected'};
 const desktop = {context: {windowId: 'main'}, windows: [{id: 'main', surface}, {id: 'child', surface: {kind: 'thread', threadId: 'other'}}], pending: [surface]} as Desktop;
 expect(detachedSurface(desktop, surface)).toBeUndefined();
 expect(pendingSurface(desktop, surface)).toBe(true);
 expect(pendingSurface(desktop, {kind: 'thread', threadId: 'other'})).toBe(false);
 desktop.windows.push({id: 'owner', surface} as Desktop['windows'][number]);
 expect(detachedSurface(desktop, surface)?.id).toBe('owner');
 expect(detachedSurface(null, surface)).toBeUndefined(); expect(pendingSurface(null, surface)).toBe(false);
});
