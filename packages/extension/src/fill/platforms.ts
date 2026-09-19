import { registerPlatformAdapter, type PlatformAdapter } from './adapters'

/**
 * 真实平台适配器（TASKS T5.2）—— 前 3 家：**北森、Moka、大易**。
 *
 * ## 为什么是这三家（写进 README 的选择依据，这里留技术细节）
 *
 * 国内校招网申的表单层基本被这三家 ATS SaaS 覆盖，外企在华校招的
 * 申请页也大多跑在它们上面。三家的 DOM 风格恰好构成三种典型难度，
 * 挤在一个批次里做，才能互相印证「适配器边界画在哪」：
 *
 * | 平台 | DOM 风格 | 适配器要解决的问题 |
 * |---|---|---|
 * | 北森 | 随机 id、`span` 标题（非 `label`）、「请输入…」placeholder | 标题对提取层不可见，「姓名 / 姓名拼音」靠 placeholder 打平成歧义，必须精确钉 |
 * | Moka | label 规范、`data-moka-field` 语义属性、email 字段是 `type=text` | 平台越规范启发式越够用 —— 适配器只钉少数，验证「不多钉」的克制 |
 * | 大易 | `p_*` 稳定 name、option value 是中文、毕业时间只有年份下拉 | 「紧急联系人电话」与「手机号码」包含得分打平，钉 `p_mobile` 解围；年份下拉 vs `2024-06` 由 option-mismatch 兜住，不硬猜 |
 *
 * ## 版本纪律（DESIGN 232「适配器随平台改版失效」的执行点）
 *
 * `version` 与快照 fixture 的 `data-platform-version` 由测试钉成相等：
 * 平台改版 → 重新采集快照 → 两边**一起** bump。只改选择器不改版本、
 * 或改了快照忘了改代码，都会在 `platforms.test.ts` 的版本纪律断言上红。
 *
 * ## 快照的诚实声明
 *
 * 三份快照 fixture 是**手工建模的近似**（provisional）：结构特征
 * 按真实页面对照公开资料建模，不是逐字节拷贝。真实采集流程与
 * 维护约定见 README「适配器与快照维护」。判据不因此放松 ——
 * 真快照一旦换进来，同一组断言原样生效。
 *
 * 注册发生在 MV3 内容脚本入口处一次性完成（`registerBuiltinPlatformAdapters`）；
 * 注册表本身是 T5.1 的机制，本文件只提供内置名单。
 */

/**
 * 北森 —— 选择器按 v1 快照钉：
 *   - placeholder 精确匹配用属性选择器（`[placeholder="请输入姓名"]`），
 *     「请输入姓名拼音」是**不同的属性值**，不会误中；
 *   - radio 组绑定第一个成员（`input[name="rdoGender"]`），
 *     `adapterBindings` 取到的 key 是组名；
 *   - 学历下拉钉 `name` 属性（`ctl00$main$field6`）—— 该编号在 v1
 *     快照里稳定，改版即由版本纪律拦住。
 */
const BEISEN_ADAPTER: PlatformAdapter = Object.freeze({
  id: 'beisen',
  platformMarker: 'beisen',
  version: '1',
  selectors: Object.freeze({
    'basics.name.zh': 'input[placeholder="请输入姓名"]',
    'basics.contact.phone': 'input[placeholder="请输入手机号"]',
    'basics.identity.gender': 'input[name="rdoGender"]',
    'education.0.studyType.zh': 'select[name="ctl00$main$field6"]',
  }),
})

/**
 * Moka —— 只钉三个 `data-moka-field` 明确的字段，其余放给启发式。
 * 刻意不钉学历 / 城市：Moka 的 label 关联规范，启发式 10 分精确命中，
 * 适配器多钉一条就多一份改版维护成本，没有对应的收益。
 */
const MOKA_ADAPTER: PlatformAdapter = Object.freeze({
  id: 'moka',
  platformMarker: 'moka',
  version: '1',
  selectors: Object.freeze({
    'basics.name.zh': 'input[data-moka-field="name"]',
    'basics.contact.phone': 'input[data-moka-field="phone"]',
    'basics.contact.email': 'input[data-moka-field="email"]',
  }),
})

/**
 * 大易 —— 钉两个：
 *   - `p_mobile`：电话歧义的唯一解（不钉就是两个 6 分候选打平 → 都不填）；
 *   - `p_education`：select 的 name 稳定。**不钉**毕业时间 —— 年份下拉
 *     与档案 `YYYY-MM` 的缝该走 option-mismatch 缺口提示用户，钉了
 *     也躲不过选项校验，只是白花一份维护成本。
 */
const DAYEE_ADAPTER: PlatformAdapter = Object.freeze({
  id: 'dayee',
  platformMarker: 'dayee',
  version: '1',
  selectors: Object.freeze({
    'basics.contact.phone': 'input[name="p_mobile"]',
    'education.0.studyType.zh': 'select[name="p_education"]',
  }),
})

/** 内置适配器名单 —— mockboard 是 T5.1 的测试锚点，刻意不在其中。 */
export const BUILTIN_PLATFORM_ADAPTERS: readonly PlatformAdapter[] = Object.freeze([
  BEISEN_ADAPTER,
  MOKA_ADAPTER,
  DAYEE_ADAPTER,
])

/** 内容脚本入口调用一次；重复注册由注册表拒绝（T5.1 的防重语义）。 */
export function registerBuiltinPlatformAdapters(): void {
  for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
    registerPlatformAdapter(adapter)
  }
}
