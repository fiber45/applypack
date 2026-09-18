import { describe, expect, it } from 'vitest'

import { archiveV1Schema, emptyArchiveV1 } from './archive'
import { ArchiveDecodeError, deserializeArchive, serializeArchive } from './codec'
import { maximalArchiveV1 } from './__fixtures__/maximal-archive'

describe('v1 档案 · 序列化与反序列化', () => {
  it('填满全部字段的档案通过校验', () => {
    expect(() => archiveV1Schema.parse(maximalArchiveV1)).not.toThrow()
  })

  it('序列化 → 反序列化深相等', () => {
    const restored = deserializeArchive(serializeArchive(maximalArchiveV1))
    expect(restored).toEqual(maximalArchiveV1)
  })

  it('序列化是稳定的：同一输入产生完全相同的字符串', () => {
    expect(serializeArchive(maximalArchiveV1)).toBe(serializeArchive(maximalArchiveV1))
  })

  it('序列化结果里不含 undefined 字段（否则往返会掉数据）', () => {
    const json = serializeArchive(maximalArchiveV1)
    expect(json).not.toContain('undefined')
    expect(JSON.parse(json)).toEqual(maximalArchiveV1)
  })

  it('空档案通过校验，且往返深相等', () => {
    const empty = emptyArchiveV1()
    expect(() => archiveV1Schema.parse(empty)).not.toThrow()
    expect(deserializeArchive(serializeArchive(empty))).toEqual(empty)
  })

  it('解析必须幂等 —— 否则「解析结果再解析」会走样，往返也就不可信了', () => {
    const samples: readonly unknown[] = [
      maximalArchiveV1,
      emptyArchiveV1(),
      { schemaVersion: 1, basics: {} },
      { schemaVersion: 1, basics: {}, work: [{ company: '某公司', position: { zh: '实习生' } }] },
      { schemaVersion: 1, basics: { name: { zh: '某某' }, contact: { phone: '13800138000' } } },
    ]
    for (const sample of samples) {
      const once = archiveV1Schema.parse(sample)
      expect(archiveV1Schema.parse(once), `解析不幂等：${JSON.stringify(sample)}`).toEqual(once)
    }
  })

  it('反序列化不修改传入的字符串内容之外的东西（输出与输入无引用共享）', () => {
    const restored = deserializeArchive(serializeArchive(maximalArchiveV1))
    expect(restored).not.toBe(maximalArchiveV1)
    expect(restored.basics).not.toBe(maximalArchiveV1.basics)
    restored.basics.contact.phone = '+8600000000000'
    expect(maximalArchiveV1.basics.contact.phone).toBe('+8613800138000')
  })
})

describe('v1 档案 · 解码失败必须是显式错误，不得静默降级', () => {
  it('非法 JSON 抛 ArchiveDecodeError', () => {
    expect(() => deserializeArchive('{ not json')).toThrow(ArchiveDecodeError)
  })

  it('缺少 schemaVersion 抛 ArchiveDecodeError', () => {
    const withoutVersion: Record<string, unknown> = { ...maximalArchiveV1 }
    delete withoutVersion['schemaVersion']
    expect(() => deserializeArchive(JSON.stringify(withoutVersion))).toThrow(ArchiveDecodeError)
  })

  it('schemaVersion 非 1 抛 ArchiveDecodeError', () => {
    expect(() => deserializeArchive(JSON.stringify({ ...maximalArchiveV1, schemaVersion: 2 }))).toThrow(
      ArchiveDecodeError,
    )
  })

  it('顶层出现未知字段抛错 —— 严格模式，不允许绕过分级的新字段悄悄混进来', () => {
    const polluted = { ...maximalArchiveV1, secretField: '不应该存在' }
    expect(() => deserializeArchive(JSON.stringify(polluted))).toThrow(ArchiveDecodeError)
  })

  it('嵌套层级出现未知字段同样抛错', () => {
    const polluted = {
      ...maximalArchiveV1,
      basics: {
        ...maximalArchiveV1.basics,
        contact: { ...maximalArchiveV1.basics.contact, unknownWay: '13900000000' },
      },
    }
    expect(() => deserializeArchive(JSON.stringify(polluted))).toThrow(ArchiveDecodeError)
  })

  it('customFields 是唯一的开放槽位，任意键值都合法', () => {
    const withCustom = {
      ...maximalArchiveV1,
      customFields: { 任何键: { 嵌套: ['都可以'] } },
    }
    expect(() => archiveV1Schema.parse(withCustom)).not.toThrow()
  })
})

describe('v1 档案 · 局部结构约束', () => {
  it('LocalizedString 至少要有一种语言', () => {
    const invalid = {
      ...maximalArchiveV1,
      basics: { ...maximalArchiveV1.basics, label: {} },
    }
    expect(() => archiveV1Schema.parse(invalid)).toThrow()
  })

  it('LocalizedString 允许只有中文（迁移后的常见状态，en 由缺口闭环补齐）', () => {
    const zhOnly = {
      ...maximalArchiveV1,
      basics: { ...maximalArchiveV1.basics, label: { zh: '算法工程师' } },
    }
    expect(() => archiveV1Schema.parse(zhOnly)).not.toThrow()
  })

  it('highlights 是字符串数组，不接受对象', () => {
    const invalid = {
      ...maximalArchiveV1,
      work: [{ ...maximalArchiveV1.work[0], highlights: [{ text: '不该是对象' }] }],
    }
    expect(() => archiveV1Schema.parse(invalid)).toThrow()
  })
})
