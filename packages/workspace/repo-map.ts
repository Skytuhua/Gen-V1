import ts from 'typescript';

type MappedFile = { path: string; mode: 'PARSED' | 'FILE_LIST_ONLY'; imports: string[]; exports: { name: string; line: number }[] };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const ignored = /^(?:\.git|node_modules|\.env(?:\..*)?|.*\.(?:pem|key|pfx|p12)|\.harness.*|\.claude|\.codex|\.pi|\.hermes|secrets?|credentials?)$/i;
const supported = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const allowed = (path: string) => path.length <= 1024 && !/[\\:\u0000]/.test(path) &&
  path.split('/').every(part => part && part !== '.' && part !== '..' && !ignored.test(part));

/** No filesystem crawl or inferred call graph. The host supplies admitted file identities and source bytes. */
export function buildRepoMap(grantedPaths: readonly string[], readAdmitted: (path: string) => string) {
  const ordered = [...new Set(grantedPaths.filter(allowed))].sort(compare);
  const files: MappedFile[] = [];
  for (const path of ordered.slice(0, 128)) {
    const entry: MappedFile = { path, mode: 'FILE_LIST_ONLY', imports: [], exports: [] };
    files.push(entry);
    if (!supported.test(path)) continue;
    const source = readAdmitted(path);
    if (Buffer.byteLength(source) > 256 * 1024) continue;
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    if ((tree as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) continue;
    entry.mode = 'PARSED';
    const edges = new Set<string>();
    for (const statement of tree.statements) {
      if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)) edges.add(statement.moduleSpecifier.text);
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const named = ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(decl => decl.name) :
        'name' in statement ? [(statement as ts.NamedDeclaration).name] : [];
      for (const name of named) if (name && ts.isIdentifier(name)) entry.exports.push({
        name: name.text, line: tree.getLineAndCharacterOfPosition(name.getStart(tree)).line + 1,
      });
    }
    entry.imports = [...edges].sort(compare);
    entry.exports.sort((a, b) => compare(a.name, b.name) || a.line - b.line);
  }
  return { files, omittedFiles: Math.max(0, ordered.length - files.length) };
}
