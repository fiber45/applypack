/**
 * 密文库会话断言。
 *
 * 密文库层比 crypto 层多出来的东西只有一件：**生命周期**。
 * 所以这里的断言分成三组，每组盯一个不变量：
 *
 *   1. 往返 —— 存进去的能原样拿回来（含「保存内容不该动密钥材料」）
 *   2. 换口令 —— 只重做密钥封装，内容一个字节都不许动
 *   3. 锁定 —— 密钥离开内存之后，读写必须失败而不是「悄悄成功一半」
 */
import { describe, expect, it } from 'vitest'

import { rejectionCode } from '../crypto/__fixtures__/crypto-error-probe'
import { base64ToBytes, bytesToBase64 } from '../crypto/index'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { emptyArchiveV1 } from '../schema/index'
import { TEST_KDF_PARAMS } from './__fixtures__/test-params'
import { Vault } from './session'

const PASSPHRASE = 'correct horse battery staple'
const CREATE = { params: TEST_KDF_PARAMS } as const

/** 一份填满全部字段的档案，已封进密文库。 */
const sealedVault = (): Promise<Vault> =>
  Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })

describe('新建与往返', () => {
  it('新建的库未锁定，且携带一份空档案', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)

    expect(vault.isLocked).toBe(false)
    expect(await vault.loadArchive()).toEqual(emptyArchiveV1())
  })

  it('可以用一份已有档案建库，立刻读回即深相等', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    expect(await vault.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('保存后再读回：填满全部字段的档案深相等', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    await vault.saveArchive(maximalArchiveV1)

    expect(await vault.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('落盘的密文里不含任何明文（别人拿到文件也读不出）', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const text = vault.toVaultText()

    const secrets = [
      '林知远',
      'Lin Zhiyuan',
      'linzhiyuan@example.com',
      '+8613800138000',
      '330106200205140011',
      '浙江省杭州市西湖区某路 1 号',
      '某某大学',
      '推荐系统',
    ]

    for (const secret of secrets) {
      expect(text).not.toContain(secret)
    }
  })

  it('会话里的密文可以 JSON 往返（能落盘、能走网络）', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const revived = await Vault.open(JSON.parse(JSON.stringify(vault.file)), PASSPHRASE)

    expect(await revived.loadArchive()).toEqual(maximalArchiveV1)
  })
})

describe('保存内容不该动密钥材料', () => {
  it('保存档案后盐与被封装的密钥完全不变（只有 payload 变）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    const before = vault.file

    await vault.saveArchive(maximalArchiveV1)
    const after = vault.file

    expect(after.kdf).toEqual(before.kdf)
    expect(after.wrappedKey).toEqual(before.wrappedKey)
    expect(after.payload).not.toEqual(before.payload)
  })

  it('每次保存都换新的 payload nonce（改一个字也要重新随机）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)

    await vault.saveArchive(maximalArchiveV1)
    const first = vault.file.payload
    await vault.saveArchive(maximalArchiveV1)
    const second = vault.file.payload

    expect(second.nonce).not.toBe(first.nonce)
    expect(second.ciphertext).not.toBe(first.ciphertext)
  })

  it('连续保存多次，读回的是最后一次的内容（保存是替换，不是叠加）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)

    await vault.saveArchive(emptyArchiveV1())
    await vault.saveArchive(maximalArchiveV1)
    await vault.saveArchive(emptyArchiveV1())

    expect(await vault.loadArchive()).toEqual(emptyArchiveV1())

    // 落盘后再开一次，确认中间那两次没有以任何形式留在文件里。
    const reopened = await Vault.open(vault.file, PASSPHRASE)
    expect(await reopened.loadArchive()).toEqual(emptyArchiveV1())
  })

  it('保存后仍能用原口令打开（保存不改变口令语义）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    await vault.saveArchive(maximalArchiveV1)

    const reopened = await Vault.open(vault.file, PASSPHRASE)
    expect(await reopened.loadArchive()).toEqual(maximalArchiveV1)
  })
})

describe('换口令：只重做密钥封装', () => {
  const NEXT = 'a-brand-new-passphrase'

  it('换完之后：新口令能开、旧口令打不开', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    await vault.changePassphrase(NEXT)

    expect(await rejectionCode(Vault.open(vault.file, PASSPHRASE))).toBe('decryption_failed')
    expect(await (await Vault.open(vault.file, NEXT)).loadArchive()).toEqual(maximalArchiveV1)
  })

  it('payload 密文与 nonce 逐字节不变 —— 换口令不重新加密内容', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const before = JSON.parse(JSON.stringify(vault.file.payload)) as unknown

    await vault.changePassphrase(NEXT)

    // 这一条是两层密钥设计的唯一直接证据。它一旦失败，说明 payload 的 AAD
    // 又被绑回了盐上 —— 「换口令」将退化成「重新加密全部内容」。
    expect(vault.file.payload).toEqual(before)
  })

  it('盐与被封装的密钥都换了（口令换了，密钥封装必须重做）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    const before = vault.file

    await vault.changePassphrase(NEXT)

    expect(vault.file.kdf.salt).not.toBe(before.kdf.salt)
    expect(vault.file.wrappedKey).not.toEqual(before.wrappedKey)
  })

  it('KDF 参数沿用原文件的，不顺手升到新默认值', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    await vault.changePassphrase(NEXT)

    // 换口令是一次范围明确的用户操作，不该顺带改变加密强度 ——
    // 否则「这次改动到底改了什么」就说不清了。参数升级应当是独立的一次迁移。
    expect(vault.file.kdf.memoryKiB).toBe(TEST_KDF_PARAMS.memoryKiB)
    expect(vault.file.kdf.iterations).toBe(TEST_KDF_PARAMS.iterations)
    expect(vault.file.kdf.parallelism).toBe(TEST_KDF_PARAMS.parallelism)
  })

  it('换口令后接着保存内容，新口令依然能读回（两步不打架）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    await vault.changePassphrase(NEXT)
    await vault.saveArchive(maximalArchiveV1)

    const reopened = await Vault.open(vault.file, NEXT)
    expect(await reopened.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('空口令被拒绝，且失败后状态完全不变（不会把库改坏）', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const before = JSON.parse(JSON.stringify(vault.file)) as unknown

    expect(await rejectionCode(vault.changePassphrase(''))).toBe('invalid_params')

    expect(vault.file).toEqual(before)
    expect(await (await Vault.open(vault.file, PASSPHRASE)).loadArchive()).toEqual(maximalArchiveV1)
  })
})

describe('锁定：密钥离开内存之后', () => {
  it('lock 之后 isLocked 为真', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    vault.lock()
    expect(vault.isLocked).toBe(true)
  })

  it('锁定后读 / 写 / 换口令一律抛 vault_locked（不是 decryption_failed）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    vault.lock()

    // 错误码必须区分：把「忘了先解锁」报成「口令错误」，
    // 用户会开始怀疑自己记错口令 —— 一个诊断信息的错误足以把人引向相反的处置。
    expect(await rejectionCode(vault.loadArchive())).toBe('vault_locked')
    expect(await rejectionCode(vault.saveArchive(maximalArchiveV1))).toBe('vault_locked')
    expect(await rejectionCode(vault.changePassphrase('whatever'))).toBe('vault_locked')
  })

  it('锁定不影响密文本身：文件照旧可读，且能用口令重新打开', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const before = vault.toVaultText()

    vault.lock()

    expect(vault.toVaultText()).toBe(before)
    const reopened = await Vault.open(vault.file, PASSPHRASE)
    expect(await reopened.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('lock 幂等：重复调用不抛错', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    vault.lock()
    expect(() => vault.lock()).not.toThrow()
    expect(vault.isLocked).toBe(true)
  })

  it('解锁出来的是新会话，与已锁定的那个互不影响', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    vault.lock()

    const fresh = await Vault.open(vault.file, PASSPHRASE)
    expect(fresh.isLocked).toBe(false)
    // 已锁定的那个仍然锁着 —— 解锁不会「唤醒」旧会话对象。
    expect(vault.isLocked).toBe(true)
  })
})

describe('打开外部输入：先校验结构，再看口令', () => {
  it('不是对象 / 形状不对 → malformed_envelope', async () => {
    for (const bad of [null, undefined, 42, 'string', [], true, {}]) {
      expect(await rejectionCode(Vault.open(bad, PASSPHRASE))).toBe('malformed_envelope')
    }
  })

  it('口令错 → decryption_failed（与结构错误区分）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)
    expect(await rejectionCode(Vault.open(vault.file, 'nope'))).toBe('decryption_failed')
  })

  it('失败的 open 不会泄漏出任何对象', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)

    let leaked: unknown = 'NEVER_RESOLVED'
    await expect(
      Vault.open(vault.file, 'nope').then((value) => {
        leaked = value
      }),
    ).rejects.toThrow()

    expect(leaked).toBe('NEVER_RESOLVED')
  })

  it('open 成功 ⇒ 内容完好可读，不存在「解锁了却读不出来」的中间态', async () => {
    const vault = await sealedVault()

    // 正面：open 成功就一定读得出来。
    const opened = await Vault.open(vault.file, PASSPHRASE)
    await expect(opened.loadArchive()).resolves.toEqual(maximalArchiveV1)

    // 反面：内容被改过的文件在 open 那一刻就失败，用户永远不会走到
    // 「以为解锁成功了、然后被告知档案损坏」那一步。
    const bytes = await base64ToBytes(vault.file.payload.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 0xff
    const corrupted = {
      ...vault.file,
      payload: { ...vault.file.payload, ciphertext: await bytesToBase64(bytes) },
    }

    expect(await rejectionCode(Vault.open(corrupted, PASSPHRASE))).toBe('decryption_failed')
  })

  it('篡改 payload 密文 → decryption_failed', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const bytes = await base64ToBytes(vault.file.payload.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 0xff

    // 刻意不用 Buffer / btoa：core 的 lib 白名单里没有 Node 与 DOM，
    // 测试文件同样受这条约束（它也在 src/ 下、也过 tsc）。
    const tampered = {
      ...vault.file,
      payload: { ...vault.file.payload, ciphertext: await bytesToBase64(bytes) },
    }

    expect(await rejectionCode(Vault.open(tampered, PASSPHRASE))).toBe('decryption_failed')
  })
})

/**
 * 「这份密文是不是我们的、里面是什么」—— 扩展端密文副本（T1.5）依赖的判决手段。
 *
 * 这组断言要证明的是一个**能力边界**：`loadPayload` 能回答的问题恰好是
 * 「我手里这把 DEK 打得开这团 payload 吗，打开之后是什么」，多一点都没有。
 * 正面（同源 ⇒ 解得出档案，含换口令之后）与反面（另一个库 / 被改过 ⇒ 解不开）
 * 都要有 —— 只测正面的话，「永远返回同一份缓存」也能通过。
 */
describe('解一份不属于本会话的 payload：loadPayload', () => {
  it('同一个库保存过的那份 payload：解得出内容（内容换了，密钥没换）', async () => {
    const vault = await Vault.create(PASSPHRASE, CREATE)

    await vault.saveArchive(maximalArchiveV1)
    const next = vault.file.payload

    await vault.saveArchive(emptyArchiveV1())

    // 这是扩展端「推送刷新」的全部依据：手里这把密钥对**后来的** payload 依然有效。
    expect(await vault.loadPayload(next)).toEqual(maximalArchiveV1)
  })

  it('换口令之后照样解得开 —— 换掉的是封装，不是那把密钥', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const payload = vault.file.payload

    await vault.changePassphrase('another-passphrase')

    // 这条是 DEK 分层的第二个证据（第一个是「payload 逐字节不变」）：
    // 头部（盐 / wrappedKey）整体换掉了，而内容仍然由同一把 DEK 保护。
    expect(await vault.loadPayload(payload)).toEqual(maximalArchiveV1)
  })

  it('loadArchive 就是对自己那份 payload 调用它（两条路径不会各自漂移）', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })

    expect(await vault.loadPayload(vault.file.payload)).toEqual(await vault.loadArchive())
  })

  it('另一个库的 payload ⇒ decryption_failed', async () => {
    const mine = await Vault.create(PASSPHRASE, CREATE)
    const other = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })

    expect(await rejectionCode(mine.loadPayload(other.file.payload))).toBe('decryption_failed')
  })

  it('被篡改一个字节的 payload ⇒ decryption_failed', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const bytes = await base64ToBytes(vault.file.payload.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 0xff

    expect(
      await rejectionCode(
        vault.loadPayload({ ...vault.file.payload, ciphertext: await bytesToBase64(bytes) }),
      ),
    ).toBe('decryption_failed')
  })

  it('它不改动会话的任何状态', async () => {
    const vault = await Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })
    const before = vault.toVaultText()
    const other = await Vault.create(PASSPHRASE, CREATE)

    // 试开别的库（一定失败）与试开自己的（一定成功），两条路都不许有副作用：
    // 否则调用方就得先关心调用顺序。
    await rejectionCode(vault.loadPayload(other.file.payload))
    await vault.loadPayload(vault.file.payload)

    expect(vault.toVaultText()).toBe(before)
    expect(vault.isLocked).toBe(false)
    expect(await vault.loadArchive()).toEqual(maximalArchiveV1)
  })
})
