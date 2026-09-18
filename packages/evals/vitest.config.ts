import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // 评测集是纯函数断言，不需要 DOM。与 core 同一个理由：
    // 测试环境里有的东西，产物里也会有 —— 别让它多出来。
    environment: 'node',
  },
})
