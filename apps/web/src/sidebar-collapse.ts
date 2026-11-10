import {useCallback, useLayoutEffect, useRef, type MouseEvent, type RefObject} from 'react';
import {observeMotionPolicy, readMotionPolicy} from './motion-policy';

/** Layout commits normally; only a disposable, inert copy travels. */
export function useSidebarCollapse(sidebar: RefObject<HTMLElement | null>, collapsed: boolean, enabled: boolean, mobile: boolean) {
  const previous = useRef(collapsed), pointer = useRef(false);
  const visual = useRef<{clip: HTMLElement; snapshot: HTMLElement; animation?: Animation} | null>(null);
  const settle = useCallback(() => {
    const current = visual.current;
    visual.current = null;
    current?.animation?.cancel();
    current?.clip.remove();
    sidebar.current?.removeAttribute('data-collapse-visual');
  }, [sidebar]);
  const allowed = () => enabled && !mobile && readMotionPolicy() === 'full' && sidebar.current?.closest('.app-shell')?.getAttribute('data-panel-animations') !== 'false';
  const snapshot = () => {
    const element = sidebar.current;
    if (!element) return;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const clip = document.createElement('div'), copy = element.cloneNode(true) as HTMLElement;
    clip.className = 'sidebar-collapse-overlay';
    clip.inert = true;
    clip.setAttribute('aria-hidden', 'true');
    Object.assign(clip.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
    copy.removeAttribute('data-collapse-visual');
    copy.removeAttribute('id');
    copy.inert = true;
    copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    Object.assign(copy.style, {width: `${rect.width}px`, height: `${rect.height}px`, padding: style.padding, borderRight: style.borderRight});
    clip.append(copy);
    element.parentElement!.append(clip);
    // cloneNode does not retain the navigation's scroll position.
    const sources = element.querySelectorAll('*'), copies = copy.querySelectorAll('*');
    sources.forEach((node, index) => {copies[index]!.scrollTop = node.scrollTop;});
    visual.current = {clip, snapshot: copy};
  };

  // Call before the host changes collapse state, while closing geometry is available.
  const prepare = (event: MouseEvent) => {
    pointer.current = event.detail > 0 && allowed();
    if (!pointer.current) settle();
    else if (!collapsed && !visual.current) snapshot();
  };

  useLayoutEffect(() => {
    const changed = previous.current !== collapsed;
    previous.current = collapsed;
    if (!changed) {if (!allowed()) settle(); return;}
    const animate = pointer.current;
    pointer.current = false;
    const element = sidebar.current;
    if (collapsed && element?.contains(document.activeElement)) {
      element.closest('.app-shell')?.querySelector<HTMLElement>('.sidebar-recovery')?.focus();
    }
    if (!animate || !allowed()) {settle(); return;}
    if (!visual.current) snapshot();
    const current = visual.current;
    if (!current || !element) return;
    const style = getComputedStyle(current.snapshot);
    const from = current.animation ? {opacity: style.opacity, transform: style.transform} :
      {opacity: collapsed ? '1' : '0', transform: collapsed ? 'translateX(0px)' : 'translateX(-4px)'};
    const token = style.getPropertyValue(collapsed ? '--ui-motion-panel-exit' : '--ui-motion-panel-enter').trim();
    const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000);
    if (!Number.isFinite(duration) || duration <= 0) {settle(); return;}
    current.animation?.cancel();
    element.dataset.collapseVisual = 'true';
    const animation = current.snapshot.animate([from, {opacity: collapsed ? '0' : '1', transform: collapsed ? 'translateX(-4px)' : 'translateX(0px)'}], {
      duration, easing: style.getPropertyValue('--ui-ease-enter').trim(), fill: 'both',
    });
    animation.id = collapsed ? 'sidebar-collapse-close' : 'sidebar-collapse-open';
    current.animation = animation;
    animation.onfinish = () => {if (visual.current?.animation === animation) settle();};
    animation.oncancel = () => {if (visual.current?.animation === animation) settle();};
  }, [collapsed, enabled, mobile]);

  useLayoutEffect(() => {
    const stop = observeMotionPolicy(policy => {if (policy !== 'full') settle();});
    const shell = sidebar.current?.closest('.app-shell');
    const observer = new MutationObserver(() => {if (shell?.getAttribute('data-panel-animations') === 'false') settle();});
    if (shell) observer.observe(shell, {attributes: true, attributeFilter: ['data-panel-animations']});
    window.addEventListener('resize', settle);
    window.addEventListener('keydown', settle);
    return () => {
      stop(); observer.disconnect(); settle();
      window.removeEventListener('resize', settle);
      window.removeEventListener('keydown', settle);
    };
  }, [sidebar, settle]);
  return prepare;
}
