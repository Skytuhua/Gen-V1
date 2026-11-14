import {useLayoutEffect, useState, type RefObject} from 'react';

export function useTableOverflow(ref: RefObject<HTMLDivElement | null>) {
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () => setOverflowing(container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const table = container.querySelector('table');
    if (table) observer.observe(table);
    measure();
    return () => observer.disconnect();
  }, [ref]);
  return overflowing;
}
