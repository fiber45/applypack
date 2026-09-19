/**
 * T7.1 —— 内容脚本入口（vite IIFE 构建的唯一切口）。
 *
 * ## 这一层只有三件事，刻意没有第四件
 *
 * 1. 注册内置适配器（全局副作用，一次）；
 * 2. `asDomDocument` 正控守卫把真实 `document` 交给引擎；
 * 3. 扫描结果挂到 `globalThis.__APPLYPACK_SCAN__`。
 *
 * 没有第四件事的意思是：本层**不碰 UI、不碰网络、不碰 chrome.* API**。
 * 面板渲染是 T7.2 的事；`check-dist.mjs` 会用「产物里不得出现 fetch /
 * XMLHttpRequest / WebSocket / chrome.」把这三条「不」钉成构建期事实。
 *
 * ## 为什么挂全局而不是直接渲染
 *
 * T7.2 之前没有 UI，挂全局让人在任意页面的 DevTools Console 里输
 * `__APPLYPACK_SCAN__` 就能手工冒烟 —— 这也是 T7.4 装载说明的验证步骤。
 * 命名带 `__APPLYPACK_` 前缀，避免与页面自身的全局撞名。
 */

import { asDomDocument } from '../fill/dom'
import { registerBuiltinPlatformAdapters } from '../fill/platforms'
import { scanPage, type PageScan } from './scan'

export function boot(
  doc: unknown,
  register: () => void = registerBuiltinPlatformAdapters,
): PageScan {
  register()
  return scanPage(asDomDocument(doc))
}

// 内容脚本在 document_idle 装载，DOM 已就绪 —— 装载即扫描。
// 测试环境（node）没有 document，这个块自然跳过。
const doc = (globalThis as { document?: unknown }).document
if (doc !== undefined) {
  const scan = boot(doc)
  ;(globalThis as unknown as { __APPLYPACK_SCAN__?: PageScan }).__APPLYPACK_SCAN__ = scan
}
