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
