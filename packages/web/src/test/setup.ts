/**
 * jsdom 环境的测试准备。
 *
 * 只做一件事：每个用例之后把 DOM 清干净。
 *
 * 为什么不用 `@testing-library/jest-dom` 或自动 cleanup：本包**不开 vitest globals**
 * （`describe` / `it` / `expect` 一律显式 import），而 Testing Library 的自动清理
 * 靠的是注册全局 `afterEach`。不开 globals 就得自己显式来 —— 少一个依赖，
 * 也少一处「看起来在跑其实没跑」的可能。
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
