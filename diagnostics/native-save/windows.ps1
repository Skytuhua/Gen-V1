$ErrorActionPreference = 'Stop'
$clock = [Diagnostics.Stopwatch]::StartNew()
$ownedPid = 0
$ticks = $null
function Emit($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Depth 10 -Compress)); [Console]::Out.Flush() }
try {
  $line = [Console]::In.ReadLine()
  if ($line.Length -gt 4096) { throw 'Bound' }
  $inputValue = $line | ConvertFrom-Json
  if (@($inputValue.psobject.Properties).Count -ne 2) { throw 'Input' }
  $ownedPid = [int]$inputValue.pid
  $image = [string]$inputValue.executable
  if ($ownedPid -le 0 -or -not [IO.Path]::IsPathRooted($image)) { throw 'Owner' }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class OwnedWindowProbe {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback c, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, Callback c, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint command);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static long[] Windows(uint pid) { var items=new List<long>(); EnumWindows((h,p)=>{if(Pid(h)==pid && items.Count<32) items.Add(h.ToInt64());return true;},IntPtr.Zero);return items.ToArray(); }
  public static long[] Children(IntPtr parent,uint pid) { var items=new List<long>();EnumChildWindows(parent,(h,p)=>{if(Pid(h)==pid)items.Add(h.ToInt64());return items.Count<=64;},IntPtr.Zero);return items.ToArray(); }
  public static string TitleKind(IntPtr h) { var s=new StringBuilder(512);GetWindowText(h,s,s.Capacity);var v=s.ToString();return v=="Export project memory"?"expected-export":v=="M05 native Save diagnostic"?"fixture":v.Length==0?"empty":"other"; }
  public static string ClassKind(IntPtr h) { var s=new StringBuilder(128);GetClassName(h,s,s.Capacity);var v=s.ToString();return v=="#32770"?"dialog":v.StartsWith("Chrome_WidgetWin_")?"chromium":v=="DirectUIHWND"?"direct-ui":"other"; }
  public static string ChildClass(IntPtr h) { var s=new StringBuilder(128);GetClassName(h,s,s.Capacity);var v=s.ToString();return v=="Edit"||v=="Button"||v=="ComboBox"||v=="ComboBoxEx32"?v:"other"; }
}
'@
  function Check-Owner {
    $process = [Diagnostics.Process]::GetProcessById($ownedPid)
    try {
      if ($process.HasExited -or -not [StringComparer]::OrdinalIgnoreCase.Equals($process.MainModule.FileName, $image)) { throw 'Owner' }
      $actual = [string]$process.StartTime.ToUniversalTime().Ticks
      if ($null -eq $script:ticks) { $script:ticks = $actual } elseif ($script:ticks -cne $actual) { throw 'Owner' }
    } finally { $process.Dispose() }
  }
  function Name-Kind([string]$name) {
    if ($name -ceq 'Export project memory') { return 'expected-export' }
    if ($name -ceq 'M05 native Save diagnostic') { return 'fixture' }
    if ($name -ceq 'File name:') { return 'file-name' }
    if ($name -ceq 'Save') { return 'save' }
    if ($name -ceq 'Cancel') { return 'cancel' }
    if ($name.Length -eq 0) { return 'empty' }
    return 'other'
  }
  function Element-Meta($element) {
    $current = $element.Current
    if ($current.ProcessId -ne $ownedPid) { return @{foreignBoundary=$true} }
    $kind = $current.ControlType.ProgrammaticName
    if ($kind -notmatch '^ControlType\.(Window|Pane|Edit|Button|ComboBox|Text|TitleBar|MenuBar|List|ListItem|Tree|TreeItem|ToolBar)$') { $kind = 'other' }
    $automationId = $current.AutomationId
    if ($automationId -notmatch '^(?:[A-Za-z0-9_-]{0,64})$') { $automationId = '<other>' }
    return [ordered]@{pid=$current.ProcessId;hwnd=[string]$current.NativeWindowHandle;nameKind=(Name-Kind $current.Name);type=$kind;automationId=$automationId;enabled=$current.IsEnabled;offscreen=$current.IsOffscreen}
  }
  function Native-ControlMeta($element,[IntPtr]$nativeHandle) {
    if ([OwnedWindowProbe]::Pid($nativeHandle) -ne $ownedPid) { throw 'Native child owner changed' }
    $info=$element.Current
    if ($info.ProcessId -ne 0 -and $info.ProcessId -ne $ownedPid) { return @{uiaOwner='other';nativeOwnerMatches=$true} }
    $kind=$info.ControlType.ProgrammaticName
    if ($kind -notmatch '^ControlType\.(Window|Pane|Edit|Button|ComboBox|Text|TitleBar|MenuBar|List|ListItem|Tree|TreeItem|ToolBar)$') {$kind='other'}
    $id=$info.AutomationId;if($id -notmatch '^[A-Za-z0-9_-]{0,64}$'){$id='<other>'}
    $value=$null;$invoke=$null;$valueAvailable=$false;$invokeAvailable=$false;$readOnly=$null;$patternError=$false
    try {
      $valueAvailable=$element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value)
      if($valueAvailable){$readOnly=$value.Current.IsReadOnly}
      $invokeAvailable=$element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)
    } catch {$patternError=$true}
    return [ordered]@{nativeOwnerMatches=$true;uiaPid=$info.ProcessId;uiaHwnd=[string]$info.NativeWindowHandle;uiaHandleMatches=([long]$info.NativeWindowHandle -eq $nativeHandle.ToInt64());nameKind=(Name-Kind $info.Name);type=$kind;automationId=$id;enabled=$info.IsEnabled;offscreen=$info.IsOffscreen;valuePattern=$valueAvailable;valueReadOnly=$readOnly;invokePattern=$invokeAvailable;patternError=$patternError}
  }
  function Exact-SelectorCounts($element) {
    $fileCondition=[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@(
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit),
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1001'),
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'File name:')))
    $saveCondition=[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@(
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button),
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1'),
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Save')))
    return @{file=$element.FindAll([System.Windows.Automation.TreeScope]::Descendants,$fileCondition).Count;save=$element.FindAll([System.Windows.Automation.TreeScope]::Descendants,$saveCondition).Count}
  }
  Check-Owner
  foreach ($due in @(0,1000,5000,15000,28000,33000)) {
    while ($clock.ElapsedMilliseconds -lt $due) { Start-Sleep -Milliseconds 100; Check-Owner }
    Check-Owner
    $rootItems = @(); $rootError = $false
    try {
      $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownedPid)
      $elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
      for ($i=0; $i -lt [Math]::Min(32,$elements.Count); $i++) { $rootItems += (Element-Meta $elements.Item($i)) }
    } catch { $rootError = $true }
    $windows = @()
    foreach ($number in [OwnedWindowProbe]::Windows([uint32]$ownedPid)) {
      $handle = [IntPtr]::new($number)
      $owner = [OwnedWindowProbe]::GetWindow($handle,4)
      $rootOwner = [OwnedWindowProbe]::GetAncestor($handle,3)
      $entry = [ordered]@{hwnd=[string]$number;titleKind=[OwnedWindowProbe]::TitleKind($handle);classKind=[OwnedWindowProbe]::ClassKind($handle);visible=[OwnedWindowProbe]::IsWindowVisible($handle);enabled=[OwnedWindowProbe]::IsWindowEnabled($handle);ownerHwnd=$null;foreignOwner=$false;rootOwnerHwnd=$null;foreignRootOwner=$false;uia=$null;parents=@();controls=@();uiaError=$false;nativeChildren=@();ownedChildCount=$null;nativeCandidateCount=$null;exactSelectorCounts=$null}
      if ($owner -ne [IntPtr]::Zero) {if ([OwnedWindowProbe]::Pid($owner) -eq $ownedPid) {$entry.ownerHwnd=[string]$owner.ToInt64()} else {$entry.foreignOwner=$true}}
      if ($rootOwner -ne [IntPtr]::Zero) {if ([OwnedWindowProbe]::Pid($rootOwner) -eq $ownedPid) {$entry.rootOwnerHwnd=[string]$rootOwner.ToInt64()} else {$entry.foreignRootOwner=$true}}
      try {
        $element = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        $entry.uia = Element-Meta $element
        $parent = $element
        for ($depth=0; $depth -lt 6; $depth++) {
          $parent = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($parent)
          if ($null -eq $parent) { break }
          $meta = Element-Meta $parent
          $entry.parents += $meta
          if ($meta.foreignBoundary) { break }
        }
        if ($entry.titleKind -eq 'expected-export') {
          if ($element.Current.ProcessId -ne $ownedPid -or [OwnedWindowProbe]::Pid($handle) -ne $ownedPid) {throw 'UIA dialog owner changed'}
          $entry.exactSelectorCounts=Exact-SelectorCounts $element
          $queue = [Collections.Generic.Queue[object]]::new(); $queue.Enqueue(@{element=$element;depth=0}); $visited=0
          while ($queue.Count -gt 0 -and $visited -lt 64) {
            $next=$queue.Dequeue(); $visited++
            $meta=Element-Meta $next.element
            if ($meta.foreignBoundary) {continue}
            if ($meta.type -eq 'ControlType.Edit' -or $meta.type -eq 'ControlType.Button') {if ($entry.controls.Count -lt 24) {$entry.controls += $meta}}
            if ($next.depth -lt 4) {
              $child=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetFirstChild($next.element); $siblings=0
              while ($null -ne $child -and $siblings -lt 32 -and $queue.Count -lt 64) {$queue.Enqueue(@{element=$child;depth=$next.depth+1});$siblings++;$child=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetNextSibling($child)}
            }
          }
        }
      } catch { $entry.uiaError=$true }
      if ($entry.titleKind -eq 'expected-export') {
        Check-Owner
        if ([OwnedWindowProbe]::Pid($handle) -ne $ownedPid) {throw 'Dialog owner changed'}
        $children=[OwnedWindowProbe]::Children($handle,[uint32]$ownedPid)
        if ($children.Length -gt 64) {throw 'Owned child enumeration exceeded its bound'}
        $entry.ownedChildCount=$children.Length;$candidateCount=0
        foreach ($childNumber in $children) {
          $childHandle=[IntPtr]::new($childNumber)
          if ([OwnedWindowProbe]::Pid($childHandle) -ne $ownedPid) {throw 'Native child owner changed'}
          $childClass=[OwnedWindowProbe]::ChildClass($childHandle);$childId=[OwnedWindowProbe]::GetDlgCtrlID($childHandle)
          $child=[ordered]@{hwnd=[string]$childNumber;pid=$ownedPid;id=$childId;class=$childClass;visible=[OwnedWindowProbe]::IsWindowVisible($childHandle);enabled=[OwnedWindowProbe]::IsWindowEnabled($childHandle);uia=$null;uiaError=$false}
          if ($childId -in @(1,2,1001) -or $childClass -in @('Edit','Button','ComboBox','ComboBoxEx32')) {
            $candidateCount++;if ($candidateCount -gt 16) {throw 'Native control inspection exceeded its bound'}
            try {$child.uia=Native-ControlMeta ([System.Windows.Automation.AutomationElement]::FromHandle($childHandle)) $childHandle} catch {$child.uiaError=$true}
          }
          $entry.nativeChildren += $child
        }
        $entry.nativeCandidateCount=$candidateCount
        Check-Owner
      }
      $windows += $entry
    }
    Check-Owner
    Emit ([ordered]@{version=1;phase='snapshot';elapsedMs=[int]$clock.ElapsedMilliseconds;pid=$ownedPid;processStartTicks=$ticks;rootChildren=$rootItems;rootQueryFailed=$rootError;windows=$windows})
  }
  Emit @{version=1;phase='completed';pid=$ownedPid;processStartTicks=$ticks;elapsedMs=[int]$clock.ElapsedMilliseconds}
  exit 0
} catch {
  Emit @{version=1;phase='failed';pid=$ownedPid;processStartTicks=$ticks;elapsedMs=[int]$clock.ElapsedMilliseconds;reason='owned-window-observation-failed'}
  exit 1
}
