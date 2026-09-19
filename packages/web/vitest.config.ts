import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 与 core / extension 的选择正好相反，理由是同一条：
    // **测试环境里有的东西，产物里也会多出来。**
    // core 用 node 环境是为了让「零 DOM」没有退路；本包用 jsdom 是因为
    // 它要验的正是「DOM 里到底渲染出了什么」—— 拿一个不存在的 DOM 去验，
    // 验的就不是产物了。
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
