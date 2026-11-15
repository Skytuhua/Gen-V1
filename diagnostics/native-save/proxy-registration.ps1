[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('direct','compiled','static','thread')][string]$Mode)
$ErrorActionPreference='Stop'
$clock=[Diagnostics.Stopwatch]::StartNew()
$receipt=[ordered]@{version=1;mode=$Mode;createdAt=[DateTime]::UtcNow.ToString('o');passed=$false;scope='Read-only UI Automation assembly registration; no native dialog, account, provider request or control action.';stage='load-assemblies';sourceSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();powershellVersion=$PSVersionTable.PSVersion.ToString();clrVersion=$PSVersionTable.CLRVersion.ToString();processBits=([IntPtr]::Size*8);client=$null;requested=$null;registered=$null;providerTableCount=$null;forcedDefaultProviders=$false;ownedThreadJoinBoundMs=5000;loadedProviders=@();exceptions=@()}
function Assembly-Identity($name) {
  $token=([BitConverter]::ToString($name.GetPublicKeyToken())).Replace('-','').ToLowerInvariant()
  if($name.Name -notin @('UIAutomationClient','UIAutomationClientsideProviders') -or $token -notmatch '^[0-9a-f]{16}$'){throw 'Unexpected UI Automation assembly identity.'}
  return [ordered]@{name=$name.Name;version=$name.Version.ToString();culture=$name.CultureName;publicKeyToken=$token;codeBasePresent=(-not [string]::IsNullOrEmpty($name.CodeBase))}
}
try {
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $client=[System.Windows.Automation.AutomationElement].Assembly
  $receipt.client=Assembly-Identity ($client.GetName())
  $receipt.stage='construct-provider-name'
  $provider=[Reflection.AssemblyName]::new($client.FullName)
  $provider.Name='UIAutomationClientsideProviders'
  $receipt.requested=Assembly-Identity $provider
  if($Mode -cne 'direct'){
    $receipt.stage='compile-public-caller'
    Add-Type -ReferencedAssemblies @($client.Location,[System.Windows.Automation.ControlType].Assembly.Location) -TypeDefinition @'
public static class M05ProxyRegistrationProbe {
  [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining | System.Runtime.CompilerServices.MethodImplOptions.NoOptimization)]
  public static void Register(System.Reflection.AssemblyName name) {
    System.Windows.Automation.ClientSettings.RegisterClientSideProviderAssembly(name);
    System.GC.KeepAlive(name);
  }
  [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining | System.Runtime.CompilerServices.MethodImplOptions.NoOptimization)]
  public static void OnOwnedThread(System.Reflection.AssemblyName name) {
    System.Exception failure=null;
    var thread=new System.Threading.Thread(delegate(){try{Register(name);}catch(System.Exception error){failure=error;}});
    thread.IsBackground=true;
    thread.SetApartmentState(System.Threading.ApartmentState.MTA);
    thread.Start();
    if(!thread.Join(5000))throw new System.TimeoutException("Owned initialization thread deadline.");
    if(failure!=null)System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
  }
}
public static class M05ProxyStaticBootstrap {
  static M05ProxyStaticBootstrap() {
    System.Windows.Automation.ClientSettings.RegisterClientSideProviders(new System.Windows.Automation.ClientSideProviderDescription[0]);
  }
  [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining | System.Runtime.CompilerServices.MethodImplOptions.NoOptimization)]
  public static void Ensure() {}
}
'@ | Out-Null
  }
  if($Mode -ceq 'static'){
    $receipt.stage='force-default-providers'
    [M05ProxyStaticBootstrap]::Ensure()
    $receipt.forcedDefaultProviders=$true
  }
  $receipt.stage='register-provider'
  if($Mode -ceq 'direct'){[System.Windows.Automation.ClientSettings]::RegisterClientSideProviderAssembly($provider)}elseif($Mode -ceq 'thread'){[M05ProxyRegistrationProbe]::OnOwnedThread($provider)}else{[M05ProxyRegistrationProbe]::Register($provider)}
  $receipt.stage='inspect-registered-provider'
  $loaded=@([AppDomain]::CurrentDomain.GetAssemblies()|Where-Object {$_.GetName().Name -eq 'UIAutomationClientsideProviders'})
  if($loaded.Count -ne 1){throw 'Expected exactly one registered provider assembly.'}
  $receipt.registered=Assembly-Identity ($loaded[0].GetName())
  foreach($key in @('version','culture','publicKeyToken')){if($receipt.client[$key] -cne $receipt.registered[$key]){throw 'Registered provider identity did not match the loaded client.'}}
  $type=$loaded[0].GetType('UIAutomationClientsideProviders.UIAutomationClientSideProviders',$true)
  $field=$type.GetField('ClientSideProviderDescriptionTable',[Reflection.BindingFlags]'Public,Static')
  if($null -eq $field){throw 'Provider description table missing.'}
  $table=$field.GetValue($null);$receipt.providerTableCount=$table.Length
  if($table.Length -lt 1 -or $table.Length -gt 256){throw 'Provider description table out of bounds.'}
  $receipt.stage='completed';$receipt.passed=$true
} catch {
  $failure=$_.Exception
  for($i=0;$null -ne $failure -and $i -lt 4;$i++){
    $type=$failure.GetType().FullName
    if($type -notmatch '^[A-Za-z0-9_.+]{1,160}$'){$type='Other'}
    $frames=@()
    foreach($frame in ([Diagnostics.StackTrace]::new($failure,$false)).GetFrames()){
      $method=$frame.GetMethod();if($null -eq $method){continue}
      $declaring=$method.DeclaringType;if($null -eq $declaring){continue}
      $owner=$declaring.FullName
      if($owner -notmatch '^(MS[.]Internal[.]Automation[.]|System[.]Windows[.]Automation[.]|M05Proxy(RegistrationProbe|StaticBootstrap)$)'){continue}
      if($owner -notmatch '^[A-Za-z0-9_.+]{1,160}$' -or $method.Name -notmatch '^[A-Za-z0-9_.]{1,80}$'){continue}
      $frames+=@{type=$owner;method=$method.Name;ilOffset=$frame.GetILOffset();nativeOffset=$frame.GetNativeOffset()};if($frames.Count -ge 8){break}
    }
    $receipt.exceptions+=@{type=$type;hresult=[int]$failure.HResult;frames=@($frames)}
    $failure=$failure.InnerException
  }
}
$loaded=@([AppDomain]::CurrentDomain.GetAssemblies()|Where-Object {$_.GetName().Name -eq 'UIAutomationClientsideProviders'})
if($loaded.Count -gt 2){throw 'Loaded provider metadata exceeded its fixed bound.'}
foreach($assembly in $loaded){$receipt.loadedProviders+=@(Assembly-Identity ($assembly.GetName()))}
$receipt.elapsedMs=[int]$clock.ElapsedMilliseconds
$json=($receipt|ConvertTo-Json -Depth 8 -Compress)+[char]10
$bytes=[Text.Encoding]::UTF8.GetBytes($json)
if($bytes.Length -gt 16384){throw 'Registration receipt exceeded its fixed bound.'}
$sha=[Security.Cryptography.SHA256]::Create()
try{$digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
$root=Join-Path $PWD.Path '.harness-native-save-proxy'
[IO.Directory]::CreateDirectory($root)|Out-Null
[IO.File]::WriteAllBytes((Join-Path $root ($Mode+'.json')),$bytes)
$header=@{schema=1;mode=$Mode;bytes=$bytes.Length;sha256=$digest}|ConvertTo-Json -Compress
[Console]::Out.WriteLine('M05_PROXY_REGISTRATION_HEADER='+$header)
[Console]::Out.WriteLine('M05_PROXY_REGISTRATION_BODY='+[Convert]::ToBase64String($bytes))
[Console]::Out.WriteLine('M05_PROXY_REGISTRATION_END='+$digest)
if(-not $receipt.passed){exit 1}
exit 0
