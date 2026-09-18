import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // core 是纯 TS，无 DOM 依赖 —— 测试环境同样不该有 DOM，
    // 否则「零 DOM」这条约束会在这里被悄悄绕过。
    environment: 'node',
  },
})
