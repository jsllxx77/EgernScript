// ==UserScript==
// @name        网易云Cookie提取
// @match       https://music.163.com/*
// @run-at      document-idle
// ==/UserScript==

(function() {
    'use strict';
    var btn = document.createElement('div');
    btn.textContent = '复制Cookie';
    btn.style.cssText = 'position:fixed;right:10px;bottom:80px;z-index:999999;'
        + 'background:#e60026;color:#fff;padding:8px 14px;border-radius:20px;'
        + 'font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    btn.onclick = function() {
        var full = document.cookie.trim();
        if (!full) { btn.textContent = '无Cookie，请先登录'; return; }
        // 优先用剪贴板 API 直接复制完整 Cookie
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(full).then(function() {
                btn.textContent = '已复制完整Cookie(' + full.length + '字符)!';
                setTimeout(function(){ btn.textContent = '复制Cookie'; }, 2000);
            }).catch(function() {
                prompt('长按全选复制完整Cookie:', full);
            });
        } else {
            // 兜底：弹窗显示，长按全选复制
            prompt('长按全选复制完整Cookie:', full);
        }
    };
    document.body.appendChild(btn);
})();
