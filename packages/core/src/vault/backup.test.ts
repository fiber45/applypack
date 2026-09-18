/**
 * 加密备份与存储层断言。
 *
 * TASKS.md T1.3 的第一条验收是「导出 `.vault` → 导入后全字段深相等」。
 * 这条要求朴素，但它排除了一整类看起来更贴心的实现：导出时裁掉空字段、
 * 导入时补默认值、导出时顺手压成一行 —— 这些都会让备份在**用户不知情时**偏离原件，
 * 而且要等到某天真的需要恢复时才会被发现。
 *
 * 第二组断言盯的是存储抽象：`core` 不假设介质长什么样。
 * 用一个「故意把文本存反」的 store 就能证明这一点 —— 如果实现里藏着
 * 对 localStorage / IndexedDB 形状的假设，这组断言会立刻挂掉。
 */
import { describe, expect, it } from 'vitest'

import { rejectionCode } from '../crypto/__fixtures__/crypto-error-probe'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { emptyArchiveV1 } from '../schema/index'
import { TEST_KDF_PARAMS } from './__fixtures__/test-params'
import { VAULT_FILE_EXTENSION, isVaultFileName, parseVaultFile, serializeVaultFile } from './backup'
import { Vault } from './session'
import { createMemoryVaultStore, eraseVault, persistVault, restoreVault, type VaultStore } from './store'

const PASSPHRASE = 'correct horse battery staple'
const CREATE = { params: TEST_KDF_PARAMS } as const

const sealedVault = (): Promise<Vault> =>
  Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })

describe('.vault 文本：导出即可导入', () => {
  it('导出 → 解析 → 导入 → 读回，逐字段深相等（T1.3 验收）', async () => {
    const source = await sealedVault()
    const text = source.toVaultText()

    const restored = await Vault.open(parseVaultFile(text), PASSPHRASE)

    expect(await restored.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('解析出的密文与原对象深相等（导出不是摘要，是原件）', async () => {
    const vault = await sealedVault()
    expect(parseVaultFile(vault.toVaultText())).toEqual(vault.file)
  })

  it('序列化幂等：再序列化一次得到逐字节相同的文本', async () => {
    const vault = await sealedVault()
    const once = vault.toVaultText()
    const twice = serializeVaultFile(parseVaultFile(once))

    expect(twice).toBe(once)
  })

  it('导出的是文本本身：以 { 开头、无 BOM、以换行结尾', async () => {
    const text = (await sealedVault()).toVaultText()

    expect(text.startsWith('{')).toBe(true)
    expect(text.charCodeAt(0)).toBe(0x7b)
    // BOM 会让一部分解析器与命令行工具把文件当成二进制 —— 备份不该输在这种地方。
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('备份文本里不含任何明文（它能安全地放进网盘）', async () => {
    const text = (await sealedVault()).toVaultText()

    for (const secret of ['林知远', 'Lin Zhiyuan', 'linzhiyuan@example.com', '330106200205140011']) {
      expect(text).not.toContain(secret)
    }
  })

  it('非 JSON → malformed_envelope（不是神秘崩溃）', () => {
    expect(() => parseVaultFile('这不是 JSON')).toThrowError(/合法 JSON/)
  })

  it('JSON 但结构不对 → malformed_envelope；多了未知字段也一样', async () => {
    const vault = await sealedVault()

    // 用户拿文本编辑器打开备份，看见一堆 base64，很容易「顺手加个备注」。
    // 严格模式会拒绝它 —— 这与 ADR-8 同一条理由：未知字段没有数据分级。
    const withNote = { ...vault.file, note: '我的简历备份' }

    expect(() => parseVaultFile(JSON.stringify(withNote))).toThrowError()
    expect(() => parseVaultFile('{"format":"applypack-vault"}')).toThrowError()
  })

  it('口令不对时导入失败，且不返回任何东西', async () => {
    const text = (await sealedVault()).toVaultText()
    expect(await rejectionCode(Vault.open(parseVaultFile(text), 'wrong'))).toBe('decryption_failed')
  })
})

describe('文件名规则', () => {
  it('只接受 ASCII 字母数字与 . _ - 组成的 .vault', () => {
    expect(isVaultFileName('applypack-2026-09-19.vault')).toBe(true)
    expect(isVaultFileName('resume_backup.vault')).toBe(true)
    expect(isVaultFileName('我的备份.vault')).toBe(false)
    expect(isVaultFileName('my backup.vault')).toBe(false)
    expect(isVaultFileName('applypack.json')).toBe(false)
    expect(isVaultFileName('applypack.vault.exe')).toBe(false)
  })

  it('扩展名常量与规则一致', () => {
    expect(isVaultFileName(`x${VAULT_FILE_EXTENSION}`)).toBe(true)
  })
})

describe('存储抽象：core 对介质零假设', () => {
  it('空存储上恢复返回 null —— 「还没有库」不是错误', async () => {
    const store = createMemoryVaultStore()

    // 首次使用的用户从没设过口令，此时给他看「口令错误」是纯粹的误导。
    expect(await restoreVault(store, PASSPHRASE)).toBeNull()
  })

  it('落盘 → 恢复 → 读回，深相等', async () => {
    const store = createMemoryVaultStore()
    const vault = await sealedVault()
    await persistVault(store, vault)

    const restored = await restoreVault(store, PASSPHRASE)
    expect(await restored?.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('重复落盘是整体替换，不是追加或合并', async () => {
    const store = createMemoryVaultStore()

    const first = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    await persistVault(store, first)

    const second = await Vault.create(PASSPHRASE, CREATE)
    await persistVault(store, second)

    const restored = await restoreVault(store, PASSPHRASE)
    // 存储里只剩第二次那份：第一次的档案（maximalArchiveV1）必须彻底消失。
    // 半新半旧的文件是最坏的形态 —— 它可能仍能解开，但内容已经错了。
    expect(await restored?.loadArchive()).toEqual(emptyArchiveV1())
  })

  it('抹除之后，恢复回到「还没有库」', async () => {
    const store = createMemoryVaultStore()
    await persistVault(store, await sealedVault())

    await eraseVault(store)

    expect(await store.read()).toBeNull()
    expect(await restoreVault(store, PASSPHRASE)).toBeNull()
  })

  it('抹除是幂等的', async () => {
    const store = createMemoryVaultStore()
    await eraseVault(store)
    await expect(eraseVault(store)).resolves.toBeUndefined()
  })

  it('换一个「把文本存反」的存储实现，行为完全不变', async () => {
    // 这个 store 故意用非直觉的介质形状：每次写入反转文本，读出时再反转回来。
    // 如果 core 的密文库层暗含了任何关于「存的是什么形状」的假设，这里就会挂。
    const backing: { raw: string | null } = { raw: null }
    const reversedStore: VaultStore = {
      async read() {
        return backing.raw === null ? null : [...backing.raw].reverse().join('')
      },
      async write(text: string) {
        backing.raw = [...text].reverse().join('')
      },
      async remove() {
        backing.raw = null
      },
    }

    await persistVault(reversedStore, await sealedVault())

    // 介质里存的确实是反转后的文本（导出文本以 `{` 开头、以换行结尾，
    // 反转后即以换行开头、以 `{` 结尾）—— 但它照样能读回来。
    expect(backing.raw?.endsWith('{')).toBe(true)
    expect(backing.raw?.includes('"format"')).toBe(false)

    const restored = await restoreVault(reversedStore, PASSPHRASE)
    expect(await restored?.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('存储里放一段垃圾文本 → 恢复时抛 malformed_envelope，不返回半成品', async () => {
    const store = createMemoryVaultStore('随便什么内容')
    expect(await rejectionCode(restoreVault(store, PASSPHRASE))).toBe('malformed_envelope')
  })

  it('存储里有合法密文但口令错 → decryption_failed（与上一条区分开）', async () => {
    const store = createMemoryVaultStore()
    await persistVault(store, await sealedVault())

    expect(await rejectionCode(restoreVault(store, 'wrong'))).toBe('decryption_failed')
  })
})
