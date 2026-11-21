import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = '45.2.0'; // Packaged Electron — the addon must match its import lib, not Node's.
const inputs = [
  [`node-v${version}-headers.tar.gz`, '42eaab65c533d5bb3189a39f6d653138362d4ad1dfcb94cba9b713d77e873c72'],
  ['win-x64/node.lib', 'c4ba898a42b8e5e37eeecae6e89c9831d59e0e2d9a279b4189fc2b349ac63156'],
] as const;

function run(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(file, args, { cwd, env, windowsHide: true, windowsVerbatimArguments: /[\\/]cmd\.exe$/i.test(file), stdio: 'inherit' });
  if (result.error || result.status !== 0) throw Error('Windows control bridge compilation failed.');
}

/** Compiles the M16 C4 Windows.Graphics.Capture bridge for the shipped
 * Electron host: Electron's own node headers and node.exe import library are
 * pinned by digest in a dedicated cache (shared caches could silently serve
 * the credential-lease Node inputs). */
export async function buildWindowsControlBridge(outputDirectory = join(root, 'packages/core')) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Control bridge build requires Windows x64.');
  const artifact = join(resolve(outputDirectory), 'windows-control-bridge.node'), source = join(root, 'packages/core/windows-control-bridge.cc');
  // Rebuilding needs pinned Electron headers plus Visual Studio; skip it when
  // the native module on disk already covers the current source and script.
  const script = fileURLToPath(import.meta.url);
  if (existsSync(artifact) && statSync(artifact).mtimeMs >= statSync(source).mtimeMs && statSync(artifact).mtimeMs >= statSync(script).mtimeMs) return artifact;
  const cache = join(root, '.harness-windows-control-bridge-build');
  await mkdir(cache, { recursive: true });
  for (const [name, sha256] of inputs) {
    const target = join(cache, name.split('/').at(-1)!); let bytes: Buffer | undefined;
    try { bytes = await readFile(target); } catch { /* Download only pinned public build inputs. */ }
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sha256) {
      const response = await fetch(`https://artifacts.electronjs.org/headers/dist/v${version}/${name}`);
      if (!response.ok) throw Error('Pinned Electron build input is unavailable.');
      bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error('Electron build input checksum mismatch.');
      await writeFile(target, bytes);
    }
  }
  run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe'), ['-xzf', join(cache, inputs[0][0])], cache);
  const include = join(cache, 'node_headers/include/node'), library = join(cache, 'node.lib');
  if (!existsSync(join(include, 'node_api.h')) || !existsSync(library)) throw Error('Pinned Electron build inputs did not stage.');
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
  const installation = existsSync(vswhere) ? spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() : '';
  if (!installation) throw Error('Windows control bridge build requires Visual Studio C++ Build Tools.');
  const setup = join(installation, 'Common7/Tools/VsDevCmd.bat'), response = join(cache, 'compile-control-bridge.rsp'), output = artifact;
  await mkdir(dirname(output), { recursive: true });
  if ([setup, response, source, output, include, library, cache].some(path => /[\r\n"%&|<>^]/.test(path))) throw Error('Unsupported native build path.');
  await writeFile(response, [
    '/nologo', '/LD', '/EHsc', '/std:c++20', '/O2', '/MT', '/DNAPI_VERSION=8', '/DNODE_GYP_MODULE_NAME=windows_control_bridge',
    `/I"${include}"`, `"${source}"`, `"${library}"`,
    'windowsapp.lib', 'd3d11.lib', 'dxgi.lib', 'ole32.lib', 'dwmapi.lib', 'user32.lib', 'delayimp.lib',
    // The addon loads inside Electron's main process: delay-load node.exe so the
    // delay hook binds its imports to the host executable at load time.
    '/link', '/DELAYLOAD:node.exe', `/OUT:"${output}"`,
  ].join(' '));
  run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/cmd.exe'), ['/d', '/s', '/c', `call "${setup}" -arch=x64 >nul && cl.exe @"${response}"`], cache, { ...process.env, PATH: dirname(vswhere) + ';' + process.env.PATH });
  // Diagnostic only (Node host): developer PATH must not hide unstaged native
  // DLL dependencies. The acceptance load is the installed Electron process.
  run(process.execPath, ['-e', 'if(typeof require(process.argv[1]).pickWindow!=="function")process.exit(1)', output], cache, { ...process.env, PATH: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') });
  return output;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.platform === 'win32') { await buildWindowsControlBridge(); console.log('Windows control bridge built.'); }
  else console.log('Windows control bridge build skipped (Windows x64 only).');
}
