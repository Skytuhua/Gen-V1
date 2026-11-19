// M16 C4 — Windows selected-window observation bridge.
//
// App-owned consent chooser only: listWindows() enumerates live top-level
// application windows and, inside the same enumeration pass, binds a
// GraphicsCaptureItem for each row (CreateForWindow) that is HELD for the
// selection lifetime. The row's creation-bound identity is the bound item
// itself — an HWND value plus process id cannot prove window creation
// identity because HWNDs recycle within a process, so no hwnd/pid token is
// ever re-derivation used post-binding. Same-object proof between
// enumeration and binding comes from a window PROP token (window properties
// are destroyed with the window object, so GetProp==token after
// CreateForWindow proves the bound object is still the enumerated one; the
// prop is kept for the binding lifetime as the revalidation marker).
// Invalidation is reliable: the item's Closed event fires when the bound
// window is destroyed, frame production starves, and the prop vanishes — any
// of those closes the binding and every later op fails closed.
//
// Node-API surface (called only from apps/desktop/control-bridge.ts):
//   pickWindow(ownerHwndBuffer|null) -> HELD: system picker cannot bind an HWND (CONTROL_PICKER_BINDING_UNSUPPORTED)
//   listWindows()                    -> Promise<windowObject[]> — app-owned chooser feed; each row carries a bindingId
//   windowIdentity(bindingId:string) -> Promise<same|null> — live re-proof of the held binding
//   captureWindow(bindingId:string)  -> Promise<{data:Buffer,width,height}> — capture via the already-bound item
//   dropBinding(bindingId:string)    -> Promise<null> — release a held binding (Stop/cancel)

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define UNICODE
#include <windows.h>
#include <delayimp.h>
#include <string.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <node_api.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Storage.Streams.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <dwmapi.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <shobjidl.h>
#include <string>
#include <vector>
#include <memory>
#include <optional>
#include <unordered_map>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <atomic>
#include <mutex>
#include <condition_variable>

// The addon is linked /DELAYLOAD:node.exe so its node imports bind to the
// host executable at load time: inside Electron there is no node.exe to
// resolve. Same preload mechanism node-gyp injects as win_delay_load_hook.cc,
// declared via the installed SDK's own type.
static FARPROC WINAPI delayLoadNodeExe(unsigned int dliNotify,PDelayLoadInfo info){
 if(dliNotify!=dliNotePreLoadLibrary)return NULL;
 if(_stricmp(info->szDll,"node.exe")!=0)return NULL;
 return (FARPROC)GetModuleHandle(NULL);
}
decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2=delayLoadNodeExe;

namespace {
namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgi = winrt::Windows::Graphics::Imaging;
namespace wdx = winrt::Windows::Graphics::DirectX;
namespace wdx3 = winrt::Windows::Graphics::DirectX::Direct3D11;
using Microsoft::WRL::ComPtr;
using Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess;

void require(bool condition, const char* stage) { if (!condition) throw std::runtime_error(stage); }
void hr(HRESULT result, const char* stage) { require(SUCCEEDED(result), stage); }

struct WindowDesc {
  HWND hwnd = nullptr;
  DWORD pid = 0;
  DWORD threadId = 0;
  std::wstring title;
  RECT rect{};
  UINT dpi = 96;
  uintptr_t token = 0;
  std::string bindingId;
};

std::wstring windowText(HWND hwnd) {
  int length = GetWindowTextLengthW(hwnd);
  std::wstring value(length > 0 ? length : 1, L'\0');
  int written = GetWindowTextW(hwnd, value.data(), length + 1);
  value.resize(written > 0 ? written : 0);
  return value;
}

std::wstring windowClass(HWND hwnd) {
  wchar_t name[256]{};
  int written = GetClassNameW(hwnd, name, 255);
  return std::wstring(name, written > 0 ? written : 0);
}

// A prove-able application window: visible top-level, owned by a real process,
// not cloaked, not a shell surface. Titles may be empty (some apps) — identity
// is never title-based alone.
bool enumerableAppWindow(HWND hwnd) {
  if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return false;
  if (GetWindow(hwnd, GW_OWNER) != nullptr) return false;
  LONG_PTR ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if (ex & WS_EX_TOOLWINDOW) return false;
  DWORD cloaked = 0;
  if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked != 0) return false;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid == 0 || pid == GetCurrentProcessId()) return false; // our own app is not a target
  std::wstring klass = windowClass(hwnd);
  if (klass == L"Progman" || klass == L"WorkerW" || klass == L"Shell_TrayWnd" || klass == L"Shell_SecondaryTrayWnd" || klass == L"DV2ControlHost") return false;
  RECT rect{};
  if (!GetWindowRect(hwnd, &rect)) return false;
  return (rect.right - rect.left) > 0 && (rect.bottom - rect.top) > 0;
}

// ---- Bound-window registry -------------------------------------------------
//
// Identity model (D02/D04): an HWND value is a table index, not a creation
// identity — Windows recycles handles, including within one process. The only
// object that can prove "the window the user selected is the window being
// captured" is a capture item that was bound while the selection was minted
// and is held for the whole selection lifetime. listWindows therefore does
// binding at enumeration time and hands out opaque bindingIds; no later op
// ever derives an object from an HWND.
//
// Same-object atomicity across the bind uses a window PROP: properties are
// destroyed with the window object, so GetProp==token proves the object that
// was marked is the object that got bound (and remains so at revalidation).
// SetProp on a window the OS won't let us mark (e.g. elevated targets) makes
// the row unbindable — it is excluded rather than bound unproven.

const wchar_t* kBindProp = L"GenV1M16Bind";

struct HeldBinding {
  HWND hwnd = nullptr;
  DWORD pid = 0;
  DWORD threadId = 0;
  uintptr_t token = 0;
  std::wstring title;
  RECT rect{};
  UINT dpi = 96;
  wgc::GraphicsCaptureItem item{nullptr};
  wgc::IGraphicsCaptureItem::Closed_revoker closedRevoker;
  bool closed = false;
};

// Every binding op runs on the single STA thread, so the map needs no lock;
// the Closed event also marshals onto that apartment.
//
// The registry is intentionally heap-allocated and leaked: its destructor
// would release GraphicsCaptureItems during CRT teardown, which can run
// after the WinRT apartment is already gone (observed 0xC0000005). Items
// are released during runtime through dropBinding/dropAllOnSta; at process
// exit the map is abandoned rather than destructed, so no item release can
// ever happen outside a live apartment.
std::unordered_map<std::string, HeldBinding>& bindings() {
  static auto* map = new std::unordered_map<std::string, HeldBinding>();
  return *map;
}

std::atomic<uint64_t>& bindingSerial() {
  static std::atomic<uint64_t> serial{0};
  return serial;
}

// Enumerate eligible windows, marking each with a per-enumeration prop token.
// If a window object is destroyed and recreated mid-enumeration, the prop
// dies with the old object and the recycled handle will fail the post-bind
// GetProp check — the binding either refers to one consistent window object
// or does not exist at all.
struct EnumContext { std::vector<WindowDesc> windows; uint64_t epoch; };
BOOL CALLBACK enumWindow(HWND hwnd, LPARAM param) {
  auto* context = reinterpret_cast<EnumContext*>(param);
  if (!enumerableAppWindow(hwnd)) return TRUE;
  uintptr_t token = ((context->epoch & 0xffffffffull) << 32) | (uint32_t)context->windows.size();
  if (!SetPropW(hwnd, kBindProp, reinterpret_cast<HANDLE>(token))) return TRUE;
  WindowDesc desc{};
  desc.hwnd = hwnd;
  desc.token = token;
  desc.threadId = GetWindowThreadProcessId(hwnd, &desc.pid);
  desc.title = windowText(hwnd);
  GetWindowRect(hwnd, &desc.rect);
  desc.dpi = GetDpiForWindow(hwnd);
  context->windows.push_back(std::move(desc));
  return TRUE;
}

std::vector<WindowDesc> appWindows(uint64_t epoch) {
  EnumContext context{};
  context.epoch = epoch;
  EnumWindows(enumWindow, reinterpret_cast<LPARAM>(&context));
  return std::move(context.windows);
}

std::optional<WindowDesc> describe(HWND hwnd) {
  if (!IsWindow(hwnd) || !enumerableAppWindow(hwnd)) return std::nullopt;
  WindowDesc desc{};
  desc.hwnd = hwnd;
  desc.threadId = GetWindowThreadProcessId(hwnd, &desc.pid);
  desc.title = windowText(hwnd);
  if (!GetWindowRect(hwnd, &desc.rect)) return std::nullopt;
  desc.dpi = GetDpiForWindow(hwnd);
  return desc;
}

// Live proof that the bound window object still exists: the item has not
// reported Closed, our creation marker is still on the window, and it is
// still a capturable application window.
bool bindingAlive(const HeldBinding& binding) {
  if (binding.closed) return false;
  HANDLE prop = GetPropW(binding.hwnd, kBindProp);
  if (prop != reinterpret_cast<HANDLE>(binding.token)) return false;
  return describe(binding.hwnd).has_value();
}

void dropBinding(HeldBinding& binding) {
  if (IsWindow(binding.hwnd)) RemovePropW(binding.hwnd, kBindProp);
  try { binding.closedRevoker.revoke(); } catch (...) {}
  binding.item = nullptr;
  binding.closed = true;
}

// No drain hook: env-teardown callbacks run while ExitProcess serializes
// threads, and waiting on the STA thread there deadlocks whenever a capture
// is in flight (verified on-box). The leaked registry already guarantees
// nothing destructs at teardown; drop paths release bindings during runtime.

// ---- JS marshalling -------------------------------------------------------

std::string utf8(const std::wstring& wide) {
  if (wide.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, wide.data(), (int)wide.size(), nullptr, 0, nullptr, nullptr);
  std::string value(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.data(), (int)wide.size(), value.data(), size, nullptr, nullptr);
  return value;
}

napi_value windowObject(napi_env env, const WindowDesc& desc) {
  napi_value object;
  napi_create_object(env, &object);
  napi_set_named_property(env, object, "handle", ([&] { napi_value v; napi_create_double(env, (double)(intptr_t)desc.hwnd, &v); return v; })());
  napi_set_named_property(env, object, "processId", ([&] { napi_value v; napi_create_uint32(env, desc.pid, &v); return v; })());
  napi_set_named_property(env, object, "title", ([&] { napi_value v; napi_create_string_utf8(env, utf8(desc.title).c_str(), NAPI_AUTO_LENGTH, &v); return v; })());
  napi_value bounds, x, y, w, h;
  napi_create_object(env, &bounds);
  napi_create_int32(env, desc.rect.left, &x);
  napi_create_int32(env, desc.rect.top, &y);
  napi_create_int32(env, desc.rect.right - desc.rect.left, &w);
  napi_create_int32(env, desc.rect.bottom - desc.rect.top, &h);
  napi_set_named_property(env, bounds, "x", x);
  napi_set_named_property(env, bounds, "y", y);
  napi_set_named_property(env, bounds, "width", w);
  napi_set_named_property(env, bounds, "height", h);
  napi_set_named_property(env, object, "bounds", bounds);
  napi_set_named_property(env, object, "dpiScale", ([&] { napi_value v; napi_create_double(env, desc.dpi / 96.0, &v); return v; })());
  napi_set_named_property(env, object, "bindingId", ([&] { napi_value v; napi_create_string_utf8(env, desc.bindingId.c_str(), NAPI_AUTO_LENGTH, &v); return v; })());
  return object;
}

// ---- Async worker ---------------------------------------------------------

struct Work {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  HWND hwnd = nullptr;
  std::string bindingId;
  enum class Kind { Pick, Identity, Capture, List, Drop } kind = Kind::Pick;
  // Results
  bool hasWindow = false;
  WindowDesc window{};
  std::vector<BYTE> png;
  std::vector<WindowDesc> windows;
  uint32_t width = 0, height = 0;
  std::string error;
};

void complete(napi_env env, Work* work, bool isNull) {
  napi_value result = nullptr;
  if (work->kind == Work::Kind::List) {
    napi_create_array_with_length(env, work->windows.size(), &result);
    for (size_t i = 0; i < work->windows.size(); ++i) {
      napi_set_element(env, result, (uint32_t)i, windowObject(env, work->windows[i]));
    }
  } else if (isNull) {
    napi_get_null(env, &result);
  } else if (work->kind == Work::Kind::Capture) {
    napi_create_object(env, &result);
    napi_value data;
    void* bytes = nullptr;
    napi_create_buffer_copy(env, work->png.size(), work->png.data(), &bytes, &data);
    memcpy(bytes, work->png.data(), work->png.size());
    napi_set_named_property(env, result, "data", data);
    napi_value w, h;
    napi_create_uint32(env, work->width, &w);
    napi_create_uint32(env, work->height, &h);
    napi_set_named_property(env, result, "width", w);
    napi_set_named_property(env, result, "height", h);
  } else {
    result = windowObject(env, work->window);
  }
  napi_resolve_deferred(env, work->deferred, result);
}

void finish(napi_env env, napi_status, void* data) {
  std::unique_ptr<Work> work(static_cast<Work*>(data));
  if (work->error.empty()) {
    complete(env, work.get(), (work->kind == Work::Kind::Pick || work->kind == Work::Kind::Identity || work->kind == Work::Kind::Drop) && !work->hasWindow);
  } else {
    napi_value error;
    napi_create_error(env, nullptr, ([&] { napi_value v; napi_create_string_utf8(env, work->error.c_str(), NAPI_AUTO_LENGTH, &v); return v; })(), &error);
    napi_reject_deferred(env, work->deferred, error);
  }
  napi_delete_async_work(env, work->work);
}

// ---- WinRT execution context ----------------------------------------------

// One STA thread owns the WinRT apartment for pick + capture calls. WGC frame
// pools must be created and awaited on a consistent thread; the picker's
// consent UI also requires a proper apartment. All real work funnels here.
struct StaThread {
  HANDLE ready = nullptr;
  HANDLE thread = nullptr;
  DWORD id = 0;
  struct Job { void (*run)(void*); void* data; HANDLE done; }* job = nullptr;
  CRITICAL_SECTION lock{};
  HANDLE pending = nullptr;
  std::atomic<bool> stop{false};
};

StaThread& sta() {
  static StaThread instance;
  static std::once_flag once;
  std::call_once(once, [] {
    instance.ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    instance.pending = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    InitializeCriticalSection(&instance.lock);
    instance.thread = CreateThread(nullptr, 0, [](void* raw) -> DWORD {
      auto* self = static_cast<StaThread*>(raw);
      winrt::init_apartment(winrt::apartment_type::single_threaded);
      SetEvent(self->ready);
      MSG message{};
      for (;;) {
        WaitForSingleObject(self->pending, INFINITE);
        EnterCriticalSection(&self->lock);
        auto* job = self->job;
        self->job = nullptr;
        LeaveCriticalSection(&self->lock);
        if (self->stop) break;
        if (job) { job->run(job->data); SetEvent(job->done); }
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&message); DispatchMessageW(&message); }
      }
      winrt::uninit_apartment();
      return 0;
    }, &instance, 0, &instance.id);
  });
  return instance;
}

// Run `fn` on the STA thread and wait for it.
void onSta(void (*run)(void*), void* data) {
  auto& context = sta();
  WaitForSingleObject(context.ready, INFINITE);
  HANDLE done = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  StaThread::Job job{run, data, done};
  EnterCriticalSection(&context.lock);
  context.job = &job;
  LeaveCriticalSection(&context.lock);
  SetEvent(context.pending);
  WaitForSingleObject(done, INFINITE);
  CloseHandle(done);
}

// ---- Picker ---------------------------------------------------------------

struct PickResult { bool cancelled = false; WindowDesc window{}; std::string error; HWND owner = nullptr; std::string bindingId; };

// HOLD_PICKER_BINDING (D02/D04): the system GraphicsCapturePicker returns a
// GraphicsCaptureItem whose DisplayName/Size are not an authoritative window
// identity, and no public API maps the item back to its HWND. A heuristic
// match against EnumWindows titles or client dimensions cannot prove which
// object the picker returned — a display and a same-sized window are
// indistinguishable — so it was removed and every window operation fails
// closed until an approved same-object binding exists.
void pickOnSta(void* raw) {
  auto* result = static_cast<PickResult*>(raw);
  result->error = "CONTROL_PICKER_BINDING_UNSUPPORTED: the capture picker cannot return an authoritative window identity; selected-window control is held.";
}

// ---- WGC capture ----------------------------------------------------------

// Create a GraphicsCaptureItem for an HWND. Called exactly once per chooser
// row, inside listWindows' enumeration — the returned item is then held in
// the binding registry and is the only object capture sessions may use.
wgc::GraphicsCaptureItem createItemForWindow(HWND hwnd) {
  auto interop = winrt::get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
  wgc::GraphicsCaptureItem item{nullptr};
  hr(interop->CreateForWindow(hwnd, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(item)), "The selected window cannot be captured.");
  require(bool(item), "The selected window cannot be captured.");
  return item;
}

class WgcSession {
 public:
  // The item arrives already bound (from the held registry entry) — this
  // class never derives a capture object from an HWND.
  explicit WgcSession(const wgc::GraphicsCaptureItem& item) : item_(item) {
    D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    hr(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2, D3D11_SDK_VERSION, &device_, nullptr, &context_), "Direct3D is unavailable for capture.");

    ComPtr<IDXGIDevice> dxgi;
    hr(device_.As(&dxgi), "Direct3D is unavailable for capture.");
    ComPtr<::IInspectable> inspectable;
    hr(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), &inspectable), "Direct3D is unavailable for capture.");
    winrt::check_hresult(inspectable->QueryInterface(winrt::guid_of<wdx3::IDirect3DDevice>(), winrt::put_abi(deviceRT_)));

    framePool_ = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(
        deviceRT_, wdx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 1, item_.Size());
    session_ = framePool_.CreateCaptureSession(item_);
    // Cursor/border toggles exist on Windows 10 2004+; keep them best-effort.
    try { session_.IsCursorCaptureEnabled(false); session_.IsBorderRequired(false); } catch (...) {}
  }

  // Copy one fresh frame into CPU-readable PNG bytes.
  bool grab(std::vector<BYTE>& png, uint32_t& width, uint32_t& height) {
    std::mutex mutex;
    std::condition_variable cv;
    wgc::Direct3D11CaptureFrame frame{nullptr};
    auto token = framePool_.FrameArrived([&](auto& pool, auto&) {
      std::lock_guard<std::mutex> guard(mutex);
      if (!frame) frame = pool.TryGetNextFrame();
      cv.notify_all();
    });
    session_.StartCapture();
    {
      std::unique_lock<std::mutex> lock(mutex);
      if (!cv.wait_for(lock, std::chrono::seconds(10), [&] { return bool(frame); })) { framePool_.FrameArrived(token); return false; }
    }
    framePool_.FrameArrived(token);
    auto size = frame.ContentSize();
    width = (uint32_t)size.Width;
    height = (uint32_t)size.Height;
    if (!width || !height) return false;

    ComPtr<ID3D11Texture2D> source;
    ComPtr<IDirect3DDxgiInterfaceAccess> access;
    winrt::check_hresult(reinterpret_cast<IInspectable*>(winrt::get_abi(frame.Surface()))->QueryInterface(IID_PPV_ARGS(&access)));
    hr(access->GetInterface(IID_PPV_ARGS(&source)), "The captured frame is unreadable.");

    D3D11_TEXTURE2D_DESC desc{};
    source->GetDesc(&desc);
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    desc.Usage = D3D11_USAGE_STAGING;
    desc.BindFlags = 0;
    desc.MiscFlags = 0;
    ComPtr<ID3D11Texture2D> staging;
    hr(device_->CreateTexture2D(&desc, nullptr, &staging), "The captured frame is unreadable.");
    context_->CopyResource(staging.Get(), source.Get());
    D3D11_MAPPED_SUBRESOURCE mapped{};
    hr(context_->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped), "The captured frame is unreadable.");
    std::vector<BYTE> pixels((size_t)height * desc.Width * 4);
    for (uint32_t row = 0; row < height; ++row) {
      memcpy(pixels.data() + (size_t)row * desc.Width * 4, (const BYTE*)mapped.pData + (size_t)row * mapped.RowPitch, desc.Width * 4);
    }
    context_->Unmap(staging.Get(), 0);

    // PNG encode via WIC — software bitmap round trip keeps a documented codec.
    ComPtr<IWICImagingFactory> wic;
    hr(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&wic)), "The PNG encoder is unavailable.");
    ComPtr<IWICBitmap> bitmap;
    hr(wic->CreateBitmapFromMemory(desc.Width, height, GUID_WICPixelFormat32bppBGRA, desc.Width * 4, (UINT)pixels.size(), pixels.data(), &bitmap), "The captured frame is unreadable.");
    ComPtr<IWICStream> stream;
    hr(wic->CreateStream(&stream), "The PNG encoder is unavailable.");
    ComPtr<IStream> memory;
    hr(CreateStreamOnHGlobal(nullptr, TRUE, memory.GetAddressOf()), "The PNG encoder is unavailable.");
    hr(stream->InitializeFromIStream(memory.Get()), "The PNG encoder is unavailable.");
    ComPtr<IWICBitmapEncoder> encoder;
    hr(wic->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder), "The PNG encoder is unavailable.");
    hr(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache), "The PNG encoder is unavailable.");
    ComPtr<IWICBitmapFrameEncode> frameEncode;
    hr(encoder->CreateNewFrame(&frameEncode, nullptr), "The PNG encoder is unavailable.");
    hr(frameEncode->Initialize(nullptr), "The PNG encoder is unavailable.");
    hr(frameEncode->SetSize(desc.Width, height), "The PNG encoder is unavailable.");
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    hr(frameEncode->SetPixelFormat(&format), "The PNG encoder is unavailable.");
    require(format == GUID_WICPixelFormat32bppBGRA, "The PNG encoder is unavailable.");
    hr(frameEncode->WriteSource(bitmap.Get(), nullptr), "The PNG encoder is unavailable.");
    hr(frameEncode->Commit(), "The PNG encoder is unavailable.");
    hr(encoder->Commit(), "The PNG encoder is unavailable.");
    STATSTG stats{};
    hr(memory->Stat(&stats, STATFLAG_NONAME), "The PNG encoder is unavailable.");
    png.resize((size_t)stats.cbSize.QuadPart);
    LARGE_INTEGER zero{};
    hr(memory->Seek(zero, STREAM_SEEK_SET, nullptr), "The PNG encoder is unavailable.");
    ULONG read = 0;
    hr(memory->Read(png.data(), (ULONG)png.size(), &read), "The PNG encoder is unavailable.");
    require(read == png.size(), "The PNG encoder is unavailable.");
    return true;
  }

  ~WgcSession() {
    try { session_.Close(); } catch (...) {}
    try { framePool_.Close(); } catch (...) {}
  }

 private:
  wgc::GraphicsCaptureItem item_{nullptr};
  ComPtr<ID3D11Device> device_;
  ComPtr<ID3D11DeviceContext> context_;
  wdx3::IDirect3DDevice deviceRT_{nullptr};
  wgc::Direct3D11CaptureFramePool framePool_{nullptr};
  wgc::GraphicsCaptureSession session_{nullptr};
};

// Capture uses the held binding's already-created item — the HWND is only
// consulted for liveness revalidation, never to construct a capture object,
// so HWND recycling cannot redirect capture to a different window.
struct CaptureResult { std::vector<BYTE> png; uint32_t width = 0, height = 0; std::string error; std::string bindingId; WindowDesc window{}; };

void captureOnSta(void* raw) {
  auto* result = static_cast<CaptureResult*>(raw);
  try {
    auto found = bindings().find(result->bindingId);
    if (found == bindings().end() || !bindingAlive(found->second)) {
      if (found != bindings().end()) dropBinding(found->second);
      result->error = "The selected window binding is closed; the target no longer exists or cannot be re-proven.";
      return;
    }
    auto& binding = found->second;
    auto desc = describe(binding.hwnd);
    if (!desc) { binding.closed = true; result->error = "The selected window no longer exists or is not a capturable application window."; return; }
    WgcSession session(binding.item);
    if (!session.grab(result->png, result->width, result->height)) {
      // A closed/minimized bound window starves the frame pool — treat it as
      // binding loss rather than a retryable capture failure.
      if (binding.closed) result->error = "The selected window binding closed during capture.";
      else result->error = "The selected window produced no capturable frame.";
      return;
    }
    result->window = *desc;
  } catch (const winrt::hresult_error& error) {
    result->error = "Window capture failed: " + utf8(std::wstring(error.message().c_str(), error.message().size()));
  } catch (const std::exception& error) {
    result->error = error.what();
  } catch (...) {
    result->error = "Window capture failed.";
  }
}

// Live re-proof of a held binding: binding registered, not Closed, the prop
// token still on the same window object, still a capturable app window.
void identityOnSta(void* raw) {
  auto* result = static_cast<PickResult*>(raw);
  auto found = bindings().find(result->bindingId);
  if (found == bindings().end() || !bindingAlive(found->second)) { result->cancelled = true; return; }
  auto& binding = found->second;
  auto desc = describe(binding.hwnd);
  if (!desc) { binding.closed = true; result->cancelled = true; return; }
  result->window = *desc;
  result->window.bindingId = result->bindingId;
  result->cancelled = false;
}

struct ListResult { std::vector<WindowDesc> windows; std::string error; };

// The chooser feed: enumerate eligible windows and bind a capture item for
// each inside the same pass. Prop tokens prove the bound object is the
// enumerated object; any row that cannot be proven is dropped, never listed.
void listOnSta(void* raw) {
  auto* result = static_cast<ListResult*>(raw);
  try {
    // A fresh enumeration epoch makes stale props on recycled/foreign windows
    // unforgeable for this pass; old bindings stay valid until they close.
    uint64_t epoch = ++bindingSerial();
    auto windows = appWindows(epoch);
    for (auto& desc : windows) {
      const uintptr_t token = desc.token;
      try {
        // Re-proof the exact object before binding: still enumerable, same
        // thread, then bind and confirm the marker survived CreateForWindow.
        auto live = describe(desc.hwnd);
        if (!live || live->threadId != desc.threadId || live->pid != desc.pid) {
          if (IsWindow(desc.hwnd)) RemovePropW(desc.hwnd, kBindProp);
          continue;
        }
        HeldBinding binding{};
        binding.hwnd = desc.hwnd;
        binding.pid = desc.pid;
        binding.threadId = desc.threadId;
        binding.token = token;
        binding.title = desc.title;
        binding.rect = desc.rect;
        binding.dpi = desc.dpi;
        binding.item = createItemForWindow(desc.hwnd);
        if (GetPropW(desc.hwnd, kBindProp) != reinterpret_cast<HANDLE>(token)) {
          // The window object changed while the item was being created — the
          // old object died (taking the prop); the handle now names another
          // window. Refuse rather than bind an unproven object.
          binding.item = nullptr;
          if (IsWindow(desc.hwnd)) RemovePropW(desc.hwnd, kBindProp);
          continue;
        }
        std::string bindingId;
        {
          char id[32];
          snprintf(id, sizeof(id), "wgc-%llx", (unsigned long long)token);
          bindingId = id;
          bindings().emplace(bindingId, std::move(binding));
          auto& placed = bindings().at(bindingId);
          // The handler marks via map lookup — never a raw node pointer, so a
          // queued Closed event after erase cannot write freed memory.
          placed.closedRevoker = placed.item.Closed(winrt::auto_revoke, [id = bindingId](auto&&, auto&&) {
            auto it = bindings().find(id);
            if (it != bindings().end()) it->second.closed = true;
          });
        }
        desc.bindingId = bindingId;
        result->windows.push_back(std::move(desc));
      } catch (...) {
        // Unbindable rows are excluded — the chooser only ever offers proven
        // bindings (fail closed at listing time, not at capture time).
        if (IsWindow(desc.hwnd)) RemovePropW(desc.hwnd, kBindProp);
        continue;
      }
    }
  } catch (const std::exception& error) {
    result->error = error.what();
  } catch (...) {
    result->error = "Window enumeration failed.";
  }
}

void dropOnSta(void* raw) {
  auto* result = static_cast<PickResult*>(raw);
  auto found = bindings().find(result->bindingId);
  if (found != bindings().end()) { dropBinding(found->second); bindings().erase(found); }
  result->cancelled = false; // always resolves — cancel must not fail
}

// ---- napi entry points ----------------------------------------------------

template <typename Result>
Work* makeWork(napi_env env, napi_callback_info info, size_t& argc, napi_value* argv, Work::Kind kind, napi_value* promise) {
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  auto* work = new Work();
  work->kind = kind;
  napi_create_promise(env, &work->deferred, promise);
  napi_value name;
  napi_create_string_utf8(env, "gen-v1-control-bridge", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name,
      [](napi_env, void* data) {
        auto* work = static_cast<Work*>(data);
        try {
          if (work->kind == Work::Kind::Pick) {
            PickResult result{};
            result.owner = work->hwnd; // owner HWND resolved at queue time
            onSta(pickOnSta, &result);
            if (!result.error.empty()) work->error = result.error;
            else if (!result.cancelled) { work->hasWindow = true; work->window = result.window; }
          } else if (work->kind == Work::Kind::Identity) {
            PickResult result{};
            result.bindingId = work->bindingId;
            onSta(identityOnSta, &result);
            if (!result.error.empty()) work->error = result.error;
            else if (!result.cancelled) { work->hasWindow = true; work->window = result.window; }
          } else if (work->kind == Work::Kind::List) {
            ListResult result{};
            onSta(listOnSta, &result);
            if (!result.error.empty()) work->error = result.error;
            else work->windows = std::move(result.windows);
          } else if (work->kind == Work::Kind::Drop) {
            PickResult result{};
            result.bindingId = work->bindingId;
            onSta(dropOnSta, &result);
          } else {
            CaptureResult result{};
            result.bindingId = work->bindingId;
            onSta(captureOnSta, &result);
            if (!result.error.empty()) work->error = result.error;
            else { work->hasWindow = true; work->window = result.window; work->png = std::move(result.png); work->width = result.width; work->height = result.height; }
          }
        } catch (const std::exception& error) {
          work->error = error.what();
        } catch (...) {
          work->error = "The control bridge operation failed.";
        }
      },
      finish, work, &work->work);
  return work;
}

napi_value pickWindow(napi_env env, napi_callback_info info) {
  napi_value argv[1] = {nullptr};
  size_t argc = 1;
  napi_value promise;
  Work* work = makeWork<PickResult>(env, info, argc, argv, Work::Kind::Pick, &promise);
  napi_valuetype type = napi_undefined;
  if (argc > 0) napi_typeof(env, argv[0], &type);
  if (type == napi_object) { // Buffer with the owner HWND bytes
    void* data = nullptr;
    size_t length = 0;
    if (napi_get_buffer_info(env, argv[0], &data, &length) == napi_ok && data && length >= sizeof(intptr_t)) {
      work->hwnd = (HWND)(intptr_t)*(uint64_t*)data;
    }
  }
  napi_queue_async_work(env, work->work);
  return promise;
}

std::string bindingArg(napi_env env, napi_callback_info info) {
  napi_value argv[1] = {nullptr};
  size_t argc = 1;
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  char buffer[64]{};
  size_t length = 0;
  if (argc > 0) napi_get_value_string_utf8(env, argv[0], buffer, sizeof(buffer) - 1, &length);
  return std::string(buffer, length);
}

napi_value windowIdentity(napi_env env, napi_callback_info info) {
  napi_value argv[1] = {nullptr};
  size_t argc = 1;
  napi_value promise;
  Work* work = makeWork<PickResult>(env, info, argc, argv, Work::Kind::Identity, &promise);
  work->bindingId = bindingArg(env, info);
  napi_queue_async_work(env, work->work);
  return promise;
}

napi_value captureWindow(napi_env env, napi_callback_info info) {
  napi_value argv[1] = {nullptr};
  size_t argc = 1;
  napi_value promise;
  Work* work = makeWork<CaptureResult>(env, info, argc, argv, Work::Kind::Capture, &promise);
  work->bindingId = bindingArg(env, info);
  napi_queue_async_work(env, work->work);
  return promise;
}

napi_value dropBindingOp(napi_env env, napi_callback_info info) {
  napi_value argv[1] = {nullptr};
  size_t argc = 1;
  napi_value promise;
  Work* work = makeWork<PickResult>(env, info, argc, argv, Work::Kind::Drop, &promise);
  work->bindingId = bindingArg(env, info);
  napi_queue_async_work(env, work->work);
  return promise;
}

// App-owned consent chooser feed: rows of live enumerable application windows
// — each carrying an opaque bindingId naming the capture item bound for that
// exact window object inside this call (identity is the held item, never a
// derived hwnd/pid match).
napi_value listWindows(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value promise;
  Work* work = makeWork<ListResult>(env, info, argc, nullptr, Work::Kind::List, &promise);
  napi_queue_async_work(env, work->work);
  return promise;
}

napi_value init(napi_env env, napi_value exports) {
  napi_set_named_property(env, exports, "pickWindow", ([&] { napi_value f; napi_create_function(env, "pickWindow", NAPI_AUTO_LENGTH, pickWindow, nullptr, &f); return f; })());
  napi_set_named_property(env, exports, "listWindows", ([&] { napi_value f; napi_create_function(env, "listWindows", NAPI_AUTO_LENGTH, listWindows, nullptr, &f); return f; })());
  napi_set_named_property(env, exports, "windowIdentity", ([&] { napi_value f; napi_create_function(env, "windowIdentity", NAPI_AUTO_LENGTH, windowIdentity, nullptr, &f); return f; })());
  napi_set_named_property(env, exports, "captureWindow", ([&] { napi_value f; napi_create_function(env, "captureWindow", NAPI_AUTO_LENGTH, captureWindow, nullptr, &f); return f; })());
  napi_set_named_property(env, exports, "dropBinding", ([&] { napi_value f; napi_create_function(env, "dropBinding", NAPI_AUTO_LENGTH, dropBindingOp, nullptr, &f); return f; })());
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
