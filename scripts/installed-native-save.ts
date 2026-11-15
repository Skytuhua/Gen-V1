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
$sw=[Diagnostics.Stopwatch]::StartNew()
$o=0; $t0=$null; $dh=$null; $why='startup-failed'; $cs=@(); $lease=$null
function Fail([string]$why) { $script:why=$why; throw 'Native Save verification refused.' }
function Emit([string]$ph) {
  $en=[ordered]@{phase=$ph;pid=$o;processStartTicks=$t0;dialogHandle=$dh;elapsedMs=[int]$sw.ElapsedMilliseconds}
  if($ph -eq 'failed'){$en.reason=$why;if($cs.Count){$en.controls=@($cs)}}
  [Console]::Out.WriteLine(($en|ConvertTo-Json -Depth 5 -Compress));[Console]::Out.Flush()
}
try {
  $it=[Console]::In.ReadLine();if($it.Length -gt 8192){Fail 'startup-failed'}
  $r=$it|ConvertFrom-Json
  if(@($r.psobject.Properties).Count -ne 6){Fail 'startup-failed'}
  $o=[int]$r.pid; $i0=[string]$r.executable; $rp=[string]$r.directory; $t=[string]$r.target
  if($o -le 0 -or -not [IO.Path]::IsPathRooted($i0) -or -not [IO.Path]::IsPathRooted($rp) -or $t -cne [IO.Path]::Combine($rp,'installed-memory-redacted-export.json')){Fail 'startup-failed'}
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
public static class W {
  [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.NoOptimization)]
  public static void Register(System.Reflection.AssemblyName name) {
    System.Windows.Automation.ClientSettings.RegisterClientSideProviderAssembly(name);
    GC.KeepAlive(name);
  }
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static uint Read(int h) { uint p; GetWindowThreadProcessId(new IntPtr(h), out p); return p; }
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr d,IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowUnicode(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",SetLastError=true)] static extern IntPtr Send(IntPtr h,uint m,UIntPtr w,IntPtr l,uint f,uint t,out UIntPtr r);
  static void No(){throw new IOException("Native input refused");}
  public static void Text(string s) {
    if(s.Length<1||s.Length>260)No();
    foreach(char c in s)if(char.IsControl(c))No();
    new UTF8Encoding(false,true).GetByteCount(s);
  }
  public static void P(int d,int e,uint p,uint m,uint w,int l,uint t) {
    var h=new IntPtr(e);var s=new StringBuilder(16);UIntPtr r;
    if(e==0||Read(e)!=p||!IsChild(new IntPtr(d),h)||!IsWindowUnicode(h)||GetClassName(h,s,16)!=4||s.ToString()!="Edit"||t==0||t>500)No();
    if(Send(h,m,new UIntPtr(w),new IntPtr(l),0x23,t,out r)==IntPtr.Zero)No();
  }
  public delegate bool Visit(IntPtr h,IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visit visit,IntPtr p);
  public static IntPtr[] Windows(uint p) {
    var items=new List<IntPtr>();
    if(!EnumWindows((h,x)=>{uint q;GetWindowThreadProcessId(h,out q);if(q==p)items.Add(h);return items.Count<=32;},IntPtr.Zero))throw new IOException("Window enumeration refused");
    return items.ToArray();
  }
}
public sealed class L : IDisposable {
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
  public L(string path, string volume, string index) {
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
  [W]::Register($p)
  try { $lease=[L]::new($rp,[string]$r.dev,[string]$r.ino) } catch { Fail 'target-changed' }
  function O {
    try {
      $pr=[Diagnostics.Process]::GetProcessById($o)
      try { if($pr.HasExited){Fail 'owner-changed'}; $im=$pr.MainModule.FileName; $tk=[string]$pr.StartTime.ToUniversalTime().Ticks }
      finally { $pr.Dispose() }
      if(-not [string]::Equals($im,$i0,[StringComparison]::OrdinalIgnoreCase)){Fail 'owner-changed'}
      if($null -ne $script:t0 -and $script:t0 -cne $tk){Fail 'owner-changed'}
      $script:t0=$tk
    } catch { Fail 'owner-changed' }
  }
  function T {
    try { $lease.Check() } catch { Fail 'target-changed' }
    $root=Get-Item -LiteralPath $rp -Force
    if(-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or -not [string]::Equals($root.FullName,$rp,[StringComparison]::OrdinalIgnoreCase)){Fail 'target-changed'}
    if(Test-Path -LiteralPath $t){Fail 'target-exists'}
  }
  function Ds {
    $a=[Collections.ArrayList]::new()
    foreach($h in [W]::Windows([uint32]$o)) {
      try { $d=[AutomationElement]::FromHandle($h);$i=$d.Current } catch { continue }
      if($i.ProcessId -eq $o -and $i.Name -ceq 'Export project memory' -and $i.ControlType -eq [ControlType]::Window){[void]$a.Add($d)}
    }
    return ,$a
  }
  function D($d) {
    O
    $cu=$d.Current
    if($cu.ProcessId -ne $o -or $cu.Name -cne 'Export project memory' -or $cu.NativeWindowHandle -eq 0 -or [W]::Read($cu.NativeWindowHandle) -ne $o){Fail 'dialog-ownership'}
    $h=[string]$cu.NativeWindowHandle
    if($null -ne $script:dh -and $script:dh -cne $h){Fail 'dialog-ownership'}
    $script:dh=$h
  }
  function X($d) {
    $cond=[OrCondition]::new([Condition[]]@(
      [PropertyCondition]::new([AutomationElement]::ControlTypeProperty,[ControlType]::Edit),
      [PropertyCondition]::new([AutomationElement]::ControlTypeProperty,[ControlType]::Button)))
    $a=$d.FindAll([TreeScope]::Descendants,$cond); $items=@()
    for($ix=0;$ix -lt [Math]::Min(24,$a.Count);$ix++) {
      $i=$a.Item($ix).Current
      if($i.ProcessId -ne $o){continue}
      $id=$i.AutomationId;if($id -notmatch '^[A-Za-z0-9_-]{0,64}$'){$id='<other>'}
      $class=$i.ClassName;if($class -notmatch '^[A-Za-z0-9_.#-]{0,64}$'){$class='<other>'}
      $name=$i.Name;if($name -cnotin @('File name:','Save','Cancel')){$name='<other>'}
      $kind='button';if($i.ControlType -eq [ControlType]::Edit){$kind='edit'}
      $items+=@{controlType=$kind;automationId=$id;name=$name;className=$class;pid=$i.ProcessId;enabled=$i.IsEnabled}
    }
    $script:cs=$items
  }
  function C($d) {
    D $d
    $ft=[AndCondition]::new([Condition[]]@(
      [PropertyCondition]::new([AutomationElement]::ControlTypeProperty,[ControlType]::Edit),
      [PropertyCondition]::new([AutomationElement]::AutomationIdProperty,'1001'),
      [PropertyCondition]::new([AutomationElement]::NameProperty,'File name:')))
    $st=[AndCondition]::new([Condition[]]@(
      [PropertyCondition]::new([AutomationElement]::ControlTypeProperty,[ControlType]::Button),
      [PropertyCondition]::new([AutomationElement]::AutomationIdProperty,'1'),
      [PropertyCondition]::new([AutomationElement]::NameProperty,'Save')))
    $fe=$d.FindAll([TreeScope]::Descendants,$ft); $sa=$d.FindAll([TreeScope]::Descendants,$st)
    if($fe.Count -ne 1 -or $sa.Count -ne 1){X $d;Fail 'unknown-controls'}
    $ed=$fe.Item(0); $b=$sa.Item(0)
    if($ed.Current.ProcessId -ne $o -or $b.Current.ProcessId -ne $o -or -not $ed.Current.IsEnabled -or -not $b.Current.IsEnabled){X $d;Fail 'unknown-controls'}
    $v=$null; $iv=$null
    if(-not $ed.TryGetCurrentPattern([ValuePattern]::Pattern,[ref]$v) -or $v.Current.IsReadOnly -or -not $b.TryGetCurrentPattern([InvokePattern]::Pattern,[ref]$iv)){X $d;Fail 'unknown-controls'}
    return @{value=$v;invoke=$iv;edit=$ed;button=$b}
  }
  function F($e) {
    D $d;$e.SetFocus();$f=([AutomationElement]::FocusedElement).Current;$c=$e.Current
    if(-not $c.HasKeyboardFocus -or $f.ProcessId -ne $o -or $f.NativeWindowHandle -ne $c.NativeWindowHandle -or $f.AutomationId -cne $c.AutomationId -or $f.ControlType -ne $c.ControlType){Fail 'action-failed'}
  }
  function P($m,$w,$l) {
    D $d;T;$c=$x.edit.Current
    if($c.ProcessId -ne $o -or $c.NativeWindowHandle -ne $eh -or $c.AutomationId -cne '1001' -or $c.Name -cne 'File name:' -or $c.ControlType -ne [ControlType]::Edit -or -not $c.IsEnabled -or -not $c.HasKeyboardFocus){Fail 'action-failed'}
    $left=60000-$sw.ElapsedMilliseconds;if($left -le 0){Fail 'action-failed'}
    [W]::P([int]$dh,$eh,[uint32]$o,[uint32]$m,[uint32]$w,[int]$l,[uint32][Math]::Min(500,$left))
  }
  O;T
  $ex=Ds;if($ex.Count -ne 0){Fail 'existing-dialog'}
  Emit 'ready'; $until=$sw.ElapsedMilliseconds+30000; $d=$null
  while($sw.ElapsedMilliseconds -lt $until -and $sw.ElapsedMilliseconds -lt 60000) {
    O; $ds=Ds
    if($ds.Count -gt 1){Fail 'ambiguous-dialog'}
    if($ds.Count -eq 1){$d=$ds.Item(0);break}
    Start-Sleep -Milliseconds 100
  }
  if($null -eq $d){Fail 'dialog-timeout'}
  D $d;Emit 'dialog-found'
  $x=C $d;T
  $why='action-failed';[W]::Text($t);F $x.edit
  $eh=$x.edit.Current.NativeWindowHandle
  P 0xB1 0 -1
  foreach($ch in $t.ToCharArray()){P 0x102 ([uint32][char]$ch) 1}
  if($x.value.Current.Value -cne $t){Fail 'action-failed'}
  Emit 'file-name-set'
  $ds=Ds;if($ds.Count -ne 1){Fail 'ambiguous-dialog'}
  $x=C ($ds.Item(0));T
  if($x.value.Current.Value -cne $t){Fail 'action-failed'}
  Emit 'save-invoked';$x.invoke.Invoke()
  while($sw.ElapsedMilliseconds -lt 60000) {
    O;$ds=Ds
    if($ds.Count -eq 0){
      Emit 'dialog-closed'
      if([Console]::In.ReadLine() -cne 'release'){Fail 'action-failed'}
      O;$lease.Check();$lease.Dispose();Emit 'target-released';exit 0
    }
    if($ds.Count -ne 1){Fail 'ambiguous-dialog'}
    D ($ds.Item(0));Start-Sleep -Milliseconds 100
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

/** Uses bounded character input and native Invoke only for exact admitted owned dialog controls. */
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
