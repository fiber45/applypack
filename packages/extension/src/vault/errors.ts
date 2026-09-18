/**
 * 扩展端会话的错误与「为什么被锁住」。
 *
 * 与 `core/crypto` 的错误码同一条理由：**失败路径必须可被程序区分**。
 * 但这里多出来一个维度 —— core 只回答「密钥对不对」，扩展端还要回答
 * **「为什么现在没有密钥可用」**。
 *
 * | 情形 | 用户该做什么 | 与其它情形的差别 |
 * |---|---|---|
 * | 还没在这个会话里解过锁 | 输口令 | 与「刚超时」的提示语不同 |
 * | 空闲超时 | 输口令（并知道是超时，不是自己记错了） | |
 * | 到绝对上限 | 输口令 | 即使一直在用也会到期，提示语要说清 |
 * | Web 端改了口令 | 输**新**口令 | 不然会一直试旧口令 |
 * | 用户主动锁定 | 输口令 | 这是用户自己的动作，不该弹「会话已过期」 |
 * | 本设备还没有密文副本 | 先去 Web 端建档 / 导入备份 | **没有任何口令能解决它** |
 *
 * 最后一行是唯一一种「输口令也没用」的情况，把它和「已锁定」混为一谈，
 * 用户会在一个自己无法解决的问题上反复重试口令 —— 与 T1.3 里
 * 「忘了先解锁 ≠ 口令错误」是同一类错误的第二次出现。
 */

/** 会话当前没有可用密钥的原因。 */
export type LockReason =
  /** 这个会话从来没解过锁（但可能已经有密文副本）。 */
  | 'never_unlocked'
  /** 用户主动点了锁定。 */
  | 'manual'
  /** 空闲超时：距最后一次使用已满 TTL。 */
  | 'idle_timeout'
  /** 到达绝对上限：这次解锁活得够久了，与是否活跃无关。 */
  | 'max_lifetime'
  /** 收到的新密文换了密钥封装代际（Web 端改了口令），手里的密钥不能再当作有效凭据。 */
  | 'key_changed'

export type ExtensionVaultErrorCode =
  /** 需要已解锁的会话，而当前没有（含各种超时原因，见 `lockReason`）。 */
  | 'vault_locked'
  /** 本设备上还没有密文副本 —— 没有任何口令能解决它。 */
  | 'no_ciphertext'
  /**
   * 构造会话时的参数不合法（例如超时时间不是正数）。
   *
   * 单独一个码，因为它与「锁定」是两件事：锁定是运行中的状态，这是配置写错了。
   * 最值得拦的是 `NaN` —— `now >= 某时刻 + NaN` 恒为 `false`，也就是**永不过期**。
   * 那是那种「看起来在工作」的坏配置：测试全绿，而密码学上等于没有超时。
   */
  | 'invalid_options'

/**
 * 扩展会话层的错误。
 *
 * **解锁失败不在这里** —— 那是 core 的 `CryptoError`（`decryption_failed` /
 * `invalid_params`），原样透传。重新包装一遍只会得到一个字段完全相同的副本，
 * 并让「口令错」这件事在两个类型里各有一份真相。
 * 所以本层的错误码只覆盖「扩展会话比 core 多出来的那部分」：生命周期与副本。
 */
export class ExtensionVaultError extends Error {
  readonly code: ExtensionVaultErrorCode

  /** 锁定原因。仅当 `code === 'vault_locked'` 时有意义，否则为 `null`。 */
  readonly lockReason: LockReason | null

  constructor(code: ExtensionVaultErrorCode, message: string, lockReason: LockReason | null = null) {
    super(message)
    this.name = 'ExtensionVaultError'
    this.code = code
    this.lockReason = lockReason
  }
}

/** 把原因翻成一句能直接显示给用户的话（避免各调用方各写一份文案）。 */
export function describeLockReason(reason: LockReason): string {
  switch (reason) {
    case 'never_unlocked':
      return '扩展还没解锁'
    case 'manual':
      return '已手动锁定'
    case 'idle_timeout':
      return '会话空闲超时，已自动锁定'
    case 'max_lifetime':
      return '本次解锁已达最长时限，请重新解锁'
    case 'key_changed':
      return 'Web 端的密文库已重新封装（改过口令），请用新口令解锁'
  }
}
