import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 相对基路径：静态产物要能直接部署到 GitHub Pages / Cloudflare Pages 的子路径下，
  // 也要能在本地以 file:// 打开看一眼。绝对路径 `/assets/...` 会让后两者全废。
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
