import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles.css'

const container = document.getElementById('root')

// 显式抛错而不是用非空断言：`#root` 缺失时，`createRoot(null)` 的报错信息
// 出现在 React 内部，与真正的原因（index.html 被改了）隔着好几层。
if (container === null) {
  throw new Error('找不到 #root 容器 —— 检查 index.html')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
