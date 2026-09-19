import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FILE_STEM,
  DELIVERY_FILE_NAME_PATTERN,
  MAX_FILE_STEM_LENGTH,
  VIEW_SUFFIXES,
  checkFileName,
  checkFileNames,
  deliveryFileName,
  isDeliveryFileName,
  resolveNaming,
  sanitizeFileStem,
} from './filename'

const DEFAULTS = ['Resume_CN.pdf', 'Resume_EN.pdf', 'Resume_Bilingual.pdf']

/** 名字里允许出现的字符集 —— 与正则的字符集是同一份，单独写一次用来直接断言契约。 */
const ALLOWED_ONLY = /^[A-Za-z0-9_-]+$/

/**
 * 对抗性输入。**每一项都是真实会遇到的写法**，不是随机噪声：
 * 前四条是中文用户最自然的命名习惯，中间是各平台的保留字符，
 * 最后是空/超长这类边界。
 */
const HOSTILE: readonly string[] = Object.freeze([
  '张智远',
  '张智远_简历',
  '张智远_Zhiyuan',
  'Zhang Zhiyuan',
  'Zhang.Zhiyuan',
  'Resume_EN.pdf',
  'Resume_EN.PDF',
  'a/b/c',
  'a\\b',
  '../../etc/passwd',
  'a\tb\nc',
  'Resume 🚀',
  '<>:"|?*',
  'Zhang（Zhiyuan）',
  'CON',
  '...',
  '   ',
  '',
  'a\u0000b',
  '  __a__  ',
  'Zhang-Zhiyuan',
  'x'.repeat(500),
])

function namesFor(stem: string): readonly string[] {
  return VIEW_SUFFIXES.map((suffix) => deliveryFileName(stem, suffix))
}

describe('T4c · 文件名规范 ^[A-Za-z0-9_-]+\\.pdf$', () => {
  it('正则与 TASKS.md 里的字面量逐字一致 —— 顺手放宽它会当场变红', () => {
    // 这条断言的存在理由是：规范来自清单，不是本文件的实现细节。
    // 若有人把 `_` 从字符集里去掉、或允许了大写后缀，改动会出现在 diff 里。
    expect(DELIVERY_FILE_NAME_PATTERN.source).toBe('^[A-Za-z0-9_-]+\\.pdf$')
    expect(DELIVERY_FILE_NAME_PATTERN.flags).toBe('')
  })

  it('接受三个默认文件名', () => {
    for (const name of DEFAULTS) expect(isDeliveryFileName(name)).toBe(true)
  })

  it('拒绝中文、空格、大小写后缀、路径与缺后缀', () => {
    const rejected = [
      '张智远_简历.pdf',
      'Resume CN.pdf',
      'Resume_EN.PDF',
      'Resume_EN.pdf ',
      ' Resume_EN.pdf',
      'a/b.pdf',
      'Resume_EN',
      '',
      '.pdf',
      'Resume_EN.pdf.pdf',
    ]
    for (const name of rejected) expect([name, isDeliveryFileName(name)]).toEqual([name, false])
  })

  it('对抗性输入表不是空的 —— 否则下面那条循环是空转的', () => {
    // 一条 `for` 循环里没有元素时也会「通过」。T1.4 的教训。
    expect(HOSTILE.length).toBeGreaterThanOrEqual(15)
  })

  it('**净化器的契约对任何输入都成立**：产出只含允许字符，拼上后缀后必定合规', () => {
    for (const raw of HOSTILE) {
      const stem = sanitizeFileStem(raw)
      // 契约的第一半：词干本身只含允许字符（空串是合法的「不可用」）。
      expect([raw, ALLOWED_ONLY.test(stem) || stem === '']).toEqual([raw, true])
      // 契约的第二半：三个后缀拼出来的名字全部合规。
      for (const name of namesFor(stem)) {
        expect([raw, isDeliveryFileName(name)]).toEqual([raw, true])
      }
    }
  })

  it('具体输出 —— 不只断言「合规」，还要断言「变成了什么」', () => {
    // 只断言「结果合规」的话，一个把所有输入都变成空串的净化器也能通过。
    const cases: readonly (readonly [string, string])[] = [
      ['Zhang Zhiyuan', 'Zhang_Zhiyuan'],
      ['Zhang.Zhiyuan', 'Zhang_Zhiyuan'],
      ['Resume_EN.pdf', 'Resume_EN'],
      ['Resume_EN.PDF', 'Resume_EN'],
      ['../../etc/passwd', 'etc_passwd'],
      ['a/b/c', 'a_b_c'],
      ['a\\b', 'a_b'],
      ['a\tb\nc', 'a_b_c'],
      ['a\u0000b', 'a_b'],
      ['Resume 🚀', 'Resume'],
      ['Zhang（Zhiyuan）', 'Zhang_Zhiyuan'],
      ['张智远_Zhiyuan', 'Zhiyuan'],
      ['  __a__  ', 'a'],
      ['Zhang-Zhiyuan', 'Zhang-Zhiyuan'],
      ['CON', 'CON'],
      // 全部字符都不可用的几种，净化后是空串，由调用方回落。
      ['张智远', ''],
      ['张智远_简历', ''],
      ['...', ''],
      ['   ', ''],
      ['', ''],
    ]
    for (const [raw, expected] of cases) {
      expect([raw, sanitizeFileStem(raw)]).toEqual([raw, expected])
    }
  })

  it('路径分隔符被彻底替换 —— 产物里不可能出现第二个路径段', () => {
    for (const raw of HOSTILE) {
      const name = deliveryFileName(sanitizeFileStem(raw), 'EN')
      expect([raw, name.includes('/') || name.includes('\\')]).toEqual([raw, false])
      // 而且不是靠「恰好没有斜杠」：整段里的点号也一并被换掉了，
      // 所以 `..` 这种退化路径段也不存在。
      expect([raw, name.includes('..')]).toEqual([raw, false])
    }
  })

  it('超长输入被截到上限，且截断后仍然合规', () => {
    const stem = sanitizeFileStem('x'.repeat(500))
    expect(stem.length).toBe(MAX_FILE_STEM_LENGTH)
    expect(stem).toBe('x'.repeat(MAX_FILE_STEM_LENGTH))
    expect(isDeliveryFileName(deliveryFileName(stem, 'Bilingual'))).toBe(true)
  })

  it('截断点落在下划线上时，尾部不留孤立下划线', () => {
    // `y` 重复 63 次 + `_` + 更多内容 ⇒ 前 64 个字符的末尾正好是 `_`。
    const stem = sanitizeFileStem(`${'y'.repeat(63)}_tail`)
    expect(stem).toBe('y'.repeat(63))
  })
})

describe('T4c · 三份文件不可能撞名', () => {
  it('**后缀在净化之后追加**，所以不同的后缀必然给出不同的名字', () => {
    // 这不是一条需要运行时检查的性质 —— 它是「后缀是代码给的、词干是用户给的」
    // 这个分工的直接推论。这条断言测的是那个分工还在。
    for (const raw of HOSTILE) {
      const names = namesFor(sanitizeFileStem(raw))
      expect([raw, new Set(names).size]).toEqual([raw, VIEW_SUFFIXES.length])
    }
  })

  it('默认词干拼出的就是 T4b 已经用着的三个视图名', () => {
    // T4b 把 `PackageViewName` 定成 `Resume_CN` 这种形状，T4c 的文件名必须与它一致，
    // 否则「视图名」与「文件名」会在两处各自演化。
    expect(namesFor(DEFAULT_FILE_STEM)).toEqual(DEFAULTS)
  })

  it('词干里带后缀字样也不会覆盖真正的后缀', () => {
    // `Resume_CN` 作为词干时，中版的文件名是 `Resume_CN_CN.pdf`。
    // 看起来笨，但它是对的：用户给的是标识，代码给的是身份，两者不互相覆盖。
    expect(namesFor('Resume_CN')).toEqual([
      'Resume_CN_CN.pdf',
      'Resume_CN_EN.pdf',
      'Resume_CN_Bilingual.pdf',
    ])
  })
})

describe('T4c · 词干回落必须显式', () => {
  it('没给词干 ⇒ 用默认值，且不算回落', () => {
    expect(resolveNaming(undefined)).toEqual({
      requestedStem: null,
      usedStem: DEFAULT_FILE_STEM,
      fellBack: false,
    })
  })

  it('给了可用的词干 ⇒ 净化后使用，原始请求照样保留', () => {
    expect(resolveNaming('Zhang Zhiyuan')).toEqual({
      requestedStem: 'Zhang Zhiyuan',
      usedStem: 'Zhang_Zhiyuan',
      fellBack: false,
    })
  })

  it('**全中文词干 ⇒ 回落，并且必须说出来**', () => {
    // 「张智远」是中文用户写简历时最自然的一个输入，而它在允许字符集里
    // 一个字符都不剩。静默丢掉它 = 文件生成成功、名字合规、没有报错，
    // 而用户拿到的名字不是他要求的。
    expect(resolveNaming('张智远')).toEqual({
      requestedStem: '张智远',
      usedStem: DEFAULT_FILE_STEM,
      fellBack: true,
    })
  })

  it('用户要求的词干恰好是默认值时不算回落 —— 这就是 `fellBack` 不能推导的原因', () => {
    const report = resolveNaming('Resume')
    expect(report.requestedStem).toBe(report.usedStem)
    expect(report.fellBack).toBe(false)
  })

  it('空串算回落（要求了，但要求的东西不可用）', () => {
    expect(resolveNaming('').fellBack).toBe(true)
    expect(resolveNaming('   ').fellBack).toBe(true)
  })
})

describe('T4c · 不合规的文件名要被指得出来（回归绊线）', () => {
  const BAD: readonly (readonly [string, string, number])[] = [
    ['张智远_简历.pdf', 'illegal_character', 0],
    ['Resume CN.pdf', 'illegal_character', 6],
    ['../Resume_EN.pdf', 'illegal_character', 0],
    ['Resume_EN.pdf.pdf', 'illegal_character', 9],
    // 后缀先判：`Resume_EN.pdf ` 的问题在后缀，不在第 10 个字符那个点上 ——
    // 报「第 10 个字符非法」会把人领到错的地方。
    ['Resume_EN.pdf ', 'bad_extension', -1],
    ['Resume_EN.PDF', 'bad_extension', -1],
    ['Resume_EN', 'bad_extension', -1],
    ['', 'bad_extension', -1],
    ['.pdf', 'bad_extension', -1],
  ]

  it('每一项都能被定位到具体字符（或明确说是后缀的问题）', () => {
    for (const [fileName, reason, index] of BAD) {
      const problem = checkFileName(fileName)
      expect([fileName, problem?.reason, problem?.index]).toEqual([fileName, reason, index])
    }
  })

  it('合规的名字一律返回 null —— 判反了的话上面那组也「通过」', () => {
    for (const name of DEFAULTS) expect(checkFileName(name)).toBeNull()
    for (const raw of HOSTILE) {
      for (const name of namesFor(sanitizeFileStem(raw))) {
        expect([name, checkFileName(name)]).toEqual([name, null])
      }
    }
  })

  it('列表版逐份检查，返回全部问题而不是第一个', () => {
    const problems = checkFileNames([
      { name: 'Resume_CN', fileName: 'Resume_CN.pdf' },
      { name: 'Resume_EN', fileName: 'Resume EN.pdf' },
      { name: 'Resume_Bilingual', fileName: '双语.pdf' },
    ])
    expect(problems.map((problem) => problem.fileName)).toEqual(['Resume EN.pdf', '双语.pdf'])
  })
})
