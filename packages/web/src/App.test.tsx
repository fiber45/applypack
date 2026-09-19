/**
 * App 冒烟 —— 三块 tab 的接线事实。
 *
 * ## 会话流程的 crypto 不在这里跑
 *
 * 真实 `Vault.create` 在 jsdom 里会被跨 realm 的 `instanceof` 拒收
 * （见 vault-session/model.test.ts 头注）。App 的会话接线由
 * vault-session 模型测试 + 用户手工冒烟覆盖；本文件用「预览与导出
 * 直接吃 sample 档案」这一条确定路径，验 tab 导航与预览内容真实。
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'
import { buildPreviewModel } from './features/preview/model'
import { sampleArchive } from './demo/sample'

describe('App —— 三块功能接线', () => {
  it('三个 tab 都在，默认落在档案页（含匹配报告演示）', () => {
    render(<App />)
    expect(screen.getByTestId('tab-archive')).toBeTruthy()
    expect(screen.getByTestId('tab-preview')).toBeTruthy()
    expect(screen.getByTestId('tab-deliver')).toBeTruthy()
    // 档案页初始无会话 → 显示创建入口
    expect(screen.getByTestId('vault-create')).toBeTruthy()
  })

  it('预览 / 导出页在未解锁会话时显示引导 —— 未保存的东西不出现在下游', () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-preview'))
    expect(screen.getByLabelText('生成预览').textContent).toContain('先在「档案」创建')
    fireEvent.click(screen.getByTestId('tab-deliver'))
    expect(screen.getByLabelText('导出交付').textContent).toContain('先在「档案」创建')
  })

  it('sample 档案的预览模型可独立构建（真实引擎链，零网络）', () => {
    const model = buildPreviewModel(sampleArchive)
    expect(model.cnHtml).toContain('林知远') // sample 档案的姓名事实
    expect(model.intros.length).toBeGreaterThan(0)
  })
})
