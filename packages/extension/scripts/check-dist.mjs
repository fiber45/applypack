/**
 * T7.1 构建产物门禁 —— `pnpm build` 的最后一步，产物形状不对照明停。
 *
 * 钉的是骨架的三条「不」：
 *   1. 产物齐（manifest + content-script，manifest 引用的文件名一致）；
 *   2. 无 chrome.* API 调用（清单里没申请权限，代码里也不许偷偷用）；
 *   3. 零网络原语（fetch / XMLHttpRequest / WebSocket）——
 *      扩展侧的「数据不出浏览器」是构建期可验证的，不是口头承诺。
 *
 * 这层比 vitest 断言更靠后：它看的是**打包后**的产物 ——
 * 依赖图里混进来一个带网络调用的包，测试全绿也会在这里红。
 */
import { readFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dist), 'utf8'))
const js = readFileSync(new URL('content-script.js', dist), 'utf8')

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) {
    console.error(`check-dist: ${msg}`)
    process.exit(1)
  }
}

assert(manifest.manifest_version === 3, 'manifest 不是 MV3')
assert(
  Array.isArray(manifest.content_scripts) &&
    manifest.content_scripts[0]?.js?.[0] === 'content-script.js',
  'content_scripts 未指向 content-script.js',
)
assert(js.length > 1000, 'content-script.js 小于 1KB —— 打包可能没把引擎包进来')
assert(js.includes('__APPLYPACK_SCAN__'), '入口接线断了：扫描结果没挂到全局')
assert(
  js.includes('overlay-envelope') && js.includes('applypack-overlay'),
  'overlay 没进产物 —— 粘贴信封解锁的面板是入口胶水的必选项，别悄悄删',
)
assert(!js.includes('chrome.'), '产物调用了 chrome.* API —— 骨架承诺零 API，别悄悄加')
assert(!/\bfetch\s*\(/.test(js), '产物包含 fetch 调用 —— 骨架承诺零网络，别悄悄加')

// T9.2 起产物打包了 libsodium（粘贴信封解锁要解密）。它的 emscripten
// 胶水自带一个 Node 环境 wasm 文件加载器（`new XMLHttpRequest`），浏览器
// 路径永不执行（wasm 内联 base64，Web 端 connect-src 'none' 下一直正常
// 可证）。零网络断言因此从「字符串不得出现」改成**基线计数**：第三方
// 胶水恰好多不了，自己的代码多一处网络原语就红。
const xhrCount = (js.match(/XMLHttpRequest/g) ?? []).length
assert(
  xhrCount === 1,
  `产物包含 ${xhrCount} 处 XMLHttpRequest —— 基线是 libsodium 胶水的 1 处，多了就是你加了网络调用`,
)
assert(!/WebSocket/.test(js), '产物包含 WebSocket —— 同上')

console.log('check-dist: 产物形状 OK（MV3 + 引擎已打包 + 零 API + 零网络原语）')
