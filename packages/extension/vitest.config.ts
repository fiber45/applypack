import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // 与 core 同一个理由：测试环境里有的东西，产物里也会多出来。
    // 本包的会话逻辑完全靠注入的时钟与传输推进，不需要 DOM、也不需要真实计时器 ——
    // 这一点由 `tsconfig` 的 `lib: ["ES2023"]` + `types: []` 强制（没有 setTimeout）。
    environment: 'node',
  },
})
