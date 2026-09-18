/**
 * Agent 层测试的夹具。
 *
 * 直接复用改写层的夹具（`GOOD_TEXT` / `mockClient` / `output`）—— 两份
 * 「合法的模型回复」如果各写一遍，某天闸门变了就会只改一处，
 * 而症状是「Agent 的测试过了、改写的测试没过」，徒增排查成本。
 *
 * `ITEMS` 里三条经历的分数是**刻意拉开**的：`work.0` 命中两个 JD 技能词、
 * 时间最近、四条要点全部含数字；`work.2` 一项都不占。这样「挑经历」
 * 与「淘汰理由」才有东西可断言。
 */

import type { CompiledJd } from '../../compile/index'
import type { MatchItem } from '../../match/index'
import type { RewriteCandidate } from '../../rewrite/index'
import {
  GOOD_TEXT,
  JD as REWRITE_JD,
  SOURCE_TEXT,
  candidate as rewriteCandidate,
  mockClient,
  output,
} from '../../rewrite/__fixtures__/harness'

export { GOOD_TEXT, SOURCE_TEXT, mockClient, output }

export const JD: CompiledJd = REWRITE_JD

/** 参照时间。匹配引擎要求显式传入，读系统时间会破坏可复现性。 */
export const NOW = '2026-09'

/** 编造了原文里没有的数字 40（原文只有 12 / 4.2 / 38）。 */
export const FABRICATED = '重构推荐系统召回链路，将回填耗时降低 40%'

/** 同一句话换一个强动词开头 —— 用来避开「同一动词最多出现 2 次」这条硬约束。 */
export function goodWith(opening: string): string {
  return `${opening}推荐系统召回链路，上线 12 个特征，回填耗时从 4.2 小时降至 38 分钟`
}

/** 一组互不重复的强动词开头。 */
export const OPENINGS: readonly string[] = Object.freeze([
  '重构',
  '主导',
  '设计',
  '优化',
  '实现',
  '搭建',
  '推动',
  '落地',
])

export const ITEMS: readonly MatchItem[] = Object.freeze([
  {
    entryId: 'work.0',
    kind: 'work',
    title: '算法工程实习生',
    organization: '某某科技有限公司',
    startDate: '2025-06',
    endDate: '2025-09',
    texts: ['Python', '推荐系统', '特征工程', '召回通道'],
    highlightCount: 4,
    quantifiedCount: 4,
  },
  {
    entryId: 'work.1',
    kind: 'work',
    title: '数据分析实习生',
    organization: '某商贸公司',
    startDate: '2024-03',
    endDate: '2024-06',
    texts: ['数据看板', '报表'],
    highlightCount: 2,
    quantifiedCount: 0,
  },
  {
    entryId: 'work.2',
    kind: 'project',
    title: '课程作业',
    organization: '某大学',
    startDate: null,
    endDate: null,
    texts: ['文档整理'],
    highlightCount: 1,
    quantifiedCount: 0,
  },
])

/** 每条对应 `ITEMS` 里的一个 entryId。 */
export function candidates(): readonly RewriteCandidate[] {
  return [
    rewriteCandidate('b0', SOURCE_TEXT, { entryId: 'work.0', title: '算法工程实习生' }),
    rewriteCandidate('b1', SOURCE_TEXT, {
      entryId: 'work.1',
      title: '数据分析实习生',
      keywordsHit: [],
    }),
    rewriteCandidate('b2', SOURCE_TEXT, { entryId: 'work.2', title: '课程作业', keywordsHit: [] }),
  ]
}
