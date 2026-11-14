/** Settings writes retain their owning view until the accepted metadata is read. */
const pending = new Set<Promise<unknown>>();

export function settingsOperation<T>(operation: () => Promise<T>): Promise<T> {
 const request = operation();
 pending.add(request);
 void request.then(() => pending.delete(request), () => pending.delete(request));
 return request;
}

export async function settleSettingsOperations(): Promise<void> {
 // Individual write failures surface through their own callers; the handoff
 // guard only needs every pending write to reach a settled state.
 while (pending.size) await Promise.allSettled([...pending]);
}
