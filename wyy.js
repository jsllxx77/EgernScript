// wyy.js — Surge http-response 脚本 (v3 诊断版)
// 功能: 从 music.163.com 的 Set-Cookie 响应头提取完整 Cookie, 自动推送到服务器更新点歌接口
// 三级诊断: 1)无Set-Cookie→心跳计数 2)有Set-Cookie无MUSIC_U→提示 3)有MUSIC_U→推送+确认
// 配合: wyy.sgmodule (MITM: music.163.com), 服务器端点: https://wyy.wi11.de/cookie-update.php

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
    var first = String(setCookies[i]).split(';')[0].trim();
    if (first && first.indexOf('=') > 0) {
      pairs.push(first);
    }
  }
  var cookieStr = pairs.join('; ');

  if (cookieStr.indexOf('MUSIC_U=') > -1) {
    var last = $persistentStore.read('wyy_cookie') || '';
    if (cookieStr !== last) {
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
      return; // 回调中会 $done
    }
  } else {
    // 诊断2: 有 Set-Cookie 但无 MUSIC_U (每小时最多提示一次)
    var d2 = $persistentStore.read('wyy_diag2') || '';
    var hour = String(new Date().getHours());
    if (d2 !== hour) {
      $persistentStore.write(hour, 'wyy_diag2');
      $notification.post('网易云Cookie', '🔍 诊断: 有Set-Cookie但无MUSIC_U', '登录响应未包含MUSIC_U，请查看最近请求确认登录域名');
    }
  }
} else {
  // 诊断1: 心跳 — 无 Set-Cookie 的响应, 每30次通知一次确认脚本在运行
  var count = parseInt($persistentStore.read('wyy_run_count') || '0', 10) + 1;
  $persistentStore.write(String(count), 'wyy_run_count');
  if (count % 30 === 0) {
    $notification.post('网易云Cookie', '🔍 诊断: 脚本运行中', '已执行' + count + '次，均无Set-Cookie');
  }
}

$done({});
