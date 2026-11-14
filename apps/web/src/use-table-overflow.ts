import {useLayoutEffect, useState, type RefObject} from 'react';

export function useTableOverflow(ref: RefObject<HTMLDivElement | null>) {
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () => setOverflowing(container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    // The table can mount or be replaced after this effect runs; a container
    // that overflows by scrolling never resizes, so re-attach on DOM changes.
    let table: HTMLTableElement | null = null;
    const attach = () => {
      const next = container.querySelector('table');
      if (next === table) return;
      if (table) observer.unobserve(table);
      table = next;
      if (table) observer.observe(table);
      measure();
    };
    attach();
    const mutations = new MutationObserver(attach);
    mutations.observe(container, {childList: true, subtree: true});
    measure();
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, [ref]);
  return overflowing;
}
