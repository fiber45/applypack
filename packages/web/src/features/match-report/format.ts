/**
 * match-report 的显示口径。
 *
 * ## 为什么格式化函数要单独成一个文件
 *
 * 因为断言必须与界面用**同一个**函数。
 *
 * 「屏幕上四项相加等于总分」这条断言，如果测试自己写一遍 `toFixed(1)`，
 * 那么它验的是「测试的格式化」而不是「界面的格式化」—— 界面改成两位小数、
 * 改成百分比、或者干脆格式化错了，测试照样全绿。一个用另一套口径写出来的断言，
 * 是一面照着自己的镜子。
 *
 * 所以：**任何进入断言的字面量，都必须来自这里。**
 */

import type { MatchReportRow } from '../../../../core/src/match/index'

/** 0.1 的整数倍按一位小数显示；整数不显示小数位（`88` 而不是 `88.0`）。 */
export function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** 原始得分 [0,1] 的百分比显示，用于进度条宽度与「拿了多少」的旁注。 */
export function formatRatio(raw: number): string {
  return `${Math.round(raw * 100)}%`
}

/**
 * 带符号的差值：`+8.3` / `-4.1` / `0`。
 *
 * 正号必须显式写出来。`总分 72.3 / 入选线 72.3` 这种情形下，
 * 不带符号的 `0` 与「没算出来」看起来一样；写上符号之后，
 * 它读作「正好压在线上」，与「这一格是空的」分得开。
 */
export function formatSignedPoints(value: number): string {
  const rounded = formatPoints(value)
  return value > 0 ? `+${rounded}` : rounded
}

export function statusLabel(status: MatchReportRow['status']): string {
  return status === 'selected' ? '入选' : '淘汰'
}

/**
 * 展开控件的可读名字。**带上名次与条目名**，否则一屏五个「展开」按钮，
 * 读屏用户（以及只能用键盘的人）没法知道自己在展开哪一个。
 */
export function expandControlText(expanded: boolean, row: MatchReportRow): string {
  return `${expanded ? '收起' : '展开'}第 ${row.rank} 名「${row.label}」的详情`
}

/** 每行的小节标题。三种小节对选中项与淘汰项**一视同仁**地出现。 */
export const SECTION_TITLES = Object.freeze({
  composition: '分数构成',
  reasons: '逐条理由',
  verdict: '结论',
})

/** 四项都没失分时的占位文案 —— 不能留空框，空框让人以为界面坏了。 */
export const NO_REASONS_TEXT = '四项维度都没有失分，没有可列的理由。'
