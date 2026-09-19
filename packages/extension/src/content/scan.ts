/**
 * T7.1 —— 内容脚本骨架的纯逻辑层：`scanPage` 是「真实浏览器页面」与
 * 「填充引擎」之间第一条生产缝。
 *
 * ## 为什么扫描结果里带版本对齐（staleAdapter）
 *
 * T5.2 的版本纪律（adapter.version ⇔ 快照 `data-platform-version`）此前只
 * 在 CI 里生效 —— 也就是说，平台改版后**第一次发现选择器扑空的现场是测试机**，
 * 用户侧只会看到「没填上」。扫描层把页面自申报的版本和适配器版本摆在一起，
 * 让「平台改了、适配器没跟上」在**用户页面上**就是可见状态 —— T7.2 的面板
 * 将据此显示「该平台可能改版了」，而不是让字段静默落空。
 *
 * 本层刻意**不注册适配器**：注册是全局副作用（注册表拒绝重复 id），
 * 由入口 `boot` 一次性完成。`scanPage` 保持纯函数 —— 给什么注册表状态
 * 就扫什么结果，测试里用 `resetPlatformAdaptersForTests` 精确控制。
 */

import { detectPlatformAdapter } from '../fill/adapters'
import type { DomDocument } from '../fill/dom'
import { extractFieldFeatures } from '../fill/features'

export interface PageScan {
  /** 命中的适配器 id；`null` = 未知表单（T7.2 起走启发式兜底）。 */
  readonly platform: string | null
  /** 页面自申报的快照版本（`data-platform-version`），无标记为 `null`。 */
  readonly pageVersion: string | null
  /** 命中适配器的选择器版本。 */
  readonly adapterVersion: string | null
  /**
   * 页面版本 ≠ 适配器版本 —— 平台已改版，选择器可能扑空。
   * 两边都有版本但相等（或页面无标记）时为 `false`。
   */
  readonly staleAdapter: boolean
  /** 提取出的字段特征数（与适配器无关，任何表单都提取）。 */
  readonly featureCount: number
}

export function scanPage(doc: DomDocument): PageScan {
  const adapter = detectPlatformAdapter(doc)
  if (adapter === null) {
    return {
      platform: null,
      pageVersion: null,
      adapterVersion: null,
      staleAdapter: false,
      featureCount: extractFieldFeatures(doc).length,
    }
  }

  // 版本标记与平台标记挂在同一个元素上（快照约定，见 snapshot fixtures）。
  const markers = doc.querySelectorAll(`[data-platform="${adapter.platformMarker}"]`)
  const pageVersion = markers[0]?.getAttribute('data-platform-version') ?? null

  return {
    platform: adapter.id,
    pageVersion,
    adapterVersion: adapter.version,
    staleAdapter: pageVersion !== null && pageVersion !== adapter.version,
    featureCount: extractFieldFeatures(doc).length,
  }
}
