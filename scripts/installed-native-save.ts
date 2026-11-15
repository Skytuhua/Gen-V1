import {spawn} from 'node:child_process';
import {lstat, open, realpath} from 'node:fs/promises';
import {isAbsolute, join, resolve, win32} from 'node:path';
import {z} from 'zod';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';

const FILE_NAME = 'installed-memory-redacted-export.json';
const DIALOG_TITLE = 'Export project memory';
const PHASES = ['ready', 'dialog-found', 'file-name-set', 'save-invoked', 'dialog-closed', 'target-released'] as const;
const REASONS = ['startup-failed', 'owner-changed', 'existing-dialog', 'dialog-timeout', 'ambiguous-dialog', 'dialog-ownership', 'unknown-controls', 'target-exists', 'target-changed', 'action-failed', 'dialog-close-timeout'] as const;
const controlSchema = z.strictObject({controlType: z.enum(['edit', 'button']), automationId: z.string().regex(/^(?:[A-Za-z0-9_-]{0,64}|<other>)$/), name: z.enum(['File name:', 'Save', 'Cancel', '<other>']), className: z.string().regex(/^(?:[A-Za-z0-9_.#-]{0,64}|<other>)$/), pid: z.number().int().positive(), enabled: z.boolean()});
const eventSchema = z.strictObject({phase: z.enum([...PHASES, 'failed']), pid: z.number().int().positive(), processStartTicks: z.string().regex(/^[0-9]{15,20}$/).nullable(), dialogHandle: z.string().regex(/^-?[1-9][0-9]{0,19}$/).nullable(), elapsedMs: z.number().int().min(0).max(75000), reason: z.enum(REASONS).optional(), controls: z.array(controlSchema).max(24).optional()});
type NativeSaveEvent = z.infer<typeof eventSchema>;
export type InstalledNativeSaveObservation = {status: 'running' | 'completed' | 'failed'; pid: number; processStartTicks: string | null; dialogHandle: string | null; dialogTitle: typeof DIALOG_TITLE; events: NativeSaveEvent[]; failure?: typeof REASONS[number]};
export type InstalledNativeOwner = {pid: number; executable: string; isAlive: () => boolean};
export type InstalledNativeSaveTarget = {directory: {path: string; dev: string; ino: string}; path: string};

/** A native Save chooser receives only this fixed absent output in the already owned evidence root. */
export async function prepareInstalledNativeSave(directory: string): Promise<InstalledNativeSaveTarget> {
  if (!isAbsolute(directory) || resolve(directory) !== directory) throw Error('The native Save evidence directory must be canonical.');
  const info = await lstat(directory, {bigint: true});
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw Error('The native Save evidence directory must be ordinary and canonical.');
  const target = {directory: {path: directory, dev: String(info.dev), ino: String(info.ino)}, path: join(directory, FILE_NAME)};
  await assertTarget(target, true); return target;
}
async function assertTarget(target: InstalledNativeSaveTarget, absent: boolean) {
  if (!isAbsolute(target.directory.path) || resolve(target.directory.path) !== target.directory.path || target.path !== join(target.directory.path, FILE_NAME)) throw Error('The native Save target is not the fixed evidence file.');
  const info = await lstat(target.directory.path, {bigint: true});
  if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== target.directory.dev || String(info.ino) !== target.directory.ino || await realpath(target.directory.path) !== target.directory.path) throw Error('The native Save evidence directory identity changed.');
  if (absent) {
    try {await lstat(target.path);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error;}
    throw Error('The native Save output already exists; an absent file is required.');
  }
}
export async function readInstalledNativeSave(target: InstalledNativeSaveTarget): Promise<Buffer> {
  await assertTarget(target, false);
  const before = await lstat(target.path, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink()) throw Error('Native Save output must be an ordinary regular file.');
  if (before.size < 1n || before.size > 1048576n) throw Error('Native Save output exceeds its fixture size bound.');
  const file = await open(target.path, 'r');
  try {
    const actual = await file.stat({bigint: true});
    if (actual.dev !== before.dev || actual.ino !== before.ino || actual.size !== before.size) throw Error('Native Save output identity changed before readback.');
    const bytes = await file.readFile();
    const after = await lstat(target.path, {bigint: true});
    await assertTarget(target, false);
    if (!after.isFile() || after.isSymbolicLink() || after.dev !== actual.dev || after.ino !== actual.ino || after.size !== BigInt(bytes.length) || bytes.length !== Number(actual.size)) throw Error('Native Save output changed during readback.');
    return bytes;
  } finally {await file.close();}
}

/** Native diagnostics contain only fixed stages and bounded control identities, never input values. */
export function parseInstalledNativeSaveTranscript(raw: string, pid: number): InstalledNativeSaveObservation {
  const invalid = () => Error('Invalid native Save dialog observation.');
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647 || Buffer.byteLength(raw) > 32768) throw invalid();
  const lines = raw.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > 7) throw invalid();
  const value: InstalledNativeSaveObservation = {status: 'running', pid, processStartTicks: null, dialogHandle: null, dialogTitle: DIALOG_TITLE, events: []};
  let elapsed = 0;
  for (const line of lines) {
    let event: NativeSaveEvent;
    try {event = eventSchema.parse(JSON.parse(line));} catch {throw invalid();}
    if (value.status !== 'running' || event.pid !== pid || event.controls?.some(control => control.pid !== pid) || event.elapsedMs < elapsed || value.processStartTicks !== null && event.processStartTicks !== value.processStartTicks || value.dialogHandle !== null && event.dialogHandle !== value.dialogHandle) throw invalid();
    if (event.phase === 'failed') {
      if (!event.reason) throw invalid();
      value.status = 'failed'; value.failure = event.reason;
    } else {
      if (event.phase !== PHASES[value.events.length] || event.reason !== undefined || event.controls !== undefined || !event.processStartTicks || event.phase === 'ready' && event.dialogHandle !== null || event.phase !== 'ready' && event.dialogHandle === null) throw invalid();
      if (event.phase === 'target-released') value.status = 'completed';
    }
    value.processStartTicks = event.processStartTicks; value.dialogHandle = event.dialogHandle; value.events.push(event); elapsed = event.elapsedMs;
  }
  return value;
}

// The script is fixed. Only validated owner/path data crosses stdin, never command text.
// Its root lease pins the existing owner receipt to keep the writable root nonempty.
// Data/list handle access enforces sharing denial; attribute-only opens would not.
// Keep the compiled caller frame while .NET Framework discovers its native control providers.
const NATIVE_SAVE_SCRIPT = String.raw`
using namespace System.Windows.Automation
$ErrorActionPreference='Stop'
$clock=[Diagnostics.Stopwatch]::StartNew()
$owner=0; $ticks0=$null; $dialogHandle=$null; $reason='startup-failed'; $controls=@(); $lease=$null
function Fail([string]$reason) { $script:reason=$reason; throw 'Native Save verification refused.' }
function Emit([string]$phase) {
  $entry=[ordered]@{phase=$phase;pid=$owner;processStartTicks=$ticks0;dialogHandle=$dialogHandle;elapsedMs=[int]$clock.ElapsedMilliseconds}
  if($phase -eq 'failed'){$entry.reason=$reason;if($controls.Count){$entry.controls=@($controls)}}
  [Console]::Out.WriteLine(($entry|ConvertTo-Json -Depth 5 -Compress));[Console]::Out.Flush()
}
try {
  $inputText=[Console]::In.ReadLine();if($inputText.Length -gt 8192){Fail 'startup-failed'}
  $request=$inputText|ConvertFrom-Json
  if(@($request.psobject.Properties).Count -ne 6){Fail 'startup-failed'}
  $owner=[int]$request.pid; $image0=[string]$request.executable; $rootPath=[string]$request.directory; $target=[string]$request.target
  if($owner -le 0 -or -not [IO.Path]::IsPathRooted($image0) -or -not [IO.Path]::IsPathRooted($rootPath) -or $target -cne [IO.Path]::Combine($rootPath,'installed-memory-redacted-export.json')){Fail 'startup-failed'}
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $u=[AutomationElement].Assembly
  $p=[Reflection.AssemblyName]::new($u.FullName);$p.Name='UIAutomationClientsideProviders'
  Add-Type -ReferencedAssemblies @($u.Location,[ControlType].Assembly.Location) -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.CompilerServices;
using Microsoft.Win32.SafeHandles;
public static class SaveOwner {
  [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.NoOptimization)]
  public static void Register(System.Reflection.AssemblyName name) {
    System.Windows.Automation.ClientSettings.RegisterClientSideProviderAssembly(name);
    GC.KeepAlive(name);
  }
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  public static uint Read(int h) { uint p; GetWindowThreadProcessId(new IntPtr(h), out p); return p; }
  public delegate bool Visit(IntPtr h,IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visit visit,IntPtr p);
  public static IntPtr[] Windows(uint p) {
    var items=new List<IntPtr>();
    if(!EnumWindows((h,x)=>{uint q;GetWindowThreadProcessId(h,out q);if(q==p)items.Add(h);return items.Count<=32;},IntPtr.Zero))throw new IOException("Window enumeration refused");
    return items.ToArray();
  }
}
public sealed class RootLease : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
  readonly List<SafeFileHandle> held = new List<SafeFileHandle>();
  readonly string path, volume, index;
  SafeFileHandle root;
  public RootLease(string path, string volume, string index) {
    this.path=Path.GetFullPath(path); this.volume=volume; this.index=index;
    try {
      if(this.path.Length<3 || this.path[1]!=':' || this.path[2]!='\\' || this.path.Substring(2).Contains(":")) throw new IOException("Ordinary local evidence path required");
      string current=Path.GetPathRoot(this.path); Pin(current,true,1);
      string[] parts=this.path.Substring(current.Length).Split(new char[]{'\\'},StringSplitOptions.RemoveEmptyEntries);
      for(int i=0;i<parts.Length;i++){current=Path.Combine(current,parts[i]);root=Pin(current,true,i==parts.Length-1?3u:1u);}
      Check();
      Pin(Path.Combine(this.path,"owner.json"),false,1);
    } catch {Dispose();throw;}
  }
  SafeFileHandle Pin(string name,bool directory,uint sharing) {
    var handle=CreateFile(name,directory?0x81u:0x80000080u,sharing,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
    if(handle.IsInvalid){handle.Dispose();throw new IOException("Evidence path lease unavailable");}
    held.Add(handle);Info info;
    if(!GetFileInformationByHandle(handle,out info) || (info.Attributes&0x400)!=0 || directory!=((info.Attributes&0x10)!=0) || !directory&&info.Links!=1)throw new IOException("Evidence path redirected");
    VerifyPath(handle,name);return handle;
  }
  static void VerifyPath(SafeFileHandle handle,string expected) {
    var value=new StringBuilder(32768);var count=GetFinalPathNameByHandle(handle,value,(uint)value.Capacity,0);
    if(count==0 || count>=value.Capacity)throw new IOException("Evidence path unavailable");
    string actual=value.ToString();if(actual.StartsWith(@"\\?\",StringComparison.Ordinal))actual=actual.Substring(4);
    if(!String.Equals(actual.TrimEnd('\\'),expected.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new IOException("Evidence path changed");
  }
  public void Check() {
    Info info;if(root==null || root.IsClosed || !GetFileInformationByHandle(root,out info) || (info.Attributes&0x410)!=0x10 || info.Volume.ToString()!=volume || (((ulong)info.IndexHigh<<32)|info.IndexLow).ToString()!=index)throw new IOException("Evidence root identity changed");
    VerifyPath(root,path);
  }
  public void Dispose(){for(int i=held.Count-1;i>=0;i--)held[i].Dispose();held.Clear();}
}
'@ | Out-Null
  [SaveOwner]::Register($p)
  try { $lease=[RootLease]::new($rootPath,[string]$request.dev,[string]$request.ino) } catch { Fail 'target-changed' }
  function Check-Owner {
    try {
      $process=[Diagnostics.Process]::GetProcessById($owner)
      try { if($process.HasExited){Fail 'owner-changed'}; $image=$process.MainModule.FileName; $ticks=[string]$process.StartTime.ToUniversalTime().Ticks }
      finally { $process.Dispose() }
      if(-not [string]::Equals($image,$image0,[StringComparison]::OrdinalIgnoreCase)){Fail 'owner-changed'}
      if($null -ne $script:ticks0 -and $script:ticks0 -cne $ticks){Fail 'owner-changed'}
      $script:ticks0=$ticks
    } catch { Fail 'owner-changed' }
  }
  function Check-Target {
    try { $lease.Check() } catch { Fail 'target-changed' }
    $root=Get-Item -LiteralPath $rootPath -Force
    if(-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or -not [string]::Equals($root.FullName,$rootPath,[StringComparison]::OrdinalIgnoreCase)){Fail 'target-changed'}
    if(Test-Path -LiteralPath $target){Fail 'target-exists'}
  }
  function Find-Dialogs {
    $found=[Collections.ArrayList]::new()
    foreach($handle in [SaveOwner]::Windows([uint32]$owner)) {
      try { $dialog=[AutomationElement]::FromHandle($handle);$info=$dialog.Current } catch { continue }
      if($info.ProcessId -eq $owner -and $info.Name -ceq 'Export project memory' -and $info.ControlType -eq [ControlType]::Window){[void]$found.Add($dialog)}
    }
    return ,$found
  }
  function Check-Dialog($dialog) {
    Check-Owner
    $current=$dialog.Current
    if($current.ProcessId -ne $owner -or $current.Name -cne 'Export project memory' -or $current.NativeWindowHandle -eq 0 -or [SaveOwner]::Read($current.NativeWindowHandle) -ne $owner){Fail 'dialog-ownership'}
    $handle=[string]$current.NativeWindowHandle
    if($null -ne $script:dialogHandle -and $script:dialogHandle -cne $handle){Fail 'dialog-ownership'}
    $script:dialogHandle=$handle
  }
  function Capture-Controls($dialog) {
    $condition=[OrCondition]::new([Condition[]]@(
      [PropertyCondition]::new([AutomationElement]::ControlTypeProperty,[ControlType]::Edit),
      [PropertyCondition]::new([AutomationElement]::ControlTypeProperty,[ControlType]::Button)))
    $found=$dialog.FindAll([TreeScope]::Descendants,$condition); $items=@()
    for($index=0;$index -lt [Math]::Min(24,$found.Count);$index++) {
      $info=$found.Item($index).Current
      if($info.ProcessId -ne $owner){continue}
      $id=$info.AutomationId;if($id -notmatch '^[A-Za-z0-9_-]{0,64}$'){$id='<other>'}
      $class=$info.ClassName;if($class -notmatch '^[A-Za-z0-9_.#-]{0,64}$'){$class='<other>'}
      $name=$info.Name;if($name -cnotin @('File name:','Save','Cancel')){$name='<other>'}
      $kind='button';if($info.ControlType -eq [ControlType]::Edit){$kind='edit'}
      $items+=@{controlType=$kind;automationId=$id;name=$name;className=$class;pid=$info.ProcessId;enabled=$info.IsEnabled}
    }
    $script:controls=$items
  }
  function Save-Controls($dialog) {
    Check-Dialog $dialog
    $fileTest=[AndCondition]::new([Condition[]]@(
      [PropertyCondition]::new([AutomationElement]::ControlTypeProperty,[ControlType]::Edit),
      [PropertyCondition]::new([AutomationElement]::AutomationIdProperty,'1001'),
      [PropertyCondition]::new([AutomationElement]::NameProperty,'File name:')))
    $saveTest=[AndCondition]::new([Condition[]]@(
      [PropertyCondition]::new([AutomationElement]::ControlTypeProperty,[ControlType]::Button),
      [PropertyCondition]::new([AutomationElement]::AutomationIdProperty,'1'),
      [PropertyCondition]::new([AutomationElement]::NameProperty,'Save')))
    $file=$dialog.FindAll([TreeScope]::Descendants,$fileTest); $save=$dialog.FindAll([TreeScope]::Descendants,$saveTest)
    if($file.Count -ne 1 -or $save.Count -ne 1){Capture-Controls $dialog;Fail 'unknown-controls'}
    $edit=$file.Item(0); $button=$save.Item(0)
    if($edit.Current.ProcessId -ne $owner -or $button.Current.ProcessId -ne $owner -or -not $edit.Current.IsEnabled -or -not $button.Current.IsEnabled){Capture-Controls $dialog;Fail 'unknown-controls'}
    $value=$null; $invoke=$null
    if(-not $edit.TryGetCurrentPattern([ValuePattern]::Pattern,[ref]$value) -or $value.Current.IsReadOnly -or -not $button.TryGetCurrentPattern([InvokePattern]::Pattern,[ref]$invoke)){Capture-Controls $dialog;Fail 'unknown-controls'}
    $parent=[SaveOwner]::GetParent([IntPtr]::new($edit.Current.NativeWindowHandle))
    if($parent -eq [IntPtr]::Zero -or [SaveOwner]::Read($parent.ToInt32()) -ne $owner){Fail 'unknown-controls'}
    $combo=[AutomationElement]::FromHandle($parent);$c=$combo.Current
    if($c.ProcessId -ne $owner -or $c.NativeWindowHandle -ne $parent.ToInt32() -or $c.ControlType -ne [ControlType]::ComboBox -or $c.ClassName -cne 'ComboBox' -or $c.Name -cne 'File name:' -or -not $c.IsEnabled){Fail 'unknown-controls'}
    $comboValue=$null
    if(-not $combo.TryGetCurrentPattern([ValuePattern]::Pattern,[ref]$comboValue) -or $comboValue.Current.IsReadOnly){Fail 'unknown-controls'}
    return @{value=$value;combo=$comboValue;invoke=$invoke}
  }
  Check-Owner;Check-Target
  $existing=Find-Dialogs;if($existing.Count -ne 0){Fail 'existing-dialog'}
  Emit 'ready'; $findUntil=$clock.ElapsedMilliseconds+30000; $dialog=$null
  while($clock.ElapsedMilliseconds -lt $findUntil -and $clock.ElapsedMilliseconds -lt 60000) {
    Check-Owner; $dialogs=Find-Dialogs
    if($dialogs.Count -gt 1){Fail 'ambiguous-dialog'}
    if($dialogs.Count -eq 1){$dialog=$dialogs.Item(0);break}
    Start-Sleep -Milliseconds 100
  }
  if($null -eq $dialog){Fail 'dialog-timeout'}
  Check-Dialog $dialog;Emit 'dialog-found'
  $pair=Save-Controls $dialog;Check-Target
  $reason='action-failed';$pair.combo.SetValue($target)
  if($pair.value.Current.Value -cne $target -or $pair.combo.Current.Value -cne $target){Fail 'action-failed'}
  Emit 'file-name-set'
  $dialogs=Find-Dialogs;if($dialogs.Count -ne 1){Fail 'ambiguous-dialog'}
  $pair=Save-Controls ($dialogs.Item(0));Check-Target
  if($pair.value.Current.Value -cne $target -or $pair.combo.Current.Value -cne $target){Fail 'action-failed'}
  Emit 'save-invoked';$pair.invoke.Invoke()
  while($clock.ElapsedMilliseconds -lt 60000) {
    Check-Owner;$dialogs=Find-Dialogs
    if($dialogs.Count -eq 0){
      Emit 'dialog-closed'
      if([Console]::In.ReadLine() -cne 'release'){Fail 'action-failed'}
      Check-Owner;$lease.Check();$lease.Dispose();Emit 'target-released';exit 0
    }
    if($dialogs.Count -ne 1){Fail 'ambiguous-dialog'}
    Check-Dialog ($dialogs.Item(0));Start-Sleep -Milliseconds 100
  }
  Fail 'dialog-close-timeout'
} catch { Emit 'failed';exit 1 } finally { if($null -ne $lease){$lease.Dispose()} }
`;

export function installedNativeSaveCommand(systemRoot: string) {
  if (!win32.isAbsolute(systemRoot) || systemRoot.length > 260 || /["\r\n\0]/.test(systemRoot)) throw Error('The native Save worker requires the declared Windows runtime.');
  const file = win32.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Remove code indentation only. The fixed script has no indented multiline string data.
  const encoded = Buffer.from(NATIVE_SAVE_SCRIPT.replace(/^ +/gm, ''), 'utf16le').toString('base64');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-MTA', '-EncodedCommand', encoded];
  const commandLineCharacters = file.length + 2 + args.reduce((sum, value) => sum + value.length + 1, 0) + 1;
  if (commandLineCharacters >= 32767) throw Error('The fixed native Save worker exceeds the Windows command-line bound.');
  return {file, args, commandLineCharacters};
}

/** Uses native Value/Invoke patterns only after the owned PID and exact live dialog are admitted. */
export async function saveInstalledMemoryThroughNativeDialog<T>(owner: InstalledNativeOwner, target: InstalledNativeSaveTarget, trigger: () => Promise<void>, complete: () => Promise<T>, observe: (value: InstalledNativeSaveObservation) => void) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.pid > 2147483647 || !win32.isAbsolute(owner.executable) || !owner.isAlive()) throw Error('The native Save worker requires the live owned Windows process.');
  await assertTarget(target, true);
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw Error('The native Save worker requires the declared Windows runtime.');
  const command = installedNativeSaveCommand(systemRoot);
  const worker = spawn(command.file, command.args, {cwd: target.directory.path, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '', stderrBytes = 0, triggered = false, settled = false, triggerResult: Promise<void> | undefined, completionStarted = false, released = false;
  let completedValue: T;
  let observation = parseInstalledNativeSaveTranscript('', owner.pid); observe(observation);
  const result = await new Promise<InstalledNativeSaveObservation>((accept, reject) => {
    const fail = (error: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); clearInterval(liveness);
      void terminateProcessTree(worker).then(() => reject(error), () => reject(error));
    };
    const timer = setTimeout(() => fail(Error('The owned native Save worker exceeded its 75000 ms deadline.')), 75000);
    const liveness = setInterval(() => {if (!owner.isAlive()) fail(Error('The owned installed process exited during native Save.'));}, 100);
    worker.once('error', () => fail(Error('The owned native Save worker could not start.')));
    worker.stdin.on('error', () => fail(Error('The owned native Save worker refused its bounded input.')));
    worker.stderr.on('data', (bytes: Buffer) => {stderrBytes += bytes.length; if (stderrBytes > 16384) fail(Error('The owned native Save worker exceeded its diagnostic bound.'));});
    worker.stdout.on('data', (bytes: Buffer) => {
      if (settled) return;
      stdout += bytes.toString('utf8');
      try {
        if (Buffer.byteLength(stdout) > 32768) throw Error('The owned native Save worker exceeded its output bound.');
        const completeLines = stdout.slice(0, stdout.lastIndexOf('\n') + 1);
        observation = parseInstalledNativeSaveTranscript(completeLines, owner.pid); observe(observation);
        if (observation.status === 'failed') {fail(Error('Native Save refused: ' + observation.failure + '.')); return;}
        if (!triggered && observation.events[0]?.phase === 'ready') {
          triggered = true;
          triggerResult = assertTarget(target, true).then(() => {if (!owner.isAlive()) throw Error('The owned installed process changed before export.'); return trigger();});
          void triggerResult.catch(error => fail(error instanceof Error ? error : Error('The native export action failed.')));
        }
        if (!completionStarted && observation.events.some(event => event.phase === 'dialog-closed')) {
          completionStarted = true;
          void Promise.resolve(triggerResult).then(complete).then(value => {
            if (settled || !owner.isAlive()) throw Error('The owned process changed before native Save readback.');
            completedValue = value; released = true; worker.stdin.end('release\n');
          }).catch(error => fail(error instanceof Error ? error : Error('Native Save completion failed.')));
        }
      } catch (error) {fail(error instanceof Error ? error : Error('The native Save observation was invalid.'));}
    });
    worker.once('close', (code, signal) => {
      if (settled) return;
      try {
        observation = parseInstalledNativeSaveTranscript(stdout, owner.pid); observe(observation);
        if (code !== 0 || signal !== null || observation.status !== 'completed' || !triggered || !released || !owner.isAlive()) throw Error('The native Save dialog did not complete for the owned process.');
        settled = true; clearTimeout(timer); clearInterval(liveness); accept(observation);
      } catch (error) {fail(error instanceof Error ? error : Error('The native Save worker failed.'));}
    });
    worker.stdin.write(JSON.stringify({pid: owner.pid, executable: owner.executable, directory: target.directory.path, target: target.path, dev: target.directory.dev, ino: target.directory.ino}) + '\n');
  });
  await triggerResult; await assertTarget(target, false); return {dialog: result, value: completedValue!};
}
