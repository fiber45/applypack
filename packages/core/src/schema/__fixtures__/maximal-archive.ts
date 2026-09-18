/**
 * 「填满全部字段」的 v1 档案样本。
 *
 * 存在理由：A / B 分级策略表是**声明式**的，它可能写错路径名。
 * 本样本提供一份**运行时真实对象**，测试用它做双向覆盖校验：
 *   1. 对象里每个叶子路径，都必须能被某条策略覆盖（否则说明策略漏了字段）
 *   2. 每条策略路径，都必须在对象里真实存在（否则说明策略写了幽灵字段）
 *
 * 因此本文件里出现的所有值均为**虚构**，仅供测试使用；
 * 其中身份证号、手机号为满足格式的编造值，不对应任何真实个人。
 */
import type { ArchiveV1 } from '../archive'

export const maximalArchiveV1 = {
  schemaVersion: 1,
  basics: {
    name: { zh: '林知远', en: 'Lin Zhiyuan' },
    label: { zh: '算法工程师', en: 'Algorithm Engineer' },
    summary: {
      zh: '计算机科学与技术专业本科应届生，专注推荐系统与特征工程。',
      en: 'Final-year CS undergraduate focused on recommender systems and feature engineering.',
    },
    url: 'https://linzhiyuan.dev',
    picture: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/AL0AAAAASUVORK5CYII=',
    location: {
      city: '杭州',
      region: '浙江',
      countryCode: 'CN',
      address: '浙江省杭州市西湖区某路 1 号',
    },
    contact: {
      email: 'linzhiyuan@example.com',
      phone: '+8613800138000',
      wechat: 'linzhiyuan_dev',
    },
    identity: {
      idNumber: '330106200205140011',
      politicalStatus: '共青团员',
      nativePlace: '浙江宁波',
      birthDate: '2002-05-14',
      gender: '男',
    },
    emergencyContact: { name: '林建国', relation: '父', phone: '+8613900139000' },
    health: { note: '无重大病史' },
    family: { note: '独生子女' },
    desiredSalary: { amount: 25000, currency: 'CNY' },
    profiles: [
      { network: 'GitHub', username: 'linzhiyuan', url: 'https://github.com/linzhiyuan' },
      {
        network: 'LinkedIn',
        username: 'lin-zhiyuan',
        url: 'https://www.linkedin.com/in/lin-zhiyuan',
      },
    ],
  },
  work: [
    {
      company: '杭州某某科技有限公司',
      position: { zh: '算法工程实习生', en: 'Algorithm Engineering Intern' },
      startDate: '2025-06',
      endDate: '2025-09',
      location: '杭州',
      summary: { zh: '负责推荐系统召回通道的特征工程。' },
      highlights: [
        '负责召回通道的特征工程，累计上线 12 个特征',
        '将离线特征回填耗时从 4.2 小时降至 38 分钟',
      ],
    },
  ],
  education: [
    {
      institution: '某某大学',
      area: { zh: '计算机科学与技术', en: 'Computer Science and Technology' },
      studyType: { zh: '本科', en: "Bachelor's Degree" },
      startDate: '2022-09',
      endDate: '2026-06',
      gpa: '3.7/4.0',
      score: '89.5/100',
      highlights: ['专业排名前 8%'],
    },
  ],
  projects: [
    {
      name: {
        zh: '校园二手交易推荐系统',
        en: 'Campus Second-hand Marketplace Recommender',
      },
      description: {
        zh: '基于协同过滤与内容特征的混合推荐，服务于校内 3000+ 用户。',
        en: 'Hybrid recommender combining collaborative filtering and content features.',
      },
      highlights: ['召回率相比热门榜提升 27%'],
      keywords: ['推荐系统', '协同过滤', '特征工程'],
      startDate: '2025-03',
      endDate: '2025-05',
      url: 'https://github.com/linzhiyuan/campus-recsys',
    },
  ],
  skills: [
    { name: { zh: 'Python', en: 'Python' }, level: '熟练', keywords: ['Pandas', 'NumPy'] },
    {
      name: { zh: '机器学习框架', en: 'ML Frameworks' },
      level: '熟练',
      keywords: ['PyTorch', 'LightGBM'],
    },
  ],
  languages: [
    { language: { zh: '英语', en: 'English' }, fluency: 'CET-6', score: '562' },
    { language: { zh: '普通话', en: 'Mandarin' }, fluency: '母语' },
  ],
  certificates: [
    {
      name: { zh: '全国大学英语六级考试', en: 'CET-6' },
      issuer: '全国大学英语四六级考试委员会',
      date: '2024-06',
      score: '562',
    },
  ],
  awards: [
    {
      title: { zh: '全国大学生数学建模竞赛省级二等奖', en: 'Provincial Second Prize, CUMCM' },
      date: '2024-09',
      awarder: '浙江省教育厅',
    },
  ],
  customFields: {
    drivingLicense: 'C1',
    militaryService: '无',
  },
} satisfies ArchiveV1
