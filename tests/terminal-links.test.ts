import { describe, expect, it, vi } from 'vitest';
import { terminalLinkHint, terminalLinkModifier, terminalLinkUrl } from '../apps/web/src/terminal-links.ts';
import { openWebLink } from '../apps/web/src/open-web-link.ts';

describe('terminalLinkUrl', () => {
  it('accepts plain http(s) URLs', () => {
    expect(terminalLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(terminalLinkUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
  });
  it('rejects credentials, unsafe protocols, control chars and oversized input', () => {
    expect(terminalLinkUrl('https://user:pw@example.com')).toBeNull();
    expect(terminalLinkUrl('javascript:alert(1)')).toBeNull();
    expect(terminalLinkUrl('file:///etc/passwd')).toBeNull();
    expect(terminalLinkUrl('ftp://x.example')).toBeNull();
    expect(terminalLinkUrl('mailto:a@b.c')).toBeNull();
    expect(terminalLinkUrl('https://' + 'a'.repeat(2050))).toBeNull();
    expect(terminalLinkUrl('https://example.com/a\nb')).toBeNull();
    expect(terminalLinkUrl('https://example.com/a b')).toBeNull();
    expect(terminalLinkUrl('not a url')).toBeNull();
    expect(terminalLinkUrl('')).toBeNull();
  });
});

describe('terminalLinkModifier', () => {
  it('requires primary button and Ctrl or Meta', () => {
    expect(terminalLinkModifier({ button: 0, ctrlKey: true, metaKey: false })).toBe(true);
    expect(terminalLinkModifier({ button: 0, ctrlKey: false, metaKey: true })).toBe(true);
    expect(terminalLinkModifier({ button: 0, ctrlKey: false, metaKey: false })).toBe(false);
    expect(terminalLinkModifier({ button: 1, ctrlKey: true, metaKey: false })).toBe(false);
  });
});

describe('terminalLinkHint', () => {
  it('names the macOS modifier only on Mac platforms', () => {
    expect(terminalLinkHint('MacIntel')).toBe('⌘+click to open');
    expect(terminalLinkHint('Win32')).toBe('Ctrl+click to open');
    expect(terminalLinkHint('Linux x86_64')).toBe('Ctrl+click to open');
  });
});

describe('openWebLink', () => {
  it('uses the desktop bridge when present, window.open otherwise', async () => {
    const win = globalThis as { harnessDesktop?: { openExternal: (u: string) => Promise<void> } };
    const g = globalThis as { open?: unknown; harnessDesktop?: { openExternal: (u: string) => Promise<void> } };
    g.open = vi.fn().mockReturnValue(null);
    const open = g.open as ReturnType<typeof vi.fn>;
    win.harnessDesktop = { openExternal: vi.fn().mockResolvedValue(undefined) };
    await openWebLink('https://example.com/x');
    expect(win.harnessDesktop.openExternal).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    delete g.harnessDesktop;
    await openWebLink('https://example.com/x');
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
    delete g.open;
  });
});
