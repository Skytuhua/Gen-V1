// M16 C4 — Windows selected-window observation bridge.
//
// Approved platform path only: the system GraphicsCapturePicker supplies the
// user consent surface; the picked item is bound to one unique live top-level
// application HWND before any capture proceeds (fail closed on displays, zero
// or ambiguous identity matches). Capture goes through
// Windows.Graphics.Capture frame pools bound to that exact HWND — never
// BitBlt/PrintWindow fallbacks, never broad screen capture.
//
// Node-API surface (called only from apps/desktop/control-bridge.ts):
//   pickWindow(ownerHwndBuffer|null) -> Promise<{handle,processId,title,bounds,dpiScale}|null>
//   windowIdentity(handle:number)    -> Promise<same|null>
//   captureWindow(handle:number)     -> Promise<{data:Buffer,width,height}>

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define UNICODE
#include <windows.h>
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
#include <stdexcept>
#include <atomic>
#include <mutex>
#include <condition_variable>

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
  std::wstring title;
  RECT rect{};
  UINT dpi = 96;
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

// EnumWindows-driven enumeration was removed: matching a GraphicsCaptureItem
// back to an HWND by display name or client size cannot prove same-object
// binding (a display can share a window's title or dimensions). The picker
// holds no public API returning the picked item's HWND, so the window path is
// held rather than approximated.

std::optional<WindowDesc> describe(HWND hwnd) {
  if (!IsWindow(hwnd) || !enumerableAppWindow(hwnd)) return std::nullopt;
  WindowDesc desc{};
  desc.hwnd = hwnd;
  GetWindowThreadProcessId(hwnd, &desc.pid);
  desc.title = windowText(hwnd);
  if (!GetWindowRect(hwnd, &desc.rect)) return std::nullopt;
  desc.dpi = GetDpiForWindow(hwnd);
  return desc;
}

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
  return object;
}

// ---- Async worker ---------------------------------------------------------

struct Work {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  HWND hwnd = nullptr;
  enum class Kind { Pick, Identity, Capture } kind = Kind::Pick;
  // Results
  bool hasWindow = false;
  WindowDesc window{};
  std::vector<BYTE> png;
  uint32_t width = 0, height = 0;
  std::string error;
};

void complete(napi_env env, Work* work, bool isNull) {
  napi_value result = nullptr;
  if (isNull) {
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
    complete(env, work.get(), work->kind != Work::Kind::Capture && !work->hasWindow);
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

struct PickResult { bool cancelled = false; WindowDesc window{}; std::string error; HWND owner = nullptr; };

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

struct CaptureResult { std::vector<BYTE> png; uint32_t width = 0, height = 0; std::string error; HWND hwnd = nullptr; WindowDesc window{}; };

class WgcSession {
 public:
  explicit WgcSession(HWND hwnd) {
    auto interop = winrt::get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    hr(interop->CreateForWindow(hwnd, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(item_)), "The selected window cannot be captured.");
    require(bool(item_), "The selected window cannot be captured.");

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

// capture/identity are likewise held: no caller can supply a proven HWND while
// the picker binding gap stands, so these paths refuse rather than capture an
// unproven window.
void captureOnSta(void* raw) {
  auto* result = static_cast<CaptureResult*>(raw);
  result->error = "CONTROL_PICKER_BINDING_UNSUPPORTED: window capture requires a proven selected window identity; selected-window control is held.";
}

void identityOnSta(void* raw) {
  auto* result = static_cast<PickResult*>(raw);
  result->error = "CONTROL_PICKER_BINDING_UNSUPPORTED: window identity requires a proven selected window; selected-window control is held.";
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
            result.owner = work->hwnd;
            onSta(identityOnSta, &result);
            if (!result.cancelled) { work->hasWindow = true; work->window = result.window; }
          } else {
            CaptureResult result{};
            result.hwnd = work->hwnd;
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

napi_value windowIdentity(napi_env env, napi_callback_info info) {
  napi_value argv[1] = {nullptr};
  size_t argc = 1;
  napi_value promise;
  Work* work = makeWork<PickResult>(env, info, argc, argv, Work::Kind::Identity, &promise);
  double handle = 0;
  if (argc > 0) napi_get_value_double(env, argv[0], &handle);
  work->hwnd = (HWND)(intptr_t)(int64_t)handle;
  napi_queue_async_work(env, work->work);
  return promise;
}

napi_value captureWindow(napi_env env, napi_callback_info info) {
  napi_value argv[1] = {nullptr};
  size_t argc = 1;
  napi_value promise;
  Work* work = makeWork<CaptureResult>(env, info, argc, argv, Work::Kind::Capture, &promise);
  double handle = 0;
  if (argc > 0) napi_get_value_double(env, argv[0], &handle);
  work->hwnd = (HWND)(intptr_t)(int64_t)handle;
  napi_queue_async_work(env, work->work);
  return promise;
}

napi_value init(napi_env env, napi_value exports) {
  napi_set_named_property(env, exports, "pickWindow", ([&] { napi_value f; napi_create_function(env, "pickWindow", NAPI_AUTO_LENGTH, pickWindow, nullptr, &f); return f; })());
  napi_set_named_property(env, exports, "windowIdentity", ([&] { napi_value f; napi_create_function(env, "windowIdentity", NAPI_AUTO_LENGTH, windowIdentity, nullptr, &f); return f; })());
  napi_set_named_property(env, exports, "captureWindow", ([&] { napi_value f; napi_create_function(env, "captureWindow", NAPI_AUTO_LENGTH, captureWindow, nullptr, &f); return f; })());
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
