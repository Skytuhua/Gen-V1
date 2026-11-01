# Fixed application-owned helper. Paths arrive only as JSON data on stdin.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class HarnessPathGuard {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle handle, int kind, ref int value, uint size);
  [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status, Information; }
  [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle handle, out IoStatus status, IntPtr value, uint size, int kind);
  [DllImport("ntdll.dll")] static extern uint RtlNtStatusToDosError(int status);
  static readonly Dictionary<string, List<SafeFileHandle>> Groups = new Dictionary<string, List<SafeFileHandle>>();
  public sealed class ManifestEntry {
    public string path, dev, ino;
    public bool directory;
    public long size;
  }
  static readonly Dictionary<string, List<ManifestEntry>> Manifests = new Dictionary<string, List<ManifestEntry>>();
  static List<SafeFileHandle> Held;
  static List<ManifestEntry> Manifest;
  public static void Begin(string id) { Held = new List<SafeFileHandle>(); Groups.Add(id, Held); Manifest = new List<ManifestEntry>(); Manifests.Add(id, Manifest); }
  public static ManifestEntry[] GetManifest(string id) { return Manifests[id].ToArray(); }
  static Info Pin(string path, bool directory, bool readOnly = false, bool allowChildWrites = false, bool createMarker = false) {
    // Strict directory guards deny write/delete opens; files share writes but deny deletion.
    // Include data/list access: attribute-only opens do not enforce Windows sharing denial.
    var sharing = directory ? 1u : (readOnly ? 1u : 3u);
    var handle = CreateFile(path, directory ? 0x81u : 0x80000080u, sharing, IntPtr.Zero, createMarker ? 4u : 3u, 0x02200000, IntPtr.Zero);
    if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
    Held.Add(handle);
    Info info;
    if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
    if ((info.Attributes & 0x400) != 0 || directory != ((info.Attributes & 0x10) != 0)) throw new IOException("Redirected or changed resource component");
    if (!directory && info.Links != 1) throw new IOException("Multiple hardlinks are unsupported");
    var final = new StringBuilder(32768);
    var length = GetFinalPathNameByHandle(handle, final, (uint)final.Capacity, 0);
    if (length == 0 || length >= final.Capacity) throw new IOException("Cannot identify opened resource");
    string actual = final.ToString();
    if (actual.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) actual = @"\\" + actual.Substring(8);
    else if (actual.StartsWith(@"\\?\", StringComparison.Ordinal)) actual = actual.Substring(4);
    if (!String.Equals(actual.TrimEnd('\\'), path.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) throw new IOException("Opened resource path changed");
    if (directory && allowChildWrites) {
      // NTFS requires an empty directory to establish a reparse point:
      // https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points
      // Pin an ordinary marker before relaxing write sharing for native atomic saves.
      // Its read-only, deny-delete handle keeps the directory nonempty throughout use.
      Pin(Path.Combine(path, ".harness-directory-guard"), false, true, false, true);
      var writable = CreateFile(path, 0x81u, 3u, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
      if (writable.IsInvalid) { writable.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
      Held.Add(writable);
      Info verified;
      if (!GetFileInformationByHandle(writable, out verified) || verified.Volume != info.Volume || verified.IndexHigh != info.IndexHigh || verified.IndexLow != info.IndexLow || (verified.Attributes & 0x400) != 0) throw new IOException("Account directory identity changed");
      handle.Dispose();
    }
    return info;
  }
  static bool Within(string path, string root) { return String.Equals(path, root, StringComparison.OrdinalIgnoreCase) || path.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase); }
  public static void Acquire(string path, bool leaf, string volume, string index, bool empty, bool tree, bool readOnly, bool allowChildWrites, string childWriteRoot) {
    if (allowChildWrites && leaf) throw new IOException("Child writes require a directory namespace guard");
    path = Path.GetFullPath(path);
    // Local disk paths only. Device/UNC namespaces have different identity semantics.
    if (path.Length < 3 || path[1] != ':' || path[2] != '\\' || path.Substring(2).Contains(":")) throw new IOException("Only local ordinary paths are supported");
    childWriteRoot = allowChildWrites ? Path.GetFullPath(String.IsNullOrEmpty(childWriteRoot) ? path : childWriteRoot).TrimEnd('\\') : "";
    if (allowChildWrites && !Within(path.TrimEnd('\\'), childWriteRoot)) throw new IOException("Child-write scope must contain its guarded directory");
    string current = Path.GetPathRoot(path); Pin(current, true, false, allowChildWrites && Within(current.TrimEnd('\\'), childWriteRoot));
    string[] parts = path.Substring(current.Length).Split(new char[]{'\\'}, StringSplitOptions.RemoveEmptyEntries);
    for (int i=0; i<parts.Length; i++) {
      current = Path.Combine(current, parts[i]);
      bool last = i == parts.Length-1;
      if (!last || allowChildWrites || Directory.Exists(current)) Pin(current, true, false, allowChildWrites && Within(current.TrimEnd('\\'), childWriteRoot));
      else if (leaf) Pin(current, false, readOnly);
    }
    if (leaf && !String.IsNullOrEmpty(volume)) {
      Info info;
      if (!GetFileInformationByHandle(Held[Held.Count-1], out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
      ulong identity = ((ulong)info.IndexHigh << 32) | info.IndexLow;
      if (info.Volume.ToString() != volume || identity.ToString() != index || (empty && (info.SizeHigh != 0 || info.SizeLow != 0))) throw new IOException("Guarded object identity changed");
    }
    if (tree) { int visited = 0; long bytes = 0; Tree(path, 0, ref visited, ref bytes); }
  }
  static void Tree(string path, int depth, ref int visited, ref long bytes) {
    if (depth > 64) throw new IOException("Metadata depth limit exceeded");
    foreach (string child in Directory.EnumerateFileSystemEntries(path)) {
      if (++visited > 10000) throw new IOException("Metadata entry limit exceeded");
      var attributes = File.GetAttributes(child);
      if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Redirected metadata is unsupported");
      bool directory = (attributes & FileAttributes.Directory) != 0;
      Info info = Pin(child, directory, true);
      long size = directory ? 0 : ((long)info.SizeHigh << 32) | info.SizeLow;
      if (size < 0 || size > 64 * 1024 * 1024 - bytes) throw new IOException("Snapshot byte limit exceeded");
      bytes += size;
      Manifest.Add(new ManifestEntry { path = child, directory = directory, dev = info.Volume.ToString(), ino = (((ulong)info.IndexHigh << 32) | info.IndexLow).ToString(), size = size });
      if (directory) Tree(child, depth+1, ref visited, ref bytes);
    }
  }
  public static void Release(string id) { var held = Groups[id]; for (int i=held.Count-1; i>=0; i--) held[i].Dispose(); Groups.Remove(id); Manifests.Remove(id); }
  public static void ReleaseAll() { foreach (var held in Groups.Values) foreach (var h in held) h.Dispose(); Groups.Clear(); Manifests.Clear(); }
  public static void RemoveOwned(string path, string volume, string index, bool empty, bool directory) {
    using (var handle = CreateFile(path, 0x10080, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
      if (handle.IsInvalid) return; // Missing, replaced or busy: preserve it.
      Info info;
      if (!GetFileInformationByHandle(handle, out info)) return;
      ulong identity = ((ulong)info.IndexHigh << 32) | info.IndexLow;
      if ((info.Attributes & 0x400) != 0 || directory != ((info.Attributes & 0x10) != 0) || (!directory && info.Links != 1) || info.Volume.ToString() != volume || identity.ToString() != index) return;
      if (!directory && empty && (info.SizeHigh != 0 || info.SizeLow != 0)) return; // Keep a hot rollback journal as recovery evidence.
      int remove = 1;
      if (!SetFileInformationByHandle(handle, 4, ref remove, 4)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }
  static FileStream VerifyDestination(string destination, string volume, string index, string expectedHash) {
    // Share read/delete so the atomic rename remains possible. This denies
    // in-place writers; external atomic pathname replacements remain possible.
    var handle = CreateFile(destination, 0x80000080, 5, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    FileStream stream = null;
    try {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      Info info;
      if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
      ulong identity = ((ulong)info.IndexHigh << 32) | info.IndexLow;
      if ((info.Attributes & 0x410) != 0 || info.Links != 1 || info.Volume.ToString() != volume || identity.ToString() != index) throw new IOException("Replacement destination identity changed");
      if (info.SizeHigh != 0 || info.SizeLow > 8 * 1024 * 1024) throw new IOException("Replacement destination exceeds its byte limit");
      stream = new FileStream(handle, FileAccess.Read);
      using (var hash = SHA256.Create()) {
        string actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        if (actual != expectedHash) throw new IOException("Replacement destination bytes changed");
      }
      return stream;
    } catch { if (stream != null) stream.Dispose(); else handle.Dispose(); throw; }
  }
  public static void ReplaceOwned(string source, string destination, string volume, string index, string expectedHash, string targetVolume, string targetIndex, string targetHash) {
    using (var target = String.IsNullOrEmpty(targetHash) ? null : VerifyDestination(destination, targetVolume, targetIndex, targetHash))
    using (var handle = CreateFile(source, 0x80010080, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot open replacement source");
      Info info;
      if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
      ulong identity = ((ulong)info.IndexHigh << 32) | info.IndexLow;
      if ((info.Attributes & 0x410) != 0 || info.Links != 1 || info.Volume.ToString() != volume || identity.ToString() != index) throw new IOException("Replacement source identity changed");
      using (var stream = new FileStream(handle, FileAccess.Read)) {
        using (var hash = SHA256.Create()) {
          string actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
          if (actual != expectedHash) throw new IOException("Replacement source bytes changed");
        }
        byte[] name = Encoding.Unicode.GetBytes(Path.GetFileName(destination));
        if (!String.Equals(Path.GetDirectoryName(source), Path.GetDirectoryName(destination), StringComparison.OrdinalIgnoreCase)) throw new IOException("Replacement must remain in its guarded directory");
        int rootOffset = IntPtr.Size == 8 ? 8 : 4, lengthOffset = rootOffset + IntPtr.Size, nameOffset = lengthOffset + 4;
        IntPtr buffer = Marshal.AllocHGlobal(nameOffset + name.Length);
        try {
          // A bare name + NULL root renames within the opened source's own directory.
          // It avoids reopening the pinned directory for write access.
          // POSIX rename permits replacement of our open destination, which
          // explicitly shares deletion. It does not bypass a deny-delete lease.
          bool conditional = target != null;
          Marshal.WriteInt32(buffer, 0, conditional ? 3 : 1); Marshal.WriteIntPtr(buffer, rootOffset, IntPtr.Zero);
          Marshal.WriteInt32(buffer, lengthOffset, name.Length); Marshal.Copy(name, 0, IntPtr.Add(buffer, nameOffset), name.Length);
          IoStatus outcome;
          int status = NtSetInformationFile(handle, out outcome, buffer, (uint)(nameOffset + name.Length), conditional ? 65 : 10);
          if (status < 0) throw new Win32Exception((int)RtlNtStatusToDosError(status), "Cannot rename replacement source: " + RtlNtStatusToDosError(status));
        } finally { Marshal.FreeHGlobal(buffer); }
      }
    }
  }
}
'@
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $line | ConvertFrom-Json
    if ($request.command -eq 'acquire') {
      [HarnessPathGuard]::Begin([string]$request.id)
      foreach ($entry in $request.paths) { [HarnessPathGuard]::Acquire([string]$entry.path, [bool]$entry.leaf, [string]$entry.dev, [string]$entry.ino, [bool]$entry.empty, [bool]$entry.tree, [bool]$entry.readOnly, [bool]$entry.allowChildWrites, [string]$entry.childWriteRoot) }
    } elseif ($request.command -eq 'release') { [HarnessPathGuard]::Release([string]$request.id) }
    elseif ($request.command -eq 'removeOwned') { [HarnessPathGuard]::RemoveOwned([string]$request.path, [string]$request.dev, [string]$request.ino, [bool]$request.empty, [bool]$request.directory) }
    elseif ($request.command -eq 'replaceOwned') { [HarnessPathGuard]::ReplaceOwned([string]$request.source, [string]$request.destination, [string]$request.dev, [string]$request.ino, [string]$request.sha256, [string]$request.targetDev, [string]$request.targetIno, [string]$request.targetSha256) }
    else { throw 'Invalid guard request' }
    if ($request.command -eq 'acquire' -and @($request.paths | Where-Object { $_.tree }).Count -gt 0) {
      [Console]::WriteLine((@{ id = [string]$request.id; entries = @([HarnessPathGuard]::GetManifest([string]$request.id)) } | ConvertTo-Json -Compress -Depth 5))
    } else { [Console]::WriteLine([string]$request.id) }
    [Console]::Out.Flush()
  }
} catch {
  $failure = $_.Exception.GetBaseException()
  [Console]::Error.WriteLine('GUARD_NATIVE_ERROR:' + $failure.HResult)
  exit 1
}
finally { [HarnessPathGuard]::ReleaseAll() }
