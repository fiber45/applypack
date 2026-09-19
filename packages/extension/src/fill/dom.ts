/**
 * 最小结构 DOM 接口 —— 填充引擎与真实 DOM 之间唯一的缝。
 *
 * ## 为什么是自己声明，而不是 `lib: ["DOM"]`
 *
 * extension 的 tsconfig 继承 base：`lib: ["ES2023"] + types: []` ——
 * 和 core 一样，`document`、`setTimeout` 这些全局**不可写**。这不是洁癖：
 * MV3 的 service worker 里挂一个 `setTimeout`，进程 30 秒后被杀，
 * 定时器静默失效（T1.5 的教训，见 `vault/clock.ts`）；同理，填充引擎的
 * 纯逻辑层一旦能顺手摸到真 DOM，「逻辑可测」就会退化成「逻辑碰巧在
 * 测试机可测」。
 *
 * 于是接口只声明**逻辑真正需要的最小面**：
 * 生产环境里内容脚本传真实 DOM 节点，测试里传 jsdom 节点，
 * 两者都天然满足这个结构 —— 谁也不 import 谁。
 *
 * 写操作刻意不在这里：本层只**读**页面。写 DOM（且经用户确认后）
 * 是 T5.3 预览确认 UI 的职责。
 */

export interface DomElement {
  /** 大写标签名，与 DOM 一致（`INPUT` / `SELECT` / `TEXTAREA` / `LABEL`） */
  readonly tagName: string
  getAttribute(qualifiedName: string): string | null
  /** DOM 语义：无子文本时为 `''`（适配函数负责把 `null` 归一成 `''`） */
  readonly textContent: string
  querySelectorAll(selectors: string): readonly DomElement[]
  readonly parentElement: DomElement | null
}

export interface DomDocument {
  querySelectorAll(selectors: string): readonly DomElement[]
  getElementById(elementId: string): DomElement | null
}

/**
 * 把任意「长得像 Document 的东西」适配成 `DomDocument`。
 * 形状检查是运行时的（正控）：结构不符立即抛错，而不是等着在
 * 三层之后的 `undefined` 里炸出来。
 */
export function asDomDocument(candidate: unknown): DomDocument {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new TypeError('asDomDocument：入参不是对象')
  }
  const doc = candidate as Record<string, unknown>
  if (typeof doc.querySelectorAll !== 'function' || typeof doc.getElementById !== 'function') {
    throw new TypeError('asDomDocument：入参缺少 querySelectorAll / getElementById，不是 Document 形状')
  }
  return candidate as DomDocument
}
