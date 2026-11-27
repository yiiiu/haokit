// 运行配置：全部来自环境变量，生产环境写在 /etc/haokit.env（见 .env.example）

const num = (v, fallback) => {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// TRUST_PROXY：信任哪些反向代理转发的 X-Forwarded-For / X-Forwarded-Proto
//   loopback（默认）只信任本机的代理（Caddy 和本服务在同一台机器）
//   也可以写 IP / 网段列表、跳数，或 true / false
function parseTrustProxy(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  // 网站正式地址，用于 canonical 和 sitemap，例如 https://haokit.xyz；不填时按请求的域名生成
  siteUrl: (process.env.SITE_URL || '').trim().replace(/\/+$/, ''),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY || 'loopback'),
  // 套了 Cloudflare 时设为 cf-connecting-ip，用它取访问者真实 IP（只在请求来自本机代理时才读取）
  clientIpHeader: (process.env.CLIENT_IP_HEADER || '').trim().toLowerCase(),
  rateLimit: {
    max: num(process.env.RATE_LIMIT_MAX, 300),
    windowMs: num(process.env.RATE_LIMIT_WINDOW_SEC, 600) * 1000,
  },
  concurrency: {
    global: num(process.env.MAX_CONCURRENT_FETCH, 20),
    perIp: num(process.env.MAX_CONCURRENT_PER_IP, 5),
    queueMs: num(process.env.FETCH_QUEUE_TIMEOUT_SEC, 30) * 1000,
  },
  // Cloudflare Web Analytics 的站点令牌；不填就不加载统计脚本（本地开发默认不统计）
  cfAnalyticsToken: parseToken(process.env.CF_ANALYTICS_TOKEN),
};

function parseToken(v) {
  const token = (v || '').trim();
  if (!token) return '';
  if (/^[A-Za-z0-9]{16,64}$/.test(token)) return token;
  console.warn('[config] CF_ANALYTICS_TOKEN 格式不对（应为 Cloudflare 后台给的一串字母数字），访问统计未开启');
  return '';
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

/** 访问者 IP：优先用受信任代理转发的地址 */
export function clientIp(req) {
  if (config.clientIpHeader && LOOPBACK.test(req.socket?.remoteAddress || '')) {
    const v = req.get(config.clientIpHeader);
    if (v) return v.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** 网站根地址（不带末尾斜杠） */
export function siteBase(req) {
  return config.siteUrl || `${req.protocol}://${req.get('host')}`;
}
