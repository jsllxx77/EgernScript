'use strict';

// x_cookie_capture.js — 捕获 X (Twitter) 网页版的 auth_token + ct0
//
// ⚠️ 重要前提：X 的官方 App 不使用浏览器 Cookie（走 OAuth 会话令牌，且 App 有证书固定，
//    MITM 也解不开），所以「打开 X App 抓 Cookie」这条路本身不成立。
//    本脚本只能从浏览器抓：Safari / Chrome 打开 x.com 并登录。
//
// 模式:
//   http_request 捕获: 请求里出现 auth_token / ct0 就分别记账，凑齐后推送服务器 + 通知
//   generic 手动导出: 读取已保存的 cookie 并通知（点通知复制到剪贴板，不受 NOTIFY 开关影响）
// 推送端点: https://wyy.wi11.de/x-cookie-update.php?key=<KEY>（KEY 来自 ctx.env.X_COOKIE_KEY / $argument）
// 配合: x_cookie_capture.yaml / x_cookie_capture.sgmodule（MITM: x.com, *.x.com, api.twitter.com …）
//
// 环境变量:
//   X_COOKIE_KEY  推送密钥（首尾空白会被自动剔除）
//   NOTIFY        通知策略：all（默认，全部） / errors（只报错误） / off（完全不弹）
//   DEBUG         true 时每次匹配都发诊断通知（排查用，需要 NOTIFY 不为 off）
//
// 去重: 同一条 cookie 在 PUSH_COOLDOWN 秒内只推送/通知一次，避免 x.com 并发请求导致重复弹窗。

const K_AUTH = 'X_AUTH_TOKEN';
const K_CT0 = 'X_CT0';
const K_RAW = 'X_COOKIE_RAW';
const K_TS = 'X_COOKIE_TS';
const K_LAST = 'X_LAST_PUSH';
const K_DIAG = 'X_COOKIE_DIAG_COUNT';
const K_DBG = 'X_COOKIE_DEBUG_SEEN';
const DIAG_THRESHOLD = 20;
const DEBUG_ALWAYS = 5;
const PUSH_COOLDOWN = 20;
const SCRIPT_VERSION = '2026.10.21-egern4';
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

function storageGet(key, ctx) {
  if (ctx && ctx.storage && typeof ctx.storage.get === 'function') return ctx.storage.get(key);
  if (typeof $persistentStore !== 'undefined') return $persistentStore.read(key);
  if (typeof $prefs !== 'undefined') return $prefs.valueForKey(key);
  return null;
}

function storageSet(value, key, ctx) {
  if (!value) return false;
  if (ctx && ctx.storage && typeof ctx.storage.set === 'function') {
    ctx.storage.set(key, value);
    return true;
  }
  if (typeof $persistentStore !== 'undefined') return $persistentStore.write(value, key);
  if (typeof $prefs !== 'undefined') return $prefs.setValueForKey(value, key);
  return false;
}

function getEnv(ctx, name) {
  if (ctx && ctx.env && ctx.env[name]) return String(ctx.env[name]);
  return '';
}

function isOn(v) {
  return /^(1|true|yes|on)$/i.test(String(v || '').trim());
}

// 通知策略：all | errors | off
function notifyMode(ctx) {
  const m = String(getEnv(ctx, 'NOTIFY') || 'all').trim().toLowerCase();
  return m === 'off' || m === 'errors' ? m : 'all';
}

// opts: { action, kind: 'info'|'error', force }
function notify(title, subtitle, message, ctx, opts) {
  const o = opts || {};
  if (!o.force) {
    const mode = notifyMode(ctx);
    if (mode === 'off') return undefined;
    if (mode === 'errors' && o.kind !== 'error') return undefined;
  }
  try {
    if (ctx && typeof ctx.notify === 'function') {
      const payload = { title, subtitle: subtitle || '', body: message || '' };
      if (o.action) payload.action = o.action;
      return ctx.notify(payload);
    }
    if (typeof $notification !== 'undefined') return $notification.post(title, subtitle || '', message || '');
    if (typeof $notify !== 'undefined') return $notify(title, subtitle || '', message || '');
    if (typeof console !== 'undefined' && console.log) console.log(`${title} ${subtitle || ''} ${message || ''}`);
  } catch (e) {
    if (typeof console !== 'undefined' && console.log) console.log(`notify_error=${e.message || e}`);
  }
  return undefined;
}

function headerGet(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    try { return headers.get(name) || ''; } catch (e) { /* fallthrough */ }
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === lower) {
      const v = headers[key];
      return Array.isArray(v) ? v.join('; ') : String(v == null ? '' : v);
    }
  }
  return '';
}

function done(value) {
  if (typeof $done !== 'undefined') return $done(value || {});
  return undefined;
}

function getPushKey(ctx) {
  // 去掉所有空白字符：从终端/聊天窗口粘贴 key 时极易带上尾部换行或空格，
  // 那会让 key 变成 33 位从而被服务器判为 invalid key。
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, '');
  const k = clean(getEnv(ctx, 'X_COOKIE_KEY'));
  if (k) return k;
  if (typeof $argument !== 'undefined' && $argument) return clean($argument);
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
    return $task.fetch({ method: 'POST', url: options.url || url, headers: options.headers, body: options.body })
      .then((resp) => ({ status: resp.statusCode, body: resp.body }));
  }
  return Promise.reject(new Error('HTTP client unavailable'));
}

function clipboardAction(raw) {
  // Egern 支持 action.clipboard，点通知即可复制；其他运行时忽略该字段
  return { type: 'clipboard', text: raw };
}

function buildCookieStr(authToken, ct0) {
  const parts = [];
  if (authToken) parts.push(`auth_token=${authToken}`);
  if (ct0) parts.push(`ct0=${ct0}`);
  return parts.join('; ');
}

// ---------- 诊断 ----------

function debugNotify(ctx, url, cookieHeader, cookies, authToken, ct0) {
  if (!isOn(getEnv(ctx, 'DEBUG'))) return;
  const seen = parseInt(storageGet(K_DBG, ctx) || '0', 10) + 1;
  storageSet(String(seen), K_DBG, ctx);
  if (seen > DEBUG_ALWAYS && seen % DIAG_THRESHOLD !== 0) return;

  const host = (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] || '?';
  const keys = Object.keys(cookies);
  const lines = [
    `#${seen} host=${host}`,
    `Cookie头: ${cookieHeader ? '有' : '无'}`,
    `字段: ${keys.length ? keys.slice(0, 10).join(', ') : '（空）'}`,
    `auth_token: ${authToken ? '有' : '无'} / ct0: ${ct0 ? '有' : '无'}`,
  ];
  notify('X Cookie 诊断', cookieHeader ? '脚本已运行' : '脚本已运行（无 Cookie）', lines.join('\n'), ctx, { kind: 'info' });
}

// ---------- 捕获逻辑 ----------

async function pushCookie(raw, ctx) {
  const key = getPushKey(ctx);
  if (!key) {
    notify('X Cookie', '已捕获（未配置推送KEY）', raw, ctx, { action: clipboardAction(raw), kind: 'info' });
    return;
  }
  try {
    const resp = await httpPost(`${PUSH_URL}?key=${encodeURIComponent(key)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `cookie=${encodeURIComponent(raw)}`,
    }, ctx);
    const bodyText = String(resp.body || '').slice(0, 120);
    if (resp.status === 200) {
      notify('X Cookie', '✅ 服务器已自动更新', `len=${raw.length} · parse_hub_bot 约1分钟内生效`, ctx, { kind: 'info' });
    } else if (resp.status === 401 || resp.status === 403) {
      // 打出 key 长度：可区分「没填」「填错」「多了空格/换行」三种情况
      notify('X Cookie', '❌ 推送被拒：密钥无效',
        `服务器返回 HTTP ${resp.status} ${bodyText}\n当前 X_COOKIE_KEY 长度 = ${key.length}\n请确认它与服务器 x-cookie-update.php 里的 key 完全一致（注意首尾空格、换行）`,
        ctx, { action: clipboardAction(raw), kind: 'error' });
    } else {
      notify('X Cookie', '❌ 服务器更新失败', `HTTP ${resp.status} ${bodyText}`, ctx, { action: clipboardAction(raw), kind: 'error' });
    }
  } catch (e) {
    notify('X Cookie', '❌ 推送失败', String(e.message || e), ctx, { action: clipboardAction(raw), kind: 'error' });
  }
}

async function captureRequest(ctx) {
  // 只读请求头，绝不读 body：抓 cookie 不需要它，而 Egern 的 body 只能消费一次，
  // 读了会把 X 的 POST（登录/发帖）请求体弄丢。
  const req = ctx.request || (typeof $request !== 'undefined' ? $request : {}) || {};
  const headers = req.headers || {};
  const url = req.url || '';
  const cookieHeader = headerGet(headers, 'Cookie');
  const cookies = parseCookies(cookieHeader);

  // auth_token：只可能来自 Cookie（HttpOnly，但请求头里仍然会带）
  const authToken = cookies.auth_token || storageGet(K_AUTH, ctx) || '';

  // ct0：可能来自 Cookie，也可能只在 x-csrf-token 请求头里
  let ct0 = cookies.ct0 || '';
  if (!ct0) {
    const csrf = headerGet(headers, 'x-csrf-token') || headerGet(headers, 'x-xsrf-token');
    if (csrf && /^[A-Za-z0-9_\-+/=]{16,}$/.test(csrf)) ct0 = csrf;
  }
  if (!ct0) ct0 = storageGet(K_CT0, ctx) || '';

  debugNotify(ctx, url, cookieHeader, cookies, authToken, ct0);

  // 分别记账：任何一半出现都先存下来，另一半下次补齐
  if (cookies.auth_token) storageSet(cookies.auth_token, K_AUTH, ctx);
  if (cookies.ct0) storageSet(cookies.ct0, K_CT0, ctx);

  if (!authToken || !ct0) {
    // 没凑齐 → 静默透传，但保留心跳诊断（每 20 次提醒一次脚本在跑）
    const n = parseInt(storageGet(K_DIAG, ctx) || '0', 10) + 1;
    storageSet(String(n), K_DIAG, ctx);
    if (n % DIAG_THRESHOLD === 0) {
      notify('X Cookie', `诊断: 脚本在运行（${n} 次）`, `已匹配到 X 请求，但尚未凑齐 auth_token + ct0。\n当前: auth_token=${authToken ? '有' : '无'} ct0=${ct0 ? '有' : '无'}\n请用 Safari 打开 x.com 并确认已登录；环境变量 DEBUG=true 可看每次请求的明细。`, ctx, { kind: 'info' });
    }
    return done({}); // 透传
  }

  const raw = buildCookieStr(authToken, ct0);
  const oldRaw = storageGet(K_RAW, ctx) || '';
  const now = Math.floor(Date.now() / 1000);
  const lastPush = parseInt(storageGet(K_LAST, ctx) || '0', 10);

  // cookie 变了 且 距离上次推送超过冷却时间，才推送+通知。
  // x.com 一次打开会并发多条请求，两个脚本实例可能在极短时间内都判定「cookie 是新的」，
  // 冷却窗口把这种情况收敛成一条通知。
  if (raw && raw !== oldRaw && now - lastPush >= PUSH_COOLDOWN) {
    storageSet(raw, K_RAW, ctx);
    storageSet(String(now), K_TS, ctx);
    storageSet(String(now), K_LAST, ctx);
    storageSet('0', K_DIAG, ctx);
    await pushCookie(raw, ctx);
  }
  return done({}); // 透传
}

// ---------- 手动导出（generic 脚本，通知强制显示） ----------

async function exportCookie(ctx) {
  const raw = storageGet(K_RAW, ctx) || buildCookieStr(storageGet(K_AUTH, ctx) || '', storageGet(K_CT0, ctx) || '');
  const ts = storageGet(K_TS, ctx) || '';
  const date = ts ? new Date(Number(ts) * 1000).toLocaleString() : '';
  const authToken = storageGet(K_AUTH, ctx) || '';
  const ct0 = storageGet(K_CT0, ctx) || '';
  if (!raw) {
    notify('X Cookie', '尚未捕获', '请用 Safari 打开 x.com 并登录（X 官方 App 不走网页 Cookie，抓不到）。确认 MITM 已开启、证书已信任，必要时开启「屏蔽 QUIC」后再试。', ctx, { force: true });
    return done({});
  }
  notify('X Cookie', `捕获时间 ${date} · 点击复制`, raw, ctx, { action: clipboardAction(raw), force: true });
  if (!authToken || !ct0) {
    notify('X Cookie', '提示', `当前只凑齐了一半：auth_token=${authToken ? '有' : '无'} ct0=${ct0 ? '有' : '无'}`, ctx, { force: true });
  }
  if (!getPushKey(ctx)) {
    notify('X Cookie', '提示', '未配置 X_COOKIE_KEY，不会自动推送服务器', ctx, { force: true });
  }
  done({});
}

// ---------- 入口 ----------

export default async function main(ctx) {
  if (ctx && ctx.request) return captureRequest(ctx);
  return exportCookie(ctx);
}
