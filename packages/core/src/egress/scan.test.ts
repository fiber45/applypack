import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { projectArchiveForLLM } from './project'
import { blockingLeaks, findBLevelPaths, isStrongIdentifier, scanPayload } from './scan'

const ARCHIVE = maximalArchiveV1

describe('深度扫描器', () => {
  it('不含任何 B 级值的载荷 ⇒ 零阻断', () => {
    const clean = projectArchiveForLLM(ARCHIVE)
    expect(blockingLeaks(scanPayload(clean, ARCHIVE))).toEqual([])
  })

  it('逐字泄漏手机号 ⇒ 命中 value_verbatim 且指向 basics.contact.phone', () => {
    const leaks = blockingLeaks(scanPayload({ body: '联系方式 +8613800138000' }, ARCHIVE))
    expect(leaks.map((leak) => leak.source)).toContain('basics.contact.phone')
    expect(leaks.find((leak) => leak.source === 'basics.contact.phone')?.kind).toBe('value_verbatim')
  })

  it('分隔符变形（+86 138 0013 8000）⇒ 命中 value_normalized', () => {
    const leaks = blockingLeaks(scanPayload({ body: '+86 138 0013 8000' }, ARCHIVE))
    const hit = leaks.find((leak) => leak.source === 'basics.contact.phone')
    expect(hit?.kind).toBe('value_normalized')
  })

  it('身份证号 ⇒ 阻断', () => {
    const leaks = blockingLeaks(scanPayload({ body: '330106200205140011' }, ARCHIVE))
    expect(leaks.some((leak) => leak.source === 'basics.identity.idNumber')).toBe(true)
  })

  it('邮箱 ⇒ 阻断（含 @ 视为强标识符）', () => {
    const leaks = blockingLeaks(scanPayload({ body: 'linzhiyuan@example.com' }, ARCHIVE))
    expect(leaks.some((leak) => leak.source === 'basics.contact.email')).toBe(true)
  })

  it('住址 ⇒ 阻断（含中文与数字）', () => {
    const leaks = blockingLeaks(scanPayload({ body: '浙江省杭州市西湖区某路 1 号' }, ARCHIVE))
    expect(leaks.some((leak) => leak.source === 'basics.location.address')).toBe(true)
  })

  it('纯 ASCII 词（GitHub / 用户名）只进 advisory，不进阻断集', () => {
    const leaks = scanPayload({ body: 'linzhiyuan is my handle' }, ARCHIVE)
    expect(blockingLeaks(leaks)).toEqual([])
    expect(leaks.some((leak) => leak.severity === 'advisory')).toBe(true)
  })

  it('过短的值（性别 "男"、驾照 "C1"）根本不参与扫描', () => {
    const leaks = scanPayload({ body: '男 C1 未婚' }, ARCHIVE)
    expect(leaks.some((leak) => leak.source === 'basics.identity.gender')).toBe(false)
    expect(leaks.some((leak) => leak.source === 'customFields.drivingLicense')).toBe(false)
  })

  it('阻断项的 preview 不包含完整 B 级值 —— 错误消息本身不能成为泄漏点', () => {
    const leaks = blockingLeaks(scanPayload({ body: '+8613800138000' }, ARCHIVE))
    const phone = leaks.find((leak) => leak.source === 'basics.contact.phone')
    expect(phone).toBeDefined()
    expect(phone?.preview).not.toContain('8613800138000')
    expect(phone?.preview).not.toContain('13800138000')
    expect(phone?.preview.length).toBeLessThan(30)
  })

  it('无法序列化的载荷视为不构成泄漏，不抛错', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(scanPayload(cyclic, ARCHIVE)).toEqual([])
  })

  it('源对象为空 ⇒ 无可扫描的值', () => {
    expect(scanPayload({ body: '+8613800138000' }, {})).toEqual([])
  })

  it('findBLevelPaths 能看穿完整的 B 级子树', () => {
    expect(findBLevelPaths(ARCHIVE)).toContain('basics.contact.phone')
    expect(findBLevelPaths(ARCHIVE)).toContain('basics.identity.idNumber')
    expect(findBLevelPaths(ARCHIVE)).toContain('customFields.drivingLicense')
  })

  it('强标识符判据本身可被断言 —— 它是阻断与提示唯一的分界', () => {
    expect(isStrongIdentifier('+8613800138000')).toBe(true)
    expect(isStrongIdentifier('linzhiyuan@example.com')).toBe(true)
    expect(isStrongIdentifier('浙江省杭州市')).toBe(true)
    expect(isStrongIdentifier('GitHub')).toBe(false)
    expect(isStrongIdentifier('linzhiyuan')).toBe(false)
  })
})
