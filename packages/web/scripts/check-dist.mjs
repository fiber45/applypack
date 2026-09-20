/**
 * 构建期断言：dist/index.html 的 CSP 必须同时满足两件事。
 *
 * ## 为什么这个校验必须存在
 *
 * 2026-09-20 事故：CSP 写了 `script-src 'self'` 但漏掉 `'wasm-unsafe-eval'`，
 * 真实浏览器按 CSP Level 3 拒绝编译 WebAssembly —— 加密层的 hash-wasm
 * 与 libsodium 全部无法实例化，点「创建并解锁」无任何反应。
 * **jsdom 测试不执行 CSP**，所以 918 条断言拦不住它；唯一能拦住的位置
 * 就是构建产物本身。
 *
 * 两条判据各自独立报错，缺哪条说哪条：
 *
 * 1. `script-src` 含 `'wasm-unsafe-eval'` —— WASM 密码学可用。
 *    它只放行 WASM 编译，不放行 eval / new Function，是最小口子。
 * 2. `connect-src 'none'` —— 零网络承诺。删掉这条的任何改动
 *    （哪怕顺手「放宽一点点」）都在构建期直接红。
 */
import { readFileSync } from 'node:fs'

const htmlPath = new URL('../dist/index.html', import.meta.url)
const html = readFileSync(htmlPath, 'utf8')

const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
if (match === null) {
  console.error('[check-dist] dist/index.html 里找不到 Content-Security-Policy meta —— CSP 被删了？')
  process.exit(1)
}
const csp = match[1]

if (!/(^|;)\s*script-src\b[^;]*'wasm-unsafe-eval'/.test(csp)) {
  console.error(
    '[check-dist] CSP 的 script-src 缺少 \'wasm-unsafe-eval\' —— WASM（hash-wasm / libsodium）' +
      '在真实浏览器里会被拒绝编译，创建 / 解锁将无任何反应（2026-09-20 事故）。' +
      `\n  当前 CSP: ${csp}`,
  )
  process.exit(1)
}

if (!/(^|;)\s*connect-src\s+'none'/.test(csp)) {
  console.error(
    '[check-dist] CSP 的 connect-src 不再是 \'none\' —— 零网络承诺被破坏，这是架构红线。' +
      `\n  当前 CSP: ${csp}`,
  )
  process.exit(1)
}

console.log('[check-dist] CSP ok: script-src 含 wasm-unsafe-eval，connect-src 为 none')
