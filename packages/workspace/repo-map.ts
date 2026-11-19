import ts from 'typescript';

export type RepoMappedFile = { path: string; mode: 'PARSED' | 'FILE_LIST_ONLY'; imports: string[]; exports: { name: string; line: number }[] };
export const REPO_MAP_PARSER = 'typescript@' + ts.version;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const ignored = /^(?:\.git|node_modules|\.env(?:\..*)?|.*\.(?:pem|key|pfx|p12)|\.harness.*|\.claude|\.codex|\.pi|\.hermes|secrets?|credentials?)$/i;
const supported = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
export const repoMapPrivateSegment = (part: string) => ignored.test(part);
export const repoMapLanguageSupported = (path: string) => supported.test(path);
export const repoMapPathAllowed = (path: string) => path.length <= 1024 && !/[\\:\u0000]/.test(path) &&
  path.split('/').every(part => part && part !== '.' && part !== '..' && !ignored.test(part));

/** No filesystem crawl or inferred call graph. The host supplies admitted file identities and source bytes. */
export function buildRepoMap(grantedPaths: readonly string[], readAdmitted: (path: string) => string) {
  const ordered = [...new Set(grantedPaths.filter(repoMapPathAllowed))].sort(compare);
  const files: RepoMappedFile[] = [];
  for (const path of ordered.slice(0, 128)) {
    const entry: RepoMappedFile = { path, mode: 'FILE_LIST_ONLY', imports: [], exports: [] };
    files.push(entry);
    if (!supported.test(path)) continue;
    const source = readAdmitted(path);
    if (Buffer.byteLength(source) > 256 * 1024) continue;
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    if ((tree as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) continue;
    entry.mode = 'PARSED';
    const edges = new Set<string>();
    const exported = (name: string, node: ts.Node) => entry.exports.push({ name, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
    const boundNames = (name: ts.BindingName): ts.Identifier[] => ts.isIdentifier(name) ? [name] : name.elements.flatMap(element => ts.isBindingElement(element) ? boundNames(element.name) : []);
    for (const statement of tree.statements) {
      if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)) edges.add(statement.moduleSpecifier.text);
      if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && statement.moduleReference.expression && ts.isStringLiteral(statement.moduleReference.expression)) edges.add(statement.moduleReference.expression.text);
      if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) exported(element.name.text, element.name);
        else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) exported(statement.exportClause.name.text, statement.exportClause.name);
        continue;
      }
      if (ts.isExportAssignment(statement)) { exported(statement.isExportEquals ? 'export=' : 'default', statement); continue; }
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      if (!modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const defaultExport = modifiers.find(mod => mod.kind === ts.SyntaxKind.DefaultKeyword);
      if (defaultExport) { exported('default', defaultExport); continue; }
      const named = ts.isVariableStatement(statement) ? statement.declarationList.declarations.flatMap(decl => boundNames(decl.name)) :
        ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isImportEqualsDeclaration(statement) ? [statement.name] : [];
      for (const name of named) if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) exported(name.text, name);
    }
    // TypeScript import types are declared module dependencies even when
    // nested in another type. A runtime import() call is a different node.
    const pending: ts.Node[] = [tree];
    while (pending.length) {
      const node = pending.pop()!;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
        edges.add(node.argument.literal.text);
      ts.forEachChild(node, child => { pending.push(child); });
    }
    entry.imports = [...edges].sort(compare);
    entry.exports.sort((a, b) => compare(a.name, b.name) || a.line - b.line);
  }
  return { files, omittedFiles: Math.max(0, ordered.length - files.length) };
}

/** Deterministic ranking over an existing map: explicit requested-path match first, then referenced-symbol
 * count descending, then normalized path and first matching symbol ascending. Never mutates the map. */
export function rankRepoMap<T extends RepoMappedFile>(map: { files: readonly T[] }, request: { paths?: readonly string[]; symbols?: readonly string[] }) {
  const paths = new Set((request.paths ?? []).filter(path => typeof path === 'string' && repoMapPathAllowed(path)));
  const symbols = [...new Set((request.symbols ?? []).filter(symbol => typeof symbol === 'string' && symbol.length > 0))].sort(compare);
  const ranked = map.files.map(file => {
    const matched = symbols.filter(symbol => file.exports.some(entry => entry.name === symbol));
    return { ...file, imports: [...file.imports], exports: file.exports.map(entry => ({ ...entry })),
      requestedPath: paths.has(file.path), referencedSymbols: matched.length, matchedSymbols: matched };
  });
  ranked.sort((a, b) => Number(b.requestedPath) - Number(a.requestedPath) || b.referencedSymbols - a.referencedSymbols ||
    compare(a.path, b.path) || compare(a.matchedSymbols[0] ?? '', b.matchedSymbols[0] ?? ''));
  return { files: ranked };
}
