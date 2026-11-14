import { join, resolve } from 'node:path';
import ts from 'typescript';
import { applyOverlayPolicy, readOverlayInventory, scanUi } from './ui-guard';

try {
  let root = process.cwd(), json = false, check = false;
  for (let index = 2; index < process.argv.length; index++) {
    if (process.argv[index] === '--root' && process.argv[index + 1]) root = resolve(process.argv[++index]!);
    else if (process.argv[index] === '--json') json = true;
    else if (process.argv[index] === '--check') check = true;
    else throw Error(`Unknown UI guard argument: ${process.argv[index]}`);
  }
  // --check reuses the overlay program for semantic diagnostics, so `pnpm lint`
  // replaces separate `tsc --noEmit` + `lint:ui` program constructions.
  const scan = scanUi(root, { check }), result = applyOverlayPolicy(scan.violations, readOverlayInventory(join(root, 'scripts/ui-overlay-legacy.json')));
  if (json) console.log(JSON.stringify({ files: scan.files, ...result }, null, 2));
  else {
    for (const item of result.violations) console.log(`${item.file}:${item.line}:${item.column} [${item.rule}] ${item.message}`);
    console.log(`UI guard: ${scan.files.length} sources; ${result.violations.length} violations; ${result.legacy.length} inventoried legacy/geometry occurrences (not primitive approvals); ${result.retired.length} retired entries.`);
  }
  if (check && scan.diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(scan.diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  process.exitCode = result.violations.length || scan.diagnostics.length ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
