/**
 * T9.2a —— 粘贴信封解锁的纯模型（「密文副本通道」的拍板实现）。
 *
 * ## 为什么是「粘贴信封」而不是自动推送
 *
 * T1.5 设计的密文推送（`CiphertextTransport`）在真实浏览器里需要一条
 * 跨 origin 的副本通道，而本扩展的骨架承诺是**零权限、零 chrome.* API**
 * （check-dist 把它钉成构建期事实）。粘贴方案让 Web 端复制信封文本、
 * 用户在网申页粘贴 —— 通道就是剪贴板和用户的手，一条权限都不用加。
 * 代价是每个网申页面都要重新粘贴一次（信封与密钥只活在本页内存），
 * 这是「零权限」的诚实价格，不是缺陷。
 *
 * ## 失败语义
 *
 * 任何一环失败（不是 JSON / 不是合法信封 / 口令错）都返回 `null`，
 * 与面板 `UnlockArchive` 接缝同一种语言：「成 / 不成」两种结局，
 * 错误分类是 vault 层（T1.5）的事，UI 不需要第三种状态。
 * **绝不抛出** —— 解锁失败被抛进内容脚本的顶层 = 未处理拒绝 = 「点了没反应」
 * （Web 端 2026-09 事故的扩展版教训）。
 */
import { parseEnvelopeFile } from '../../../core/src/crypto/index'
import { Vault } from '../../../core/src/vault/index'
import type { ArchiveV1 } from '../../../core/src/schema/index'

export interface EnvelopeUnlock {
  /** 解锁出的档案 —— 交给 `openPanel` / `unlockPanel` 构建 ready 预览。 */
  readonly archive: ArchiveV1
  /** 解锁出的库实例 —— 回填放行后 `saveArchive` + `toVaultText` 的数据源。 */
  readonly vault: Vault
}

export async function unlockFromEnvelopeText(
  text: string,
  passphrase: string,
): Promise<EnvelopeUnlock | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }
  let file: Parameters<typeof Vault.open>[0]
  try {
    file = parseEnvelopeFile(parsed)
  } catch {
    return null
  }
  try {
    const vault = await Vault.open(file, passphrase)
    return { archive: await vault.loadArchive(), vault }
  } catch {
    return null
  }
}
