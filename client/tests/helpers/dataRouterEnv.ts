// jsdom 会替换全局 AbortController，而 Node 原生 Request 只认原生 AbortSignal，
// data router 的 navigate() 因此抛 "Expected signal to be an instance of AbortSignal"。
// 导入本文件后，Request 构造时丢弃 signal（测试里不需要中止请求），让 data router 在 jsdom 下可走真实导航。
const NativeRequest = globalThis.Request

class JsdomSafeRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init && 'signal' in init) {
      const { signal: _signal, ...rest } = init
      void _signal
      super(input, rest)
      return
    }
    super(input, init)
  }
}

globalThis.Request = JsdomSafeRequest as typeof Request
