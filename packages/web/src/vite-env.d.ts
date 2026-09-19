/// <reference types="vite/client" />

/**
 * Vite 的客户端类型声明。作用只有一个（目前）：让 TypeScript 认识
 * `import './styles.css'` 这类**副作用导入**。
 *
 * 为什么用 `/// <reference>` 而不是把它加进 `tsconfig` 的 `types` 数组：
 * `types: []` 是刻意留空的 —— 它的用途是「不把 node_modules/@types 下的包
 * 全量注入全局作用域」，防止哪天一个传递依赖带来 `@types/node` 之后
 * core 里就能悄悄用上 `process`。这里需要的只是**一处的**模块声明，
 * 那就用一次显式的引用，而不是把整个全局注入开关重新打开。
 */
