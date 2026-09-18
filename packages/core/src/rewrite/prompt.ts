/**
 * 改写 prompt 的两个构造器：系统提示（进缓存前缀）与单条任务（进易变段）。
 *
 * ## 为什么任务消息里没有整份档案
 *
 * DESIGN 8.2 规定了每条经历只带四项：名称、时间、**原始文本（一字不改）**、
 * 匹配分数与命中关键词。不带：B 级字段、历史版本、**JD 原文**。
 * 最后一项容易被忽略 —— JD 原文经常有几百字，而改写一条 bullet 需要的
 * 只是「这个岗位在意什么词」，结构化摘要（`CompiledJd`）恰好就是这个东西。
 * 把 JD 原文塞进来，成本上去了，模型还得自己再抽一次关键词。
 *
 * ## 为什么 prompt 里的 schema 形状是从 schema 生成的
 *
 * 同 `compile/jd.ts`：手写两遍必然漂移，而漂移的症状是
 * 「模型能力不行」，实际是两份文档不同步。`rewrite.test.ts` 里有一条
 * 断言钉住同步。
 */

import { z } from 'zod'

import type { CompiledJd } from '../compile/index'
import { rewriteOutputSchema } from './schema'
import type { RewriteCandidate, StyleAnchor } from './types'

const SHAPE = JSON.stringify(z.toJSONSchema(rewriteOutputSchema), null, 2)

export const REWRITE_SYSTEM_PROMPT = `你是一个简历条目改写器。你的唯一职责是把一条**原始经历描述**改写成一条简历 bullet。

硬约束（违反任意一条，输出会被确定性校验拒绝并要求重写）：
1. 只输出一个 JSON 对象。不要输出解释文字，不要使用 markdown 代码围栏。
2. **不得引入任何新的数字。** 数字只能来自 <source> 中已经出现的那些，一个都不许新增，
   也不得改动已有数字的值（"4.0" 与 "4" 视为同一个数）。原文没有量化的条目，
   就交一条不含数字的条目 —— 编一个数字出来是最严重的错误。
3. 不得引入 <source> 中不存在的实体：公司名、学校名、技术名词、系统名、职级。
   形容词可以换，事实不可以加。
4. text 必须以强动词开头（主导 / 负责 / 设计 / 搭建 / 优化 / 落地，或英文的 Led / Built / Designed），
   不得使用「参与」「协助」这类弱开头，不得出现被动语态。
5. text 长度上限：中文不超过 45 字，英文不超过 25 词。超限会被拒绝。
6. sourceSpan 与 evidence 的每一项都必须是 <source> 中**逐字出现**的片段。
   下游会把它们与 <source> 逐字比对，**转述、概括、润色过的片段一律判为不合规**。
7. 输出必须严格符合下面的 schema。不得增加、删除或改名任何字段。

字段判据：
- text：改写后的 bullet，一句话，动宾结构，优先把原文里的量化结果保留下来。
- sourceSpan：这条改写所依据的原文片段，可以是整段 <source>。
- evidence：支撑 text 中每一个断言的原文片段，至少一条。text 里说了几件事，就给几条。
- keywordsHit：text 中实际命中的 <keywords> 里的词。这个字段不参与判定，
  但填错会把下游的改写方向带偏。

schema 形状：
${SHAPE}`

/** JD 消息。刻意用结构化摘要而不是原文，理由见文件头。 */
export function buildJdMessage(jd: CompiledJd | undefined): string {
  if (jd === undefined) {
    return '本次改写没有提供目标岗位信息。请只依据 <source> 改写，不要臆测岗位要求。'
  }
  return `以下是目标岗位的结构化信息（由 JD 编译而来，不是 JD 原文）。

<jd>
${JSON.stringify(jd, null, 2)}
</jd>`
}

/** 锚点块。空锚点时返回空串 —— 不产生一个写着「无」的空标签。 */
export function renderAnchorBlock(anchors: readonly StyleAnchor[]): string {
  if (anchors.length === 0) return ''
  const lines = anchors.map((anchor) => `- ${anchor.text}`).join('\n')
  return `<style_anchors>
以下是同一份简历里已经定稿的条目。请让本条 bullet 的用词密度与句式风格与它们保持一致
（同样的语域、同样的动词力度），但**不要复用它们描述的事实**。
${lines}
</style_anchors>

`
}

function formatPeriod(candidate: RewriteCandidate): string {
  if (candidate.startDate === null && candidate.endDate === null) return '未标注'
  return `${candidate.startDate ?? '?'} ~ ${candidate.endDate ?? '至今'}`
}

/** 本轮任务消息。全部易变内容都在这里，缓存断点因此落在它之前。 */
export function buildBulletTask(
  candidate: RewriteCandidate,
  anchors: readonly StyleAnchor[] = [],
): string {
  return `${renderAnchorBlock(anchors)}<candidate id="${candidate.bulletId}" entry="${candidate.entryId}">
<title>${candidate.title}</title>
<organization>${candidate.organization}</organization>
<period>${formatPeriod(candidate)}</period>
<score>${candidate.score}</score>
<keywords>${candidate.keywordsHit.join('、')}</keywords>
<source>
${candidate.sourceText}
</source>
</candidate>

请改写 <candidate> 中的这一段经历，输出一个 JSON 对象。`
}

/**
 * 重试消息。
 *
 * **只带结构化失败，不整体回显模型原文。**
 *
 * 这一点与 `compile/runner.ts` 的选择不同，差别来自失败对象的形状：
 * 编译的失败是「结构缺字段」，模型必须看到自己产出的那份结构才知道缺在哪里；
 * 而改写的失败天然是**「这一句」**—— 闸门的 `detail` 里已经引用了那句话
 * （`「40」在原始素材中找不到依据：负责…`），再回显整份 JSON 就是纯冗余。
 *
 * 冗余在这里不是无害的：整份回显会把模型上一轮的全部自由发挥带进重试请求，
 * 而重试请求的输入本该只有原文与 JD。DESIGN 8.5 的主张正是
 * 「结构化反馈的粒度决定它能否收敛」—— 那就应该只带那个粒度。
 */
export function buildRetryMessage(feedback: string): string {
  return `${feedback}

请只修正上述问题，其余保持原样。仍然只输出一个 JSON 对象，不要添加解释。`
}
