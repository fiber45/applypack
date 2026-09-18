/**
 * AEAD 层断言。
 *
 * 这一层是「别人读不出」的最后一道数学保障，因此断言的重点不是「能加密」，
 * 而是**所有失败的路径都必须显式抛错** —— 篡改密文、篡改 nonce、AAD 不匹配、
 * 密钥长度错误。密码学代码最危险的失败模式是「悄悄返回了半份数据」，
 * 而不是「报错」。
 */
import { describe, expect, it } from 'vitest'

import * as noble from '@noble/ciphers/chacha.js'

import { aeadOpen, aeadSeal, generateDek, randomBytes, utf8ToBytes, type SealedBox } from './index'
import { rejectionCode } from './__fixtures__/crypto-error-probe'
import { bytesToHex, hexToBytes } from './__fixtures__/hex'
import { XCHACHA_VECTORS } from './__fixtures__/xchacha-vectors'

describe('AEAD 往返', () => {
  it('加密后再解密得到原文', async () => {
    const key = await generateDek()
    const plaintext = await utf8ToBytes('算法工程师 · 推荐系统与特征工程')

    const box = await aeadSeal(key, plaintext)
    const opened = await aeadOpen(key, box)

    expect(Array.from(opened)).toEqual(Array.from(plaintext))
  })

  it('空明文也能往返（密文长度为 0，认证标签仍在）', async () => {
    const key = await generateDek()
    const box = await aeadSeal(key, new Uint8Array(0))

    expect(box.ciphertext.length).toBe(16)
    expect((await aeadOpen(key, box)).length).toBe(0)
  })

  it('较大输入（1 MiB）能往返', async () => {
    const key = await generateDek()
    const plaintext = new Uint8Array(1024 * 1024)
    for (let i = 0; i < plaintext.length; i += 1) plaintext[i] = i % 251

    const box = await aeadSeal(key, plaintext)
    const opened = await aeadOpen(key, box)

    expect(opened.length).toBe(plaintext.length)
    expect(opened[plaintext.length - 1]).toBe(plaintext[plaintext.length - 1])
  })

  it('密文长度 = 明文长度 + 16 字节认证标签', async () => {
    const key = await generateDek()
    const box = await aeadSeal(key, new Uint8Array(37))
    expect(box.ciphertext.length).toBe(37 + 16)
  })
})

describe('AEAD nonce 管理', () => {
  it('nonce 长度固定 24 字节（XChaCha20 的 192-bit nonce）', async () => {
    const key = await generateDek()
    const box = await aeadSeal(key, new Uint8Array(1))
    expect(box.nonce.length).toBe(24)
  })

  it('同一密钥下两次加密同一明文，nonce 与密文都不同', async () => {
    const key = await generateDek()
    const plaintext = await utf8ToBytes('同一段明文')

    const first = await aeadSeal(key, plaintext)
    const second = await aeadSeal(key, plaintext)

    expect(Array.from(first.nonce)).not.toEqual(Array.from(second.nonce))
    expect(Array.from(first.ciphertext)).not.toEqual(Array.from(second.ciphertext))
  })
})

describe('AEAD 失败路径必须显式抛错，且不得返回部分数据', () => {
  it('篡改密文任意一字节 → decryption_failed', async () => {
    const key = await generateDek()
    const box = await aeadSeal(key, await utf8ToBytes('不可篡改'))

    for (const index of [0, 5, box.ciphertext.length - 1]) {
      const tampered = new Uint8Array(box.ciphertext)
      tampered[index] = (tampered[index] ?? 0) ^ 0x01

      expect(await rejectionCode(aeadOpen(key, { nonce: box.nonce, ciphertext: tampered }))).toBe(
        'decryption_failed',
      )
    }
  })

  it('篡改 nonce → decryption_failed', async () => {
    const key = await generateDek()
    const box = await aeadSeal(key, await utf8ToBytes('不可篡改'))

    const tamperedNonce = new Uint8Array(box.nonce)
    tamperedNonce[0] = (tamperedNonce[0] ?? 0) ^ 0x01

    expect(await rejectionCode(aeadOpen(key, { nonce: tamperedNonce, ciphertext: box.ciphertext }))).toBe(
      'decryption_failed',
    )
  })

  it('换一把密钥 → decryption_failed', async () => {
    const box = await aeadSeal(await generateDek(), await utf8ToBytes('换钥匙'))
    const opened = rejectionCode(aeadOpen(await generateDek(), box))
    expect(await opened).toBe('decryption_failed')
  })

  it('AAD 不匹配 → decryption_failed；AAD 一致 → 成功', async () => {
    const key = await generateDek()
    const aad = await utf8ToBytes('record:internship-1')
    const box = await aeadSeal(key, await utf8ToBytes('绑定到记录 ID'), aad)

    expect(
      await rejectionCode(aeadOpen(key, box, await utf8ToBytes('record:internship-2'))),
    ).toBe('decryption_failed')

    const opened = await aeadOpen(key, box, aad)
    expect(Array.from(opened)).toEqual(Array.from(await utf8ToBytes('绑定到记录 ID')))
  })

  it('加密时用了 AAD，解密时不传 AAD → decryption_failed（不能降级绕过）', async () => {
    const key = await generateDek()
    const box = await aeadSeal(key, await utf8ToBytes('x'), await utf8ToBytes('绑定'))

    expect(await rejectionCode(aeadOpen(key, box))).toBe('decryption_failed')
  })

  it('密钥长度不对 → invalid_params（在触碰密码学之前就拒绝）', async () => {
    const box = await aeadSeal(await generateDek(), new Uint8Array(1))

    expect(await rejectionCode(aeadSeal(new Uint8Array(16), new Uint8Array(1)))).toBe('invalid_params')
    expect(await rejectionCode(aeadOpen(new Uint8Array(16), box))).toBe('invalid_params')
    expect(await rejectionCode(aeadOpen(new Uint8Array(0), box))).toBe('invalid_params')
  })

  it('nonce 长度不对 → invalid_params', async () => {
    const key = await generateDek()
    const box = await aeadSeal(key, new Uint8Array(1))
    const badNonce: SealedBox = { nonce: new Uint8Array(8), ciphertext: box.ciphertext }

    expect(await rejectionCode(aeadOpen(key, badNonce))).toBe('invalid_params')
  })
})

describe('AEAD 算法身份', () => {
  it('跨实现向量：能解开 libsodium 官方 C 实现产出的密文', async () => {
    // 这一类断言防的是**参数传递顺序**错误 ——
    // libsodium 的 encrypt 与 decrypt 参数顺序不同（decrypt 的 secret_nonce 在最前），
    // 传反了不会崩溃，只会静默算出另一串字节。只有对拍参考实现才发现得了。
    //
    // 注意这里只验证解密方向。`aeadSeal` 刻意**不允许调用方指定 nonce**
    // （见 aead.ts 的说明：nonce 复用对这类算法是致命的，不该把责任交给调用方），
    // 所以「我们加密出的密文与向量一致」这件事在 API 层面不可测 ——
    // 加密方向由下一条 noble 交叉验证覆盖。
    for (const vector of XCHACHA_VECTORS) {
      const opened = await aeadOpen(
        hexToBytes(vector.keyHex),
        { nonce: hexToBytes(vector.nonceHex), ciphertext: hexToBytes(vector.ciphertextHex) },
        hexToBytes(vector.aadHex),
      )
      expect(bytesToHex(opened)).toBe(vector.plaintextHex)
    }
  })

  it('输出格式与参考实现同构：密文长度恒为明文长度 + 16，nonce 恒为 24 字节', async () => {
    for (const vector of XCHACHA_VECTORS) {
      const plaintext = hexToBytes(vector.plaintextHex)
      const box = await aeadSeal(hexToBytes(vector.keyHex), plaintext, hexToBytes(vector.aadHex))

      expect(box.nonce.length).toBe(24)
      expect(box.ciphertext.length).toBe(plaintext.length + 16)
      // 我们自己的密文也应当能被独立实现解开 —— 但 nonce 是随机的，
      // 所以这里只能校验结构，语义上的互解见下一条。
    }
  })

  it('与独立纯 JS 实现（@noble/ciphers）双向互解', async () => {
    // 上一条验证「我们没传错参数」，这一条验证「算法本身是对的」——
    // 两个实现在密码学上没有共享代码路径（C 编译的 wasm vs 纯 JS），
    // 因此任何建构偏差都会让其中一侧解不开。
    const keyBytes = await generateDek()
    const nonce = await randomBytes(24)
    const aad = await utf8ToBytes('applypack/v1/test')
    const plaintext = await utf8ToBytes('cross-implementation check')

    // 方向一：noble 加密 → 我们解密
    const nobleCipher = noble.xchacha20poly1305(keyBytes, nonce, aad).encrypt(plaintext)
    const openedByUs = await aeadOpen(keyBytes, { nonce, ciphertext: nobleCipher }, aad)
    expect(Array.from(openedByUs)).toEqual(Array.from(plaintext))

    // 方向二：我们加密 → noble 解密
    const box = await aeadSeal(keyBytes, plaintext, aad)
    const openedByNoble = noble.xchacha20poly1305(keyBytes, box.nonce, aad).decrypt(box.ciphertext)
    expect(Array.from(openedByNoble)).toEqual(Array.from(plaintext))
  })

  it('AAD 语义不宽松：空 AAD 与缺省 AAD 等价，但一旦有内容就不再匹配', async () => {
    const key = await generateDek()
    const plaintext = await utf8ToBytes('aad semantics')

    const withEmptyAad = await aeadSeal(key, plaintext, new Uint8Array(0))
    const withNothing = await aeadSeal(key, plaintext)

    expect(Array.from(await aeadOpen(key, withEmptyAad))).toEqual(Array.from(plaintext))
    expect(Array.from(await aeadOpen(key, withNothing, new Uint8Array(0)))).toEqual(Array.from(plaintext))

    expect(await rejectionCode(aeadOpen(key, withEmptyAad, await utf8ToBytes('x')))).toBe(
      'decryption_failed',
    )
  })
})
