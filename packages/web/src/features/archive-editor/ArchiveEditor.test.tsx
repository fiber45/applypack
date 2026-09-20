/**
 * T8.1 档案编辑器组件测试 —— 模型三态在界面上的投影。
 *
 * 与 MatchReport.test.tsx 同一风格：模型算术已在 model.test.ts 验过，
 * 这里验「界面有没有把已经拿到的信息藏起来」—— 错误信息要真的显示、
 * 已保存徽标不能在错误状态下出现。
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { archiveV1Schema, type ArchiveV1 } from '../../../../core/src/schema/index'
import { ArchiveEditor } from './ArchiveEditor'

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

function field(label: string): HTMLInputElement {
  const input = screen.getByLabelText('城市', { selector: 'input' }) as HTMLInputElement
  if (label !== '城市') throw new Error('helper 只支持城市字段')
  return input
}

describe('T8.1 档案编辑器 —— 三态徽标与保存按钮', () => {
  it('起点显示「已保存」；合法编辑 → 「有未保存的修改」；保存 → 回到「已保存」且回调收到新值', () => {
    const onPersist = vi.fn<(a: ArchiveV1) => void>()
    render(<ArchiveEditor saved={sample()} onPersist={onPersist} />)
    expect(screen.getByTestId('editor-status').textContent).toBe('已保存')

    const city = field('城市')
    fireEvent.change(city, { target: { value: '杭州' } })
    expect(screen.getByTestId('editor-status').textContent).toBe('有未保存的修改')

    fireEvent.click(screen.getByTestId('editor-save'))
    expect(screen.getByTestId('editor-status').textContent).toBe('已保存')
    expect(onPersist).toHaveBeenCalledTimes(1)
    expect(onPersist.mock.calls[0]?.[0]?.basics.location?.city).toBe('杭州')
  })

  it('薪资填「25k」→ 显示 schema 错误（指到字段），状态是「有误」，保存按钮不可用', () => {
    const onPersist = vi.fn<(a: ArchiveV1) => void>()
    render(<ArchiveEditor saved={sample()} onPersist={onPersist} />)

    fireEvent.change(screen.getByLabelText('期望薪资（数字）', { selector: 'input' }), {
      target: { value: '25k' },
    })
    expect(screen.getByTestId('editor-status').textContent).toBe('内容有误，不能保存')
    const issues = screen.getByTestId('editor-issues')
    expect(issues.textContent).toMatch(/desiredSalary\.amount/)
    // 「不产生已保存的假象」：错误状态下已保存徽标消失、保存按钮禁用
    expect(screen.queryByText('已保存')).toBeNull()
    expect((screen.getByTestId('editor-save') as HTMLButtonElement).disabled).toBe(true)
    expect(onPersist).not.toHaveBeenCalled()
  })
})

describe('全库编辑 —— 分区条目在界面上的投影', () => {
  it('新增项目 → 未填必填是「有误」；填上名称转「未保存」，保存后回调收到带项目的档案', () => {
    const onPersist = vi.fn<(a: ArchiveV1) => void>()
    render(<ArchiveEditor saved={sample()} onPersist={onPersist} />)

    // 空档案没有项目分区入口的断言在 App 层；这里直接新增一条项目
    fireEvent.click(screen.getByTestId('add-projects'))
    // 「新增即 invalid」：项目名必填，issues 必须指到 projects.0.name
    expect(screen.getByTestId('editor-status').textContent).toBe('内容有误，不能保存')
    expect(screen.getByTestId('editor-issues').textContent).toMatch(/projects\.0\.name/)
    expect((screen.getByTestId('editor-save') as HTMLButtonElement).disabled).toBe(true)

    // 草稿在 invalid 态仍然可见可编辑 —— 半成品不能被清成空串
    fireEvent.change(screen.getByLabelText('项目名称（中）', { selector: 'input' }), {
      target: { value: '校园二手交易平台' },
    })
    expect(screen.getByTestId('editor-status').textContent).toBe('有未保存的修改')

    fireEvent.click(screen.getByTestId('editor-save'))
    expect(screen.getByTestId('editor-status').textContent).toBe('已保存')
    expect(onPersist).toHaveBeenCalledTimes(1)
    const persisted = onPersist.mock.calls[0]?.[0] as ArchiveV1
    expect(persisted.projects[0]?.name).toEqual({ zh: '校园二手交易平台' })
  })

  it('要点与关键词按行 / 逗号换算进档案；删除按钮移除条目', () => {
    const onPersist = vi.fn<(a: ArchiveV1) => void>()
    render(<ArchiveEditor saved={sample()} onPersist={onPersist} />)

    fireEvent.click(screen.getByTestId('add-projects'))
    fireEvent.change(screen.getByLabelText('项目名称（中）', { selector: 'input' }), {
      target: { value: '平台' },
    })
    fireEvent.change(screen.getByLabelText('要点（每行一条）', { selector: 'textarea' }), {
      target: { value: '第一条\n\n第二条\n' },
    })
    fireEvent.change(screen.getByLabelText('关键词（逗号分隔）', { selector: 'input' }), {
      target: { value: 'React, Node ,MySQL' },
    })
    fireEvent.click(screen.getByTestId('editor-save'))

    const persisted = onPersist.mock.calls[0]?.[0] as ArchiveV1
    expect(persisted.projects[0]?.highlights).toEqual(['第一条', '第二条'])
    expect(persisted.projects[0]?.keywords).toEqual(['React', 'Node', 'MySQL'])

    // 删除第一条 → 徽标变「未保存」，再保存 → projects 清空
    fireEvent.click(screen.getByTestId('remove-projects-0'))
    expect(screen.getByTestId('editor-status').textContent).toBe('有未保存的修改')
    fireEvent.click(screen.getByTestId('editor-save'))
    const afterRemove = onPersist.mock.calls[1]?.[0] as ArchiveV1
    expect(afterRemove.projects).toHaveLength(0)
  })

  it('clean 态提供「载入示例档案」—— 示例只是草稿起点，保存前不落库', () => {
    const onPersist = vi.fn<(a: ArchiveV1) => void>()
    render(<ArchiveEditor saved={sample()} onPersist={onPersist} />)

    fireEvent.click(screen.getByTestId('editor-load-sample'))
    // 示例档案进入草稿 → dirty；但没点保存就没有任何持久化
    expect(screen.getByTestId('editor-status').textContent).toBe('有未保存的修改')
    expect(onPersist).not.toHaveBeenCalled()
    // 示例数据可见（sample 档案的姓名事实）
    expect(screen.getByLabelText('姓名', { selector: 'input' })).toHaveProperty(
      'value',
      expect.stringContaining('林知远'),
    )
  })
})
