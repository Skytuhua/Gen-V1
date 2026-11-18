import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, '.harness-windows-credential-build');

function run(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(file, args, { cwd, env, windowsHide: true, windowsVerbatimArguments: /[\\/]cmd\.exe$/i.test(file), stdio: 'inherit' });
  if (result.error || result.status !== 0) throw Error('Windows control bridge compilation failed.');
}

/** Compiles the M16 C4 Windows.Graphics.Capture bridge. Shares the pinned
 * Node-API headers and node.lib already staged by the credential-lease build;
 * this script only adds the WinRT/D3D link surface. */
export async function buildWindowsControlBridge(outputDirectory = join(root, 'packages/core')) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Control bridge build requires Windows x64.');
  const artifact = join(resolve(outputDirectory), 'windows-control-bridge.node'), source = join(root, 'packages/core/windows-control-bridge.cc');
  // Rebuilding needs pinned Node headers plus Visual Studio; skip it when the
  // native module on disk already covers the current source.
  if (existsSync(artifact) && statSync(artifact).mtimeMs >= statSync(source).mtimeMs) return artifact;
  const include = join(cache, 'node-v24.14.0/include/node'), library = join(cache, 'node.lib');
  if (!existsSync(include) || !existsSync(library)) throw Error('Run build:credential-lease first to stage the pinned Node build inputs.');
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
  const installation = existsSync(vswhere) ? spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() : '';
  if (!installation) throw Error('Windows control bridge build requires Visual Studio C++ Build Tools.');
  const setup = join(installation, 'Common7/Tools/VsDevCmd.bat'), response = join(cache, 'compile-control-bridge.rsp'), output = artifact;
  await mkdir(cache, { recursive: true });
  await mkdir(dirname(output), { recursive: true });
  if ([setup, response, source, output, include, library, cache].some(path => /[\r\n"%&|<>^]/.test(path))) throw Error('Unsupported native build path.');
  await writeFile(response, [
    '/nologo', '/LD', '/EHsc', '/std:c++17', '/O2', '/MT', '/DNAPI_VERSION=8', '/DNODE_GYP_MODULE_NAME=windows_control_bridge',
    `/I"${include}"`, `"${source}"`, `"${library}"`,
    'windowsapp.lib', 'd3d11.lib', 'dxgi.lib', 'ole32.lib', 'dwmapi.lib',
    '/link', `/OUT:"${output}"`,
  ].join(' '));
  run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/cmd.exe'), ['/d', '/s', '/c', `call "${setup}" -arch=x64 >nul && cl.exe @"${response}"`], cache, { ...process.env, PATH: dirname(vswhere) + ';' + process.env.PATH });
  // Developer PATH must not hide unstaged native DLL dependencies.
  run(process.execPath, ['-e', 'if(typeof require(process.argv[1]).pickWindow!=="function")process.exit(1)', output], cache, { ...process.env, PATH: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') });
  return output;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.platform === 'win32') { await buildWindowsControlBridge(); console.log('Windows control bridge built.'); }
  else console.log('Windows control bridge build skipped (Windows x64 only).');
}
