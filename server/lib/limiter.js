// 并发控制：限制全站和单个 IP 同时进行的取件请求数，超出的排队等待，等太久就放弃

export class BusyError extends Error {
  constructor() {
    super('服务器繁忙，请稍后再试');
    this.code = 'BUSY';
    this.status = 503;
  }
}

/**
 * @param {{ global: number, perIp: number, queueMs: number }} opts
 */
export function createLimiter({ global, perIp, queueMs }) {
  let active = 0;
  const perKey = new Map();
  const queue = [];

  const canStart = (key) => active < global && (perKey.get(key) || 0) < perIp;
  const start = (key) => {
    active++;
    perKey.set(key, (perKey.get(key) || 0) + 1);
  };

  function makeRelease(key) {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      active--;
      const n = (perKey.get(key) || 1) - 1;
      if (n > 0) perKey.set(key, n);
      else perKey.delete(key);
      drain();
    };
  }

  function drain() {
    for (let i = 0; i < queue.length; ) {
      const w = queue[i];
      if (canStart(w.key)) {
        queue.splice(i, 1);
        clearTimeout(w.timer);
        start(w.key);
        w.resolve(makeRelease(w.key));
      } else i++;
    }
  }

  /** 拿到执行名额，返回释放函数（务必在 finally 里调用） */
  function acquire(key) {
    if (canStart(key)) {
      start(key);
      return Promise.resolve(makeRelease(key));
    }
    return new Promise((resolve, reject) => {
      const w = { key, resolve };
      w.timer = setTimeout(() => {
        const i = queue.indexOf(w);
        if (i >= 0) queue.splice(i, 1);
        reject(new BusyError());
      }, queueMs);
      queue.push(w);
    });
  }

  return { acquire, stats: () => ({ active, queued: queue.length }) };
}
