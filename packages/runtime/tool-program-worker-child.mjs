import { parentPort, workerData } from 'node:worker_threads';

const port = parentPort;
if (!port) throw new Error('This module is a dedicated worker entry');
const data = workerData;
const { QuickJS, Intrinsics } = await import(data.engineUrl);
let vm;
let ended = false;
let issued = 0;
let offered;
const pending = new Map();
const clock = { creating: true, now: data.startClock ?? 0, startedAt: data.startClock ?? 0 };
const seedText = data.seed ?? '1'.repeat(64);
let seed = 0;
for (let index = 0; index < 64; index += 8) seed = (Math.imul(seed ^ Number.parseInt(seedText.slice(index, index + 8), 16), 0x9e3779b1)) >>> 0;
let randomState = seed || 1;
function randomWord() {
  randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
  return randomState >>> 0;
}
function send(message) { if (!ended) port.postMessage(message); }
function failure(code, message) {
  if (ended) return;
  port.postMessage({ type: 'error', code, message: String(message).slice(0, 2048) });
  ended = true;
  // Do not dispose the VM here: this can be called from a host callback on its
  // active WASM stack. The parent always terminates and waits for the worker.
}
function wasi(memory) {
  return {
    clock_time_get(id, _precision, pointer) {
      if (id !== 0 && id !== 1) return 52;
      const nanoseconds = clock.creating
        ? (id === 0 ? BigInt(seed + 1) * 1000n : 0n)
        : BigInt(id === 0 ? clock.now : clock.now - clock.startedAt) * 1_000_000n;
      new DataView(memory.buffer).setBigUint64(pointer, nanoseconds, true);
      return 0;
    },
    random_get(pointer, length) {
      const bytes = new Uint8Array(memory.buffer, pointer, length);
      for (let index = 0; index < length; index++) bytes[index] = randomWord() & 255;
      return 0;
    },
    fd_write() { return 8; },
    fd_close() { return 8; },
    fd_fdstat_get() { return 8; },
    fd_seek() { return 8; },
  };
}
function ownErrorText(handle) {
  if (handle.isString) return handle.toString().slice(0, 2048);
  const descriptor = handle.getOwnPropertyDescriptor('message');
  try { return descriptor?.value?.isString ? descriptor.value.toString().slice(0, 2048) : 'Program execution failed'; }
  finally { descriptor?.value?.dispose(); descriptor?.get?.dispose(); descriptor?.set?.dispose(); }
}
function drain() { if (!ended) vm.executePendingJobs(); }

try {
  const memoryBytes = data.mode === 'self-test' ? data.memoryBytes : data.limits.memoryBytes;
  vm = await QuickJS.create({
    wasm: data.module, memoryLimit: memoryBytes, maxStackSize: 512 * 1024,
    timezoneOffset: 0, wasi,
    intrinsics: Intrinsics.ALL & ~Intrinsics.WEAK_REF & ~Intrinsics.PROXY,
    interruptHandler: () => data.interrupt ? Atomics.load(new Int32Array(data.interrupt), 0) !== 0 : false,
    // No module loader, native extensions, network, environment, filesystem,
    // process, console, or host objects are installed in the guest.
  });
  clock.creating = false;
  if (data.mode === 'self-test') {
    const ambientClean = vm.evalCode(
      '["process","require","fetch","console","WebAssembly","std","os","Deno","Bun"].every(name => typeof globalThis[name] === "undefined")',
    ).consume(handle => handle.toString()) === 'true';
    const memory = vm._getMemory();
    memory.grow(memoryBytes / 65_536 - memory.buffer.byteLength / 65_536);
    let overflowRejected = false;
    try { memory.grow(1); } catch { overflowRejected = true; }
    send({ type: 'self-test', maximum: memory.buffer.byteLength, overflowRejected, ambientClean,
      environmentEmpty: Object.keys(process.env).length === 0,
      packageVersion: vm.versions['quickjs-wasi'], engineVersion: vm.versions.quickjs });
    vm.dispose();
    port.close();
  } else {
    const bridge = vm.newFunction('__programHostCall', (name, argsJson) => {
      if (ended) return vm.undefined;
      if (issued >= data.limits.maxCalls) {
        failure('PROGRAM_CALL_LIMIT', 'Program tool-call budget exceeded');
        return vm.undefined;
      }
      if (!name?.isString || !argsJson?.isString) {
        failure('PROGRAM_INVALID_INPUT', 'tools.call expects a tool name and JSON object');
        return vm.undefined;
      }
      const toolName = name.toString();
      const encoded = argsJson.toString();
      if (!toolName || toolName.length > 200 || Buffer.byteLength(encoded) > 256 * 1024) {
        failure('PROGRAM_INVALID_INPUT', 'Tool-call arguments exceed their budget');
        return vm.undefined;
      }
      const key = 'call:' + issued++;
      const deferred = vm.newPromise();
      pending.set(key, deferred);
      send({ type: 'call', key, issuedCount: issued, name: toolName, argsJson: encoded });
      return deferred.handle;
    });
    vm.global.defineProp('__programHostCall', bridge, { configurable: true });
    bridge.dispose();
    const inputHandle = vm.newString(data.inputsJson);
    vm.global.defineProp('__programInputs', inputHandle, { configurable: true });
    inputHandle.dispose();
    const stringify = vm.evalCode('JSON.stringify');
    const guestError = vm.evalCode('(message, code) => Object.defineProperty(new Error(message), "code", { value: code })');
    const bootstrap = [
      '(function(bridge, inputsText) {',
      '  const parse = JSON.parse, stringify = JSON.stringify, freeze = Object.freeze;',
      '  const keys = Object.keys, descriptors = Object.getOwnPropertyDescriptors, prototype = Object.getPrototypeOf;',
      '  const apply = Reflect.apply, then = Promise.prototype.then, isArray = Array.isArray;',
      '  function immutable(value) {',
      '    if (value && typeof value === "object") { for (const key of keys(value)) immutable(value[key]); freeze(value); }',
      '    return value;',
      '  }',
      '  const call = (name, args) => {',
      '    if (typeof name !== "string" || !args || typeof args !== "object" || isArray(args)) throw new TypeError("tools.call expects a name and object");',
      '    return apply(then, bridge(name, stringify(args)), [text => immutable(parse(text))]);',
      '  };',
      '  Object.defineProperty(globalThis, "inputs", { value: immutable(parse(inputsText)) });',
      '  Object.defineProperty(globalThis, "tools", { value: freeze({ call }) });',
      '  delete globalThis.__programHostCall; delete globalThis.__programInputs;',
      '  delete globalThis.eval; delete globalThis.Function; delete globalThis.SharedArrayBuffer;',
      '  for (const callable of [function(){}, async function(){}, function*(){}, async function*(){}]) {',
      '    Object.defineProperty(prototype(callable), "constructor", { value: undefined, writable: false, configurable: false });',
      '  }',
      '  const seen = new Set();',
      '  function harden(value) {',
      '    if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;',
      '    seen.add(value);',
      '    for (const entry of Object.values(descriptors(value))) { harden(entry.value); harden(entry.get); harden(entry.set); }',
      '    harden(prototype(value)); freeze(value);',
      '  }',
      '  for (const callable of [function(){}, async function(){}, function*(){}, async function*(){}]) harden(prototype(callable));',
      '  harden(globalThis);',
      '})(__programHostCall, __programInputs);',
    ].join('\n');
    vm.evalCode(bootstrap, '<program-bootstrap>').dispose();
    port.on('message', message => {
      if (ended) return;
      try {
        if (message?.type === 'offer' && offered === undefined && pending.has(message.key)) {
          offered = message.key;
          send({ type: 'ready-to-deliver', key: offered, issuedCount: issued });
          return;
        }
        if (message?.type !== 'commit' || message.key !== offered || !pending.has(message.key)
            || !Number.isSafeInteger(message.clock) || message.clock < 0) {
          failure('PROGRAM_PROTOCOL_ERROR', 'Invalid host delivery protocol');
          return;
        }
        const key = offered;
        const deferred = pending.get(key);
        pending.delete(key);
        clock.now = Math.max(clock.now, message.clock);
        if (message.ok) {
          if (typeof message.json !== 'string') throw new Error('Invalid host JSON');
          const value = vm.newString(message.json);
          deferred.resolve(value); value.dispose();
        } else {
          // The public newError helper assigns through Error.prototype. Our frozen
          // primordials require the captured guest constructor to define own fields.
          const text = vm.newString(String(message.message ?? 'Tool call failed').slice(0, 2048));
          const code = vm.newString(typeof message.code === 'string' ? message.code.slice(0, 200) : 'NESTED_TOOL_FAILED');
          const error = vm.callFunction(guestError, vm.undefined, text, code);
          text.dispose(); code.dispose();
          deferred.reject(error); error.dispose();
        }
        deferred.handle.dispose();
        drain();
        offered = undefined;
        send({ type: 'drained', key, issuedCount: issued });
      } catch {
        failure('PROGRAM_SCRIPT_ERROR', 'The program could not process a host delivery');
      }
    });
    const promise = vm.evalCode('(async function() { "use strict";\n' + data.source + '\n})()', '<tool-program>');
    const settled = vm.resolvePromise(promise);
    promise.dispose();
    drain();
    const result = await settled;
    if (!ended) {
      if (result.error) {
        const message = ownErrorText(result.error);
        result.error.dispose();
        failure(message.includes('out of memory') ? 'PROGRAM_MEMORY_LIMIT' : 'PROGRAM_SCRIPT_ERROR', message);
      } else {
        const encoded = vm.callFunction(stringify, vm.undefined, result.value);
        result.value.dispose();
        if (!encoded.isString) {
          encoded.dispose();
          failure('PROGRAM_SCRIPT_ERROR', 'The program must return an explicit JSON aggregate');
        } else {
          const json = encoded.toString();
          encoded.dispose();
          if (Buffer.byteLength(json) > data.limits.maxOutputBytes) failure('PROGRAM_OUTPUT_LIMIT', 'Program aggregate exceeds its byte budget');
          else { send({ type: 'done', json }); ended = true; }
        }
      }
    }
    stringify.dispose();
    guestError.dispose();
    vm.dispose();
    port.close();
  }
} catch (error) {
  failure(String(error?.message ?? '').includes('out of memory') ? 'PROGRAM_MEMORY_LIMIT' : 'PROGRAM_SCRIPT_ERROR',
    error?.message ?? 'Program execution failed');
  vm?.dispose();
  port.close();
}
