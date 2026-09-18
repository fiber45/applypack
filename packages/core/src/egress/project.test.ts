import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import type { ArchiveV1 } from '../schema/index'
import { bLevelPaths } from '../schema/index'
import { projectArchiveForLLM } from './project'
import { findBLevelPaths, findUndeclaredPaths } from './scan'

describe('A 级投影', () => {
  const projected = projectArchiveForLLM(maximalArchiveV1)

  it('投影结果里不存在任何 B 级路径', () => {
    expect(findBLevelPaths(projected)).toEqual([])
  })

  it('投影结果里不存在任何未声明路径（否则级别未知）', () => {
    expect(findUndeclaredPaths(projected)).toEqual([])
  })

  it('basics 只留下 label 与 summary —— 姓名与联系方式被整体剥掉', () => {
    expect(Object.keys(projected.basics as object).sort()).toEqual(['label', 'summary'])
  })

  it('顶层只留下 A 级子树', () => {
    expect(Object.keys(projected).sort()).toEqual([
      'awards',
      'basics',
      'certificates',
      'education',
      'languages',
      'projects',
      'schemaVersion',
      'skills',
      'work',
    ])
  })

  it('A 级内容逐字保留 —— 投影不是摘要，不能动一个字符', () => {
    const work = projected.work as { highlights: string[] }[]
    expect(work[0]?.highlights).toEqual(maximalArchiveV1.work[0]?.highlights)
  })

  it('保留下来的 A 级子树是深拷贝，不与档案共享引用', () => {
    expect(projected.work).not.toBe(maximalArchiveV1.work)
    expect((projected.work as { highlights: string[] }[])[0]?.highlights).not.toBe(
      maximalArchiveV1.work[0]?.highlights,
    )
  })

  it('改写投影结果不会污染原档案', () => {
    const mutable = projectArchiveForLLM(maximalArchiveV1) as {
      work: { highlights: string[] }[]
    }
    mutable.work[0]?.highlights.push('凭空多出来的一条经历')
    expect(maximalArchiveV1.work[0]?.highlights).toHaveLength(2)
  })

  it('B 级路径清单本身非空 —— 否则上面几条断言都是空转', () => {
    expect(bLevelPaths().length).toBeGreaterThan(0)
  })

  it('未声明的幽灵字段被丢弃（保守失败，不是放行）', () => {
    const tainted = {
      ...maximalArchiveV1,
      basics: { ...maximalArchiveV1.basics, contacts_backup: '13800138000' },
    } as unknown as ArchiveV1
    const result = projectArchiveForLLM(tainted)
    expect(Object.keys(result.basics as object).sort()).toEqual(['label', 'summary'])
  })

  it('空档案投影成空对象，不抛错', () => {
    const empty = { schemaVersion: 1, basics: {} } as unknown as ArchiveV1
    expect(projectArchiveForLLM(empty)).toEqual({ schemaVersion: 1, basics: {} })
  })
})
