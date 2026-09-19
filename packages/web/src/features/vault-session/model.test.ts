// @vitest-environment node
/**
 * T8.2 vault 会话 —— 浏览器里的解锁 / 锁定 / 保存 / 密文导入导出。
 *
 * ## 为什么这个文件跑 node 而不是本包默认的 jsdom
 *
 * 本模型零 DOM。jsdom 环境是**另一个 JS realm**：libsodium 在 node realm
 * 里加载，`instanceof Uint8Array` 对 jsdom realm 产出的数组返回 false，
 * 加密原语会以「unsupported input type」拒绝合法参数（调试实录）。
 * 浏览器里不存在这个问题（单一 realm），所以这是**测试环境的假象**
 * 而不是实现缺陷 —— 按 core 的同一惯例（node 环境钉零 DOM），
 * 纯逻辑模型在 node 里验，DOM 渲染留给组件测试的 jsdom。
 *
 * ## 与 T7.2 扩展面板同构，不发明第二种解锁语义
 *
 * 扩展端的 `UnlockArchive` 接缝约定「口令进、档案出、口令错 null」；
 * Web 端这里同样只有口令一条解锁路，错口令落在 `unlock-failed`
 * 分支 —— **该分支结构上没有 `vault` 也没有 `archive` 字段**，
 * 「错口令后档案不出现在界面上」因此是类型事实，不是渲染纪律。
 *
 * ## 密文可以展示、明文必须解锁
 *
 * `exportVaultText` 在锁定态也可用 —— 密文本来就是给磁盘和网络看的
 * （core vault 的注释原文）。断言钉住另一面：导出文本里**找不到
 * 任何档案明文**（城市、手机号）。
 */

import { describe, expect, it } from 'vitest'

import { archiveV1Schema, serializeArchive, type ArchiveV1 } from '../../../../core/src/schema/index'
import type { EncryptedEnvelope } from '../../../../core/src/crypto/index'
import {
  createSession,
  exportVaultText,
  importVaultText,
  lockSession,
  openSession,
  persistToVault,
} from './model'

function sample(): ArchiveV1 {
  return archiveV1Schema.parse({
    schemaVersion: 1,
    basics: {
      name: { zh: '张三' },
      location: { city: '成都' },
      contact: { phone: '13800138000', email: 'zhang@example.com' },
    },
  })
}

function withCity(archive: ArchiveV1, city: string): ArchiveV1 {
  return {
    ...archive,
    basics: { ...archive.basics, location: { ...archive.basics.location, city } },
  }
}

describe('T8.2 vault 会话 —— 解锁 / 锁定 / 保存 / 密文文件', () => {
  it('新建库即解锁态：loadArchive 读回的与存入的逐字节一致', async () => {
    const session = await createSession('口令-测试-1234', sample())
    expect(session.kind).toBe('unlocked')
    const loaded = await session.vault.loadArchive()
    expect(serializeArchive(loaded)).toBe(serializeArchive(sample()))
  })

  it('锁定 → 正确口令重开 → 同一档案；错口令 → unlock-failed，分支上没有 vault / archive 字段', async () => {
    const opened = await createSession('正确口令', sample())
    const locked = lockSession(opened)
    expect(locked.kind).toBe('locked')

    const again = await openSession(locked.file, '正确口令')
    expect(again.kind).toBe('unlocked')
    if (again.kind === 'unlocked') {
      expect(serializeArchive(again.archive)).toBe(serializeArchive(sample()))
    }

    const failed = await openSession(locked.file, '错误口令')
    expect(failed.kind).toBe('unlock-failed')
    // 类型事实的可执行化：失败分支不携带任何明文通道
    if (failed.kind === 'unlock-failed') {
      expect('vault' in failed).toBe(false)
      expect('archive' in failed).toBe(false)
    }
  })

  it('保存 = saveArchive：解锁态保存后 loadArchive 读到新值；锁定态传进来直接抛', async () => {
    const session = await createSession('口令-测试-1234', sample())
    const persisted = await persistToVault(session, withCity(sample(), '杭州'))
    expect(serializeArchive(persisted.archive)).toBe(serializeArchive(withCity(sample(), '杭州')))
    const loaded = await persisted.vault.loadArchive()
    expect(loaded.basics.location?.city).toBe('杭州')

    const locked = lockSession(session)
    await expect(persistToVault(locked, withCity(sample(), '杭州'))).rejects.toThrow(/只有 unlocked/)
  })

  it('导出文本在解锁态可用、且不含任何档案明文；导入重开 round-trip 成立', async () => {
    const session = await createSession('口令-测试-1234', sample())
    const text = exportVaultText(session)
    expect(typeof text).toBe('string')
    expect(text).not.toContain('成都')
    expect(text).not.toContain('13800138000')
    expect(text).not.toContain('zhang@example.com')

    const locked = importVaultText(text)
    expect(locked.kind).toBe('locked')
    const reopened = await openSession((locked as { file: EncryptedEnvelope }).file, '口令-测试-1234')
    expect(reopened.kind).toBe('unlocked')
    if (reopened.kind === 'unlocked') {
      expect(serializeArchive(reopened.archive)).toBe(serializeArchive(sample()))
    }
  })

  it('导入非法文本 → 抛错，不产出任何会话状态', () => {
    expect(() => importVaultText('这不是密文')).toThrow()
    expect(() => importVaultText('{"format":"别的格式"}')).toThrow()
  })
})
