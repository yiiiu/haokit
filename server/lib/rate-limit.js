// 按 IP 限制请求频率（固定时间窗口，计数存在内存里，适合单台服务器）

function formatWait(sec) {
  return sec < 60 ? `${sec} 秒` : `${Math.ceil(sec / 60)} 分钟`;
}

/**
 * @param {{ max: number, windowMs: number, keyFn: (req) => string }} opts
 */
export function rateLimit({ max, windowMs, keyFn }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, 60_000);
  sweep.unref();

  return (req, res, next) => {
    if (!max) return next(); // RATE_LIMIT_MAX=0 关闭限流
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    const retry = Math.max(1, Math.ceil((entry.reset - now) / 1000));
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('RateLimit-Reset', String(retry));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED', error: `请求太频繁，请 ${formatWait(retry)}后再试` });
    }
    next();
  };
}
