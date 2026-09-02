// 手动同步按钮：拉取云端 → 与本机合并（并集，保留双方真实数据）→ 写回本机 → 再上传云端
// 关键：绝不让“空数据”覆盖“真实数据”，避免以前那种“拉取后进度被清空”的问题。
const SKEY = "cet4_word_state_v1";

function load() {
  try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; }
}
function save(v) {
  try { localStorage.setItem(SKEY, JSON.stringify(v)); } catch (e) {}
}

// 合并两个词条：任何一方有真实数据就保留，空值不覆盖真实值
function mergeWord(L, R) {
  L = L || {}; R = R || {};
  var nL = L.nextReview || 0, nR = R.nextReview || 0;
  var nextReview = 0;
  if (nL > 0 && nR > 0) nextReview = Math.min(nL, nR);
  else nextReview = nL > 0 ? nL : nR;
  return {
    fav:        !!(L.fav || R.fav),
    wrong:      Math.max(L.wrong || 0, R.wrong || 0),
    correct:    Math.max(L.correct || 0, R.correct || 0),
    last:       L.last || R.last || null,
    learned:    !!(L.learned || R.learned),
    stage:      Math.max(L.stage || 0, R.stage || 0),
    reps:       Math.max(L.reps || 0, R.reps || 0),
    nextReview: nextReview,
    lastRated:  L.lastRated || R.lastRated || null,
    previewed:  !!(L.previewed || R.previewed)
  };
}

var mgEl = null;
function showToast(msg) {
  if (!mgEl) {
    mgEl = document.createElement('div');
    mgEl.id = 'sfm';
    mgEl.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);background:rgba(20,20,20,.92);color:#fff;padding:14px 20px;border-radius:10px;font-size:14px;z-index:3000;max-width:80vw;box-shadow:0 4px 14px rgba(0,0,0,.25);white-space:pre-line;text-align:center;';
    document.body.appendChild(mgEl);
  }
  mgEl.textContent = msg;
  clearTimeout(mgEl._t);
  mgEl._t = setTimeout(function () { try { mgEl.remove(); } catch (e) {} mgEl = null; }, 5000);
}

function inject() {
  if (document.getElementById('manualSyncBtn')) return;
  var b = document.createElement('button');
  b.id = 'manualSyncBtn';
  b.textContent = ' 同步 ';
  b.title = '拉取云端并合并到本机，再上传（不会用空数据覆盖本机真实进度）';
  b.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:3000;font-size:15px;padding:12px 20px;border:none;border-radius:999px;background:linear-gradient(135deg,#ff7a3a,#ff5a5a);color:#fff;font-weight:900;box-shadow:0 4px 14px rgba(255,90,90,.35);cursor:pointer;';
  b.addEventListener('click', doSync);
  document.body.appendChild(b);
}

async function doSync() {
  var c = window.Cloud || window.Config;
  var btn = document.getElementById('manualSyncBtn');
  if (!c || !c.pull || !c.push) { showToast('云端未配置（请先填 config.js）。'); return; }
  if (btn) { btn.disabled = true; btn.textContent = ' 同步中… '; }
  try {
    var user = await c.currentUser();
    if (!user) { showToast('未登录，请到「账号」页用同一个用户名+密码登录。'); return; }
    var uid = user.id;

    var local = load();
    var localCount = Object.keys(local).length;
    var remote = await c.pull(uid);
    var remoteCount = Object.keys(remote).length;

    // 合并：遍历本机 + 云端的所有词，取并集
    var allKeys = {};
    Object.keys(local).forEach(function (w) { allKeys[w] = 1; });
    Object.keys(remote).forEach(function (w) { allKeys[w] = 1; });
    var merged = {};
    Object.keys(allKeys).forEach(function (w) { merged[w] = mergeWord(local[w], remote[w]); });
    save(merged);
    await c.push(uid, merged);

    showToast('已同步。\n本机 ' + localCount + ' 词 · 云端拉取 ' + remoteCount + ' 词。\n合并后 ' + Object.keys(merged).length + ' 词，请刷新查看进度。');
  } catch (e) {
    showToast('同步失败：' + (e && e.message ? e.message : String(e)));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = ' 同步 '; }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inject);
} else {
  inject();
}
