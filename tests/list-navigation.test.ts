import { expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import { useListNavigation } from '../packages/ui-shell/list-navigation';

vi.mock('react', () => ({ useRef: <T>(current: T) => ({ current }) }));
function list() {
  const navigation = useListNavigation([
    { label: 'Alpha' }, { label: 'Beta' }, { label: 'Alpine' }, { label: 'Unavailable', disabled: true }, { label: 'Zulu' },
  ], vi.fn(), vi.fn());
  const rows = Array.from({ length: 5 }, () => ({ focus: vi.fn(), scrollIntoView: vi.fn() }));
  navigation.rows.current = rows as unknown as HTMLButtonElement[];
  const press = (key: string) => navigation.onKeyDown({ key, nativeEvent: {}, target: {}, preventDefault() {} } as KeyboardEvent);
  return { navigation, rows, press };
}

it('starts ArrowUp at the last enabled item when nothing has focus', () => {
  const { rows, press } = list();
  press('ArrowUp');
  expect(rows[4].focus).toHaveBeenCalledOnce();
});

it('keeps the current match when refining a typed prefix', () => {
  const { rows, press } = list();
  press('a'); press('l'); press('p');
  expect(rows[0].focus).toHaveBeenCalled();
  expect(rows[2].focus).not.toHaveBeenCalled();
});

it('still cycles through matching items when repeating a single key', () => {
  const { rows, press } = list();
  press('a'); press('a');
  expect(rows[0].focus).toHaveBeenCalledOnce();
  expect(rows[2].focus).toHaveBeenCalledOnce();
});

it('does not select a stale index after a menu loses rows', () => {
  const items = [{ label: 'First' }, { label: 'Second' }];
  const selected: number[] = [];
  const navigation = useListNavigation(items, index => selected.push(index), () => {});
  navigation.onFocus(1);
  items.pop();
  navigation.onKeyDown({key:'Enter', nativeEvent:{}, target:{}, preventDefault(){}} as KeyboardEvent);
  expect(selected).toEqual([]);
});

it.each(['Enter', ' '])('does not activate a different row with %j after focus falls back to the popup', key => {
  const items = [{ label: 'Original' }, { label: 'Other' }];
  const choose = vi.fn();
  const navigation = useListNavigation(items, choose, () => {});
  navigation.onFocus(0);
  items.shift();
  const replacement = {} as HTMLButtonElement;
  navigation.rows.current = [replacement];
  navigation.onKeyDown({ key, nativeEvent: {}, target: {}, preventDefault() {} } as KeyboardEvent);
  expect(choose).not.toHaveBeenCalled();
  navigation.onKeyDown({ key, nativeEvent: {}, target: replacement, preventDefault() {} } as unknown as KeyboardEvent);
  expect(choose).toHaveBeenCalledExactlyOnceWith(0);
});

it('starts a fresh typeahead after explicit keyboard navigation', () => {
  const { rows, press } = list();
  press('a');
  press('End');
  press('b');
  expect(rows[4].focus).toHaveBeenCalledOnce();
  expect(rows[1].focus).toHaveBeenCalledOnce();
});
