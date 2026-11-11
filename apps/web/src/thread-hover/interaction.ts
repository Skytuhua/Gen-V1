export const THREAD_HOVER_DWELL = 350;
export const THREAD_HOVER_TRANSFER = 120;

export function createThreadHoverInteraction(onChange: (open: boolean) => void) {
  let open = false, blocked = false, focused = false, dismissed = false;
  const pointer = new Set<'trigger' | 'card'>();
  let dwell: ReturnType<typeof setTimeout> | undefined, transfer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {clearTimeout(dwell); clearTimeout(transfer); dwell = transfer = undefined;};
  const show = (next: boolean) => {if (next !== open) {open = next; onChange(next);}};
  return {
    pointerEnter(surface: 'trigger' | 'card') {
      if (blocked) return;
      pointer.add(surface); clearTimeout(transfer);
      if (surface === 'trigger') {
        dismissed = false;
        if (!open) {clearTimeout(dwell); dwell = setTimeout(() => {if (!blocked && !dismissed) show(true);}, THREAD_HOVER_DWELL);}
      }
    },
    pointerLeave(surface: 'trigger' | 'card') {
      pointer.delete(surface); clearTimeout(dwell);
      if (!pointer.size && !focused) transfer = setTimeout(() => show(false), THREAD_HOVER_TRANSFER);
    },
    focus(within: boolean) {
      focused = within;
      if (within) {clear(); if (!blocked && !dismissed) show(true);}
      else {dismissed = false; clear(); show(false);}
    },
    dismiss() {clear(); dismissed = true; show(false);},
    setBlocked(value: boolean) {
      blocked = value;
      if (value) {clear(); pointer.clear(); focused = false; show(false);}
    },
    dispose() {clear();},
  };
}
