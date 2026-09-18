import { describe, expect, it } from 'vitest'

import { extractNumbers, numberSet, untraceableNumbers } from './numbers'

describe('数字抽取', () => {
  it('抽出整数、小数、百分号与带单位的数字', () => {
    expect(extractNumbers('上线 12 个特征，耗时从 4.2 小时降至 38 分钟')).toEqual(['12', '4.2', '38'])
  })

  it('百分号只取数字部分', () => {
    expect(extractNumbers('召回率提升 27%')).toEqual(['27'])
  })

  it('日期拆成独立数字', () => {
    expect(extractNumbers('2025-06 至 2025-09')).toEqual(['2025', '6', '2025', '9'])
  })

  it('分数拆成分子与分母', () => {
    expect(extractNumbers('GPA 3.7/4.0')).toEqual(['3.7', '4'])
  })

  it('千分位被还原', () => {
    expect(extractNumbers('服务 3,000 名用户')).toEqual(['3000'])
  })

  it('同一数值的不同写法归一化为同一个字符串', () => {
    expect(numberSet('4 小时')).toEqual(numberSet('4.0 小时'))
    expect(numberSet('1,234 次')).toEqual(numberSet('1234 次'))
  })

  it('没有数字时返回空', () => {
    expect(extractNumbers('负责推荐系统的特征工程')).toEqual([])
  })

  it('中文数字不被识别 —— 已知边界，写在文档里而不是猜', () => {
    expect(extractNumbers('累计上线十二条特征')).toEqual([])
  })

  it('加号、单位、连字符不干扰数字本身', () => {
    expect(extractNumbers('3000+ 用户、≥90 分、第 8%')).toEqual(['3000', '90', '8'])
  })
})

describe('幻觉数字溯源', () => {
  const SOURCE = '负责召回通道的特征工程，累计上线 12 个特征，回填耗时从 4.2 小时降至 38 分钟。'

  it('输出数字全部来自原文 ⇒ 无违规', () => {
    expect(untraceableNumbers('上线 12 个特征，回填从 4.2 小时降至 38 分钟', [SOURCE])).toEqual([])
  })

  it('凭空多出的数字被抓出', () => {
    expect(untraceableNumbers('上线 12 个特征，提升 40%', [SOURCE])).toEqual(['40'])
  })

  it('把 12 改成 120 ⇒ 120 无法溯源', () => {
    expect(untraceableNumbers('上线 120 个特征', [SOURCE])).toEqual(['120'])
  })

  it('多个编造数字按数值升序返回（快照稳定）', () => {
    expect(untraceableNumbers('提升 40%，服务 5000 用户，覆盖 3 个国家', [SOURCE])).toEqual([
      '3',
      '40',
      '5000',
    ])
  })

  it('4.0 与 4 等价 —— 归一化管的是**同一数值**的写法差异', () => {
    expect(untraceableNumbers('耗时 4 小时', ['耗时 4.0 小时'])).toEqual([])
  })

  it('4.2 被写成 4 ⇒ **仍算违规**：那是另一个数，不是同一个数的另一种写法', () => {
    // 这条断言推翻了本文件初稿的假设。初稿写的是「数字被简化不算幻觉」，
    // 理由是「闸门管的是凭空出现，不是写法改动」——但 4.2 → 4 恰恰**是**改动，
    // 而且是往好看的方向改。闸门若放行它，就等于允许模型把数字四舍五入成
    // 它觉得更顺眼的那个，而「仅有的数字也都对得上」正是这条闸门要保住的东西。
    expect(untraceableNumbers('回填耗时降至 38 分钟，原先 4 小时', [SOURCE])).toEqual(['4'])
  })

  it('多个来源可取并集', () => {
    expect(untraceableNumbers('覆盖 9 个城市。', ['另一段提到 9 个城市', SOURCE])).toEqual([])
  })

  it('来源为空 ⇒ 输出里每个数字都是违规', () => {
    expect(untraceableNumbers('提升 40%', [])).toEqual(['40'])
  })

  it('输出没有数字 ⇒ 永远通过（空集是任何集合的子集）', () => {
    expect(untraceableNumbers('负责特征工程', [SOURCE])).toEqual([])
  })
})
