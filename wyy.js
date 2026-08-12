// wyy.js — Surge http-response 脚本
// 功能: 从 music.163.com 的 Set-Cookie 响应头提取完整 Cookie, 自动推送到服务器更新点歌接口
// 配合: wyy.sgmodule (MITM: music.163.com), 服务器端点: https://wyy.wi11.de/cookie-update.php
// 用法: 启用模块 → 退出登录后重新登录 music.163.com → 服务器自动更新并收到确认通知
// 注意: MUSIC_U 是 HttpOnly, 页面 JS 无法读取, 只能从 Set-Cookie 响应头获取; 仅在登录时下发

var headers = $response.headers;
var setCookies = [];

// Surge 中同名响应头可能为数组或字符串
for (var k in headers) {
  if (k.toLowerCase() === 'set-cookie') {
    var v = headers[k];
    if (Array.isArray(v)) {
      setCookies = setCookies.concat(v);
    } else {
      setCookies.push(String(v));
    }
  }
}

if (setCookies.length > 0) {
  // 解析所有 Set-Cookie: 取每个条目第一个 name=value (跳过 path/expires 等属性)
  var pairs = [];
  for (var i = 0; i < setCookies.length; i++) {
    var sc = String(setCookies[i]);
    var first = sc.split(';')[0].trim();
    if (first && first.indexOf('=') > 0) {
      pairs.push(first);
    }
  }

  var cookieStr = pairs.join('; ');
  var last = $persistentStore.read('wyy_cookie') || '';

  // 仅当包含 MUSIC_U 且内容变化时推送 (避免每次请求都触发)
  if (cookieStr && cookieStr.indexOf('MUSIC_U=') > -1 && cookieStr !== last) {
    $persistentStore.write(cookieStr, 'wyy_cookie');
    var key = $argument || '';
    $httpClient.post({
      url: 'https://wyy.wi11.de/cookie-update.php?key=' + encodeURIComponent(key),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'cookie=' + encodeURIComponent(cookieStr),
      timeout: 10
    }, function(error, response) {
      if (!error && response && response.statusCode === 200) {
        $notification.post('网易云Cookie', '✅ 服务器已自动更新', '共' + pairs.length + '个字段 · ' + cookieStr.length + '字符');
      } else {
        $notification.post('网易云Cookie', '❌ 服务器更新失败', String(error || ('HTTP ' + (response ? response.statusCode : '?'))));
      }
      $done({});
    });
  } else {
    $done({});
  }
} else {
  $done({});
}
