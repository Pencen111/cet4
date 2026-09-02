// 手动同步按钮：上传本地 -> 拉取云端（云端为准）-> 刷新
(function () {
  'use strict';
  var LS_KEY = 'cet4_word_state_v1';
  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function save(v) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) {}
  }

  var msgEl = null;
  function status(msg, isErr) {
    if (!msgEl) {
      msgEl = document.createElement('div');
      msgEl.id = 'syncMsg';
      msgEl.style.cssText = 'position:fixed;left:50%;bottom:78px;transform:translateX(-50%);background:rgba(20,28,38,.92);color:#fff;padding:9px 16px;border-radius:999px;font-size:13px;z-index:300;max-width:92vw;box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:pre-line;text-align:center';
      document.body.appendChild(msgEl);
    }
    msgEl.style.background = isErr ? '#d9363e' : 'rgba(20,28,38,.92)';
    msgEl.textContent = msg;
    clearTimeout(msgEl._t);
    msgEl._t = setTimeout(function () { msgEl.remove(); msgEl = null; }, 5000);
  }

  function inject() {
    if (document.getElementById('manualSyncBtn')) return;
    var b = document.createElement('button');
    b.id = 'manualSyncBtn';
    b.textContent = '🔄 同步';
    b.title = '手动同步：上传本地并在云端覆盖后刷新';
    b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:300;font-size:14px;font-weight:800;padding:11px 17px;border:none;border-radius:999px;background:linear-gradient(135deg,#ff7a1a,#ff5a00);color:#fff;box-shadow:0 6px 18px rgba(255,106,0,.35);cursor:pointer';
    b.addEventListener('click', onSync);
    document.body.appendChild(b);
  }

  async function onSync() {
    var C = window.Cloud;
    var b = document.getElementById('manualSyncBtn');
    if (!C || !C.configured()) { status('云端同步未配置（请先填 config.js）', true); return; }
    b.disabled = true;
    b.textContent = '同步中…';
    try {
      await C.ensure();
      var user = await C.currentUser();
      if (!user) { status('未登录：请到「账号」页用同一个用户名+密码登录', true); return; }
      var uid = user.id;
      var local = load();
      // 1) 先把本地全量传到云端，避免漏掉刚做的改动
      await C.push(uid, local);
      // 2) 拉取云端（含所有设备数据）
      var remote = await C.pull(uid);
      // 3) 云端覆盖已知词，保留本地独有词，再存回本地
      Object.keys(remote).forEach(function (w) { local[w] = remote[w]; });
      save(local);
      // 4) 把合并结果再推回云端，保证本地独有词也在云端
      await C.push(uid, local);
      status('已同步账号：' + (user.email || uid) + '\n即将刷新页面加载最新数据。');
      setTimeout(function () { location.reload(); }, 900);
    } catch (e) {
      status('同步失败：' + (e && e.message ? e.message : String(e)), true);
    } finally {
      b.disabled = false;
      b.textContent = '🔄 同步';
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', inject); } else { inject(); }
})();
