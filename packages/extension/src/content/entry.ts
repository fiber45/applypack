/**
 * T7.2 —— 内容脚本入口（vite IIFE 构建的唯一切口）。
 *
 * ## 这一层只有四件事，刻意没有第五件
 *
 * 1. 注册内置适配器（全局副作用，一次）；
 * 2. `asDomDocument` 正控守卫把真实 `document` 交给引擎；
 * 3. 扫描结果挂到 `globalThis.__APPLYPACK_SCAN__`；
 * 4. 面板开合判定挂到 `globalThis.__APPLYPACK_PANEL__`（T7.2）。
 *
 * 没有第五件事的意思是：本层**不碰网络、不碰 chrome.* API**。
 * 口令输入 UI 与 overlay 渲染是 T7.3/T7.4 的事 —— 档案还没解锁，
 * 面板此刻的状态就是 `locked`：诚实，而不是画一个半残的预览。
 * `check-dist.mjs` 会用「产物里不得出现 fetch / XMLHttpRequest /
 * WebSocket / chrome.」把这些「不」钉成构建期事实。
 *
 * ## 为什么挂全局而不是直接渲染
 *
 * T7.4 之前没有真 UI，挂全局让人在任意页面的 DevTools Console 里输
 * `__APPLYPACK_SCAN__` / `__APPLYPACK_PANEL__` 就能手工冒烟。
 * 命名带 `__APPLYPACK_` 前缀，避免与页面自身的全局撞名。
 */

import { asDomDocument } from '../fill/dom'
import { registerBuiltinPlatformAdapters } from '../fill/platforms'
import { openPanel, type PanelState } from './panel'
import { scanPage, type PageScan } from './scan'

export function boot(
  doc: unknown,
  register: () => void = registerBuiltinPlatformAdapters,
): { scan: PageScan; panel: PanelState } {
  register()
  const dom = asDomDocument(doc)
  const scan = scanPage(dom)
  // 档案解锁是用户动作（T7.3 起有口令 UI）—— 装载时刻必然未解锁。
  const panel = openPanel(scan, dom, null)
  return { scan, panel }
}

// 内容脚本在 document_idle 装载，DOM 已就绪 —— 装载即扫描。
// 测试环境（node）没有 document，这个块自然跳过。
const doc = (globalThis as { document?: unknown }).document
if (doc !== undefined) {
  const { scan, panel } = boot(doc)
  const globals = globalThis as unknown as {
    __APPLYPACK_SCAN__?: PageScan
    __APPLYPACK_PANEL__?: PanelState
  }
  globals.__APPLYPACK_SCAN__ = scan
  globals.__APPLYPACK_PANEL__ = panel
}
