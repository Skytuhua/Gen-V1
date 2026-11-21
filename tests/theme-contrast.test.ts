import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { WIDGET_BASE_CSS } from '../packages/widgets/theme.ts';
import { WCAG, contrast, evaluateColor, requireTokens, resolveTokens, themeTokens, type Tokens } from '../scripts/theme-contrast.ts';
import { PROJECT_ACCENT_INK, PROJECT_PALETTE, accentInk, type ProjectAccent } from '../packages/contracts/preferences.ts';

// Every ratio below is derived from the stylesheets, so editing a token moves the audit.
const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function controlClasses(sources = globSync(['apps/web/src/**/*.tsx', 'packages/**/*.tsx'], { exclude: ['**/node_modules/**', '**/dist/**'] }).map(source)): Set<string> {
  const classes = new Set<string>();
  for (const code of sources) {
    const file = ts.createSourceFile('controls.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
        const attribute = (name: string) => attributes.find(item => item.name.getText(file) === name)?.initializer;
        const role = attribute('role')?.getText(file) ?? '';
        const focus = attribute('tabIndex')?.getText(file) ?? '';
        const tag = node.tagName.getText(file);
        const actionable = attributes.some(item => /^(?:onClick|onDoubleClick|onChange|onInput|onSubmit|contentEditable)$/.test(item.name.getText(file)));
        const container = !actionable && (['div', 'section'].includes(tag) || /["'](?:log|region)["']/.test(role));
        const toggleChild = (child: ts.Node): boolean => {
          if (ts.isJsxElement(child)) return toggleChild(child.openingElement);
          if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
            return child.tagName.getText(file) === 'button'
              && child.attributes.properties.some(item => ts.isJsxAttribute(item) && /^(?:aria-pressed|aria-selected)$/.test(item.name.getText(file)));
          }
          return ts.forEachChild(child, toggleChild) ?? false;
        };
        const toggleGroup = /["']group["']/.test(role) && ts.isJsxOpeningElement(node)
          && ts.isJsxElement(node.parent) && node.parent.children.some(toggleChild);
        if (['input', 'textarea', 'select', 'button', 'summary'].includes(tag)
          || tag === 'a' && attribute('href') || toggleGroup
          || /["'](?:button|tab|switch|checkbox|radio)["']/.test(role)
          || /(?:^|[^\d-])0(?:[^\d]|$)/.test(focus) && !container) {
          const collect = (part: ts.Node) => {
            if (ts.isStringLiteralLike(part) || ts.isTemplateHead(part) || ts.isTemplateMiddle(part) || ts.isTemplateTail(part)) {
              for (const name of part.text.split(/\s+/)) if (/^[a-z][\w-]*$/i.test(name)) classes.add(name);
            }
            ts.forEachChild(part, collect);
          };
          const names = attribute('className');
          if (names) collect(names);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return classes;
}

function dividerControlOutlines(css: string, classes: Set<string>): string[] {
  const violations: string[] = [];
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of rule[1]!.split(',').map(value => value.trim())) {
      if (selector.includes('::')) continue;
      const leaf = selector.replace(/\[[^\]]*\]/g, value => value.replace(/\s/g, '')).split(/[\s>+~]+/).at(-1)!;
      const native = /(?:^|[(:])(?:input|textarea|select|button)(?=[.#[:)]|$)/.test(leaf)
        || /\[role=["']?(?:button|tab|switch|checkbox|radio)\b/.test(leaf);
      const control = native || [...leaf.matchAll(/\.([\w-]+)/g)].some(match => classes.has(match[1]!));
      const frame = /\.[\w-]*(?:search|filter|composer)(?:-(?:field|frame))?(?=[.#[:]|$)/.test(leaf);
      for (const declaration of rule[2]!.split(';')) {
        const colon = declaration.indexOf(':'), property = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1);
        if (!/var\(\s*--border\s*[,)]/.test(value)) continue;
        const boundary = /^(?:border(?:-.+)?|outline(?:-.+)?|box-shadow)$/.test(property);
        const perimeter = /^(?:border|border-color|outline(?:-.+)?|box-shadow)$/.test(property);
        if (boundary && native || perimeter && control || frame && (perimeter || /search|filter/.test(leaf) && boundary)) violations.push(selector + ': ' + declaration.trim());
      }
    }
  }
  return violations;
}
const styles = source('apps/web/src/styles.css'), shell = source('apps/web/src/shell.css'), appearance = source('apps/web/src/appearance.css'), sidebar = source('apps/web/src/sidebar-context.css');

const REQUIRED = [
  '--canvas', '--sidebar', '--surface', '--subtle', '--hover', '--text', '--muted', '--placeholder', '--control-border',
  '--selection-bg', '--selection-ink', '--accent', '--accent-solid', '--accent-fg', '--accent-bg', '--accent-text',
  '--danger', '--danger-soft', '--danger-fg', '--danger-bg', '--pending', '--success', '--success-fg', '--success-bg',
  '--warning-fg', '--warning-bg', '--category-fg', '--category-bg',
] as const;

// Declarations stay unresolved until a context is known, so formulas such as --accent-text
// are evaluated against the theme they are painted in.
const RAW = {
  root: themeTokens(styles, ':root'),
  dark: themeTokens(styles, ':root[data-theme="dark"]'),
  high: themeTokens(shell, '.app-shell[data-contrast=high]'),
  'high dark': themeTokens(shell, ':root[data-theme=dark] .app-shell[data-contrast=high]'),
};
const shells = {
  light: RAW.root,
  'light high contrast': { ...RAW.root, ...RAW.high },
  dark: { ...RAW.root, ...RAW.dark },
  'dark high contrast': { ...RAW.root, ...RAW.dark, ...RAW['high dark'] },
} as const;
const ACCENT_RULES = { any: themeTokens(appearance, ':root[data-appearance-accent]'), dark: themeTokens(appearance, ':root[data-appearance-accent][data-theme=dark]') };
const accents = Object.keys(PROJECT_PALETTE) as ProjectAccent[];

/**
 * applyAppearance writes the chosen palette colour and its ink onto the root element and
 * appearance.css feeds those into the accent tokens; the audit reproduces exactly that.
 */
function themed(name: keyof typeof shells, accent: ProjectAccent | string): Tokens {
  const named = accent in PROJECT_PALETTE ? accent as ProjectAccent : undefined;
  const palette = named ? PROJECT_PALETTE[named] : accent, ink = named ? PROJECT_ACCENT_INK[named] : accent;
  const runtime = { '--project-accent': palette, '--project-accent-ink': ink, '--accent-ink': accentInk(ink) };
  return requireTokens(resolveTokens({ ...shells[name], ...ACCENT_RULES.any, ...(name.startsWith('dark') ? ACCENT_RULES.dark : {}), ...runtime }), REQUIRED);
}

type Pair = { foreground: string; background: string; minimum: number; where: string };
const text = (foreground: string, background: string, where: string): Pair => ({ foreground, background, minimum: WCAG.text, where });
const nonText = (foreground: string, background: string, where: string): Pair => ({ foreground, background, minimum: WCAG.nonText, where });

const PAIRS: readonly Pair[] = [
  nonText('--control-border', '--canvas', 'control outlines against the workspace'),
  nonText('--control-border', '--surface', 'input, select, action, composer, dock and search outlines'),
  nonText('--control-border', '--hover', 'hovered control outlines'),
  nonText('--control-border', '--subtle', 'control outlines inside task surfaces'),
  nonText('--control-border', '--selection-bg', 'selected controls and checkpoint actions'),
  nonText('--text', '--control-border', 'selected outlines remain distinct from resting outlines'),
  text('--text', '--canvas', 'conversation, dock and decision copy on the workspace canvas'),
  text('--text', '--sidebar', 'thread titles and settings navigation labels'),
  text('--text', '--surface', 'composer, dock cards and settings content'),
  text('--text', '--subtle', 'user message bubbles and inline code'),
  text('--text', '--hover', 'hovered thread rows, settings results and popup options'),
  text('--selection-ink', '--selection-bg', 'the selected settings destination and sidebar filter'),
  text('--muted', '--canvas', 'activity lines, empty states and composer captions'),
  text('--muted', '--sidebar', 'thread metadata, nav labels and sidebar footer'),
  text('--muted', '--surface', 'dock captions and quiet settings copy'),
  text('--muted', '--subtle', 'status pills and badges'),
  text('--muted', '--hover', 'thread metadata on a hovered or active row'),
  text('--muted', '--selection-bg', 'quiet copy on a selected row'),
  text('--placeholder', '--surface', 'input and composer placeholders'),
  text('--placeholder', '--canvas', 'search placeholders outside a card'),
  text('--accent-fg', '--canvas', 'links and verification triggers'),
  text('--accent-fg', '--surface', 'links inside dock cards and dialogs'),
  text('--accent-fg', '--subtle', 'links inside a message bubble'),
  text('--accent-fg', '--hover', 'a link inside a hovered row'),
  text('--accent-fg', '--selection-bg', 'a link inside a selected row'),
  text('--accent-fg', '--accent-bg', 'the working status chip'),
  text('--accent-text', '--canvas', 'the accent-tinted thread status text'),
  text('--accent-text', '--surface', 'accent-tinted status text on a card'),
  text('--accent-text', '--subtle', 'accent-tinted status text on a status pill'),
  text('--accent-text', '--hover', 'accent-tinted status text on a hovered row'),
  text('--accent-text', '--selection-bg', 'accent-tinted status text on a selected row'),
  text('--accent-ink', '--accent-solid', 'the primary button and send labels on their accent fill'),
  text('--danger', '--canvas', 'failed operation outcomes and error status'),
  text('--danger', '--surface', 'modal errors and the close mark'),
  text('--danger', '--subtle', 'composer and workspace error banners'),
  text('--danger', '--danger-soft', 'destructive controls on hover'),
  text('--danger-fg', '--danger-bg', 'removed diff lines'),
  text('--pending', '--canvas', 'connection state and pending decisions'),
  text('--pending', '--surface', 'dirty artifact state on a card'),
  text('--pending', '--subtle', 'the pending badge on a decision'),
  text('--pending', '--hover', 'the awaiting-input status on a hovered row'),
  text('--warning-fg', '--warning-bg', 'warning chips and notices'),
  text('--success-fg', '--success-bg', 'added diff lines and success chips'),
  text('--success', '--canvas', 'success ticks and tones'),
  text('--category-fg', '--category-bg', 'category chips'),
  nonText('--muted', '--canvas', 'the focus ring on the canvas'),
  nonText('--muted', '--surface', 'the focus ring on a card or dialog'),
  nonText('--muted', '--hover', 'the switch thumb and focus ring on a hovered row'),
  nonText('--pending', '--canvas', 'the pending dot beside a thread status'),
  nonText('--accent', '--selection-bg', 'the selected sidebar filter icon'),
];

/** A token the audit cannot turn into a colour is reported as unmeasured, not as a crash. */
function failures(tokens: Tokens): string[] {
  return PAIRS.flatMap(pair => {
    const foreground = evaluateColor(tokens[pair.foreground]!, tokens), background = evaluateColor(tokens[pair.background]!, tokens);
    if (!foreground || !background) return [`${pair.foreground} on ${pair.background} could not be measured: ${tokens[pair.foreground]} on ${tokens[pair.background]} — ${pair.where}`];
    const ratio = contrast(foreground, background);
    return ratio + 1e-9 >= pair.minimum ? [] : [`${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1, needs ${pair.minimum}:1 — ${pair.where}`];
  });
}

const contexts = (Object.keys(shells) as (keyof typeof shells)[]).flatMap(name => accents.map(accent => ({ name: `${name} with the ${accent} accent`, tokens: themed(name, accent) })));
const SURFACES = ['--canvas', '--surface', '--subtle', '--hover', '--selection-bg'] as const;

describe('appearance theme contrast audit', () => {
  it('rejects divider tokens on controls recursively, including search/filter/composer frames', () => {
    const classes = controlClasses();
    const violations = globSync(['apps/web/src/**/*.css', 'packages/**/*.css'], { exclude: ['**/node_modules/**', '**/dist/**'] })
      .flatMap(path => dividerControlOutlines(source(path), classes).map(rule => path + ': ' + rule));
    violations.push(...dividerControlOutlines(WIDGET_BASE_CSS, classes).map(rule => 'packages/widgets/theme.ts: ' + rule));
    expect(violations).toEqual([]);
  });

  it('enforces control boundaries without treating dividers or shells as controls', () => {
    const classes = new Set(['retry']);
    expect(dividerControlOutlines('', classes)).toEqual([]);
    expect(dividerControlOutlines('input { border:1px solid var(--border); } .retry { border-color:var(--border); } .search { border-bottom:1px solid var(--border); } .composer { border:1px solid var(--border); }', classes)).toHaveLength(4);
    expect(dividerControlOutlines('.card { border:1px solid var(--border); } .composer { border-top:1px solid var(--border); } .ui-modal { border:1px solid var(--border); } input { border:1px solid var(--control-border); }', classes)).toEqual([]);
  });

  it('distinguishes scroll and landmark access from interactive controls without selector exemptions', () => {
    const classes = controlClasses([`<>
      <div className="reader" role="log" tabIndex={0} onScroll={() => {}} />
      <section className="landmark" tabIndex={0} />
      <div className="scroller" tabIndex={overflowing ? 0 : undefined} onKeyDown={() => {}} onPointerDown={() => {}} />
      <div className="action" tabIndex={0} onClick={() => {}} />
      <section className="switch" role="switch" tabIndex={0} />
      <span className="focus-target" tabIndex={0} />
      <button className="native" role="region" tabIndex={0} />
      <div className="segments" role="group">{items.map(item => <button aria-pressed={item.selected} />)}</div>
    </>`]);
    expect(controlClasses([])).toEqual(new Set());
    expect([...classes].sort()).toEqual(['action', 'focus-target', 'native', 'segments', 'switch']);
    expect(dividerControlOutlines('.reader,.landmark,.scroller { border:1px solid var(--border); }', classes)).toEqual([]);
    expect(dividerControlOutlines('.action,.switch,.focus-target,.native,.segments { border:1px solid var(--border); }', classes)).toHaveLength(5);
  });

  it('still rejects all thirteen reviewer boundaries when the divider token is reintroduced', () => {
    const classes = controlClasses();
    for (const [path, selector] of [
      ['agents-workspace/agents-workspace.css', '.agents-new-output'],
      ['agents-workspace/agents-workspace.css', '.agents-workspace .agents-composer.composer'],
      ['agents-workspace/agents-workspace.css', '.agents-virtual-reveal'],
      ['agents-workspace/agents-workspace.css', '.agents-work-send input'],
      ['agents-workspace/agents-workspace.css', '.agents-board-post select'],
      ['files/files.css', '.files-filter input'],
      ['files/files.css', '.files-error button'],
      ['files/files.css', '.project-search-more'],
      ['model-picker.css', '.model-picker-search'],
      ['map-view.css', '.task-map-themes'],
      ['context-inspector.css', '.context-request-tabs>button[aria-selected="true"]'],
      ['sidebar-context.css', '.sidebar .sidebar-action-btn.selected'],
      ['relationship-graph.css', '.task-graph-check'],
    ]) {
      const rule = [...source('apps/web/src/' + path).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .find(rule => rule[1]!.split(',').some(name => name.trim() === selector));
      expect(rule, selector).toBeDefined();
      const reintroduced = rule![0].replace(/var\(--(?:control-border|text)\)/g, 'var(--border)');
      expect(dividerControlOutlines(reintroduced, classes).some(item => item.startsWith(selector + ': ')), selector).toBe(true);
    }
  });

  it('keeps scroll containers and landmarks subtle', () => {
    for (const [path, selector] of [
      ['agents-workspace/agents-workspace.css', '.agents-transcript'],
      ['interaction-tools.css', '.editable-table-scroll'],
      ['task-table.css', '.task-table .task-table-scroll'],
      ['shell.css', '.verification-panel'],
    ]) {
      const rule = [...source('apps/web/src/' + path).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .find(rule => rule[1]!.trim() === selector);
      expect(rule?.[2], selector).toMatch(/border:\s*1px solid var\(--border\)/);
    }
  });

  it('measures every audited token in every shell', () => {
    const unmeasured = contexts.flatMap(({ name, tokens }) => [...new Set(PAIRS.flatMap(pair => [pair.foreground, pair.background]))]
      .filter(token => !evaluateColor(tokens[token]!, tokens))
      .map(token => `${name}: ${token} is ${tokens[token]}`));
    expect(unmeasured).toEqual([]);
  });

  it.each(contexts)('$name keeps every primary surface at AA', ({ tokens }) => {
    expect(failures(tokens)).toEqual([]);
  });

  it('paints the surfaces this audit covers with the tokens it measures', () => {
    expect(sidebar).toMatch(/\.sidebar \.thread-item-meta\[data-thread-state='working'\] \.thread-item-status \{\s*color: var\(--accent-text\)/);
    expect(styles).toMatch(/\.send-button \{[^}]*color:var\(--accent-ink,#fff\)/);
  });

  it('keeps search, textarea, button and radio boundaries on the control token', () => {
    const boundaries = {
      'apps/web/src/agent-inbox.css': ['.agent-inbox .inbox-search>label'],
      'apps/web/src/exploration-tools.css': ['.exploration-field textarea', '.log-search'],
      'apps/web/src/conversation-find.css': ['.conversation-find'],
      'apps/web/src/everyday-data.css': ['.everyday-option-selector'],
      'apps/web/src/file-checkpoints.css': ['.file-checkpoints button'],
      'apps/web/src/document-preview.css': ['.document-preview-failure button'],
      'apps/web/src/image-compare.css': ['.image-compare-message button'],
      'apps/web/src/github-sign-in.css': ['.github-sign-in button'],
      'apps/web/src/project-memory.css': ['.project-memory-body button'],
      'apps/web/src/settings.css': ['.settings-result', '.settings-switch'],
      'apps/web/src/sidebar-context.css': ['.sidebar .search-field'],
      'apps/web/src/interaction-tools.css': ['.review-item-nav[aria-current=step]', '.review-decision-choice'],
      'apps/web/src/connections.css': ['.connection-providers button'],
      'apps/web/src/software-development.css': ['.software-list button', '.software-blocking-checks button'],
      'apps/web/src/model-picker.css': ['.model-picker-new-task', '.model-picker-search'],
      'apps/web/src/task-table.css': ['.task-table .task-table-follow', '.task-table-filter-field'],
      'apps/web/src/composer-toolbar.css': ['.composer-context-chip'],
      'apps/web/src/side-chat.css': ['.side-chat-composer'],
      'apps/web/src/workspace-canvas.css': ['.canvas-side-composer textarea'],
      'apps/web/src/work-objects.css': ['.trace-filter', '.architecture-node', '.workflow-card'],
      'apps/web/src/frontend-fidelity.css': ['.document-download>a'],
      'packages/ui-shell/feedback.css': ['.ui-error .ui-error-retry'],
      'apps/web/src/appearance-settings.css': ['.appearance-settings .color-swatch'],
      'apps/web/src/terminal-excerpts.css': ['.terminal-excerpt-chip'],
      'apps/web/src/map-view.css': ['.task-map-point', '.task-map-themes'],
      'apps/web/src/agents-workspace/agents-workspace.css': ['.agents-new-output', '.agents-workspace .agents-composer.composer', '.agents-virtual-reveal', '.agents-work-send input', '.agents-board-post select', '.agents-board-post input'],
      'apps/web/src/files/files.css': ['.files-filter input', '.files-error button', '.project-search-more'],
      'apps/web/src/relationship-graph.css': ['.task-graph-check'],
      'apps/web/src/loading-state.css': ['.loading-composer'],
      'apps/web/src/styles.css': ['.jump-latest'],
    };
    for (const [path, selectors] of Object.entries(boundaries)) {
      const rules = [...source(path).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      for (const selector of selectors) {
        const bodies = rules.filter(rule => rule[1]!.split(',').some(name => name.trim() === selector)).map(rule => rule[2]!).join('');
        expect(bodies, path + ': ' + selector).toContain('var(--control-border');
        expect(bodies, path + ': ' + selector).not.toContain('var(--border');
      }
    }
    expect(WIDGET_BASE_CSS).toMatch(/input,textarea,select\{[^}]*border:1px solid var\(--control-border,#878787\)/);
    expect(source('apps/web/src/Widget.tsx')).toContain("'--control-border': style.getPropertyValue('--control-border').trim()");
  });

  it('distinguishes selected controls and current review items from resting controls', () => {
    for (const [path, selectors] of Object.entries({
      'apps/web/src/everyday-data.css': ['.everyday-option-card[data-selected=true] .everyday-option-selector'],
      'apps/web/src/work-objects.css': ['.workflow-card[data-selected=true]', '.architecture-node[aria-pressed=true]'],
      'apps/web/src/interaction-tools.css': ['.review-decision-choice[data-selected=true]'],
      'apps/web/src/task-interface.css': ['.task-choice.is-selected'],
      'apps/web/src/settings.css': ['.settings-navigation nav button.selected'],
      'apps/web/src/exploration-tools.css': ['.schedule-interval[aria-selected=true]'],
      'apps/web/src/software-development.css': ['.software-response-tabs button[aria-selected=true]'],
      'apps/web/src/planning-question.css': ['.planning-option.is-selected'],
      'apps/web/src/connections.css': ['.connection-providers button[aria-pressed="true"]', '.connection-account-row[data-chosen="true"]'],
      'apps/web/src/context-inspector.css': ['.context-request-tabs>button[aria-selected="true"]'],
      'apps/web/src/sidebar-context.css': ['.app-shell .sidebar .sidebar-action-btn.selected', '.sidebar .sidebar-action-btn.selected', '.app-shell .sidebar .sidebar-thread-row.active', '.sidebar .sidebar-thread-row.active'],
      'apps/web/src/shell.css': ['.sidebar-thread-row.active'],
    })) {
      const rules = [...source(path).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      for (const selector of selectors) {
        const rule = rules.find(rule => rule[1]!.split(',').some(name => name.trim() === selector));
        expect(rule?.[2], selector).toMatch(/(?:border-color|box-shadow):[^;]*var\(--text\)(?:;|$)/);
        expect(rule?.[2], selector).not.toContain('border-color:var(--control-border)');
        expect(rule?.[2], selector).not.toContain('var(--selection-border');
      }
    }
    const review = source('apps/web/src/interaction-tools.css');
    expect(review).toMatch(/\.review-item-nav\{[^}]*border:1px solid transparent/);
    expect(review).toMatch(/\.review-item-nav\[aria-current=step\]\{[^}]*border-color:var\(--control-border\)/);
  });

  it('fails the pairs it would catch if a token regressed', () => {
    const broken = { ...contexts[0]!.tokens, '--muted': '#9a9a9a', '--danger': '#e0a0a8', '--accent-text': '#8a8a8a', '--control-border': '#e5e5e5' };
    expect(failures(broken)).toEqual(expect.arrayContaining([
      expect.stringContaining('--control-border on --canvas'),
      expect.stringContaining('--control-border on --surface'),
      expect.stringContaining('--control-border on --hover'),
      expect.stringContaining('--muted on --hover'),
      expect.stringContaining('--muted on --canvas'),
      expect.stringContaining('--danger on --subtle'),
      expect.stringContaining('--accent-text on --hover'),
    ]));
  });

  it('reports a token it cannot evaluate instead of failing to load', () => {
    expect(failures({ ...contexts[0]!.tokens, '--accent-text': 'oklch(0.6 0.1 250)' }).some(entry => entry.startsWith('--accent-text on --canvas could not be measured'))).toBe(true);
  });

  // The shell owns the tinted-accent formula; the audit owns the proof that any accent the
  // settings accept stays readable, custom colours included.
  it('keeps every custom accent the settings accept readable as text and as a fill', () => {
    const failures: string[] = [];
    for (let red = 0; red < 256; red += 8) for (let green = 0; green < 256; green += 8) for (let blue = 0; blue < 256; blue += 8) {
      const accent = '#' + [red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('');
      // AppearanceSettings rejects the colours below 3:1 on either shell surface.
      if (Math.min(contrast(accent, '#0F0F0F'), contrast(accent, '#FFFFFF')) < WCAG.nonText) continue;
      for (const shell of ['light', 'dark'] as const) {
        const tokens = themed(shell, accent);
        for (const surface of SURFACES) {
          const value = evaluateColor(tokens['--accent-text']!, tokens), background = evaluateColor(tokens[surface]!, tokens);
          if (!value || !background) failures.push(`${accent}: ${value ?? tokens['--accent-text']} could not be measured`);
          else if (contrast(value, background) < WCAG.text) failures.push(`${accent} tinted on ${surface} is ${contrast(value, background).toFixed(2)}:1`);
        }
        if (contrast(accentInk(accent), accent) < WCAG.text) failures.push(`${accentInk(accent)} on ${accent} as a primary fill`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });
});
