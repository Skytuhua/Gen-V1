import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = '24.14.0'; // Node-API 8 is stable across the supported Node 24 runtimes.
const inputs = [
  [`node-v${version}-headers.tar.gz`, 'bc1505c8e2b2b1f7b7cf3808bf53691e5d110c816d1bc1a48075195c5dcafe05'],
  ['win-x64/node.lib', '35fcdd35d3d22e283c0e2e095cc43ef676301bb85f950c344a73d59231bd7e61'],
] as const;
function run(file: string, args: string[], cwd: string) {
  const env = {...process.env, PATH: join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio/Installer') + ';' + process.env.PATH};
  const result = spawnSync(file, args, {cwd, env, windowsHide: true, windowsVerbatimArguments: /[\\/]cmd\.exe$/i.test(file), stdio: 'inherit'});
  if (result.error || result.status !== 0) throw Error('Windows credential lease compilation failed.');
}
export async function buildWindowsCredentialLease(outputDirectory = join(root, 'packages/core')) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Credential lease build requires Windows x64.');
  const cache = join(root, '.harness-windows-credential-build'); await mkdir(cache, {recursive: true});
  for (const [name, sha256] of inputs) {
    const target = join(cache, name.split('/').at(-1)!); let bytes: Buffer | undefined;
    try {bytes = await readFile(target);} catch { /* Download only pinned public build inputs. */ }
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sha256) {
      const response = await fetch(`https://nodejs.org/dist/v${version}/${name}`);
      if (!response.ok) throw Error('Pinned Node build input is unavailable.');
      bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error('Node build input checksum mismatch.');
      await writeFile(target, bytes);
    }
  }
  run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe'), ['-xzf', join(cache, inputs[0][0])], cache);
  const source = join(root, 'packages/core/windows-credential-lease.cc'), output = join(resolve(outputDirectory), 'windows-credential-lease.node');
  await mkdir(dirname(output), {recursive: true});
  const include = join(cache, `node-v${version}/include/node`), library = join(cache, 'node.lib');
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
  const installation = existsSync(vswhere) ? spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], {encoding: 'utf8', windowsHide: true}).stdout?.trim() : '';
  if (installation) {
    const setup = join(installation, 'Common7/Tools/VsDevCmd.bat'), response = join(cache, 'compile.rsp');
    if ([setup, response, source, output, include, library, cache].some(path => /[\r\n"%&|<>^]/.test(path))) throw Error('Unsupported native build path.');
    await writeFile(response, ['/nologo', '/LD', '/EHsc', '/std:c++17', '/O2', '/MT', '/DNAPI_VERSION=8', '/DNODE_GYP_MODULE_NAME=windows_credential_lease', `/I"${include}"`, `"${source}"`, `"${library}"`, 'advapi32.lib', '/link', `/OUT:"${output}"`].join(' '));
    run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/cmd.exe'), ['/d', '/s', '/c', `call "${setup}" -arch=x64 >nul && cl.exe @"${response}"`], cache);
  } else {
    run('g++', ['-shared', '-std=c++17', '-O2', '-static-libgcc', '-static-libstdc++', '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=windows_credential_lease', '-I', include, source, library, '-ladvapi32', '-o', output], cache);
  }
  // Load the built library in a fresh Node process, never an Electron ABI shim.
  run(process.execPath, ['-e', 'if(typeof require(process.argv[1]).acquire!=="function")process.exit(1)', output], cache);
  return output;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.platform === 'win32') {await buildWindowsCredentialLease(); console.log('Windows credential lease built.');}
}
