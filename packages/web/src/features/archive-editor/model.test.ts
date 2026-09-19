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
import { editCandidate, saveEditor, startEditor, type EditorState } from './model'

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
    state = editCandidate(state, saved, withCity(saved, '杭州'))
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
    state = editCandidate(state, saved, withCity(saved, '杭州'))
    expect(state.kind).toBe('dirty')
    state = editCandidate(state, saved, withCity(saved, '成都'))
    expect(state.kind).toBe('clean')
  })

  it('薪资「25k」→ invalid：issues 指到 desiredSalary.amount，没有 archive 可取，保存被拒绝', () => {
    const saved = sample()
    const state = editCandidate(startEditor(saved), saved, {
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
    expect(editCandidate(startEditor(saved), saved, noVersion).kind).toBe('invalid')

    const unknownField = { ...saved, mystery: 1 }
    expect(editCandidate(startEditor(saved), saved, unknownField).kind).toBe('invalid')
  })

  it('clean 状态下保存是 no-op —— 没有变化就没有写盘', () => {
    const saved = sample()
    const persist = vi.fn<(a: ArchiveV1) => void>()
    const after = saveEditor(startEditor(saved), persist)
    expect(persist).not.toHaveBeenCalled()
    expect(after.kind).toBe('clean')
  })
})
