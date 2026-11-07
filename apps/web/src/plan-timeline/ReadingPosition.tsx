import { Component, createRef, type ReactNode } from "react";

type Position = { element: HTMLElement; top: number; anchor?: HTMLElement; offset?: number };
/** Snapshot before React changes the DOM; updates never follow the active step. */
export class ReadingPosition extends Component<
  { updateKey: string; children: ReactNode },
  object,
  Position[] | null
> {
  private root = createRef<HTMLDivElement>();
  getSnapshotBeforeUpdate(previous: Readonly<{ updateKey: string; children: ReactNode }>): Position[] | null {
    if (previous.updateKey === this.props.updateKey) return null;
    const positions: Position[] = [];
    for (let element = this.root.current?.parentElement; element; element = element.parentElement) {
      if (
        element.scrollHeight <= element.clientHeight ||
        !/(auto|scroll)/.test(getComputedStyle(element).overflowY)
      )
        continue;
      const bounds = element.getBoundingClientRect();
      const anchor = [
        ...this.root.current!.querySelectorAll<HTMLElement>(
          ".plan-step-summary, .plan-fact, .plan-requirements>li, [data-agent-id], .plan-dependencies",
        ),
      ].find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.top >= bounds.top && rect.top < bounds.bottom;
      });
      positions.push({
        element,
        top: element.scrollTop,
        anchor,
        offset: anchor?.getBoundingClientRect().top,
      });
    }
    return positions;
  }
  componentDidUpdate(_previous: unknown, _state: unknown, positions: Position[] | null) {
    for (const position of positions ?? []) {
      const delta =
        position.anchor?.isConnected && position.offset !== undefined
          ? position.anchor.getBoundingClientRect().top - position.offset
          : 0;
      position.element.scrollTop = position.top + delta;
    }
  }
  render() {
    return (
      <div ref={this.root} className="plan-reading-position">
        {this.props.children}
      </div>
    );
  }
}
