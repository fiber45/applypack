/**
 * 负向断言：**口令丢失时不存在任何恢复路径。**
 *
 * TASKS.md T1.3 点名要求「这条要写成测试，不是写成注释」。它值得被认真对待，
 * 因为「我们不做后门」这种话，写在文档里是承诺、写在注释里是意图，
 * **只有写成会失败的断言才是性质**。一个后来者（包括未来的自己）
 * 想加「忘记口令怎么办」的功能时，这文件会先拦住他。
 *
 * 「不存在恢复路径」不能直接断言 —— 那是在证明一个否定命题。所以拆成四组，
 * 每组对应一种**具体的**「本来能成为恢复路径的东西」：
 *
 *   1. 弱口令与常见默认值 —— 排掉「口令其实很好猜」这条事实上的路径
 *   2. 文件结构封闭性   —— 排掉「文件里还藏着第三把钥匙」
 *   3. API 面封闭性     —— 排掉「代码里还有另一个能打开它的入口」
 *   4. 换口令的方向性   —— 排掉「换口令被当成绕过口令的手段」
 *
 * 四组都是**可执行、可失败**的：任何一处被改动，这文件会红。
 */
import { describe, expect, it } from 'vitest'

import { rejectionCode } from '../crypto/__fixtures__/crypto-error-probe'
import { base64ToBytes, bytesToBase64, utf8ToBytes } from '../crypto/index'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { TEST_KDF_PARAMS } from './__fixtures__/test-params'
import { Vault } from './session'

const PASSPHRASE = 'correct horse battery staple'
const CREATE = { params: TEST_KDF_PARAMS } as const

const sealedVault = (): Promise<Vault> =>
  Vault.create(PASSPHRASE, { ...CREATE, archive: maximalArchiveV1 })

describe('① 弱口令与常见默认值：全部打不开', () => {
  /**
   * 这不是一份通用的弱口令字典（那是 M6 的事），而是一份**针对本实现**的清单：
   * 任何「开发者为了好调试而留下的默认口令」都会出现在这份清单里。
   */
  const NOT_THE_PASSPHRASE = [
    'password',
    'Password',
    'password123',
    '123456',
    '12345678',
    '123456789',
    'qwerty',
    'admin',
    'letmein',
    'applypack',
    'ApplyPack',
    'applypack-vault',
    'applypack-vault-v1',
    'resume',
    'vault',
    'undefined',
    'null',
    'NaN',
    '[object Object]',
  ]

  it('逐个尝试都得到 decryption_failed', async () => {
    const vault = await sealedVault()

    for (const candidate of NOT_THE_PASSPHRASE) {
      expect(await rejectionCode(Vault.open(vault.file, candidate))).toBe('decryption_failed')
    }
  })

  it('空口令被直接拒绝（invalid_params），而不是当成一个可用的口令去试', async () => {
    const vault = await sealedVault()

    // 「空口令等价于没有加密」是本项目最想避免的形态：
    // 一个用户以为设了口令、实际人人可解的文件。
    expect(await rejectionCode(Vault.open(vault.file, ''))).toBe('invalid_params')
    expect(await rejectionCode(Vault.open(vault.file, '\u0000'))).toBe('decryption_failed')
  })

  it('近似口令全部失败：少一字符 / 多一空格 / 改大小写 / 换词序', async () => {
    const vault = await sealedVault()

    const nearMisses = [
      'correct horse battery stapl',
      'correct horse battery staple ',
      ' correct horse battery staple',
      'Correct Horse Battery Staple',
      'correct horse battery staplé',
      'correcthorsebatterystaple',
      'correct-horse-battery-staple',
    ]

    for (const candidate of nearMisses) {
      expect(await rejectionCode(Vault.open(vault.file, candidate))).toBe('decryption_failed')
    }
  })

  it('NFKC 归一化是**输入规范化**，不是模糊匹配 —— 它是唯一一类「近似可开」且必须可开的情形', async () => {
    const vault = await sealedVault()
    const fullwidth = 'ｃｏｒｒｅｃｔ　ｈｏｒｓｅ　ｂａｔｔｅｒｙ　ｓｔａｐｌｅ'

    // 中文输入法极易打出全角字符，不归一化就会变成「口令明明记对了却打不开」。
    // 但归一化有 RFC 定义、结果完全可预测 —— 与「猜个差不多的」是两件事。
    expect(fullwidth.normalize('NFKC')).toBe(PASSPHRASE)
    expect(await (await Vault.open(vault.file, fullwidth)).loadArchive()).toEqual(maximalArchiveV1)

    // 反面：归一化不该顺手把大小写或空格也抹平。
    expect('Correct Horse Battery Staple'.normalize('NFKC')).toBe('Correct Horse Battery Staple')
    expect('correct  horse'.normalize('NFKC')).toBe('correct  horse')
  })
})

describe('② 文件结构是封闭的：没有任何地方能藏第三把钥匙', () => {
  it('.vault 的键集合恰好是这些，一个不多', async () => {
    const vault = await sealedVault()
    const parsed = JSON.parse(vault.toVaultText()) as Record<string, unknown>

    // 解析时的严格模式（ADR-8）已经会拒绝未知字段；这条断言更进一步 ——
    // 它让「往里加一个 recoveryKey / escrowKey / hint」这件事连**产生**都不可能：
    // 只要有人加，这行立刻红，而红的那一刻就是他必须解释理由的时刻。
    expect(Object.keys(parsed).sort()).toEqual([
      'cipher',
      'format',
      'kdf',
      'payload',
      'version',
      'wrappedKey',
    ])
    expect(Object.keys(parsed.cipher as object).sort()).toEqual(['algorithm'])
    expect(Object.keys(parsed.kdf as object).sort()).toEqual([
      'algorithm',
      'iterations',
      'keyLength',
      'memoryKiB',
      'parallelism',
      'salt',
    ])
    // 只有两个 sealed box：一个装密钥，一个装内容。没有第三个容器。
    expect(Object.keys(parsed.wrappedKey as object).sort()).toEqual(['ciphertext', 'nonce'])
    expect(Object.keys(parsed.payload as object).sort()).toEqual(['ciphertext', 'nonce'])
  })

  it('文件里没有任何字段是「解密所不需要的」—— 翻转任意一处的任一字节都打不开', async () => {
    const vault = await sealedVault()

    const flip = async (encoded: string): Promise<string> => {
      const bytes = await base64ToBytes(encoded)
      bytes[0] = (bytes[0] ?? 0) ^ 0x01
      return bytesToBase64(bytes)
    }

    const variants: unknown[] = [
      { ...vault.file, kdf: { ...vault.file.kdf, salt: await flip(vault.file.kdf.salt) } },
      {
        ...vault.file,
        wrappedKey: { ...vault.file.wrappedKey, nonce: await flip(vault.file.wrappedKey.nonce) },
      },
      {
        ...vault.file,
        wrappedKey: {
          ...vault.file.wrappedKey,
          ciphertext: await flip(vault.file.wrappedKey.ciphertext),
        },
      },
      {
        ...vault.file,
        payload: { ...vault.file.payload, nonce: await flip(vault.file.payload.nonce) },
      },
      {
        ...vault.file,
        payload: { ...vault.file.payload, ciphertext: await flip(vault.file.payload.ciphertext) },
      },
    ]

    for (const variant of variants) {
      expect(await rejectionCode(Vault.open(variant, PASSPHRASE))).toBe('decryption_failed')
    }
  })
})

describe('③ API 面是封闭的：代码里没有第二个入口', () => {
  it('Vault 的静态方法恰好是 create / open 两个', () => {
    const builtins = ['length', 'name', 'prototype']
    const statics = Object.getOwnPropertyNames(Vault).filter((key) => !builtins.includes(key))

    // 这条断言的作用不是「描述现状」，而是**给未来加方法的人设一道关卡**：
    // 想在 Vault 上加 `recover()` / `reset()` / `openWithHint()`，先来这里改断言，
    // 而改的那一行会出现在 diff 里，被看见、被追问。
    expect(statics.sort()).toEqual(['create', 'open'])
  })

  it('Vault 实例上的方法恰好是这些，全部要求先解锁', () => {
    const methods = Object.getOwnPropertyNames(Vault.prototype).filter((key) => key !== 'constructor')

    expect(methods.sort()).toEqual([
      'changePassphrase',
      'file',
      'isLocked',
      'loadArchive',
      'lock',
      'saveArchive',
      'toVaultText',
    ])
  })

  it('唯一能解出档案的入口需要口令，且没有任何重载能绕过它', async () => {
    const vault = await sealedVault()

    // 传 undefined / null 当口令都不构成「跳过」——它们只是错误的输入。
    expect(await rejectionCode(Vault.open(vault.file, undefined as unknown as string))).toBe(
      'invalid_params',
    )
    expect(await rejectionCode(Vault.open(vault.file, null as unknown as string))).toBe(
      'invalid_params',
    )
  })
})

describe('④ 换口令不是绕过口令的手段', () => {
  it('拿不到会话就调不到 changePassphrase —— 换口令需要的是**当前**口令', async () => {
    const vault = await sealedVault()

    // 换口令的实现前提是「手里已经有 DEK」，而 DEK 只能由当前口令解出。
    // 所以它是一条**向前**的路径，不是一条向后的恢复路径。
    expect(await rejectionCode(Vault.open(vault.file, 'not-the-passphrase'))).toBe(
      'decryption_failed',
    )
  })

  it('换完之后旧口令彻底失效（换口令销毁的是旧的解锁能力）', async () => {
    const vault = await sealedVault()
    await vault.changePassphrase('the-only-new-passphrase')

    expect(await rejectionCode(Vault.open(vault.file, PASSPHRASE))).toBe('decryption_failed')
    expect(await (await Vault.open(vault.file, 'the-only-new-passphrase')).loadArchive()).toEqual(
      maximalArchiveV1,
    )

    // 旧口令既解不出 DEK，也解不出内容 —— 「换口令只是重新封装」不等于
    // 「旧口令还留着一条旁路」。
    expect(Object.values(vault.file).join('')).not.toContain(PASSPHRASE)
  })

  it('库一旦锁定，换口令这条路也断了（除非重新提供口令）', async () => {
    const vault = await sealedVault()
    vault.lock()

    expect(await rejectionCode(vault.changePassphrase('whatever'))).toBe('vault_locked')
  })
})

describe('备份文件不是一条恢复路径 —— 它只是密文的搬运工', () => {
  it('手上只有 .vault、没有口令：一样打不开', async () => {
    const text = (await sealedVault()).toVaultText()

    // 把备份理解为「另一把钥匙」是常见的误解。它不是 —— 它只是同一个锁
    // 的另一份拷贝。这也正是 README 里「忘记口令数据就没了」那句话的全部含义：
    // 有备份、没口令，仍然等于没有数据。
    expect(await rejectionCode(Vault.open(JSON.parse(text), 'guess-1'))).toBe('decryption_failed')
    expect(await rejectionCode(Vault.open(JSON.parse(text), 'guess-2'))).toBe('decryption_failed')
  })

  it('备份文件里的 base64 无法被识别为「它就是口令」的任何编码', async () => {
    const text = (await sealedVault()).toVaultText()

    // 排掉一类低级的隐蔽后门：把口令（或其编码）直接塞进文件当提示。
    // 编码一律走 libsodium —— core 的 lib 白名单里没有 Buffer / btoa。
    const candidates = [
      PASSPHRASE,
      PASSPHRASE.normalize('NFKC'),
      await bytesToBase64(await utf8ToBytes(PASSPHRASE)),
    ]

    for (const candidate of candidates) {
      expect(text).not.toContain(candidate)
    }
  })
})
