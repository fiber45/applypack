/**
 * 加密信封（`.vault` 的单条记录）断言。
 *
 * 信封是**要落盘、要发给别人、还会被人拿文本编辑器打开**的东西，
 * 因此它同时是安全边界和不可信输入：
 *   - 往内看：整份信封序列化后不得出现任何明文（这是「别人读不出」的直接证据）
 *   - 往外看：导入的信封可能被改过，头部字段（盐、KDF 参数）必须被认证保护
 */
import { describe, expect, it } from 'vitest'

import {
  CryptoError,
  base64ToBytes,
  bytesToBase64,
  openArchive,
  sealArchive,
  utf8ToBytes,
  type EncryptedEnvelope,
} from './index'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { emptyArchiveV1 } from '../schema/index'
import { rejectionCode } from './__fixtures__/crypto-error-probe'

/** 信封里出现的全部可读字符串，用于「不得含明文」的扫描。 */
function readableStringsOf(envelope: EncryptedEnvelope): string {
  return JSON.stringify(envelope)
}

describe('信封往返', () => {
  it('填满全部字段的档案：加密后再解密，深相等', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'correct horse battery staple')
    const opened = await openArchive(envelope, 'correct horse battery staple')

    expect(opened).toEqual(maximalArchiveV1)
  })

  it('空档案也能往返', async () => {
    const empty = emptyArchiveV1()
    const envelope = await sealArchive(empty, 'pw-12345678')
    expect(await openArchive(envelope, 'pw-12345678')).toEqual(empty)
  })

  it('经 JSON 序列化再解析后仍能解密（信封是纯 JSON，可落盘）', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')
    const roundTripped = JSON.parse(JSON.stringify(envelope)) as unknown

    expect(await openArchive(roundTripped, 'pw-12345678')).toEqual(maximalArchiveV1)
  })

  it('信封携带自己的 KDF 参数与盐 —— 解密方不需要任何外部配置', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')

    expect(envelope.format).toBe('applypack-vault')
    expect(envelope.version).toBe(1)
    expect(envelope.cipher.algorithm).toBe('XChaCha20-Poly1305')
    expect(envelope.kdf.algorithm).toBe('argon2id')
    expect(envelope.kdf.salt.length).toBeGreaterThan(0)
    expect(envelope.kdf.memoryKiB).toBeGreaterThan(0)
  })
})

describe('信封不含任何明文', () => {
  it('序列化后的信封里找不到档案中的任何一个可识别串', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')
    const serialized = readableStringsOf(envelope)

    const secrets = [
      '林知远',
      'Lin Zhiyuan',
      '算法工程师',
      '330106200205140011',
      '+8613800138000',
      'linzhiyuan@example.com',
      'linzhiyuan_dev',
      '浙江省杭州市西湖区某路 1 号',
      '推荐系统',
      '某某大学',
    ]

    for (const secret of secrets) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('密文长度只比明文长 16 字节认证标签 —— 不额外泄漏结构信息', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')
    const payloadBytes = (await base64ToBytes(envelope.payload.ciphertext)).length
    const plaintextBytes = (await utf8ToBytes(JSON.stringify(maximalArchiveV1))).length

    expect(payloadBytes).toBe(plaintextBytes + 16)
  })
})

describe('每次加密都独立随机', () => {
  it('同一档案 + 同一口令，两次加密的盐、被封装密钥与密文全不相同', async () => {
    const first = await sealArchive(maximalArchiveV1, 'pw-12345678')
    const second = await sealArchive(maximalArchiveV1, 'pw-12345678')

    expect(first.kdf.salt).not.toBe(second.kdf.salt)
    expect(first.wrappedKey.ciphertext).not.toBe(second.wrappedKey.ciphertext)
    expect(first.payload.ciphertext).not.toBe(second.payload.ciphertext)
    expect(first.payload.nonce).not.toBe(second.payload.nonce)
  })
})

describe('错误口令：必须抛错，且绝不返回部分数据', () => {
  it('错误口令 → decryption_failed', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'correct-passphrase')
    expect(await rejectionCode(openArchive(envelope, 'wrong-passphrase'))).toBe('decryption_failed')
  })

  it('口令差一个字符也打不开（不存在「部分匹配」）', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'abcdefgh')
    expect(await rejectionCode(openArchive(envelope, 'abcdefgi'))).toBe('decryption_failed')
  })

  it('失败时 promise 从未 resolve —— 调用方拿不到任何对象', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'correct-passphrase')

    // 哨兵：只有 openArchive 真的 resolve 了才会被覆盖。
    // 「不得返回部分数据」在这里落成一条可执行的断言，而不是注释里的承诺。
    let leaked: unknown = 'NEVER_RESOLVED'
    await expect(
      openArchive(envelope, 'wrong-passphrase').then((value) => {
        leaked = value
      }),
    ).rejects.toThrow(CryptoError)

    expect(leaked).toBe('NEVER_RESOLVED')
  })
})

describe('信封是不可信输入：头部被认证保护', () => {
  const seal = (): Promise<EncryptedEnvelope> => sealArchive(maximalArchiveV1, 'pw-12345678')

  it('篡改 payload 密文 → decryption_failed', async () => {
    const envelope = await seal()
    const bytes = await base64ToBytes(envelope.payload.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 0xff

    const tampered = {
      ...envelope,
      payload: { ...envelope.payload, ciphertext: await bytesToBase64(bytes) },
    }
    expect(await rejectionCode(openArchive(tampered, 'pw-12345678'))).toBe('decryption_failed')
  })

  it('篡改被封装的数据密钥 → decryption_failed', async () => {
    const envelope = await seal()
    const bytes = await base64ToBytes(envelope.wrappedKey.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 0xff

    const tampered = {
      ...envelope,
      wrappedKey: { ...envelope.wrappedKey, ciphertext: await bytesToBase64(bytes) },
    }
    expect(await rejectionCode(openArchive(tampered, 'pw-12345678'))).toBe('decryption_failed')
  })

  it('篡改盐 / KDF 参数 / payload nonce 都会导致失败（头部不是可改的元数据）', async () => {
    const envelope = await seal()

    const otherSalt = await base64ToBytes(envelope.kdf.salt)
    otherSalt[0] = (otherSalt[0] ?? 0) ^ 0x01

    const variants: EncryptedEnvelope[] = [
      { ...envelope, kdf: { ...envelope.kdf, salt: await bytesToBase64(otherSalt) } },
      { ...envelope, kdf: { ...envelope.kdf, memoryKiB: envelope.kdf.memoryKiB * 2 } },
      { ...envelope, kdf: { ...envelope.kdf, iterations: envelope.kdf.iterations + 1 } },
      { ...envelope, payload: { ...envelope.payload, nonce: await bytesToBase64(new Uint8Array(24)) } },
    ]

    for (const variant of variants) {
      expect(await rejectionCode(openArchive(variant, 'pw-12345678'))).toBe('decryption_failed')
    }
  })

  it('把某条记录的密文搬到另一条记录的头部上（换头攻击）→ 失败', async () => {
    // 两个信封有各自的盐与参数，交叉拼接后 KEK 不同，必然失败。
    const a = await sealArchive(maximalArchiveV1, 'pw-12345678')
    const b = await sealArchive(maximalArchiveV1, 'pw-12345678')
    const swapped: EncryptedEnvelope = { ...a, kdf: b.kdf, wrappedKey: b.wrappedKey }

    expect(await rejectionCode(openArchive(swapped, 'pw-12345678'))).toBe('decryption_failed')
  })
})

describe('格式校验：结构不合法要给出明确错误，而不是神秘崩溃', () => {
  it('不是对象 → malformed_envelope', async () => {
    for (const bad of [null, undefined, 42, 'string', [], true]) {
      expect(await rejectionCode(openArchive(bad, 'pw'))).toBe('malformed_envelope')
    }
  })

  it('format 标识不对 → malformed_envelope', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')
    expect(await rejectionCode(openArchive({ ...envelope, format: 'other-vault' }, 'pw'))).toBe(
      'malformed_envelope',
    )
  })

  it('未知版本 → unsupported_version（与结构错误区分开）', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')
    expect(await rejectionCode(openArchive({ ...envelope, version: 99 }, 'pw'))).toBe('unsupported_version')
  })

  it('缺少必要字段 → malformed_envelope', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')
    const withoutPayload: Record<string, unknown> = {
      format: envelope.format,
      version: envelope.version,
      kdf: envelope.kdf,
      cipher: envelope.cipher,
      wrappedKey: envelope.wrappedKey,
    }

    expect(await rejectionCode(openArchive(withoutPayload, 'pw'))).toBe('malformed_envelope')
    expect(await rejectionCode(openArchive({ ...envelope, cipher: {} }, 'pw'))).toBe('malformed_envelope')
  })

  it('cipher 算法不认识 → unsupported_algorithm（区分于结构错误，也不静默换算法）', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')
    expect(
      await rejectionCode(openArchive({ ...envelope, cipher: { algorithm: 'AES-256-GCM' } }, 'pw')),
    ).toBe('unsupported_algorithm')
  })

  it('信封里的 KDF 参数超出上限 → invalid_params（恶意文件不能拖死浏览器）', async () => {
    const envelope = await sealArchive(maximalArchiveV1, 'pw-12345678')
    const huge = { ...envelope, kdf: { ...envelope.kdf, memoryKiB: 8 * 1024 * 1024 } }

    expect(await rejectionCode(openArchive(huge, 'pw-12345678'))).toBe('invalid_params')
  })
})
