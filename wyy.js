// wyy.js — Surge http-response 脚本
// 功能: MITM 解密 music.163.com 后, 从 Set-Cookie 响应头提取 MUSIC_U (HttpOnly, 页面 JS 无法读取)
// 配合: wyy.sgmodule
// 用法: 启用模块 → 登录 music.163.com → 通知中心出现通知 → 长按通知展开 → 长按正文拷贝

var setCookie = String($response.headers['Set-Cookie'] || $response.headers['set-cookie'] || '');
var match = setCookie.match(/MUSIC_U=([^;]+)/);

if (match) {
  var value = match[1];
  var last = $persistentStore.read('wyy_music_u');
  if (last !== value) {
    // 仅在 Cookie 变化时通知, 避免每次请求都弹
    $persistentStore.write(value, 'wyy_music_u');
    $notification.post('网易云Cookie', '已获取新MUSIC_U · 长按本通知可复制', 'MUSIC_U=' + value);
  }
}

$done({});
