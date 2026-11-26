// 安全响应头
import { config } from './config.js';
import { template } from './template.js';

// 开启访问统计时额外放行的地址：统计脚本从这里加载，统计数据发到这里
const CF_SCRIPT = 'https://static.cloudflareinsights.com';
const CF_BEACON = 'https://cloudflareinsights.com';

export function securityHeaders() {
  const analytics = Boolean(config.cfAnalyticsToken);
  return (req, res, next) => {
    const { scriptHashes } = template();
    const csp = [
      "default-src 'self'",
      // 只允许本站脚本，以及 index.html 里那段内联主题脚本（按哈希放行）；开启统计时再放行 Cloudflare 的统计脚本
      `script-src 'self' ${scriptHashes.map((h) => `'${h}'`).join(' ')}${analytics ? ` ${CF_SCRIPT}` : ''}`,
      // 邮件正文在 srcdoc 沙箱 iframe 里显示，会继承这里的策略：
      // 邮件里的远程图片、样式和字体需要放行（脚本仍然一律禁止）
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' data: https:",
      `connect-src 'self'${analytics ? ` ${CF_BEACON}` : ''}`,
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // 默认完全不发来源地址。开启统计时 Cloudflare 要靠来源识别是哪个网站，改为只发域名（不含路径）；
    // 邮件正文的 iframe 自己声明了 no-referrer，邮件里的外部图片仍然拿不到来源
    res.setHeader('Referrer-Policy', analytics ? 'strict-origin' : 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // 只在 HTTPS 请求上要求浏览器以后都用 HTTPS（反向代理转发的协议要靠 trust proxy 识别）
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
