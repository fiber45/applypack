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
import { describe, expect, it, vi } from 'vitest'

// 只替换 createSession —— 其余导出保持真实实现。
// 理由：App 会话接线中「创建失败」这条路径在 jsdom 里无法用真实 crypto
// 走通（跨 realm），而它恰恰是必须钉住的行为（见下方事故用例）。
vi.mock('./features/vault-session/model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./features/vault-session/model')>()
  return { ...actual, createSession: vi.fn() }
})

import { App } from './App'
import { createSession, type UnlockedSession } from './features/vault-session/model'
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

  // 事故用例（2026-09-20）：CSP 缺 'wasm-unsafe-eval' 导致真实浏览器里
  // WASM（hash-wasm / libsodium）实例化被拒，createSession reject；
  // 而 onClick 是 `void createSession(...).then(setSession)` 没有 catch ——
  // 未处理拒绝被吞，用户看到的就是「点了没反应」。两条都必须钉死：
  // 失败要画成可见状态，且不得假装成功。
  it('创建失败必须可见 —— 静默无反应是被禁止的状态', async () => {
    const createMock = vi.mocked(createSession)
    createMock.mockRejectedValueOnce(new Error('WASM 编译被拒绝（模拟 CSP 事故）'))

    render(<App />)
    fireEvent.change(screen.getByLabelText('新库口令'), { target: { value: 'test-pass' } })
    fireEvent.click(screen.getByTestId('vault-create'))

    // 失败必须画出来，且钉住文案前缀（M2 教训：钉具体文案，不是 toThrow）
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('创建密文库失败')
    expect(alert.textContent).toContain('WASM 编译被拒绝')

    // 界面必须仍停在 no-vault 分支：没有档案、没有密文可导出 —— 失败不得假装成功
    expect(screen.queryByLabelText('密文内容')).toBeNull()
    expect(screen.queryByTestId('vault-lock')).toBeNull()
    // 创建入口仍在 —— 用户可以直接重试
    expect(screen.getByTestId('vault-create')).toBeTruthy()
  })

  // T9.2d —— 扩展的密文副本通道是「粘贴信封」：Web 端必须有一键复制出口。
  it('解锁后「复制密文信封」把 toVaultText() 写进剪贴板，并给出已复制反馈', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const fakeSession = {
      kind: 'unlocked',
      vault: {
        toVaultText: () => 'FAKE-ENVELOPE-TEXT',
        loadArchive: async () => sampleArchive,
      } as never,
      archive: sampleArchive,
    } as unknown as UnlockedSession
    vi.mocked(createSession).mockResolvedValueOnce(fakeSession)

    render(<App />)
    fireEvent.change(screen.getByLabelText('新库口令'), { target: { value: 'test-pass' } })
    fireEvent.click(screen.getByTestId('vault-create'))
    await screen.findByTestId('vault-lock')

    fireEvent.click(screen.getByTestId('vault-copy-envelope'))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('FAKE-ENVELOPE-TEXT'))
    expect((await screen.findByTestId('vault-copy-done')).textContent).toContain('已复制')
  })

  it('复制信封失败必须可见 —— 假装成功会让用户在网申页粘出空气', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(
      new Error('NotAllowedError'),
    )
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const fakeSession = {
      kind: 'unlocked',
      vault: { toVaultText: () => 'FAKE-ENVELOPE-TEXT', loadArchive: async () => sampleArchive } as never,
      archive: sampleArchive,
    } as unknown as UnlockedSession
    vi.mocked(createSession).mockResolvedValueOnce(fakeSession)

    render(<App />)
    fireEvent.change(screen.getByLabelText('新库口令'), { target: { value: 'test-pass' } })
    fireEvent.click(screen.getByTestId('vault-create'))
    await screen.findByTestId('vault-lock')

    fireEvent.click(screen.getByTestId('vault-copy-envelope'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('复制信封失败')
    // 失败不得给成功反馈
    expect(screen.queryByTestId('vault-copy-done')).toBeNull()
  })
})
