'use strict';

const SIGN_KEY = 'apr1$AwP!wRRT$gJ/q.X24poeBInlUJC';
const API_BASE = 'https://user-api.smzdm.com';
const DEFAULT_VERSION = '10.4.26';
const SCRIPT_VERSION = '2026.06.07-egern1';

function md5(input) {
  // Pure JS MD5, no Node/CryptoJS dependency; works in Loon/Surge-like JS runtimes.
  function add32(a, b) { return (a + b) & 0xffffffff; }
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5cycle(x, k) {
    let [a, b, c, d] = x;
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);

    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);

    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);

    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function md5blk(s) {
    const blocks = [];
    for (let i = 0; i < 64; i += 4) {
      blocks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return blocks;
  }
  function md51(s) {
    const utf8 = unescape(encodeURIComponent(String(s)));
    const n = utf8.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(utf8.substring(i - 64, i)));
    const tail = new Array(16).fill(0);
    const rem = utf8.substring(i - 64);
    for (i = 0; i < rem.length; i++) tail[i >> 2] |= rem.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) { md5cycle(state, tail); tail.fill(0); }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function rhex(n) {
    let s = '';
    for (let j = 0; j < 4; j++) s += (`0${((n >> (j * 8)) & 0xff).toString(16)}`).slice(-2);
    return s;
  }
  return md51(input).map(rhex).join('').toUpperCase();
}

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

function cookieKeys(cookieStr) {
  return Object.keys(parseCookies(cookieStr)).slice(0, 12).join(', ') || '无';
}

function signData(data) {
  const parts = Object.keys(data)
    .sort()
    .map((key) => [key, String(data[key]).replace(/[ \t\n]/g, '')])
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`);
  return md5(`${parts.join('&')}&key=${SIGN_KEY}`);
}

function encodeForm(data) {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
}

function extractSk(body) {
  const m = String(body || '').match(/(?:^|&)sk=([^&]+)/);
  return m ? decodeURIComponent(m[1].replace(/\+/g, '%20')) : '';
}

function buildForm(cookie, sk, nowSeconds) {
  const cookies = parseCookies(cookie);
  const data = {
    weixin: '1',
    basic_v: '0',
    f: cookies.device_smzdm || 'android',
    v: cookies.device_smzdm_version || DEFAULT_VERSION,
    time: `${Math.floor(nowSeconds || Date.now() / 1000)}000`,
    token: cookies.sess || '',
  };
  if (sk) data.sk = sk;
  data.sign = signData(data);
  return data;
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

function notify(title, subtitle, message, ctx) {
  const text = `${title} ${subtitle || ''} ${message || ''}`;
  try {
    if (ctx && typeof ctx.notify === 'function') return ctx.notify({ title, subtitle: subtitle || '', body: message || '' });
    if (typeof $notification !== 'undefined') return $notification.post(title, subtitle || '', message || '');
    if (typeof $notify !== 'undefined') return $notify(title, subtitle || '', message || '');
    if (typeof console !== 'undefined' && console.log) console.log(text);
  } catch (e) {
    if (typeof console !== 'undefined' && console.log) console.log(`${text} notify_error=${e.message || e}`);
  }
}

function headerGet(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  return getRequestHeader(headers, name);
}

function done(value) {
  if (typeof $done !== 'undefined') return $done(value || {});
}

function getRequestHeader(headers, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return '';
}

async function captureRequest(ctx) {
  const req = (ctx && ctx.request) || (typeof $request !== 'undefined' && $request) || {};
  const headers = req.headers || {};
  const cookie = headerGet(headers, 'Cookie');
  let body = req.body || '';
  if (ctx && ctx.request && typeof ctx.request.text === 'function') {
    try { body = await ctx.request.text(); } catch (_) { body = ''; }
  }
  const sk = extractSk(body);
  const url = req.url || '';
  const host = (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] || 'unknown-host';
  const storageApi = ctx && ctx.storage ? 'ctx.storage' : (typeof $persistentStore !== 'undefined' ? '$persistentStore' : (typeof $prefs !== 'undefined' ? '$prefs' : '无'));

  if (cookie && cookie.includes('sess=')) {
    const savedCookie = storageSet(cookie, 'SMZDM_COOKIE', ctx);
    if (sk) storageSet(sk, 'SMZDM_SK', ctx);
    const verifyCookie = storageGet('SMZDM_COOKIE', ctx);
    notify('什么值得买', 'Cookie 获取成功', `版本：${SCRIPT_VERSION}\n来源：${host}\n存储：${storageApi}\n写入：${savedCookie ? '成功' : '失败'}\n读回：${verifyCookie ? '有' : '无'}\n已保存 Cookie${sk ? ' 和 SK' : ''}`, ctx);
  } else if (cookie) {
    notify('什么值得买', '抓到请求但没有 sess', `版本：${SCRIPT_VERSION}\n来源：${host}\n存储：${storageApi}\nCookie字段：${cookieKeys(cookie)}`, ctx);
  } else {
    notify('什么值得买', '抓到请求但没有 Cookie', `版本：${SCRIPT_VERSION}\n来源：${host}\n存储：${storageApi}\n请确认网页已登录，或换 www/zhiyou 页面刷新`, ctx);
  }

  // Egern request scripts return nothing to pass through.
  done({});
}

function request(options, ctx) {
  if (ctx && ctx.http && typeof ctx.http.post === 'function') {
    return ctx.http.post(options.url, { headers: options.headers, body: options.body, timeout: 30000 })
      .then(async (resp) => ({ status: resp.status, body: await resp.text() }));
  }
  if (typeof $httpClient !== 'undefined') {
    return new Promise((resolve, reject) => {
      $httpClient.post(options, (err, resp, body) => {
        if (err) return reject(err);
        resolve({ status: resp && resp.status, body });
      });
    });
  }
  if (typeof $task !== 'undefined') {
    return $task.fetch({ method: 'POST', url: options.url, headers: options.headers, body: options.body })
      .then((resp) => ({ status: resp.statusCode, body: resp.body }));
  }
  throw new Error('HTTP client is unavailable in this runtime.');
}

async function postApi(endpoint, cookie, sk, ctx) {
  const cookies = parseCookies(cookie);
  const vc = cookies.device_smzdm_version_code || '866';
  const version = cookies.device_smzdm_version || DEFAULT_VERSION;
  const platform = cookies.device_smzdm || 'android';
  const ua = `smzdm_${platform}_V${version} rv:${vc} (iPhone;iOS17;zh)smzdmapp`;
  const form = buildForm(cookie, sk);
  const res = await request({
    url: `${API_BASE}${endpoint}`,
    headers: {
      'User-Agent': ua,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      request_key: `${Math.floor(Math.random() * 9000000000000000) + 1000000000000000}`,
    },
    body: encodeForm(form),
  }, ctx);
  let json;
  try { json = JSON.parse(res.body || '{}'); } catch (e) { throw new Error(`响应不是 JSON: HTTP ${res.status} ${String(res.body).slice(0, 80)}`); }
  const code = json.error_code;
  if (code !== undefined && Number(code) !== 0) throw new Error(json.error_msg || `API error ${code}`);
  return json;
}

async function checkin(ctx) {
  const cookie = storageGet('SMZDM_COOKIE', ctx);
  const sk = storageGet('SMZDM_SK', ctx) || '';
  const runtime = ctx && ctx.http ? 'ctx.http' : (typeof $httpClient !== 'undefined' ? '$httpClient' : (typeof $task !== 'undefined' ? '$task' : '无HTTP客户端'));
  const storageApi = ctx && ctx.storage ? 'ctx.storage' : (typeof $persistentStore !== 'undefined' ? '$persistentStore' : (typeof $prefs !== 'undefined' ? '$prefs' : '无'));
  notify('什么值得买', '手动签到开始', `版本：${SCRIPT_VERSION}\nCookie：${cookie ? '已保存' : '未保存'}\nSK：${sk ? '已保存' : '未保存'}\n运行时：${runtime}\n存储：${storageApi}`, ctx);
  if (!cookie || !cookie.includes('sess=')) {
    notify('什么值得买', '签到失败', '未保存含 sess 的 Cookie。请先用 Cookie 获取模块打开 www.smzdm.com 或 zhiyou.smzdm.com 登录/刷新。', ctx);
    return done({});
  }

  try {
    const checkinRes = await postApi('/checkin', cookie, sk, ctx);
    let rewardText = '';
    try {
      const rewardRes = await postApi('/checkin/all_reward', cookie, sk, ctx);
      const gift = (((rewardRes || {}).data || {}).normal_reward || {}).gift || {};
      rewardText = gift.title || gift.content_str || '';
    } catch (e) {
      rewardText = '';
    }

    const d = (checkinRes.data || {});
    const lines = [
      `连续签到：${d.daily_num || 0} 天`,
      `金币：+${d.cgold || 0}`,
      `积分：+${d.cpoints || 0}`,
      `经验：+${d.cexperience || 0}`,
    ];
    if (rewardText) lines.push(`奖励：${rewardText}`);
    notify('什么值得买', '签到成功', lines.join('\n'), ctx);
  } catch (e) {
    const skHint = sk ? '' : '\n提示：当前未保存 SK；如果 API 要求 SK，网页 Cookie 可能不够。';
    notify('什么值得买', '签到失败', `${String(e.message || e)}${skHint}`, ctx);
  }
  done({});
}

export default async function main(ctx) {
  if (ctx && ctx.request) return captureRequest(ctx);
  return checkin(ctx);
}

export { md5, parseCookies, signData, encodeForm, extractSk, buildForm };
