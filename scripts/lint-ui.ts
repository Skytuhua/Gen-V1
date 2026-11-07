import { join, resolve } from 'node:path';
import { applyOverlayPolicy, readOverlayInventory, scanUi } from './ui-guard';

try {
  let root = process.cwd(), json = false;
  for (let index = 2; index < process.argv.length; index++) {
    if (process.argv[index] === '--root' && process.argv[index + 1]) root = resolve(process.argv[++index]!);
    else if (process.argv[index] === '--json') json = true;
    else throw Error(`Unknown UI guard argument: ${process.argv[index]}`);
  }
  const scan = scanUi(root), result = applyOverlayPolicy(scan.violations, readOverlayInventory(join(root, 'scripts/ui-overlay-legacy.json')));
  if (json) console.log(JSON.stringify({ files: scan.files, ...result }, null, 2));
  else {
    for (const item of result.violations) console.log(`${item.file}:${item.line}:${item.column} [${item.rule}] ${item.message}`);
    console.log(`UI guard: ${scan.files.length} sources; ${result.violations.length} violations; ${result.legacy.length} inventoried legacy/geometry occurrences (not primitive approvals); ${result.retired.length} retired entries.`);
  }
  process.exitCode = result.violations.length ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
