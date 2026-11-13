import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export interface UiViolation {
  file: string;
  line: number;
  column: number;
  rule: 'numeric-jsx-child' | 'ad-hoc-overlay' | 'off-token-motion';
  message: string;
  fingerprint: string;
}
export interface LegacyOverlay extends UiViolation { reason: string }

// File approvals cover implementation internals, not new files in this directory.
export const primitiveImplementations: Readonly<Record<string, string>> = {
  'packages/ui-shell/ChatView.tsx': 'Persistent non-modal conversation surface; shared menu, pointer capture, viewport clamps and keyboard geometry.',
  'packages/ui-shell/chat-view.css': 'Scoped geometry for the persistent conversation surface and its pointer-transparent dock target.',
  'packages/ui-shell/ToolDock.tsx': 'Shared normal-flow tool owner; portals retain renderers from separate plug-in roots.',
  'packages/ui-shell/Popover.tsx': 'Shared anchored portal, dismissal and viewport placement primitive.',
  'packages/ui-shell/ActionMenu.tsx': 'Shared menu control; delegates placement and dismissal to Popover.',
  'packages/ui-shell/Select.tsx': 'Shared selection control and native form backing element.',
  'packages/ui-shell/Modal.tsx': 'Shared native dialog modality and focus-return primitive.',
  'packages/ui-shell/controls.css': 'Scoped shared menu, select and modal styling.',
  'packages/ui-shell/tokens.css': 'Shared primitive tokens, popover and option styling.',
  'packages/ui-shell/Toast.tsx': 'Shared toast store and non-modal feedback layer.',
  'packages/ui-shell/Tooltip.tsx': 'Shared tooltip layer adopting title attributes with dwell and focus behavior.',
  'packages/ui-shell/Feedback.tsx': 'Shared spinner, empty and error state primitives.',
  'packages/ui-shell/feedback.css': 'Scoped shared toast, tooltip and state styling.',
};
const overlayRoles = new Set(['dialog', 'alertdialog', 'menu', 'menubar', 'listbox', 'combobox', 'tooltip']);
const overlayTags = new Set(['select', 'dialog']);
const printer = ts.createPrinter({ removeComments: true });
const portable = (path: string) => path.replaceAll('\\', '/');

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
  return expression;
}

function mayRenderZero(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnion()) return type.types.some(part => mayRenderZero(part, checker));
  if (type.isIntersection()) return type.types.some(part => mayRenderZero(part, checker));
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type);
    return !constraint || mayRenderZero(constraint, checker);
  }
  if (type.isNumberLiteral()) return type.value === 0;
  if (type.flags & ts.TypeFlags.BigIntLiteral) return (type as ts.BigIntLiteralType).value.base10Value === '0';
  // Unresolved/any gates cannot establish that a numeric zero is impossible.
  return Boolean(type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown));
}

function initializer(expression: ts.Expression, checker: ts.TypeChecker): ts.Expression | undefined {
  if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) return;
  const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
  const binding = symbol?.valueDeclaration;
  const declaration = binding && ts.isShorthandPropertyAssignment(binding) ? checker.getShorthandAssignmentValueSymbol(binding)?.valueDeclaration : binding;
  if (declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration))) return declaration.initializer;
}

function callable(expression: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Node>()): ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | undefined {
  expression = unwrap(expression);
  if (seen.has(expression)) return;
  seen.add(expression);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  const value = initializer(expression, checker);
  if (value) return callable(value, checker, seen);
  let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations?.find((node): node is ts.FunctionDeclaration | ts.MethodDeclaration =>
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && Boolean(node.body));
}

function strings(expression: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Node>()): string[] {
  expression = unwrap(expression);
  if (seen.has(expression)) return [];
  seen.add(expression);
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isTemplateExpression(expression)) return [expression.head.text, ...expression.templateSpans.flatMap(span => [...strings(span.expression, checker, seen), span.literal.text])];
  if (ts.isConditionalExpression(expression)) return [...strings(expression.whenTrue, checker, seen), ...strings(expression.whenFalse, checker, seen)];
  if (ts.isCallExpression(expression)) {
    const fn = callable(expression.expression, checker), values: string[] = [];
    if (fn?.body) {
      if (!ts.isBlock(fn.body)) return strings(fn.body, checker, seen);
      const visit = (node: ts.Node) => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression) values.push(...strings(node.expression, checker, seen));
        else ts.forEachChild(node, visit);
      };
      ts.forEachChild(fn.body, visit);
    }
    return values;
  }
  const value = initializer(expression, checker);
  if (value) return strings(value, checker, seen);
  const type = checker.getTypeAtLocation(expression);
  return (type.isUnion() ? type.types : [type]).flatMap(part => part.isStringLiteral() ? [part.value] : []);
}

function overlayClass(value: string): boolean {
  return value.split(/\s+/).some(name => {
    const words = name.toLowerCase().split(/[-_]/);
    const last = words.at(-1);
    return ['dropdown', 'popover', 'popup', 'backdrop', 'modal', 'dialog', 'menu', 'listbox', 'tooltip'].includes(last ?? '')
      || last === 'body' && ['menu', 'popup', 'popover'].includes(words.at(-2) ?? '');
  });
}

function objectProperties(expression: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Node>()): [string, ts.Expression][] {
  expression = unwrap(expression);
  if (seen.has(expression)) return [];
  seen = new Set(seen).add(expression);
  const value = initializer(expression, checker);
  if (value) return objectProperties(value, checker, seen);
  if (!ts.isObjectLiteralExpression(expression)) return [];
  return expression.properties.flatMap(property => {
    if (ts.isSpreadAssignment(property)) return objectProperties(property.expression, checker, seen);
    if (ts.isShorthandPropertyAssignment(property)) return [[property.name.text, property.name] as [string, ts.Expression]];
    if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return [[property.name.text, property.initializer] as [string, ts.Expression]];
    return [];
  });
}

function jsxTextEmitsChild(text: string): boolean {
  // JSX erases multiline indentation, but inline whitespace overrides children props.
  let lineBreak = false;
  for (let index = 0; index < text.length; index++) {
    const character = text.charCodeAt(index);
    if (!ts.isWhiteSpaceLike(character)) return true;
    if (ts.isLineBreak(character)) lineBreak = true;
  }
  return !lineBreak;
}

function fixedOverlay(properties: [string, string][]): boolean {
  const values = new Map(properties);
  return ['fixed', 'absolute'].includes(values.get('position') ?? '') && (values.has('zIndex') || values.has('z-index'));
}

function markupOverlay(text: string): boolean {
  // Parse markup only at a DOM HTML sink; documentation strings are not surfaces.
  const source = ts.createSourceFile('ui-markup.tsx', `const view = <>${text}</>;`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let overlay = false;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (overlayTags.has(node.tagName.getText(source))) overlay = true;
      for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute)) {
        const name = attribute.name.getText(source), value = attribute.initializer;
        if (name === 'popover' || name === 'aria-modal' || value && ts.isStringLiteral(value)
          && (name === 'role' && overlayRoles.has(value.text) || ['class', 'className'].includes(name) && overlayClass(value.text))) overlay = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return overlay;
}

function lintMarkup(text: string, file: string): UiViolation[] {
  const violations: UiViolation[] = [];
  for (let offset = 0; offset < text.length;) {
    const start = text.indexOf('<', offset);
    if (start === -1) break;
    if (text.startsWith('<!--', start)) { const end = text.indexOf('-->', start + 4); offset = end === -1 ? text.length : end + 3; continue; }
    let quote = '', end = start + 1;
    for (; end < text.length; end++) {
      const char = text[end]!;
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    offset = end + 1;
    const tag = text.slice(start, end + 1);
    if (tag.startsWith('</') || tag.startsWith('<!') || tag.startsWith('<?')) continue;
    if (markupOverlay(tag.endsWith('/>') ? tag : `${tag.slice(0, -1)}/>`)) {
      const before = text.slice(0, start), lines = before.split('\n');
      violations.push({ file, line: lines.length, column: lines.at(-1)!.length + 1, rule: 'ad-hoc-overlay',
        message: 'HTML overlay surface: use packages/ui-shell primitives; legacy markup requires an individually reviewed migration entry.',
        fingerprint: createHash('sha256').update(tag).digest('hex') });
    }
  }
  return violations;
}

// Canonical token values: durations in milliseconds, easing curves as numeric tuples.
const tokenDurations = new Set([30, 80, 120, 140, 160, 180, 200, 220, 240, 350, 600]);
const tokenCurves = new Set(['0.16,1,0.3,1', '0.4,0,0.2,1', '0.2,0.9,0.2,1.1']);

function lintStyles(text: string, file: string): UiViolation[] {
  if (primitiveImplementations[file]) return [];
  const violations: UiViolation[] = [], scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  // Use lexical blocks/declarations, keeping strings, comments and function values opaque.
  const stack: { start: number; header: string; declarations: [string, string][]; rawDeclarations: [string, string][]; name?: string; valueStart?: number; tokens: string[] }[] = [];
  let boundary = 0, parentheses = 0, token: ts.SyntaxKind;
  const declaration = (end: number) => {
    const frame = stack.at(-1);
    if (frame?.name) {
      frame.declarations.push([frame.name, frame.tokens.join('')]);
      frame.rawDeclarations.push([frame.name, text.slice(frame.valueStart ?? end, end).trim()]);
    }
    if (frame) { frame.name = undefined; frame.tokens = []; }
  };
  while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    const start = scanner.getTokenPos(), end = scanner.getTextPos(), frame = stack.at(-1);
    if (token === ts.SyntaxKind.OpenParenToken) parentheses++;
    if (token === ts.SyntaxKind.CloseParenToken) parentheses--;
    if (parentheses) { frame?.tokens.push(scanner.getTokenText()); continue; }
    if (token === ts.SyntaxKind.OpenBraceToken) {
      stack.push({ start: boundary, header: text.slice(boundary, start).trim(), declarations: [], rawDeclarations: [], tokens: [] }); boundary = end;
    } else if (token === ts.SyntaxKind.ColonToken && frame && !frame.name) {
      frame.name = frame.tokens.join(''); frame.tokens = []; frame.valueStart = end;
    } else if (token === ts.SyntaxKind.SemicolonToken) { declaration(start); boundary = end; }
    else if (token === ts.SyntaxKind.CloseBraceToken) {
      declaration(start);
      const block = stack.pop();
      if (block) {
        const leading = text.slice(block.start).search(/\S/), position = block.start + Math.max(0, leading);
        const lines = text.slice(0, position).split('\n');
        if (fixedOverlay(block.declarations) || block.header.includes('::backdrop')
          || ['fixed', 'absolute'].includes(new Map(block.declarations).get('position') ?? '') && overlayClass(block.header.replace(/[.#:[\]>+~(),]/g, ' '))) {
          violations.push({ file, line: lines.length, column: lines.at(-1)!.length + 1, rule: 'ad-hoc-overlay',
            message: 'Overlay CSS geometry/backdrop: styles belong to named shared primitives; legacy rules require an individually reviewed migration entry.',
            fingerprint: createHash('sha256').update(block.header + JSON.stringify(block.declarations)).digest('hex') });
        }
        for (const [name, value] of block.rawDeclarations) {
          if (!['transition', 'transition-duration', 'animation', 'animation-duration'].includes(name.trim())) continue;
          const durations = [...value.matchAll(/(\d*\.?\d+)(ms|s)\b/gi)]
            .map(match => match[2].toLowerCase() === 's' ? parseFloat(match[1]) * 1000 : parseFloat(match[1]));
          const curves = [...value.matchAll(/cubic-bezier\(\s*([^)]*)\)/gi)]
            .map(match => match[1].split(',').map(part => parseFloat(part.trim())).join(','));
          if (durations.some(duration => tokenDurations.has(duration)) || curves.some(curve => tokenCurves.has(curve))) {
            violations.push({ file, line: lines.length, column: lines.at(-1)!.length + 1, rule: 'off-token-motion',
              message: 'Motion literal duplicates a design token: use var(--ui-motion-*) / var(--ui-ease-*) instead.',
              fingerprint: createHash('sha256').update(block.header + name + value).digest('hex') });
          }
        }
      }
      boundary = end;
      const parent = stack.at(-1); if (parent) { parent.name = undefined; parent.tokens = []; }
    } else frame?.tokens.push(scanner.getTokenText());
  }
  return violations;
}

function importedFrom(expression: ts.Expression, checker: ts.TypeChecker, module: string, member: string, seen = new Set<ts.Node>()): boolean {
  expression = unwrap(expression);
  if (seen.has(expression)) return false;
  seen.add(expression);
  const value = initializer(expression, checker);
  if (value && importedFrom(value, checker, module, member, seen)) return true;
  const namespace = ts.isPropertyAccessExpression(expression) && expression.name.text === member ? expression.expression : undefined;
  const symbol = checker.getSymbolAtLocation(namespace ?? expression);
  return Boolean(symbol?.declarations?.some(declaration => {
    if (ts.isImportSpecifier(declaration) && !namespace) {
      const statement = declaration.parent.parent.parent;
      return (declaration.propertyName ?? declaration.name).text === member && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === module;
    }
    if (namespace && (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))) {
      const statement = ts.isNamespaceImport(declaration) ? declaration.parent.parent : declaration.parent;
      return ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === module;
    }
    return false;
  }));
}

export function lintUiProgram(program: ts.Program, files: string[], root: string): UiViolation[] {
  const checker = program.getTypeChecker(), violations: UiViolation[] = [], emitted = new Set<string>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw Error(`UI source was not parsed: ${file}`);
    const path = portable(relative(root, source.fileName));
    const references = new Map<ts.Symbol, ts.Identifier[]>(), discarded = new Map<ts.Node, boolean>();
    const collectReferences = (node: ts.Node) => {
      if (ts.isIdentifier(node)) { const symbol = checker.getSymbolAtLocation(node); if (symbol) references.set(symbol, [...(references.get(symbol) ?? []), node]); }
      ts.forEachChild(node, collectReferences);
    };
    collectReferences(source);
    function discardedCallback(node: ts.Node): boolean {
      if (discarded.has(node)) return discarded.get(node)!;
      const name = ts.isFunctionDeclaration(node) ? node.name : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined;
      const symbol = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined;
      const uses = symbol ? (references.get(symbol) ?? []).filter(reference => reference !== name) : [];
      const result = uses.length > 0 && uses.every(reference => {
        let parent: ts.Node = reference;
        while (ts.isParenthesizedExpression(parent.parent) || ts.isAsExpression(parent.parent) || ts.isNonNullExpression(parent.parent)) parent = parent.parent;
        return ts.isJsxExpression(parent.parent) && ts.isJsxAttribute(parent.parent.parent) && parent.parent.parent.name.getText(source) !== 'children';
      });
      discarded.set(node, result); return result;
    }
    function report(node: ts.Node, rule: UiViolation['rule'], message: string) {
      const start = node.getStart(source), key = `${path}:${start}:${rule}`;
      if (emitted.has(key)) return;
      emitted.add(key);
      const { line, character } = source!.getLineAndCharacterOfPosition(start);
      const syntax = printer.printNode(ts.EmitHint.Unspecified, node, source!);
      violations.push({ file: path, line: line + 1, column: character + 1, rule, message,
        fingerprint: createHash('sha256').update(syntax).digest('hex') });
    }
    function rendered(expression: ts.Expression, falsyVisible = true, seen = new Set<ts.Node>()) {
      expression = unwrap(expression);
      if (seen.has(expression)) return;
      seen = new Set(seen).add(expression);
      if (ts.isBinaryExpression(expression)) {
        const operator = expression.operatorToken.kind;
        if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
          if (falsyVisible && mayRenderZero(checker.getTypeAtLocation(expression.left), checker)) {
            report(expression.left, 'numeric-jsx-child', 'This rendered && gate can leak 0 (or has an unresolved type); use an explicit boolean comparison/coercion.');
          }
          rendered(expression.left, falsyVisible, seen);
          rendered(expression.right, falsyVisible, seen);
        } else if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
          rendered(expression.left, operator === ts.SyntaxKind.BarBarToken ? false : falsyVisible, seen);
          rendered(expression.right, falsyVisible, seen);
        }
      } else if (ts.isConditionalExpression(expression)) {
        rendered(expression.whenTrue, falsyVisible, seen);
        rendered(expression.whenFalse, falsyVisible, seen);
      } else if (ts.isArrayLiteralExpression(expression)) {
        for (const element of expression.elements) if (!ts.isOmittedExpression(element)) rendered(ts.isSpreadElement(element) ? element.expression : element, true, seen);
      } else if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
        && ['map', 'flatMap', 'from'].includes(expression.expression.name.text)) {
        for (const argument of expression.arguments) {
          const callback = callable(argument, checker);
          if (callback?.body) returned(callback.body, true, seen);
        }
      } else {
        const value = initializer(expression, checker);
        if (value) rendered(value, falsyVisible, seen);
      }
    }
    function returned(body: ts.ConciseBody, falsyVisible: boolean, seen: Set<ts.Node>) {
      if (!ts.isBlock(body)) { rendered(body, falsyVisible, seen); return; }
      const visit = (node: ts.Node) => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression) rendered(node.expression, falsyVisible, seen);
        else ts.forEachChild(node, visit);
      };
      ts.forEachChild(body, visit);
    }
    function containsJsxValue(expression: ts.Expression, seen = new Set<ts.Node>()): boolean {
      expression = unwrap(expression);
      if (seen.has(expression)) return false;
      seen = new Set(seen).add(expression);
      if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) return true;
      if (ts.isBinaryExpression(expression)) return containsJsxValue(expression.left, seen) || containsJsxValue(expression.right, seen);
      if (ts.isConditionalExpression(expression)) return containsJsxValue(expression.whenTrue, seen) || containsJsxValue(expression.whenFalse, seen);
      if (ts.isArrayLiteralExpression(expression)) return expression.elements.some(item => !ts.isOmittedExpression(item) && containsJsxValue(ts.isSpreadElement(item) ? item.expression : item, seen));
      const value = initializer(expression, checker);
      if (value) return containsJsxValue(value, seen);
      return false;
    }
    function jsxType(type: ts.Type): boolean {
      if (type.isUnion()) return type.types.some(jsxType);
      return Boolean(type.getSymbol()?.declarations?.some(declaration => {
        for (let owner: ts.Node | undefined = declaration.parent; owner; owner = owner.parent) {
          if (ts.isModuleDeclaration(owner) && owner.name.getText() === 'JSX') return true;
        }
        return false;
      }));
    }
    function nonRenderingAttribute(node: ts.Node): boolean {
      for (let owner: ts.Node | undefined = node; owner; owner = owner.parent) {
        if (ts.isJsxAttribute(owner) && owner.name.getText(source) !== 'children') return true;
        if (ts.isFunctionLike(owner) && discardedCallback(owner)) return true;
      }
      return false;
    }
    function sharedConsumer(tag: ts.JsxTagNameExpression): boolean {
      let symbol = checker.getSymbolAtLocation(tag);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      return Boolean(symbol?.declarations?.some(declaration => primitiveImplementations[portable(relative(root, declaration.getSourceFile().fileName))]));
    }
    function sharedAncestor(node: ts.Node): boolean {
      for(let owner=node.parent;owner;owner=owner.parent){
        if(ts.isFunctionLike(owner))return false;
        if(ts.isJsxElement(owner)&&sharedConsumer(owner.openingElement.tagName))return true;
      }
      return false;
    }
    function jsxValue(node:ts.JsxOpeningLikeElement,name:string):ts.Expression|undefined{
      const prop=node.attributes.properties.find((item):item is ts.JsxAttribute=>ts.isJsxAttribute(item)&&item.name.getText(source)===name);
      return prop?.initializer&&(ts.isJsxExpression(prop.initializer)?prop.initializer.expression:ts.isStringLiteral(prop.initializer)?prop.initializer:undefined);
    }
    const idPrinter=ts.createPrinter({removeComments:true});
    function identityExpressions(value:ts.Expression|undefined):string[]{
      if(!value)return[];value=unwrap(value);
      if(ts.isConditionalExpression(value))return[...identityExpressions(value.whenTrue),...identityExpressions(value.whenFalse)];
      if(value.kind===ts.SyntaxKind.UndefinedKeyword||ts.isIdentifier(value)&&value.text==='undefined')return[];
      const symbols:number[]=[];
      const collect=(node:ts.Node)=>{if(ts.isIdentifier(node)){const declaration=checker.getSymbolAtLocation(node)?.declarations?.[0];if(declaration)symbols.push(declaration.getStart());}ts.forEachChild(node,collect);};collect(value);
      return[idPrinter.printNode(ts.EmitHint.Expression,value,value.getSourceFile())+'@'+symbols.join(',')];
    }
    const sharedIds=new WeakMap<ts.Node,Set<string>>();
    function sharedRoleOwner(node:ts.Node):boolean{
      if(sharedAncestor(node))return true;
      if(!ts.isJsxOpeningElement(node)&&!ts.isJsxSelfClosingElement(node))return false;
      if(!['button','input'].includes(node.tagName.getText(source)))return false;
      const controls=identityExpressions(jsxValue(node,'aria-controls'));if(!controls.length)return false;
      let scope:ts.Node=node;while(scope.parent&&!ts.isFunctionLike(scope)&&!ts.isSourceFile(scope))scope=scope.parent;
      let ids=sharedIds.get(scope);
      if(!ids){ids=new Set();const found=ids;
        const collect=(item:ts.Node)=>{
          if(item!==scope&&ts.isFunctionLike(item))return;
          if((ts.isJsxOpeningElement(item)||ts.isJsxSelfClosingElement(item))&&(sharedConsumer(item.tagName)||sharedAncestor(item)))for(const key of identityExpressions(jsxValue(item,'id')))found.add(key);
          ts.forEachChild(item,collect);
        };collect(scope);sharedIds.set(scope,ids);
      }
      return controls.every(key=>ids.has(key));
    }
    function architecture(node: ts.Node) {
      if (primitiveImplementations[path]) return;
      let reason = '';
      function attribute(name: string, value?: ts.Expression) {
        const values = value ? strings(value, checker) : [];
        if (name === 'role' && values.some(item => overlayRoles.has(item))&&!sharedRoleOwner(node)) reason ||= `overlay role ${values.join('/')}`;
        if (name === 'popover' || name === 'aria-modal') reason ||= `native ${name} surface`;
        if (['className', 'class'].includes(name) && values.some(overlayClass)) reason ||= 'overlay surface class';
        if (['srcDoc', 'srcdoc'].includes(name) && values.some(markupOverlay)) reason ||= 'iframe overlay markup';
        if (name === 'dangerouslySetInnerHTML' && value && objectProperties(value, checker).some(([key, html]) => key === '__html' && strings(html, checker).some(markupOverlay))) reason ||= 'React DOM overlay markup';
        if (name === 'style' && value && fixedOverlay(objectProperties(value, checker).map(([key, item]) => [key, strings(item, checker)[0] ?? item.getText(source)]))) reason ||= 'fixed/absolute overlay geometry';
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (sharedConsumer(node.tagName)) return;
        const tag = node.tagName.getText(source);
        if (overlayTags.has(tag)) reason = `native <${tag}>`;
        for (const prop of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(prop)) for (const [name, value] of objectProperties(prop.expression, checker)) attribute(name, value);
          if (!ts.isJsxAttribute(prop)) continue;
          const value = prop.initializer;
          attribute(prop.name.getText(source), value && ts.isJsxExpression(value) ? value.expression : value && ts.isStringLiteral(value) ? value : undefined);
        }
      } else if (ts.isCallExpression(node)) {
        if (importedFrom(node.expression, checker, 'react-dom', 'createPortal')) reason = 'React portal';
        if (importedFrom(node.expression, checker, 'react', 'createElement')) {
          if (node.arguments[0] && strings(node.arguments[0], checker).some(value => overlayTags.has(value))) reason = 'React factory native overlay';
          if (node.arguments[1]) for (const [name, value] of objectProperties(node.arguments[1], checker)) attribute(name, value);
        }
        if (ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text, args = node.arguments;
          if (method === 'createElement' && args[0] && strings(args[0], checker).some(value => overlayTags.has(value))) reason = 'imperative native overlay';
          if (method === 'setAttribute' && args[0] && args[1]) {
            const names = strings(args[0], checker), values = strings(args[1], checker);
            if (names.includes('role') && values.some(value => overlayRoles.has(value))
              || names.includes('popover') || names.includes('aria-modal')
              || names.includes('class') && values.some(overlayClass)) reason = 'imperative overlay attributes';
            if (names.includes('srcdoc') && values.some(markupOverlay)) reason = 'iframe overlay markup';
          }
          if (method === 'insertAdjacentHTML' && args[1] && strings(args[1], checker).some(markupOverlay)) reason = 'DOM overlay markup';
          const receiver = unwrap(node.expression.expression);
          if (method === 'send' && args[0] && ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
            const html = receiver.expression.name.text === 'type' ? receiver.arguments[0]
              : receiver.expression.name.text === 'header' && receiver.arguments[0] && strings(receiver.arguments[0], checker).some(value => value.toLowerCase() === 'content-type') ? receiver.arguments[1] : undefined;
            if (html && strings(html, checker).some(value => /^text\/html(?:\s*;|$)/i.test(value)) && strings(args[0], checker).some(markupOverlay)) reason = 'HTML response overlay markup';
          }
        }
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
        const name = node.left.name.text, values = strings(node.right, checker);
        if (name === 'className' && values.some(overlayClass)) reason = 'imperative overlay class';
        if (['innerHTML', 'outerHTML', 'srcdoc'].includes(name) && values.some(markupOverlay)) reason = 'DOM overlay markup';
        if (name === 'cssText' && values.some(value => fixedOverlay(value.split(';').map(part => part.split(':').map(text => text.trim()) as [string, string])))) reason = 'imperative overlay geometry';
      }
      if (reason) report(node, 'ad-hoc-overlay', `${reason}: use packages/ui-shell primitives; legacy occurrences require an individually reviewed migration entry.`);
    }
    function visit(node: ts.Node) {
      architecture(node);
      if (!nonRenderingAttribute(node) && ts.isJsxExpression(node) && node.expression
        && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) rendered(node.expression);
      if (!nonRenderingAttribute(node) && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
        // React uses explicit nested children before any children prop; otherwise the last prop wins.
        const nested = ts.isJsxOpeningElement(node) && node.parent.children.some(child =>
          ts.isJsxText(child) ? jsxTextEmitsChild(child.text) : !ts.isJsxExpression(child) || Boolean(child.expression));
        if (!nested) {
          let child: ts.Expression | undefined;
          for (const property of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(property)) {
              for (const [name, value] of objectProperties(property.expression, checker)) if (name === 'children') child = value;
            } else if (ts.isJsxAttribute(property) && property.name.getText(source) === 'children') {
              child = property.initializer && ts.isJsxExpression(property.initializer) ? property.initializer.expression : undefined;
            }
          }
          if (child) rendered(child);
        }
      }
      if (!nonRenderingAttribute(node) && ts.isReturnStatement(node) && node.expression
        && (containsJsxValue(node.expression) || jsxType(checker.getTypeAtLocation(node.expression)))) rendered(node.expression);
      if (!nonRenderingAttribute(node) && ts.isArrowFunction(node) && !ts.isBlock(node.body) && containsJsxValue(node.body)) rendered(node.body);
      if (!nonRenderingAttribute(node) && ts.isCallExpression(node)) {
        if (importedFrom(node.expression, checker, 'react', 'createElement')) {
          for (const child of node.arguments.slice(2)) rendered(child);
          if (node.arguments.length <= 2 && node.arguments[1]) {
            const child = new Map(objectProperties(node.arguments[1], checker)).get('children');
            if (child) rendered(child);
          }
        }
        if (importedFrom(node.expression, checker, 'react-dom', 'createPortal') && node.arguments[0]) rendered(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
}

export function applyOverlayPolicy(violations: UiViolation[], inventory: LegacyOverlay[]) {
  const remaining = [...inventory], legacy: UiViolation[] = [], fresh: UiViolation[] = [];
  for (const violation of violations) {
    const index = remaining.findIndex(entry => violation.rule === 'ad-hoc-overlay' && entry.rule === violation.rule
      && entry.file === violation.file && entry.fingerprint === violation.fingerprint && entry.reason.trim().length > 0);
    if (index === -1) fresh.push(violation);
    else { remaining.splice(index, 1); legacy.push(violation); }
  }
  return { violations: fresh, legacy, retired: remaining };
}

export function scanUi(root: string) {
  root = resolve(root);
  const configPath = join(root, 'tsconfig.json'), config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) throw Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const files: string[] = [];
  function discover(directory: string) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'build', '.git'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) discover(path);
      else if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css'].includes(extname(path)) && !path.endsWith('.d.ts')) files.push(path);
    }
  }
  for (const directory of ['apps/web', 'apps/desktop', 'apps/server', 'packages']) discover(join(root, directory));
  const plugins = join(root, 'plugins');
  if (existsSync(plugins)) for (const entry of readdirSync(plugins, { withFileTypes: true })) if (entry.isDirectory()) discover(join(plugins, entry.name, 'src'));
  files.sort();
  const scriptFiles = files.filter(file => !['.html', '.css'].includes(extname(file)));
  const inline = new Map<string, { text: string; file: string; line: number; column: number }>();
  for (const file of files.filter(path => path.endsWith('.html'))) {
    const text = readFileSync(file, 'utf8'), lower = text.toLowerCase();
    for (let offset = 0, ordinal = 0; offset < text.length;) {
      const tag = lower.indexOf('<script', offset);
      if (tag === -1) break;
      const start = text.indexOf('>', tag) + 1, end = lower.indexOf('</script', start);
      if (!start || end === -1) break;
      offset = end + 8;
      const opening = ts.createSourceFile('script-tag.tsx', `const tag = ${text.slice(tag, start - 1)}/>;`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const declaration = (opening.statements[0] as ts.VariableStatement)?.declarationList?.declarations[0]?.initializer;
      const type = declaration && ts.isJsxSelfClosingElement(declaration) ? declaration.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(opening) === 'type') : undefined;
      if (type && ts.isJsxAttribute(type) && type.initializer && ts.isStringLiteral(type.initializer)
        && !['module', 'text/javascript', 'application/javascript'].includes(type.initializer.text)) continue;
      const lines = text.slice(0, start).split('\n');
      inline.set(portable(`${file}.inline-${ordinal++}.js`), { text: text.slice(start, end), file: portable(relative(root, file)), line: lines.length - 1, column: lines.at(-1)!.length });
    }
  }
  const options = { ...parsed.options, allowJs: true, noEmit: true }, host = ts.createCompilerHost(options);
  const originalSource = host.getSourceFile.bind(host), originalExists = host.fileExists.bind(host);
  host.fileExists = file => inline.has(portable(file)) || originalExists(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => inline.has(portable(file))
    ? ts.createSourceFile(file, inline.get(portable(file))!.text, options.target ?? ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    : originalSource(file, languageVersion, onError, shouldCreateNewSourceFile);
  const inputs = [...scriptFiles, ...inline.keys()];
  const program = ts.createProgram(inputs, options, host);
  const syntaxErrors = program.getSyntacticDiagnostics();
  if (syntaxErrors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(syntaxErrors, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  const violations = lintUiProgram(program, inputs, root).map(item => {
    const origin = inline.get(portable(resolve(root, item.file)));
    return origin ? { ...item, file: origin.file, line: item.line + origin.line, column: item.column + (item.line === 1 ? origin.column : 0) } : item;
  });
  for (const file of files) {
    const path = portable(relative(root, file));
    if (file.endsWith('.html')) violations.push(...lintMarkup(readFileSync(file, 'utf8'), path));
    if (file.endsWith('.css')) violations.push(...lintStyles(readFileSync(file, 'utf8'), path));
  }
  return { files: files.map(file => portable(relative(root, file))), violations: violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column) };
}

export function readOverlayInventory(path: string): LegacyOverlay[] {
  if (!existsSync(path)) return [];
  const inventory = JSON.parse(readFileSync(path, 'utf8'));
  if (inventory.version !== 1 || !Array.isArray(inventory.entries) || inventory.entries.some((entry: LegacyOverlay) =>
    entry.rule !== 'ad-hoc-overlay' || typeof entry.file !== 'string' || !entry.file || typeof entry.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || typeof entry.reason !== 'string' || !entry.reason.trim())) throw Error('Invalid per-occurrence legacy overlay inventory.');
  return inventory.entries;
}
