// 网站基本信息。前端的页面标题和服务器端渲染的 SEO 标签都从这里读取，改名只需要改这里。

export const SITE = {
  name: '号工具',
  enName: 'HaoKit',
  title: '号工具 - Outlook取件、2FA验证码、账号格式转换在线工具',
  description:
    '号工具（HaoKit）收集常用的账号小工具：Outlook / Hotmail 邮箱取件、2FA 验证码在线生成、账号格式批量转换。打开网页就能用，令牌不保存，2FA 密钥只在浏览器本地计算。',
};

/** 不属于工具、但有独立地址的页面 */
export const PAGES = {
  privacy: {
    id: 'privacy',
    name: '隐私说明',
    desc: '本站如何处理你提交的账号、令牌和 2FA 密钥',
    icon: 'shield',
    seo: {
      title: '隐私说明 | 号工具',
      description: '号工具如何处理你提交的数据：Outlook 令牌只转发给微软、不存储；2FA 验证码和账号格式转换都在浏览器本地完成。',
    },
  },
};

/** 旧的工具 id → 新 id（旧链接自动跳转） */
export const LEGACY_IDS = { totp: '2fa' };
