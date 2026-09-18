# 作业约定（AGENTS.md）

> 本文件是给**任何执行者**读的第一份文件 —— 无论是你自己、一位合作者，还是一个 AI 编码 Agent。
> `DESIGN.md` 回答「为什么这么做」，本文件回答「怎么做」。两者冲突时，先改文档，再改代码。

---

## 0. 一句话

一个**没有服务端**的简历生成 + 网申填充工具：数据只存在浏览器里，扩展只负责读表单和提示，不代提交。

## 1. 开工前必读

- `DESIGN.md` 全文，重点第 4 节的 7 条 ADR —— **每条都写了被否决的方案与否决理由**
- **不要静默推翻任何 ADR。** 想推翻的正确流程：写一段「原否决理由为什么不再成立」→ 讨论 → 改文档 → 改代码。顺序反了就等于把设计依据丢了
- 第 1.3 节的 A / B 数据分级是整套隐私叙事的生死线，改动它等于改项目定位

## 2. 冻结的技术栈

| 层 | 选型 |
|---|---|
| 仓库 | pnpm workspace + Turborepo |
| 业务核心 | 纯 TS `core` 包，**零 DOM 依赖** |
| Web 端 | Vite + React + Tailwind |
| 扩展 | WXT（MV3） |
| 加密 | libsodium-wrappers + hash-wasm（Argon2id） |
| 数据 schema | JSON Resume + 中文 ATS 扩展 + `i18n` + `customFields` |
| LLM 接入 | Vercel AI SDK（**不要引入 Agent 框架**） |
| 检索 | MiniSearch / BM25（**不要引入向量库**） |

**明确不允许引入**：LangChain 或任何 Agent 编排框架、向量数据库、服务端运行时（含 Serverless）、Playwright / Selenium。

## 3. 目录结构

```
packages/
  core/        纯 TS：schema / 加密 / 密文库 / 编译 / 匹配 / 改写 / 校验 / 渲染
  web/         静态站：档案编辑、生成、预览、导出
  extension/   WXT MV3：内容脚本、适配器、填充与提示
  knowledge/   术语表 / few-shot 范例 / JD 黑话词典（非用户数据，可社区贡献）
  evals/       JSON 用例 + 确定性断言 + CI 入口
```

`core` 不得 import `web` 或 `extension` —— 用 lint 规则强制，不靠自觉。

## 4. 命令

```
pnpm install
pnpm dev            # Web 端
pnpm dev:ext        # 扩展
pnpm test           # 单测
pnpm test:evals     # 评测集
pnpm lint
pnpm typecheck
pnpm build
```

## 5. 红线（违反 = PR 直接驳回）

1. `core` 中任何函数不得读取 B 级字段
2. B 级字段不得出现在任何出网 payload 中 —— 有测试守着，不是靠 code review
3. 不引入服务端运行时
4. 不引入无头浏览器；不做代提交；**不做批量一键投递**
5. 扩展不代填 `input[type=file]`；不申请非必需的 host 权限；不含远程代码
6. **校验器不得调用 LLM**（验收器必须确定性）
7. 不自研密码学原语

## 6. 数据分级的落地方式

A / B 级定义见 `DESIGN.md` 1.3。实现要求是**三层防空**，不能只靠一层：

1. **类型层** —— B 级字段在 schema 上带 `neverSendToLLM: true`
2. **组装层** —— 出网请求只有一个组装入口，出口处断言 payload 深度扫描无命中
3. **测试层** —— mock LLM client，喂一份填满 B 级字段的档案，断言捕获到的 payload 中无任何标记字段

## 7. 测试要求

- **断言先于实现。** 本项目的验收标准天然可写：数字可溯源、跨语言数字集合相等、B 级不出网、EN 版页数 = 1 —— 全是确定性可计算的
- 评测集是 **CI 阻断项**，不是一份报告
- 新增能力必须同时新增用例；改行为必须同时改断言
- 涉及 LLM 的模块：测的是**闸门和组装逻辑**，不是模型输出内容

## 8. 提交规范

- 一个任务一个 PR，标题带 `TASKS.md` 的编号（如 `T3.2`）
- PR 描述必须回答两件事：影响了哪条 ADR 涉及的行为 / 新增了什么断言
- 不跳过 hooks（不用 `--no-verify`）

## 9. 遇到不确定

不要猜、不要"先这么做后面再调"。在 issue 里开一条「待决」并引用相关 ADR 编号。**本项目的全部价值建立在决策有据可查之上** —— 猜一次就白做了。
