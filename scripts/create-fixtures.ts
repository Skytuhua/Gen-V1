import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PDFDocument, StandardFonts } from "pdf-lib";

export interface FixtureManifest { version: 1; root: string; files: Record<string, string>; repository: string; database: string; pdf: string; sources: string[]; limitations: string[] }
export async function createFixtures(destination: string): Promise<FixtureManifest> {
  if (!destination || !destination.trim()) throw new Error("An explicit NEW destination is required");
  const root = resolve(destination);
  // Exclusive mkdir, without recursive:true: never reuse or modify an existing project/directory.
  try { await mkdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Destination already exists: ${root}`); throw error; }
  const write = (path: string, content: string | Uint8Array) => writeFile(join(root, path), content, { flag: "wx" });
  const repository = join(root, "repository"); await mkdir(repository); await mkdir(join(root, "sources"));
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Disposable Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Disposable Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid", GIT_CONFIG_COUNT: "0" };
  // Strip caller-supplied repository/config overrides; no inherited git path can redirect fixture writes.
  for (const name of Object.keys(gitEnv)) if (name.startsWith("GIT_") && !["GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_TERMINAL_PROMPT", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_CONFIG_COUNT"].includes(name)) delete gitEnv[name as keyof typeof gitEnv];
  function git(args: string[], expected = 0) {
    const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", "-c", "core.fsmonitor=false", ...args], { cwd: repository, env: gitEnv, encoding: "utf8", windowsHide: true, shell: false });
    if (result.error || result.status !== expected) throw new Error(`Fixture git ${args[0]} failed (${result.status}): ${result.error?.message ?? result.stderr}`);
    return result.stdout;
  }
  git(["init", "-b", "main"]);
  await write("repository/conflict.txt", "Shared baseline\n");
  await write("repository/calculator.mjs", "export const total = items => items.reduce((sum, item) => sum + item.price, 0);\n");
  await write("repository/pass.test.mjs", "import test from 'node:test'; import assert from 'node:assert/strict'; test('baseline',()=>assert.equal(2+2,4));\n");
  await write("repository/quantity.test.mjs", "import test from 'node:test'; import assert from 'node:assert/strict'; import {total} from './calculator.mjs'; test('quantity included',()=>assert.equal(total([{price:3,quantity:4}]),12));\n");
  await write("repository/fail.test.mjs", "import test from 'node:test'; import assert from 'node:assert/strict'; test('intentional failure',()=>assert.equal(1,2));\n");
  await write("repository/README.md", "Disposable local repository. quantity.test.mjs fails until calculator.mjs includes quantity. fail.test.mjs is intentionally always red. conflict.txt is a real unmerged conflict. No remote exists.\n");
  git(["add", "."]); git(["commit", "-m", "Fixture baseline"]); git(["switch", "-c", "fixture-side"]);
  await writeFile(join(repository, "conflict.txt"), "Side branch decision\n"); git(["add", "conflict.txt"]); git(["commit", "-m", "Fixture side"]);
  git(["switch", "main"]); await writeFile(join(repository, "conflict.txt"), "Main branch decision\n"); git(["add", "conflict.txt"]); git(["commit", "-m", "Fixture main"]);
  git(["merge", "--no-edit", "fixture-side"], 1);
  if (!git(["status", "--porcelain"]).includes("UU conflict.txt")) throw new Error("Fixture merge did not produce a real conflict");
  await write("sources/research-a.md", "# Harbor telemetry\nSource A, recorded 2026-10-01. Unit: shipments. North: 12, South: 8. Totals include delayed shipments. Confidence: direct measurement.\n");
  await write("sources/research-b.md", "# Harbor audit\nSource B, recorded 2026-10-02. North: 10 on-time plus 2 delayed. South: 8 on-time. The earlier assertion 'South 11' is withdrawn. These are synthetic disposable fixtures.\n");
  await write("sources/planning.md", "# Clinic plan\nBudget 2400 units. Workshop costs 800, survey 400, prototype 1200. Survey precedes prototype; workshop precedes survey. Two volunteers, 6 hours each per week. Deadline in 3 weeks. Workshop 4 hours, survey 6 hours, prototype 8 hours.\n");
  await write("sources/novel.md", "# Tidepool custody\nSpecimens Aster and Birch require a reusable custody handoff app, not a fixed category page. Handoffs need specimen id, receiver, timestamp and source note; receiver edits must survive expand/collapse. Specimen Aster source slot A; Birch slot B.\n");
  await write("sources/records.json", JSON.stringify([{ region: "North", count: 12 }, { region: "South", count: 8 }], null, 2));
  const database = join(root, "external.sqlite"); const db = new DatabaseSync(database);
  try { db.exec("CREATE TABLE tasks(id INTEGER PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL); INSERT INTO tasks VALUES(1,'Survey','todo'),(2,'Prototype','todo'),(3,'Workshop','done'); CREATE TABLE observations(region TEXT PRIMARY KEY,count INTEGER NOT NULL); INSERT INTO observations VALUES('North',12),('South',8)"); } finally { db.close(); }
  const document = await PDFDocument.create(); const page = document.addPage([612, 792]); const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Disposable evidence and consent form", { x: 40, y: 740, size: 18, font }); page.drawText("Visual signature mark only; no digital certificate.", { x: 40, y: 710, size: 11, font });
  const form = document.getForm(); form.createTextField("fullName").addToPage(page, { x: 40, y: 640, width: 260, height: 25 }); form.createCheckBox("consent").addToPage(page, { x: 40, y: 600, width: 18, height: 18 });
  const role = form.createDropdown("role"); role.addOptions(["Researcher", "Reviewer"]); role.addToPage(page, { x: 40, y: 550, width: 200, height: 25 });
  await write("editable.pdf", await document.save()); await mkdir(join(root, "exports"));
  const files: Record<string, string> = {};
  async function inventory(path = "") {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const name = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await inventory(name);
      else files[name] = createHash("sha256").update(await readFile(join(root, name))).digest("hex");
    }
  }
  await inventory();
  const manifest: FixtureManifest = { version: 1, root, files, repository, database, pdf: join(root, "editable.pdf"), sources: ["research-a.md", "research-b.md", "planning.md", "novel.md", "records.json"].map(p => join(root, "sources", p)), limitations: ["Synthetic disposable data only", "No remote Git, credentials or user projects", "PDF visual marks have no certificate"] };
  await write("manifest.json", JSON.stringify(manifest, null, 2)); return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1) { console.error("Usage: pnpm fixtures:create <NEW-destination>"); process.exitCode = 2; }
  else createFixtures(args[0]).then(manifest => console.log(JSON.stringify(manifest, null, 2))).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
