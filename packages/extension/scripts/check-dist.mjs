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
assert(!js.includes('chrome.'), '产物调用了 chrome.* API —— 骨架承诺零 API，别悄悄加')
assert(!/\bfetch\s*\(/.test(js), '产物包含 fetch 调用 —— 骨架承诺零网络，别悄悄加')
assert(!/XMLHttpRequest|WebSocket/.test(js), '产物包含 XHR/WebSocket —— 同上')

console.log('check-dist: 产物形状 OK（MV3 + 引擎已打包 + 零 API + 零网络原语）')
