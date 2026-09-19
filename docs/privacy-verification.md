# 隐私自证手册 —— 一步步验证「数据不出浏览器」

本项目宣称：**你的简历数据从不离开浏览器**。这句宣传语的与众不同之处在于，
它不是隐私政策里的一句话，而是一个**你现在就可以动手验证的主张**。
本手册给出完整验证步骤，全程不超过五分钟，不需要安装任何工具。

> 对应 DESIGN §3.4（可自证隐私）与 `packages/web/index.html` 的 CSP
> `connect-src 'none'`。验证中发现任何一条不符合，请开 issue —— 那是最高优先级的 bug。

## 你在验证什么

| 主张 | 验证手段 |
|---|---|
| 运行时不发任何携带简历内容的请求 | Network 面板全程无 `Fetch/XHR` 请求 |
| 就算想发也发不出去 | 页面 CSP 头是 `connect-src 'none'`，任何 `fetch`/`XHR`/`WebSocket` 直接被浏览器拒绝 |
| 断网也能用 | DevTools 切 Offline 后核心功能照常工作 |
| 加密在你机器上完成 | WebCrypto 的密钥派生与加解密没有服务端参与（无账号体系可参与） |

## 准备

两种入口任选：

- **本地跑**（最彻底，不依赖任何托管方）：

  ```bash
  git clone git@github.com:fiber45/applypack.git
  cd applypack && pnpm install && pnpm --filter @applypack/web build
  pnpm --filter @applypack/web exec vite preview   # 打开它打印的 http://localhost:4173
  ```

- **在线 Demo**：直接打开 README 里的 Demo 链接。

## 步骤 1：Network 面板全程监听

1. 打开页面，按 `F12`（macOS `Cmd+Opt+I`）打开 DevTools，切到 **Network** 面板。
2. 勾选顶部的 **Preserve log**（保留日志）—— 这样跨页面操作也不会丢记录。
3. 点 **🚫（Clear）** 清空当前列表。
4. 现在**正常使用产品的每一步**：导入档案 → 设置口令 → 生成简历 → 打开网申页填表 → 预览确认。
5. 操作完成后回头看 Network 列表：
   - **应当只看到**页面加载时的静态资源（`index.html`、JS/CSS chunk、自托管字体）。
   - **应当一条都没有**：`Fetch/XHR` 类型的新请求。用类型过滤器 `Fetch/XHR` 一筛便知。
   - 简历内容的任意片段（姓名、手机号、公司名）出现在任何请求里 —— 无论目标是谁 —— 都算验证失败。

## 步骤 2：验证 CSP（就算想发也发不出去）

静态资源的加载不是隐私边界 —— 关键是**运行时能不能对外发请求**。本项目在
`packages/web/index.html` 写死了 `connect-src 'none'`：

1. DevTools 切到 **Console** 面板，输入并回车：

   ```js
   fetch('https://example.com/leak', { method: 'POST', body: 'test' })
   ```

2. 预期结果：立刻被浏览器拒绝，报 **CSP（Content Security Policy）违规**，
   请求根本没有发出（Network 面板里这条显示为 blocked，服务器不可能收到）。
3. 同样的报错会在任何一段试图外传数据的代码上发生 —— 攻击者拿到 XSS
   也带不走数据。这是「可自证」与「承诺不外传」的区别。

## 步骤 3：断网验证

1. DevTools → Network 面板 → Throttle 下拉选 **Offline**。
2. 继续使用产品：生成简历、切换语言、加密导出备份 —— 全部照常工作。
3. 恢复网络。产品全程没有「因断网而失效」的核心功能，因为没有一步依赖网络。

## 步骤 4：确认页面自己的网络边界

- 页面加载的资源也应自洽：字体是自托管的（`public/fonts/`），没有第三方统计、
  没有 CDN 脚本、没有外链图片。Network 列表里每个请求的域名应当与 Demo 域名
  （或 `localhost`）相同。
- 想核对 CSP 原文：

  ```bash
  curl -s https://<demo 域名>/ | grep -i 'Content-Security-Policy'
  ```

  应看到 `connect-src 'none'`（以及 `default-src 'self'` 等其余指令）。

## 边界（我们不声称的部分）

诚实划界，验证才有意义：

- **页面加载本身**来自静态托管方（GitHub Pages 或本地服务器）。托管方能看到
  「有人访问了这个页面」，但看不到你的任何数据 —— 页面加载完之后就没有网络了。
- **BYOK 的模型 API Key**：润色功能如果启用，需要你自己提供 Key，且这部分调用
  发生在浏览器扩展侧的模型编排层，仍然直连模型服务商、不经过任何中间服务器。
  （当前竖切中润色层是确定性的，此能力启用后本节会同步更新验证步骤。）
- 我们验证的是**数据流**，不是开源代码的可信构建。想更进一步，可以本地构建
  （见「准备」）并自托管 —— 步骤 1–4 在本地构建上同样成立。

## 配图说明

> 本手册当前为纯文字步骤（每步都有明确的预期结果）。GIF 演示计划随在线 Demo
> 一起补 —— 如果你想帮忙录一段，欢迎 PR。
