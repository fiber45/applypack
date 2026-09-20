/**
 * T9.2a —— 粘贴信封解锁的纯模型。
 *
 * 「密文副本通道」的拍板方案是**粘贴信封**：Web 端复制 `toVaultText()`，
 * 网申页面粘贴 + 输口令，在本页内存里解锁 —— 零权限承诺不破。
 *
 * 本模块是这条链的**纯逻辑层**（node 可测，不碰 DOM）：
 * 信封文本 + 口令 → 档案；任何一环失败（不是 JSON / 不是合法信封 /
 * 口令错）都返回 `null` —— 与面板的 `UnlockArchive` 接缝（口令错返回
 * null，不区分错误种类）同一种语言。错误分类是 vault 层的事（T1.5），
 * 这里不做：UI 只需要「成 / 不成」两种结局。
 */
import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../../../core/src/schema/__fixtures__/maximal-archive'
import { WEB_PASSPHRASE, createWebVault } from '../vault/__fixtures__/harness'

import { unlockFromEnvelopeText } from './envelope-unlock'

describe('unlockFromEnvelopeText：信封文本 + 口令 → 档案', () => {
  it('Web 端 vault 的 toVaultText 粘贴过来，口令正确 → 档案与信封逐字段相等', async () => {
    const web = await createWebVault(maximalArchiveV1)
    const result = await unlockFromEnvelopeText(web.toVaultText(), WEB_PASSPHRASE)

    expect(result).not.toBeNull()
    expect(result?.archive).toEqual(maximalArchiveV1)
  })

  it('口令错 → null（不抛 —— 面板接缝的语言）', async () => {
    const web = await createWebVault(maximalArchiveV1)
    await expect(
      unlockFromEnvelopeText(web.toVaultText(), 'wrong-passphrase'),
    ).resolves.toBeNull()
  })

  it('不是 JSON → null；是 JSON 但不是信封 → null；空串 → null', async () => {
    await expect(unlockFromEnvelopeText('not json {{', WEB_PASSPHRASE)).resolves.toBeNull()
    await expect(unlockFromEnvelopeText('{"foo": 1}', WEB_PASSPHRASE)).resolves.toBeNull()
    await expect(unlockFromEnvelopeText('', WEB_PASSPHRASE)).resolves.toBeNull()
  })

  it('同一信封解锁出的 vault 能继续 saveArchive —— 回填写回走的是同一个库', async () => {
    const web = await createWebVault(maximalArchiveV1)
    const result = await unlockFromEnvelopeText(web.toVaultText(), WEB_PASSPHRASE)
    if (result === null) throw new Error('应当解锁成功')

    await result.vault.saveArchive(maximalArchiveV1)
    // saveArchive 后信封文本刷新（DEK 不动，payload 重封）—— 这是
    // submit-released 后「复制更新后的信封回 Web 端」的数据来源。
    expect(result.vault.toVaultText()).not.toBeNull()
  })
})
