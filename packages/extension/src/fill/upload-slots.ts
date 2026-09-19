import {
  DEFAULT_FILE_STEM,
  deliveryFileName,
  type ViewSuffix,
} from '../../../core/src/render/index'
import type { FieldFeature } from './features'
import type { FillPlan } from './plan'

/**
 * 上传槽位提示（TASKS T5.4）—— 红线 5「只提示不代填」的提示那一半。
 *
 * file 输入框在 plan 里永远落成 `file-slot` 条目，而 file-slot 没有
 * 批准资格（T5.3 的门），所以**结构上不存在「替用户上传」这条路**。
 * 本文件做的是另一件事：告诉用户「这个槽位该放哪份交付文件」。
 *
 * ## 分类词汇与 core 交付命名是同一套
 *
 * 槽位分类的结果就是 core 的 `ViewSuffix`（EN / CN / Bilingual），
 * 建议文件名直接用 `deliveryFileName` 拼出来（`Resume_EN.pdf`…）。
 * 用户在 Web 端下载的交付文件与扩展提示的槽位用的是同一套名字 ——
 * 「看到提示就知道该拖哪个文件」不靠记忆，靠词汇表共享。
 * 认不出的槽位返回 `unrecognized` 且**不给**建议文件名：猜一个
 * 比不给更糟（与填充层的「歧义 = 一个都不填」同一立场）。
 *
 * ## 用例表（TASKS 原文，逐条落地在 upload-slots.test.ts）
 *
 * | 信号（大小写不敏感） | 分类 |
 * |---|---|
 * | `english` \| `_en` \| `英文` | EN |
 * | `chinese` \| `_cn` \| `中文` | CN |
 * | `biling` \| `中英` \| `双语` | Bilingual（压过 EN/CN） |
 * | EN 与 CN 信号并存 | unrecognized（歧义不猜） |
 * | 无信号 | unrecognized |
 *
 * 已声明的识别缺口：连字符变体（`resume-en`）不在表内 —— 用例表是
 * 验收口径，扩表必须先有真实站点的槽位样本，不许凭空加模式。
 */

export type UploadSlotKind = ViewSuffix | 'unrecognized'

export interface UploadSlotNotice {
  readonly key: string
  readonly kind: UploadSlotKind
  /**
   * 建议上传的交付文件名（默认词干 `Resume`；UI 可按用户的
   * `DeliveryPackageOptions.fileStem` 替换词干重拼）。
   * `unrecognized` 槽位为 null。
   */
  readonly suggestedFileName: string | null
  readonly required: boolean
}

const BILINGUAL_PATTERNS: readonly string[] = ['biling', '中英', '双语']
const EN_PATTERNS: readonly string[] = ['english', '_en', '英文']
const CN_PATTERNS: readonly string[] = ['chinese', '_cn', '中文']

function matchesAny(haystack: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => haystack.includes(p))
}

export function classifyUploadSlot(key: string, labels: readonly string[]): UploadSlotKind {
  // key 与全部标签合成一个信号池，统一小写 —— 大小写不敏感是
  // 真实站点的常态（`Resume_EN` 与 `resume_en` 是同一个槽位）。
  const signals = [key, ...labels].join('\n').toLowerCase()

  if (matchesAny(signals, BILINGUAL_PATTERNS)) return 'Bilingual'
  const en = matchesAny(signals, EN_PATTERNS)
  const cn = matchesAny(signals, CN_PATTERNS)
  if (en && cn) return 'unrecognized' // 歧义：一个都不猜
  if (en) return 'EN'
  if (cn) return 'CN'
  return 'unrecognized'
}

/**
 * 每个 `file-slot` 条目产出一条提示。features 与 plan 按 key 对账：
 * plan 的 file-slot 本来就来自 features（plan.ts ③），对不上号是
 * 结构性编程错误，抛错而不是静默跳过。
 */
export function buildUploadNotices(
  features: readonly FieldFeature[],
  plan: FillPlan,
): UploadSlotNotice[] {
  const featureByKey = new Map(features.map((f) => [f.key, f]))

  const notices: UploadSlotNotice[] = []
  for (const item of plan.items) {
    if (item.kind !== 'file-slot') continue
    const feature = featureByKey.get(item.key)
    if (feature === undefined) {
      throw new Error(
        `buildUploadNotices：file-slot「${item.key}」没有对应的字段特征 —— ` +
          'plan 的 file-slot 只能来自 features，对不上号说明两份数据不是同一次提取的',
      )
    }
    const kind = classifyUploadSlot(feature.key, feature.labels)
    notices.push({
      key: item.key,
      kind,
      suggestedFileName: kind === 'unrecognized' ? null : deliveryFileName(DEFAULT_FILE_STEM, kind),
      required: item.required,
    })
  }
  return notices
}
