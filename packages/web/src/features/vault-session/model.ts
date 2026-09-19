/**
 * T8.2 vault 会话 —— Web 端的密文库状态机：`no-vault / locked /
 * unlock-failed / unlocked`。
 *
 * ## 全部语义都是 core 的，本模块只做两件事
 *
 * 1. **状态化**：core 的 `Vault` 是无 UI 的会话对象，`lock()` 之后
 *    对象还在但密钥没了 —— UI 需要一个「现在该画什么」的判别联合，
 *    本模块把四种画面各占一个分支（与 T7.2 扩展面板同构）。
 * 2. **失败分类**：`Vault.open` 对「口令错」与「文件坏」抛同一个
 *    `decryption_failed`（AEAD 的数学上不可区分，core 注释原文）——
 *    Web 端诚实的做法是**不假装能区分**：两种失败都落在
 *    `unlock-failed`，文案是「口令不对，或文件已损坏」。
 *
 * ## 明文与密文的两条铁律（断言见 model.test.ts）
 *
 * - `unlock-failed` 分支没有 `vault` / `archive` 字段 —— 错口令后
 *   档案在类型层就不存在，画不出来；
 * - `exportVaultText` 在锁定态也可用（密文本就是给磁盘看的），
 *   但其中找不到任何档案明文。
 */

import type { EncryptedEnvelope } from '../../../../core/src/crypto/index'
import { parseEnvelopeFile } from '../../../../core/src/crypto/index'
import { Vault } from '../../../../core/src/vault/index'
import type { ArchiveV1 } from '../../../../core/src/schema/index'

export type VaultSessionState =
  | { readonly kind: 'no-vault' }
  | { readonly kind: 'locked'; readonly file: EncryptedEnvelope }
  | { readonly kind: 'unlock-failed'; readonly file: EncryptedEnvelope }
  | { readonly kind: 'unlocked'; readonly vault: Vault; readonly archive: ArchiveV1 }

export type UnlockedSession = Extract<VaultSessionState, { kind: 'unlocked' }>

/** 新建库并用口令立即解锁（core 的 create 语义：create 成功 = 已解锁）。 */
export async function createSession(
  passphrase: string,
  archive?: ArchiveV1,
): Promise<UnlockedSession> {
  const vault = await Vault.create(passphrase, archive === undefined ? {} : { archive })
  return { kind: 'unlocked', vault, archive: await vault.loadArchive() }
}

/**
 * 口令开库。失败（口令错或文件损坏）→ `unlock-failed`，**不抛出** ——
 * 失败是用户界面要画的一种状态，不是异常流程；但它不携带任何明文。
 */
export async function openSession(
  file: unknown,
  passphrase: string,
): Promise<VaultSessionState> {
  try {
    const vault = await Vault.open(file, passphrase)
    // open 内部已验过一次内容；这里读出档案让 unlocked 分支自带现值
    const archive = await vault.loadArchive()
    return { kind: 'unlocked', vault, archive }
  } catch {
    return { kind: 'unlock-failed', file: file as EncryptedEnvelope }
  }
}

/** 解锁 → 锁定。密钥清零由 core 的 `lock()` 负责，这里只把画面切走。 */
export function lockSession(state: UnlockedSession): Extract<VaultSessionState, { kind: 'locked' }> {
  state.vault.lock()
  return { kind: 'locked', file: state.vault.file }
}

/**
 * 保存（payload 换、DEK 不动）。只有 unlocked 能保存 —— 锁定态传入
 * 直接抛错：没有密钥的保存是编不出来的操作，与其静默失败不如炸醒调用方。
 */
export async function persistToVault(
  state: VaultSessionState,
  archive: ArchiveV1,
): Promise<UnlockedSession> {
  if (state.kind !== 'unlocked') {
    throw new Error(
      `persistToVault：会话是 ${state.kind} —— 只有 unlocked 能保存，锁定态没有密钥`,
    )
  }
  await state.vault.saveArchive(archive)
  return { ...state, archive }
}

/** 导出 `.vault` 文本。锁定态也可用 —— 密文不含明文，本来就是公开形态。 */
export function exportVaultText(state: VaultSessionState): string {
  if (state.kind === 'no-vault') {
    throw new Error('exportVaultText：还没有密文库可导出')
  }
  if (state.kind === 'unlocked') return state.vault.toVaultText()
  return serializeFileForExport(state.file)
}

function serializeFileForExport(file: EncryptedEnvelope): string {
  return JSON.stringify(file, null, 2)
}

/**
 * 导入 `.vault` 文本 → `locked`（等口令）。文本非法 / 不是我们的格式
 * → 抛错：一份坏文件不该变成一个「看起来正常」的锁定状态。
 */
export function importVaultText(text: string): Extract<VaultSessionState, { kind: 'locked' }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('importVaultText：不是合法 JSON —— 这不是一份 .vault 文件')
  }
  // 校验交给 core 的 parseEnvelopeFile（「校验必须发生在最靠近数据的地方」
  // 是 core 的原则）：格式、版本、KDF 头、密文盒子逐项过 schema ——
  // 「长得像 JSON 但不是我们的信封」在这里炸，不会变成一个假锁定状态。
  const file = parseEnvelopeFile(parsed)
  return { kind: 'locked', file }
}
