// 工具注册表：侧边栏、首页卡片、前端路由，以及服务器端的页面标题、sitemap 都从这里生成。
// 这个文件同时被浏览器和 Node 服务器读取，只能放数据，不能在顶层访问 window / document。
//
// 新增一个工具：
//   1. 新建 public/tools/<目录>/index.js，导出 mount(el, ctx)，可返回一个清理函数
//   2. 在下面的 tools 数组里加一项
//   3. 如需后端接口，新建 server/tools/<目录>/index.js 导出 router，会自动挂载到 /api/<目录>
//
// 字段说明：
//   id     页面地址 /<id>（只用小写字母、数字和横线）
//   name   名称（侧边栏、标题）
//   desc   一句话说明（首页卡片、页面副标题）
//   icon   assets/icons.js 里的图标名
//   group  所属分组 id
//   tag    可选，卡片上的小标签
//   tone   可选，首页封面的色相（0–360），默认 220
//   seo    可选，{ title, description }：浏览器标题和搜索引擎看到的标题、描述
//   soon   true 表示「即将上线」，只展示不可点
//   load   () => import('./<目录>/index.js')

export const groups = [
  { id: 'mail', name: '邮箱工具' },
  { id: 'security', name: '账号安全' },
  { id: 'data', name: '数据处理' },
];

export const tools = [
  {
    id: 'outlook',
    name: 'Outlook 取件',
    desc: '用 refresh_token 读取 Outlook / Hotmail 收件箱和垃圾箱，自动识别验证码',
    icon: 'mail',
    group: 'mail',
    tag: 'Graph · IMAP',
    tone: 212,
    seo: {
      title: 'Outlook取件 - 在线读取Hotmail/Outlook邮箱验证码 | 号工具',
      description:
        '用 refresh_token 在线读取 Outlook / Hotmail 收件箱和垃圾箱，支持 4 段、5 段、6 段等账号格式批量导入，自动识别邮件里的验证码，一键复制。',
    },
    load: () => import('./outlook/index.js'),
  },
  {
    id: '2fa',
    name: '2FA 验证码',
    desc: '粘贴 2FA 密钥，实时生成 TOTP 动态验证码，支持批量和 otpauth 链接，全程在浏览器本地计算',
    icon: 'key',
    group: 'security',
    tag: 'TOTP',
    tone: 266,
    seo: {
      title: '2FA验证码 - 谷歌验证器网页版，在线获取二步验证码 | 号工具',
      description:
        '粘贴 2FA 密钥即可实时生成 6 位动态验证码，相当于网页版谷歌验证器，支持批量、otpauth 链接和 UID|密码|2FA 格式，密钥只在浏览器本地计算。',
    },
    load: () => import('./totp/index.js'),
  },
  {
    id: 'convert',
    name: '账号格式转换',
    desc: '把各种格式的账号批量转换成需要的格式：自动识别每一列，挑选和调整字段顺序、换分隔符、去重，一键复制或下载',
    icon: 'convert',
    group: 'data',
    tag: '批量',
    tone: 158,
    seo: {
      title: '账号格式转换 - 批量整理账号格式、去重导出 | 号工具',
      description:
        '把 ----、|、冒号等各种格式的账号批量转换成需要的格式：自动识别邮箱、密码、令牌、2FA 等字段，调整顺序、换分隔符、去重，一键复制或导出 txt。',
    },
    load: () => import('./convert/index.js'),
  },
];
