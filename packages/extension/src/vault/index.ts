/**
 * `@applypack/extension/vault` —— 扩展侧的密文副本。
 *
 * 职责边界：**只回答「扩展怎么拿到同一份密文、什么时候能读它、Web 端改了档案
 * 之后它怎么跟上」**。加密/解密、密钥分层、AAD 作用域全在 `@applypack/core`，
 * 本模块一行密码学都不做（AGENTS.md 红线 7）。
 *
 * ```
 * store（chrome.storage.local 等）   ← 只有密文，密钥与明文永不落盘
 *   ↑↓
 * ExtensionVaultSession ──┬─ unlock(口令) → loadArchive()     会话内读档案
 *                         ├─ lock() / 空闲超时 / 绝对上限      密钥离开内存
 *                         ├─ listen() ← transport（Web 端推送） 密文副本刷新
 *                         └─ ciphertext / vaultText             锁定时仍可读
 * ```
 *
 * ## 这个模块不做什么
 *
 * - **不发任何请求。** 它的导出面里不存在 client / llm / egress / send 之类的名字，
 *   有一条断言守着（`security.test.ts`）。扩展端唯一需要出网的能力是 M3 的改写，
 *   而那条路必须经过 `@applypack/core/egress` 的组装层 —— 不是绕过它。
 * - **不做来源认证。** 推送进来的东西只能验「结构是否合法」与「手里这把 DEK
 *   打不打得开」，见 `transport.ts` 里那段说明。
 * - **不碰页面。** 内容脚本、适配器、填充都在 M5。
 *
 * ## 依赖注入的两个接缝
 *
 * `VaultStore`（来自 `@applypack/core/vault`）与 `CiphertextTransport` 各自在
 * 扩展入口里被实现成 `chrome.storage.local` 与 `chrome.runtime.onMessage`。
 * 本包只约定行为，不碰任何 `chrome.*` 全局 —— 因此整个会话逻辑可以在 Node 里
 * 确定性地跑（没有定时器、没有真实时钟、没有浏览器）。
 *
 * @see DESIGN.md 1.3 / 3.2 · AGENTS.md §3 §5 · TASKS.md T1.5
 */

export {
  ExtensionVaultError,
  describeLockReason,
  type ExtensionVaultErrorCode,
  type LockReason,
} from './errors'

export { systemClock, type Clock } from './clock'

export {
  createMemoryTransport,
  type CiphertextPushHandler,
  type CiphertextTransport,
  type CiphertextUnsubscribe,
} from './transport'

export {
  DEFAULT_IDLE_TTL_MS,
  DEFAULT_MAX_LIFETIME_MS,
  ExtensionVaultSession,
  type ExtensionVaultOptions,
  type PushOutcome,
  type PushRejection,
  type SessionStatus,
} from './session'
