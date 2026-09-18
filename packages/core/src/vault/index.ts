/**
 * `@applypack/core/vault` —— 密文库与加密备份。
 *
 * 职责边界：**只回答「存在哪儿、什么时候解锁、怎么带走」，
 * 不回答「怎么加密一段字节」**（那是 `crypto` 层）。
 *
 * ```
 * Vault.create(口令) ──► Vault ──┬─ loadArchive() / saveArchive()  会话内读写
 *                                ├─ toVaultText()                  导出 .vault
 *                                ├─ changePassphrase(新口令)         只重封 DEK
 *                                └─ lock()                          密钥离开内存
 * ```
 *
 * **没有恢复码，也没有任何其它后门。** 密文库与 `.vault` 备份的解密入口
 * 只有一个：口令。忘记口令而手上没有 `.vault` 备份 = 数据永久丢失，
 * 这是取消服务端换来的确定代价，不是待修的缺陷。
 * 如果你担心忘记口令 —— 现在就能做且唯一有效的事是**导出备份**，
 * 以及**趁还记得时把口令换成好记的**（`changePassphrase`）。
 *
 * @see DESIGN.md 3.2 / ADR-10 · AGENTS.md §5 · TASKS.md T1.3
 */

export {
  VAULT_FILE_EXTENSION,
  isVaultFileName,
  parseVaultFile,
  serializeVaultFile,
} from './backup'

export {
  createMemoryVaultStore,
  eraseVault,
  persistVault,
  restoreVault,
  type VaultStore,
} from './store'

export { Vault, type CreateVaultOptions } from './session'
