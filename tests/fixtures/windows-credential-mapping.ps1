param([string]$Path)
$ErrorActionPreference = 'Stop'
$stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
$mapping = [IO.MemoryMappedFiles.MemoryMappedFile]::CreateFromFile($stream, ('gen-fixture-' + [Guid]::NewGuid().ToString('N')), 0, [IO.MemoryMappedFiles.MemoryMappedFileAccess]::ReadWrite, [IO.HandleInheritability]::None, $true)
$view = $mapping.CreateViewAccessor()
$stream.Dispose()
try {
    $view.Write(0, [byte]123)
    $view.Flush()
    [Console]::Out.WriteLine('mapped')
    [Console]::Out.Flush()
    [Console]::In.ReadLine() | Out-Null
} finally {
    $view.Dispose()
    $mapping.Dispose()
}
