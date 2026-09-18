/**
 * 密文库的存储抽象 —— 「存在哪儿」被隔离在这一个接口后面。
 *
 * `core` 不碰任何具体介质（零 DOM、零 Node 运行时）。IndexedDB、`chrome.storage`、
 * 用户选定的网盘目录各自实现在 Web 端与扩展端，`core` 只约定
 * 「能读一段文本、能写一段文本、能删掉它」。三个方法就是全部契约 ——
 * 接口每多一个方法，就意味着多一种「某个实现做不到」的可能。
 *
 * 为什么传**文本**而不是字节：
 *   1. `.vault` 本身就是一份 JSON 文本。IndexedDB 存字符串、localStorage 存字符串、
 *      `chrome.storage.sync` 存字符串，三个实现可以逐字相同。
 *   2. 更重要的：**用户导出的文件与内部存的东西是同一个字节序列**。
 *      「我导出的就是我存的那份」这件事因此不需要额外论证 ——
 *      它由类型直接保证，而不是靠两处序列化代码保持一致。
 *
 * 写入精度要求：`write` 必须**整体替换**而非追加或合并。密文库只有一份当前状态，
 * 半新半旧的文件是最坏的形态（它可能仍然能被解开，但内容已经错了）。
 */
import type { EncryptedEnvelope } from '../crypto/index'

import { parseVaultFile, serializeVaultFile } from './backup'
import { Vault } from './session'

export interface VaultStore {
  /** 读出当前密文，没有任何数据时返回 `null`。 */
  read(): Promise<string | null>
  /** 整体写入密文。 */
  write(text: string): Promise<void>
  /** 抹掉密文库。幂等：对空库调用不抛错。 */
  remove(): Promise<void>
}

/**
 * 内存实现。用途有三个：单测、SSR 之外的纯计算场景、以及
 * 「我不想让它落盘」的临时会话。
 *
 * 它是**唯一**一个 `core` 自带的具体实现，也因此是其余实现的参照：
 * 任何存储实现只要行为与它一致，密文库层就不需要知道差别。
 */
export function createMemoryVaultStore(initial: string | null = null): VaultStore {
  let current: string | null = initial

  return {
    async read() {
      return current
    },
    async write(text: string) {
      current = text
    },
    async remove() {
      current = null
    },
  }
}

/** 把会话当前的密文整体落盘。 */
export async function persistVault(store: VaultStore, vault: Vault): Promise<void> {
  await store.write(serializeVaultFile(vault.file))
}

/**
 * 从存储里恢复并解锁。
 *
 * 返回 `null` 表示**这台设备上还没有密文库**（不是错误）—— 与
 * 「有库但口令错」（抛 `decryption_failed`）必须是两种可区分的返回。
 * 混为一谈会让首次使用的用户看到「口令错误」，而他从没设过口令。
 */
export async function restoreVault(store: VaultStore, passphrase: string): Promise<Vault | null> {
  const text = await store.read()
  if (text === null) return null

  // 解析与解锁**必须**是同一条路径上的两步：任何绕过
  // `parseVaultFile` 直接构造 Vault 的入口都会让「外部输入先校验」这条前提失效。
  const file: EncryptedEnvelope = parseVaultFile(text)
  return Vault.open(file, passphrase)
}

/** 抹除密文库。 */
export async function eraseVault(store: VaultStore): Promise<void> {
  await store.remove()
}
