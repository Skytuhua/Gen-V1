[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('copied','fresh')][string]$Mode)
$ErrorActionPreference='Stop'
$clock=[Diagnostics.Stopwatch]::StartNew()
$receipt=[ordered]@{version=1;mode=$Mode;createdAt=[DateTime]::UtcNow.ToString('o');passed=$false;scope='Read-only UI Automation assembly registration; no native dialog, account, provider request or control action.';stage='load-assemblies';sourceSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();powershellVersion=$PSVersionTable.PSVersion.ToString();clrVersion=$PSVersionTable.CLRVersion.ToString();processBits=([IntPtr]::Size*8);client=$null;requested=$null;registered=$null;providerTableCount=$null;exceptions=@()}
function Assembly-Identity($name) {
  $token=([BitConverter]::ToString($name.GetPublicKeyToken())).Replace('-','').ToLowerInvariant()
  if($name.Name -cnotin @('UIAutomationClient','UIAutomationClientsideProviders') -or $token -notmatch '^[0-9a-f]{16}$'){throw 'Unexpected UI Automation assembly identity.'}
  return [ordered]@{name=$name.Name;version=$name.Version.ToString();culture=$name.CultureName;publicKeyToken=$token;codeBasePresent=(-not [string]::IsNullOrEmpty($name.CodeBase))}
}
try {
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $client=[System.Windows.Automation.AutomationElement].Assembly
  $receipt.client=Assembly-Identity ($client.GetName())
  $receipt.stage='construct-provider-name'
  if($Mode -ceq 'copied'){$provider=$client.GetName()}else{$provider=[Reflection.AssemblyName]::new($client.FullName)}
  $provider.Name='UIAutomationClientsideProviders'
  $receipt.requested=Assembly-Identity $provider
  $receipt.stage='register-provider'
  [System.Windows.Automation.ClientSettings]::RegisterClientSideProviderAssembly($provider)
  $receipt.stage='inspect-registered-provider'
  $loaded=@([AppDomain]::CurrentDomain.GetAssemblies()|Where-Object {$_.GetName().Name -ceq 'UIAutomationClientsideProviders'})
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
    $receipt.exceptions+=@{type=$type;hresult=[int]$failure.HResult}
    $failure=$failure.InnerException
  }
}
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
