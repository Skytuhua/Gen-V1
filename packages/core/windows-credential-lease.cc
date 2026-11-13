#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <aclapi.h>
#include <node_api.h>
#include <string>
#include <vector>
#include <memory>
#include <stdexcept>

namespace {
constexpr DWORD LIMIT = 1024 * 1024;
const napi_type_tag TAG = {0x5d36b9a7e4974ae1ULL, 0x833acfe7e7c9e5a2ULL};
struct Lease {
  std::vector<HANDLE> handles;
  std::wstring path;
  BY_HANDLE_FILE_INFORMATION identity{};
  napi_ref keepalive = nullptr;
  bool released = false;
  ~Lease() {for (auto handle : handles) if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);}
};
void require(bool condition) {if (!condition) throw std::runtime_error("unavailable");}
void check(napi_status status) {require(status == napi_ok);}
napi_value denied(napi_env env, const char* code = "PI_CREDENTIAL_LEASE_UNAVAILABLE") {
  napi_throw_error(env, code, "Protected credential evidence is unavailable."); return nullptr;
}
void finalize(napi_env, void* data, void*) {delete static_cast<Lease*>(data);}
HANDLE open(Lease& lease, const std::wstring& path, bool leaf) {
  HANDLE handle = CreateFileW(path.c_str(), leaf ? GENERIC_READ | READ_CONTROL : FILE_READ_ATTRIBUTES,
    leaf ? FILE_SHARE_READ : FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
    FILE_FLAG_OPEN_REPARSE_POINT | (leaf ? 0 : FILE_FLAG_BACKUP_SEMANTICS), nullptr);
  require(handle != INVALID_HANDLE_VALUE); lease.handles.push_back(handle);
  BY_HANDLE_FILE_INFORMATION info{};
  require(GetFileType(handle) == FILE_TYPE_DISK && GetFileInformationByHandle(handle, &info));
  require(!(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT));
  require(bool(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != leaf);
  if (leaf) require(info.nNumberOfLinks == 1 && info.nFileSizeHigh == 0 && info.nFileSizeLow <= LIMIT);
  return handle;
}
void privateFile(HANDLE handle) {
  PSID owner = nullptr; PACL acl = nullptr; PSECURITY_DESCRIPTOR descriptor = nullptr;
  require(GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
    &owner, nullptr, &acl, nullptr, &descriptor) == ERROR_SUCCESS);
  std::unique_ptr<void, decltype(&LocalFree)> security(descriptor, LocalFree);
  HANDLE token = nullptr; require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token));
  DWORD size = 0; GetTokenInformation(token, TokenUser, nullptr, 0, &size);
  std::vector<BYTE> bytes(size);
  const bool obtained = GetTokenInformation(token, TokenUser, bytes.data(), size, &size);
  CloseHandle(token); require(obtained);
  PSID user = reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid;
  require(owner && EqualSid(owner, user) && acl);
  BYTE system[SECURITY_MAX_SID_SIZE], admins[SECURITY_MAX_SID_SIZE];
  DWORD systemSize = sizeof(system), adminSize = sizeof(admins);
  require(CreateWellKnownSid(WinLocalSystemSid, nullptr, system, &systemSize));
  require(CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, admins, &adminSize));
  for (DWORD i = 0; i < acl->AceCount; ++i) {
    void* raw = nullptr; require(GetAce(acl, i, &raw)); auto* header = static_cast<ACE_HEADER*>(raw);
    if (header->AceFlags & INHERIT_ONLY_ACE) continue;
    if (header->AceType == ACCESS_DENIED_ACE_TYPE) continue;
    require(header->AceType == ACCESS_ALLOWED_ACE_TYPE);
    auto* ace = static_cast<ACCESS_ALLOWED_ACE*>(raw); auto* sid = &ace->SidStart;
    require(!ace->Mask || EqualSid(sid, user) || EqualSid(sid, system) || EqualSid(sid, admins));
  }
}
std::wstring path(napi_env env, napi_value value) {
  size_t length = 0; check(napi_get_value_string_utf16(env, value, nullptr, 0, &length));
  require(length > 3 && length < 32760); std::vector<char16_t> text(length + 1);
  size_t copied = 0; check(napi_get_value_string_utf16(env, value, text.data(), text.size(), &copied));
  require(copied == length); std::wstring result(reinterpret_cast<wchar_t*>(text.data()), length);
  require(((result[0] >= L'A' && result[0] <= L'Z') || (result[0] >= L'a' && result[0] <= L'z')) && result[1] == L':' && result[2] == L'\\');
  size_t start = 3;
  for (size_t i = 3; i <= length; ++i) {
    if (i < length && result[i] != L'\\') {require(result[i] >= 32 && std::wstring(L"/:*?\"<>|").find(result[i]) == std::wstring::npos); continue;}
    require(i > start && result[i - 1] != L'.' && result[i - 1] != L' '); start = i + 1;
  }
  return result;
}
Lease* receiver(napi_env env, napi_callback_info info) {
  napi_value self; size_t argc = 0; check(napi_get_cb_info(env, info, &argc, nullptr, &self, nullptr));
  bool tagged = false; check(napi_check_object_type_tag(env, self, &TAG, &tagged)); require(tagged);
  void* data = nullptr; check(napi_unwrap(env, self, &data)); require(data); return static_cast<Lease*>(data);
}
bool same(const BY_HANDLE_FILE_INFORMATION& a, const BY_HANDLE_FILE_INFORMATION& b) {
  return a.dwVolumeSerialNumber == b.dwVolumeSerialNumber && a.nFileIndexHigh == b.nFileIndexHigh && a.nFileIndexLow == b.nFileIndexLow
    && a.nFileSizeHigh == b.nFileSizeHigh && a.nFileSizeLow == b.nFileSizeLow && b.nNumberOfLinks == 1
    && !(b.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))
    && CompareFileTime(&a.ftLastWriteTime, &b.ftLastWriteTime) == 0;
}
void current(Lease& lease) {
  require(!lease.released); BY_HANDLE_FILE_INFORMATION info{};
  require(GetFileInformationByHandle(lease.handles.back(), &info) && same(lease.identity, info));
  Lease named; const HANDLE handle = open(named, lease.path, true);
  require(GetFileInformationByHandle(handle, &info) && same(lease.identity, info));
  privateFile(lease.handles.back());
}
napi_value read(napi_env env, napi_callback_info info) {
  try {
    Lease& lease = *receiver(env, info); current(lease);
    LARGE_INTEGER zero{}; require(SetFilePointerEx(lease.handles.back(), zero, nullptr, FILE_BEGIN));
    std::vector<BYTE> bytes(lease.identity.nFileSizeLow + 1); DWORD count = 0;
    require(ReadFile(lease.handles.back(), bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr));
    require(count == lease.identity.nFileSizeLow); current(lease);
    napi_value result; check(napi_create_buffer_copy(env, count, bytes.data(), nullptr, &result)); return result;
  } catch (...) {return denied(env);}
}
napi_value release(napi_env env, napi_callback_info info) {
  try {
    Lease& lease = *receiver(env, info);
    for (auto& handle : lease.handles) if (handle != INVALID_HANDLE_VALUE) {
      if (!CloseHandle(handle)) return denied(env, "PI_CREDENTIAL_LEASE_RELEASE_UNCERTAIN");
      handle = INVALID_HANDLE_VALUE;
    }
    lease.released = true;
    if (lease.keepalive) {check(napi_delete_reference(env, lease.keepalive)); lease.keepalive = nullptr;}
    napi_value result; check(napi_get_undefined(env, &result)); return result;
  } catch (...) {return denied(env);}
}
napi_value acquire(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 1; napi_value argument; check(napi_get_cb_info(env, info, &argc, &argument, nullptr, nullptr)); require(argc == 1);
    auto lease = std::make_unique<Lease>(); lease->path = path(env, argument);
    require(GetDriveTypeW(lease->path.substr(0, 3).c_str()) == DRIVE_FIXED);
    open(*lease, lease->path.substr(0, 3), false);
    for (size_t i = 3; i < lease->path.size(); ++i) if (lease->path[i] == L'\\') open(*lease, lease->path.substr(0, i), false);
    HANDLE held = open(*lease, lease->path, true); privateFile(held);
    std::vector<wchar_t> canonical(32768);
    DWORD length = GetFinalPathNameByHandleW(held, canonical.data(), static_cast<DWORD>(canonical.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    require(length > 4 && length < canonical.size() && std::wstring(canonical.data(), 4) == L"\\\\?\\" && _wcsicmp(canonical.data() + 4, lease->path.c_str()) == 0);
    require(GetFileInformationByHandle(held, &lease->identity)); current(*lease);
    napi_value result, method; check(napi_create_object(env, &result)); check(napi_type_tag_object(env, result, &TAG));
    check(napi_create_function(env, "read", NAPI_AUTO_LENGTH, read, nullptr, &method)); check(napi_set_named_property(env, result, "read", method));
    check(napi_create_function(env, "release", NAPI_AUTO_LENGTH, release, nullptr, &method)); check(napi_set_named_property(env, result, "release", method));
    check(napi_wrap(env, result, lease.get(), finalize, nullptr, nullptr));
    Lease* owned = lease.release();
    // A dropped JS wrapper must not silently restore writes before explicit settlement.
    check(napi_create_reference(env, result, 1, &owned->keepalive)); return result;
  } catch (...) {return denied(env);}
}
napi_value initialize(napi_env env, napi_value exports) {
  napi_value method; if (napi_create_function(env, "acquire", NAPI_AUTO_LENGTH, acquire, nullptr, &method) != napi_ok) return denied(env);
  if (napi_set_named_property(env, exports, "acquire", method) != napi_ok) return denied(env); return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
