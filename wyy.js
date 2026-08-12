// wyy.js — Surge http-response 脚本
// 功能: MITM 解密 music.163.com 后, 从 Set-Cookie 响应头提取 MUSIC_U (HttpOnly, 页面 JS 无法读取)
// 配合: wyy.sgmodule
// 用法: 启用模块 → 退出登录后重新登录 music.163.com → 通知中心出现通知 → 长按通知展开 → 长按正文拷贝
// 注意: MUSIC_U 仅在登录接口的 Set-Cookie 中出现一次, 已登录状态浏览页面不会触发

var setCookie = String($response.headers['Set-Cookie'] || $response.headers['set-cookie'] || '');

if (setCookie) {
  var match = setCookie.match(/MUSIC_U=([^;]+)/);

  if (match && match[1]) {
    var value = match[1];
    var last = $persistentStore.read('wyy_music_u');
    if (last !== value) {
      $persistentStore.write(value, 'wyy_music_u');
      // 成功获取后重置诊断标志
      $persistentStore.write('', 'wyy_diag_notified');
      $notification.post('网易云Cookie', '已获取新MUSIC_U · 长按本通知可复制', 'MUSIC_U=' + value);
    }
  } else {
    // 诊断: 检测到 Set-Cookie 但无 MUSIC_U, 仅提示一次
    var diag = $persistentStore.read('wyy_diag_notified');
    if (!diag) {
      $persistentStore.write('1', 'wyy_diag_notified');
      $notification.post('网易云Cookie', '脚本已生效但未发现MUSIC_U', '检测到Set-Cookie，请退出登录后重新登录再试');
    }
  }
}

$done({});
