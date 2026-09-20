/**
 * T8.1 档案编辑器 —— 纯逻辑模型的三条验收。
 *
 * ## 为什么编辑器也要一个纯逻辑模型
 *
 * 「错误状态与已保存状态是两个互斥的状态」这句话如果只活在 JSX 里，
 * 它就是一个渲染纪律；做成判别联合，它就是类型事实 —— `invalid`
 * 分枝**结构上没有 archive 字段**，保存按钮想拿数据都拿不到。
 * （与 T7.2 面板 `locked` 无 preview 是同一个形状，见 TASKS M7 注记。）
 *
 * ## 校验为什么不复写一遍
 *
 * schema 是 core 的严格 zod（未知字段报错），编辑器只做一次接线：
 * 候选对象 → `archiveV1Schema.safeParse`。薪资填「25k」在这里炸，
 * 不等保存密文时炸 —— T5.6 的 round-trip 判据在编辑入口就生效。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  archiveV1Schema,
  serializeArchive,
  type ArchiveV1,
} from '../../../../core/src/schema/index'
import {
  addSectionEntry,
  csvFrom,
  editCandidate,
  linesFrom,
  localizedFrom,
  localizedOf,
  removeSectionEntry,
  saveEditor,
  setBasicsPath,
  setSectionField,
  startEditor,
  type EditorState,
} from './model'

function withCity(archive: ArchiveV1, city: string): ArchiveV1 {
  return {
    ...archive,
    basics: { ...archive.basics, location: { ...archive.basics.location, city } },
  }
}

function sample(): ArchiveV1 {
  // 过一遍 schema：default 字段（identity / profiles 等）在 infer 类型里
  // 是必填 —— 手写对象字面量写不全，parse 替我们补齐且类型正确。
  return archiveV1Schema.parse({
    schemaVersion: 1,
    basics: {
      name: { zh: '张三' },
      location: { city: '成都' },
      contact: { phone: '13800138000', email: 'zhang@example.com' },
    },
  })
}

function asText(state: EditorState): string {
  return state.kind === 'invalid' ? state.issues.join('；') : serializeArchive(state.archive)
}

describe('T8.1 编辑器模型 —— clean / dirty / invalid 三态互斥', () => {
  it('起点即 clean：档案 round-trip 成立', () => {
    const state = startEditor(sample())
    if (state.kind !== 'clean') throw new Error(`应当 clean，实际 ${state.kind}`)
    // round-trip：clean 状态的档案必须能安全落库
    expect(() => serializeArchive(state.archive)).not.toThrow()
  })

  it('合法编辑 → dirty；保存 → 持久化恰一次、状态回到 clean，且保存的就是编辑后的档案', () => {
    const saved = sample()
    let state = startEditor(saved)
    state = editCandidate(saved, withCity(saved, '杭州'))
    expect(state.kind).toBe('dirty')

    const persist = vi.fn<(a: ArchiveV1) => void>()
    const after = saveEditor(state, persist)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0]?.[0]?.basics.location?.city).toBe('杭州')
    expect(after.kind).toBe('clean')
    expect(after.kind === 'clean' ? serializeArchive(after.archive) : '').toBe(
      serializeArchive(withCity(saved, '杭州')),
    )
  })

  it('把编辑改回保存值 → 回到 clean 而不是 dirty（与保存值逐字节比较，不是「有输入就 dirty」）', () => {
    const saved = sample()
    let state = startEditor(saved)
    state = editCandidate(saved, withCity(saved, '杭州'))
    expect(state.kind).toBe('dirty')
    state = editCandidate(saved, withCity(saved, '成都'))
    expect(state.kind).toBe('clean')
  })

  it('薪资「25k」→ invalid：issues 指到 desiredSalary.amount，没有 archive 可取，保存被拒绝', () => {
    const saved = sample()
    const state = editCandidate(saved, {
      ...saved,
      basics: { ...saved.basics, desiredSalary: { amount: '25k' as unknown as number } },
    })
    expect(state.kind).toBe('invalid')
    expect(asText(state)).toMatch(/desiredSalary\.amount/)
    // invalid 分支没有 archive 字段（类型事实）——保存只能从 dirty 发生
    if (state.kind === 'invalid') {
      expect(() => saveEditor(state, vi.fn())).toThrow(/只有 dirty/)
    }
  })

  it('缺 schemaVersion / 冒出未知字段 → invalid（严格模式：编辑器不比 schema 更宽容）', () => {
    const saved = sample()
    const noVersion = { ...saved } as Partial<ArchiveV1>
    delete noVersion.schemaVersion
    expect(editCandidate(saved, noVersion).kind).toBe('invalid')

    const unknownField = { ...saved, mystery: 1 }
    expect(editCandidate(saved, unknownField).kind).toBe('invalid')
  })

  it('clean 状态下保存是 no-op —— 没有变化就没有写盘', () => {
    const saved = sample()
    const persist = vi.fn<(a: ArchiveV1) => void>()
    const after = saveEditor(startEditor(saved), persist)
    expect(persist).not.toHaveBeenCalled()
    expect(after.kind).toBe('clean')
  })
})

describe('全库编辑 —— 分区条目与路径写入的结构算术', () => {
  it('setBasicsPath 深层写入不改输入（结构不可变），清理为 undefined 时键被删除', () => {
    const saved = sample()
    const snapshot = serializeArchive(saved)

    const next = setBasicsPath(saved, 'label.zh', '后端开发')
    expect(next.basics.label?.zh).toBe('后端开发')
    // 输入未被改动 —— 模型层结构不可变是组件「草稿可丢弃」的前提
    expect(serializeArchive(saved)).toBe(snapshot)

    const cleared = setBasicsPath(next, 'label.zh', undefined)
    expect(cleared.basics.label?.zh).toBeUndefined()
    // 序列化后不残留 undefined 键（严格 schema + JSON 序列化口径一致）
    expect(serializeArchive(cleared)).not.toContain('label')
  })

  it('setBasicsPath 自动创建中间对象（紧急联系人三层深）', () => {
    const saved = sample()
    const next = setBasicsPath(setBasicsPath(setBasicsPath(saved, 'emergencyContact.name', '张父'), 'emergencyContact.relation', '父子'), 'emergencyContact.phone', '13900139000')
    expect(next.basics.emergencyContact).toEqual({ name: '张父', relation: '父子', phone: '13900139000' })
  })

  it('addSectionEntry 追加空条目；setSectionField 填上必填项后候选过 schema；removeSectionEntry 删干净', () => {
    const saved = sample()
    const snapshot = serializeArchive(saved)

    const added = addSectionEntry(saved, 'projects')
    expect(added.projects).toHaveLength(1)
    expect(serializeArchive(saved)).toBe(snapshot) // 不改输入

    // 空条目过不了 schema（项目名必填）—— invalid 是新增后的预期状态
    expect(archiveV1Schema.safeParse(added).success).toBe(false)

    const filled = setSectionField(setSectionField(added, 'projects', 0, 'name', { zh: '校园二手交易平台' }), 'projects', 0, 'highlights', ['日活 2000', 'Spring Boot + Redis'])
    const parsed = archiveV1Schema.safeParse(filled)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.projects[0]?.name).toEqual({ zh: '校园二手交易平台' })
      expect(parsed.data.projects[0]?.highlights).toEqual(['日活 2000', 'Spring Boot + Redis'])
    }

    const removed = removeSectionEntry(filled, 'projects', 0)
    expect(removed.projects).toHaveLength(0)
  })

  it('越界下标必须抛错 —— 静默 no-op 会把编辑写到不存在的条目上', () => {
    const saved = sample()
    expect(() => setSectionField(saved, 'work', 0, 'company', 'x')).toThrow(/越界/)
    expect(() => removeSectionEntry(saved, 'education', -1)).toThrow(/越界/)
  })

  it('七个分区都能走 add → fill → parse 通过（覆盖每个分区的必填字段）', () => {
    const required: Record<string, Record<string, unknown>> = {
      work: { company: '某某科技', position: { zh: '后端实习生' } },
      education: { institution: '某某大学' },
      projects: { name: { zh: '项目' } },
      skills: { name: { zh: 'Java' } },
      languages: { language: { zh: '英语' } },
      certificates: { name: { zh: 'CET-6' } },
      awards: { title: { zh: '国奖' } },
    }
    for (const [section, fields] of Object.entries(required)) {
      const name = section as Parameters<typeof addSectionEntry>[1]
      const filled = Object.entries(fields).reduce(
        (acc, [key, value]) => setSectionField(acc, name, 0, key, value),
        addSectionEntry(sample(), name),
      )
      const parsed = archiveV1Schema.safeParse(filled)
      if (!parsed.success) {
        throw new Error(`${section} 填上必填项后仍过不了 schema：${JSON.stringify(parsed.error.issues)}`)
      }
      expect(parsed.data[section as 'work']).toHaveLength(1)
    }
  })

  it('本地化 / 行表 / 关键词的三组草稿换算：空进空出、往返一致', () => {
    expect(localizedOf({ zh: '前端', en: 'Frontend' })).toEqual({ zh: '前端', en: 'Frontend' })
    expect(localizedOf(undefined)).toEqual({ zh: '', en: '' })
    expect(localizedOf({ zh: '前端' })).toEqual({ zh: '前端', en: '' })
    // 双语都空 = 没有这个字段（不是空对象 —— 空对象过不了 localize 的 refine）
    expect(localizedFrom({ zh: '', en: '' })).toBeUndefined()
    expect(localizedFrom({ zh: '前端', en: '' })).toEqual({ zh: '前端' })

    expect(linesFrom('  第一条  \n\n第二条\n')).toEqual(['第一条', '第二条'])
    expect(linesFrom('')).toEqual([])

    expect(csvFrom('Java, Spring Boot , Redis')).toEqual(['Java', 'Spring Boot', 'Redis'])
    expect(csvFrom('')).toEqual([])
  })
})
