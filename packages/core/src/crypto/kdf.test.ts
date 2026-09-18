/**
 * KDF（Argon2id）层断言。
 *
 * 两个重点：
 *   1. **跨实现向量** —— 证明我们的参数理解与输出编码和官方 C 实现一致。
 *      这件事错了不会报错，只会让用户「口令明明对却打不开」，所以必须测。
 *   2. **参数是安全边界** —— 信封里的 KDF 参数来自外部文件（用户导入的 `.vault`），
 *      因此必须当作不可信输入校验，否则一个 m=4 GiB 的信封就能把浏览器拖死。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_KDF_PARAMS,
  KDF_SALT_BYTES,
  KEY_BYTES,
  MAX_KDF_ITERATIONS,
  MAX_KDF_MEMORY_KIB,
  MAX_KDF_PARALLELISM,
  deriveKek,
} from './index'
import { ARGON2ID_VECTORS } from './__fixtures__/argon2-vectors'
import { rejectionCode } from './__fixtures__/crypto-error-probe'
import { bytesToHex, hexToBytes } from './__fixtures__/hex'

const salt16 = (fill: number): Uint8Array => new Uint8Array(KDF_SALT_BYTES).fill(fill)

describe('Argon2id 跨实现测试向量（对照官方 C 实现）', () => {
  for (const vector of ARGON2ID_VECTORS) {
    it(`${vector.name} → 与参考实现逐字节一致`, async () => {
      const kek = await deriveKek(vector.passphrase, hexToBytes(vector.saltHex), {
        algorithm: 'argon2id',
        memoryKiB: vector.memoryKiB,
        iterations: vector.iterations,
        parallelism: vector.parallelism,
        keyLength: vector.keyLength,
      })

      expect(kek.length).toBe(vector.keyLength)
      expect(bytesToHex(kek)).toBe(vector.kekHex)
    })
  }
})

describe('KDF 的决定性与敏感性', () => {
  const params = { algorithm: 'argon2id', memoryKiB: 1024, iterations: 2, parallelism: 1, keyLength: 32 } as const

  it('同一口令 + 同一盐 + 同一参数 → 逐字节相同（可复现）', async () => {
    const first = await deriveKek('same input', salt16(0), params)
    const second = await deriveKek('same input', salt16(0), params)
    expect(bytesToHex(first)).toBe(bytesToHex(second))
  })

  it('口令差一个字符 → 输出完全不同（雪崩）', async () => {
    const a = await deriveKek('passphrase-a', salt16(0), params)
    const b = await deriveKek('passphrase-b', salt16(0), params)

    expect(a.length).toBe(b.length)
    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })

  it('盐不同 → 输出不同（同口令也不能复用密钥）', async () => {
    const a = await deriveKek('same', salt16(0), params)
    const b = await deriveKek('same', salt16(1), params)
    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })

  it('内存 / 迭代 / 并行度 任一变化 → 输出不同', async () => {
    const base = await deriveKek('same', salt16(0), params)
    const baseHex = bytesToHex(base)

    const moreMemory = await deriveKek('same', salt16(0), { ...params, memoryKiB: 2048 })
    const moreIterations = await deriveKek('same', salt16(0), { ...params, iterations: 3 })
    const moreParallelism = await deriveKek('same', salt16(0), { ...params, memoryKiB: 2048, parallelism: 2 })

    expect(bytesToHex(moreMemory)).not.toBe(baseHex)
    expect(bytesToHex(moreIterations)).not.toBe(baseHex)
    expect(bytesToHex(moreParallelism)).not.toBe(baseHex)
  })

  it('每次返回新的 Uint8Array —— 调用方改坏它不会污染后续推导', async () => {
    const first = await deriveKek('same', salt16(0), params)
    first.fill(0)
    const second = await deriveKek('same', salt16(0), params)

    expect(bytesToHex(second)).not.toBe('00'.repeat(KEY_BYTES))
  })
})

describe('口令归一化', () => {
  it('NFKC 归一化：全角与半角输入视为同一口令', async () => {
    // 中文用户在用输入法时很容易打出全角字符，若不归一化，换个设备/输入法
    // 就会「口令记对了但打不开」。归一化把这个陷阱消掉。
    const salt = salt16(7)
    const fullWidth = await deriveKek('ＡＢＣ１２３', salt)
    const halfWidth = await deriveKek('ABC123', salt)

    expect(bytesToHex(fullWidth)).toBe(bytesToHex(halfWidth))
  })
})

describe('生产参数的形状被固定（改参数必须显式改断言）', () => {
  it('DEFAULT_KDF_PARAMS 精确等于约定值', () => {
    // 这不是「测试实现」，而是让**参数变成一条需要解释才能改动的契约**：
    // 想让 KDF 变弱或变强，都必须同时改掉这条断言，也就必然在 review 里说出来。
    expect(DEFAULT_KDF_PARAMS).toEqual({
      algorithm: 'argon2id',
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
      keyLength: 32,
    })
  })

  it('默认参数确实能跑出 32 字节密钥（含向量里那一组）', async () => {
    const kek = await deriveKek('fiber45', salt16(9))
    expect(kek.length).toBe(KEY_BYTES)
  })
})

describe('参数校验：非法输入必须在触碰密码学之前被拒绝', () => {
  const good = { algorithm: 'argon2id', memoryKiB: 1024, iterations: 2, parallelism: 1, keyLength: 32 } as const

  it('空口令被拒绝', async () => {
    expect(await rejectionCode(deriveKek('', salt16(0), good))).toBe('invalid_params')
  })

  it('盐长度不等于 16 字节被拒绝', async () => {
    for (const length of [0, 8, 15, 17, 32]) {
      const salt = new Uint8Array(length)
      expect(await rejectionCode(deriveKek('pw', salt, good))).toBe('invalid_params')
    }
  })

  it('iterations / parallelism 必须 ≥ 1', async () => {
    expect(await rejectionCode(deriveKek('pw', salt16(0), { ...good, iterations: 0 }))).toBe('invalid_params')
    expect(await rejectionCode(deriveKek('pw', salt16(0), { ...good, parallelism: 0 }))).toBe('invalid_params')
  })

  it('内存低于 8 × 并行度（Argon2 规范下限）被拒绝', async () => {
    expect(
      await rejectionCode(deriveKek('pw', salt16(0), { ...good, memoryKiB: 15, parallelism: 2 })),
    ).toBe('invalid_params')
  })

  it('keyLength 不是 32 被拒绝（本层只服务 AES-256）', async () => {
    for (const keyLength of [16, 24, 31, 33, 64]) {
      expect(await rejectionCode(deriveKek('pw', salt16(0), { ...good, keyLength }))).toBe('invalid_params')
    }
  })

  it('算法名不是 argon2id 被拒绝', async () => {
    const bad = { ...good, algorithm: 'argon2i' } as unknown as typeof good
    expect(await rejectionCode(deriveKek('pw', salt16(0), bad))).toBe('invalid_params')
  })
})

describe('参数上限：信封里的参数来自外部文件，必须按不可信输入对待', () => {
  const good = { algorithm: 'argon2id', memoryKiB: 1024, iterations: 2, parallelism: 1, keyLength: 32 } as const

  it('内存超过上限 → invalid_params（否则一个恶意 .vault 就能耗尽内存）', async () => {
    expect(
      await rejectionCode(deriveKek('pw', salt16(0), { ...good, memoryKiB: MAX_KDF_MEMORY_KIB + 1 })),
    ).toBe('invalid_params')
  })

  it('迭代次数超过上限 → invalid_params（否则可以把解锁拖成分钟级）', async () => {
    expect(
      await rejectionCode(deriveKek('pw', salt16(0), { ...good, iterations: MAX_KDF_ITERATIONS + 1 })),
    ).toBe('invalid_params')
  })

  it('并行度超过上限 → invalid_params', async () => {
    const memoryKiB = 8 * (MAX_KDF_PARALLELISM + 1)
    expect(
      await rejectionCode(
        deriveKek('pw', salt16(0), { ...good, memoryKiB, parallelism: MAX_KDF_PARALLELISM + 1 }),
      ),
    ).toBe('invalid_params')
  })

  it('非整数 / 非有限数被拒绝', async () => {
    for (const memoryKiB of [1024.5, Number.NaN, Number.POSITIVE_INFINITY, -1024]) {
      expect(await rejectionCode(deriveKek('pw', salt16(0), { ...good, memoryKiB }))).toBe('invalid_params')
    }
    expect(
      await rejectionCode(deriveKek('pw', salt16(0), { ...good, iterations: Number.NaN })),
    ).toBe('invalid_params')
  })
})
