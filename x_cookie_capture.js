'use strict';

// x_cookie_capture.js — 捕获 X (Twitter) app/网页的 auth_token + ct0
// 模式:
//   http_request 捕获: 请求带 Cookie 时提取 auth_token/ct0，变化则本地保存 + 推送服务器 + 通知
//   generic 手动导出: 读取已保存的 cookie 并通知（Egern 点通知复制到剪贴板）
// 推送端点: https://wyy.wi11.de/x-cookie-update.php?key=<KEY>（KEY 来自 ctx.env.X_COOKIE_KEY / $argument）
// 配合: x_cookie_capture.yaml / x_cookie_capture.sgmodule (MITM: api.twitter.com, twitter.com, x.com)

const STORAGE_KEY = 'X_COOKIE_RAW';
const STORAGE_KEY_TS = 'X_COOKIE_TS';
const STORAGE_KEY_DIAG = 'X_COOKIE_DIAG_COUNT';
const DIAG_THRESHOLD = 20;
const SCRIPT_VERSION = '2026.08.16-egern2';
const PUSH_URL = 'https://wyy.wi11.de/x-cookie-update.php';

// ---------- 通用兼容层 ----------

function parseCookies(cookieStr) {
  const out = {};
  String(cookieStr || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try { out[key] = decodeURIComponent(value); } catch (e) { out[key] = value; }
    }
  });
  return out;
}

function buildCookieStr(cookies) {
  const parts = [];
  if (cookies.auth_token) parts.push(`auth_token=${cookies.auth_token}`);
  if (cookies.ct0) parts.push(`ct0=${cookies.ct0}`);
  return parts.join('; ');
}

function storageGet(key, ctx) {
  if (ctx && ctx.storage && typeof ctx.storage.get === 'function') return ctx.storage.get(key);
  if (typeof $persistentStore !== 'undefined') return $persistentStore.read(key);
  if (typeof $prefs !== 'undefined') return $prefs.valueForKey(key);
  return null;
}

function storageSet(value, key, ctx) {
  if (ctx && ctx.storage && typeof ctx.storage.set === 'function') {
    ctx.storage.set(key, value);
    return true;
  }
  if (typeof $persistentStore !== 'undefined') return $persistentStore.write(value, key);
  if (typeof $prefs !== 'undefined') return $prefs.setValueForKey(value, key);
  return false;
}

function notify(title, subtitle, message, ctx, action) {
  try {
    if (ctx && typeof ctx.notify === 'function') {
      const opts = { title, subtitle: subtitle || '', body: message || '' };
      if (action) opts.action = action;
      return ctx.notify(opts);
    }
    if (typeof $notification !== 'undefined') return $notification.post(title, subtitle || '', message || '');
    if (typeof $notify !== 'undefined') return $notify(title, subtitle || '', message || '');
    if (typeof console !== 'undefined' && console.log) console.log(`${title} ${subtitle || ''} ${message || ''}`);
  } catch (e) {
    if (typeof console !== 'undefined' && console.log) console.log(`notify_error=${e.message || e}`);
  }
}

function headerGet(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === lower) return headers[key];
  }
  return '';
}

function done(value) {
  if (typeof $done !== 'undefined') return $done(value || {});
}

function getPushKey(ctx) {
  if (ctx && ctx.env && ctx.env.X_COOKIE_KEY) return ctx.env.X_COOKIE_KEY;
  if (typeof $argument !== 'undefined' && $argument) return String($argument);
  return '';
}

function httpPost(url, options, ctx) {
  if (ctx && ctx.http && typeof ctx.http.post === 'function') {
    return ctx.http.post(url, {
      headers: options.headers,
      body: options.body,
      timeout: 15000,
      credentials: 'omit',
    }).then(async (resp) => ({ status: resp.status, body: await resp.text() }));
  }
  if (typeof $httpClient !== 'undefined') {
    return new Promise((resolve, reject) => {
      $httpClient.post({ url, headers: options.headers, body: options.body, timeout: 15 }, (err, resp, body) => {
        if (err) return reject(err);
        resolve({ status: resp && resp.status, body });
      });
    });
  }
  if (typeof $task !== 'undefined') {
    return $task.fetch({ method: 'POST', url, headers: options.headers, body: options.body })
      .then((resp) => ({ status: resp.statusCode, body: resp.body }));
  }
  return Promise.reject(new Error('HTTP client unavailable'));
}

// ---------- 捕获逻辑 ----------

async function pushCookie(raw, ctx) {
  const key = getPushKey(ctx);
  if (!key) {
    notify('X Cookie', '已捕获（未配置推送KEY）', raw, ctx, clipboardAction(raw));
    return;
  }
  try {
    const resp = await httpPost(`${PUSH_URL}?key=${encodeURIComponent(key)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `cookie=${encodeURIComponent(raw)}`,
    }, ctx);
    if (resp.status === 200) {
      notify('X Cookie', '✅ 服务器已自动更新', `len=${raw.length} · parse_hub_bot 约1分钟内生效`, ctx, clipboardAction(raw));
    } else {
      notify('X Cookie', '❌ 服务器更新失败', `HTTP ${resp.status} ${String(resp.body).slice(0, 80)}`, ctx, clipboardAction(raw));
    }
  } catch (e) {
    notify('X Cookie', '❌ 推送失败', String(e.message || e), ctx, clipboardAction(raw));
  }
}

function clipboardAction(raw) {
  // Egern 支持 action.clipboard，点通知即可复制；其他运行时忽略该字段
  return { type: 'clipboard', text: raw };
}

async function captureRequest(ctx) {
  const req = (ctx && ctx.request) || (typeof $request !== 'undefined' && $request) || {};
  const headers = req.headers || {};
  const cookies = parseCookies(headerGet(headers, 'Cookie'));
  // X app 有时 ct0 只出现在 x-csrf-token 请求头
  if (!cookies.ct0) {
    const csrf = headerGet(headers, 'x-csrf-token');
    if (csrf && /^[A-Za-z0-9_-]{16,}$/.test(csrf)) cookies.ct0 = csrf;
  }

  if (!cookies.auth_token || !cookies.ct0) {
    // 诊断: 请求匹配到了但没有完整 cookie —— 计数, 每 20 次通知一次证明脚本在运行
    const n = parseInt(storageGet(STORAGE_KEY_DIAG, ctx) || '0', 10) + 1;
    storageSet(String(n), STORAGE_KEY_DIAG, ctx);
    if (n % DIAG_THRESHOLD === 0) {
      notify('X Cookie', `诊断: 脚本在运行 (${n} 次)`, '已匹配到 X 请求, 但均无 auth_token/ct0。可能原因:\n① X app 走 QUIC/HTTP3 未过 MITM\n② app 证书固定\n③ 未登录\n请用 Safari 打开 x.com 登录后刷新试试', ctx);
    }
    done({}); // 未登录/无 cookie 的请求静默透传
    return;
  }

  const raw = buildCookieStr(cookies);
  const oldRaw = storageGet(STORAGE_KEY, ctx) || '';
  if (raw && raw !== oldRaw) {
    storageSet(raw, STORAGE_KEY, ctx);
    storageSet(String(Math.floor(Date.now() / 1000)), STORAGE_KEY_TS, ctx);
    storageSet('0', STORAGE_KEY_DIAG, ctx); // 捕获成功, 清零诊断计数
    await pushCookie(raw, ctx);
  }
  done({}); // 透传
}

// ---------- 手动导出（generic 脚本） ----------

async function exportCookie(ctx) {
  const raw = storageGet(STORAGE_KEY, ctx) || '';
  const ts = storageGet(STORAGE_KEY_TS, ctx) || '';
  const date = ts ? new Date(Number(ts) * 1000).toLocaleString() : '';
  if (!raw) {
    notify('X Cookie', '尚未捕获', '请先打开 X app 刷一下时间线，或登录网页版 x.com；确认 MITM 已开启且证书已信任。', ctx);
    return done({});
  }
  notify('X Cookie', `捕获时间 ${date} · 点击复制`, raw, ctx, clipboardAction(raw));
  if (!getPushKey(ctx)) {
    notify('X Cookie', '提示', '未配置 X_COOKIE_KEY，不会自动推送服务器', ctx);
  }
  done({});
}

// ---------- 入口 ----------

export default async function main(ctx) {
  if (ctx && ctx.request) return captureRequest(ctx);
  return exportCookie(ctx);
}
