/**
 * T7.2 —— 真实 DOM 写入器：`FillWriter` 接缝（apply.ts）的生产实现。
 *
 * ## 为什么寻址不自己推 key
 *
 * key 规则（id → name → `#N` + 冲突消歧 + radio 组代表）在 features.ts
 * 的提取循环里。写入器如果在自己的遍历里复刻这套规则，规则改一处漏一处
 * 的结局是**值写进错误的元素** —— 比不写更糟。所以 key → 元素的映射
 * 直接来自 `extractKeyedElements`：与特征提取**同一次遍历**产出，
 * 计划里的 key 和页面元素在结构上不可能脱节。
 *
 * ## 写的是什么
 *
 * - 文本类 / select：写 `value` **属性**（不是 attribute）—— 表单读取的
 *   是属性，React 控制组件监听的也是它；原生 setter  trick（绕过
 *   React 的 value tracker）留给 T7.4 在真实站点上冒烟时再决定要不要，
 *   本层不做任何框架侦测。
 * - radio 组：勾中 value 匹配的成员、取消其余 —— 组语义，不是把第一个
 *   成员的 value 改掉。
 *
 * checkbox 与 file 永远到不了这里：plan 不产出它们的 fill，
 * `applyFillPlan` 三道门再拦一次 —— 两层独立，谁也不是谁的保险。
 */

import type { FillWriter } from '../fill/apply'
import { cssEscape, extractKeyedElements } from '../fill/features'
import type { DomDocument, DomElement } from '../fill/dom'

/** 写入器眼里的可变元素：jsdom 与真实 DOM 的 input/select 都长这样。 */
interface MutableField {
  value: string
}

interface MutableRadio {
  checked: boolean
}

export function createDomFillWriter(doc: DomDocument): FillWriter {
  const byKey = new Map<string, DomElement>()
  for (const { key, element } of extractKeyedElements(doc)) {
    byKey.set(key, element)
  }

  return {
    setValue(key: string, value: string): void {
      const element = byKey.get(key)
      if (element === undefined) {
        throw new Error(
          `DomFillWriter：key「${key}」在页面上找不到 —— 计划与页面脱节，拒绝写入`,
        )
      }

      if (isRadioRepresentative(element)) {
        setRadioChecked(doc, element, value)
        return
      }

      const mutable = element as DomElement & MutableField
      mutable.value = value
    },
  }
}

/**
 * T7.3 —— 提交时刻的表单值读取。与写入器同源（`extractKeyedElements`），
 * 读和写看到的是同一批 key —— 检测回填候选时不会出现「写进了页面、
 * 读回来却找不到」的缝。所有 key 都有值（没填的是空串，不是 undefined），
 * 消费方（detectBackfillCandidates）的 trim/空白判断因此不需要先判空。
 * radio 组读勾中成员的 value，没有勾选读空串。
 */
export function readPageValues(doc: DomDocument): Record<string, string> {
  const values: Record<string, string> = {}
  for (const { key, element } of extractKeyedElements(doc)) {
    if (isRadioRepresentative(element)) {
      const name = element.getAttribute('name')
      const members =
        name === null
          ? []
          : doc.querySelectorAll(`input[type="radio"][name="${cssEscape(name)}"]`)
      let checkedValue = ''
      for (const member of members) {
        if ((member as DomElement & { checked?: boolean }).checked === true) {
          checkedValue = member.getAttribute('value') ?? ''
          break
        }
      }
      values[key] = checkedValue
      continue
    }
    const raw = (element as DomElement & { value?: unknown }).value
    values[key] = typeof raw === 'string' ? raw : ''
  }
  return values
}

function isRadioRepresentative(element: DomElement): boolean {
  return (
    element.tagName.toUpperCase() === 'INPUT' &&
    (element.getAttribute('type') ?? '').toLowerCase() === 'radio'
  )
}

/**
 * 组写入：key 对应的代表元素上取组 name，成员里勾中 value 匹配的那个、
 * 取消其余。档案值对不上任何成员在这里直接抛错 —— option-mismatch
 * 在 plan 层就不该产出 fill，真跑到这一步说明两层之间出了缝。
 */
function setRadioChecked(doc: DomDocument, representative: DomElement, value: string): void {
  const name = representative.getAttribute('name')
  if (name === null) {
    throw new Error(`DomFillWriter：radio 组「${value}」没有 name —— 坏 HTML，拒绝写入`)
  }
  const members = doc.querySelectorAll(`input[type="radio"][name="${cssEscape(name)}"]`)
  let matched = false
  for (const member of members) {
    const mutable = member as DomElement & MutableRadio
    const isTarget = member.getAttribute('value') === value
    mutable.checked = isTarget
    matched = matched || isTarget
  }
  if (!matched) {
    throw new Error(
      `DomFillWriter：radio 组「${name}」里没有 value 为「${value}」的成员 —— 计划值与页面选项脱节`,
    )
  }
}
