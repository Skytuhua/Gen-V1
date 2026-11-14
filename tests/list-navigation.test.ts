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
