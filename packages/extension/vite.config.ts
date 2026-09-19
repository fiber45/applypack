import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/content/entry.ts',
      // MV3 内容脚本不能是 ESM —— IIFE 单文件，页面加载即执行。
      // 产物名被 manifest.json 的 content_scripts.js 引用，两边一起改。
      name: 'applypackContent',
      formats: ['iife'],
      fileName: () => 'content-script.js',
    },
  },
})
