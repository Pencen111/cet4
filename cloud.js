// 云端同步模块：基于 Supabase（可选配置）。未配置时完全不影响本地使用。
(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var isConfigured = function () {
    return !!(C.supabaseUrl && C.supabaseAnonKey);
  };

  var sb = null;
  var loading = null;
  var SCRIPT = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  function loadScript() {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SCRIPT;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('无法连接同步服务，请检查网络后重试')); };
      document.head.appendChild(s);
    });
  }

  // 开启会话持久化 + 自动刷新：登录一次后，之后打开网页都保持已登录
  function ensure() {
    if (!isConfigured()) return Promise.resolve(false);
    if (sb) return Promise.resolve(true);
    if (!loading) {
      loading = (function () {
        var p = !window.supabase ? loadScript() : Promise.resolve();
        return p.then(function () {
          sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
          });
          return true;
        }).catch(function (e) {
          loading = null;
          throw e;
        });
      })();
    }
    return loading;
  }

  function toEmail(username) {
    var s = String(username || '').trim();
    var name = s.replace(/[^a-zA-Z0-9_.-]/g, '').toLowerCase() || 'user';
    return name + '@cet4app.com';
  }

  function signIn(username, password) {
    return ensure().then(function () {
      return sb.auth.signInWithPassword({ email: toEmail(username), password: password });
    }).then(function (r) {
      if (r.error) throw r.error;
      return r.data.user;
    });
  }
  function signUp(username, password) {
    return ensure().then(function () {
      return sb.auth.signUp({ email: toEmail(username), password: password });
    }).then(function (r) {
      if (r.error) throw r.error;
      return r.data.user;
    });
  }
  function signOut() {
    if (!sb) return Promise.resolve();
    return sb.auth.signOut().then(function () {});
  }
  function currentUser() {
    if (!sb) return Promise.resolve(null);
    return sb.auth.getUser().then(function (r) {
      if (r.error) return null;
      return r.data.user || null;
    }).catch(function () { return null; });
  }

  // 分页拉取：每页 1000 行，循环取完所有（绕开 Supabase 单次最多 1000 行的限制）
  function pull(userId) {
    if (!sb) return Promise.resolve({});
    var PAGE = 1000;
    var map = {};
    function fetchPage(offset) {
      return sb.from('word_state')
        .select('*')
        .eq('user_id', userId)
        .range(offset, offset + PAGE - 1)
        .then(function (r) {
          if (r.error) throw r.error;
          var rows = r.data || [];
          rows.forEach(function (row) {
            map[row.word] = {
              fav: !!row.favorite,
              wrong: row.wrong_count || 0,
              correct: row.correct_count || 0,
              last: row.last_result || null,
              previewed: !!row.previewed,
              learned: !!row.learned,
              stage: row.stage || 0,
              reps: row.reps || 0,
              nextReview: row.next_review ? new Date(row.next_review).getTime() : 0,
              lastRated: row.last_rated || null
            };
          });
          if (rows.length === PAGE) {
            return fetchPage(offset + PAGE);
          }
          return map;
        });
    }
    return fetchPage(0);
  }

  function push(userId, state) {
    if (!sb) return Promise.resolve();
    var words = Object.keys(state || {});
    var rows = words.map(function (word) {
      var s = state[word];
      return {
        user_id: userId,
        word: word,
        favorite: !!s.fav,
        wrong_count: s.wrong || 0,
        correct_count: s.correct || 0,
        last_result: s.last || null,
        previewed: !!s.previewed,
        learned: !!s.learned,
        stage: s.stage || 0,
        reps: s.reps || 0,
        next_review: s.nextReview ? new Date(s.nextReview).toISOString() : null,
        last_rated: s.lastRated || null,
        updated_at: new Date().toISOString()
      };
    });
    var CHUNK = 200;
    var chain = Promise.resolve();
    for (var i = 0; i < rows.length; i += CHUNK) {
      (function (chunk) {
        chain = chain.then(function () {
          return sb.from('word_state').upsert(chunk, { onConflict: 'user_id,word' });
        }).then(function (r) {
          if (r.error) throw r.error;
        });
      })(rows.slice(i, i + CHUNK));
    }
    return chain;
  }

  // 每课「首次全部完成记单词」的日期：表 lesson_done(user_id, unit, lesson, done_on)
  // 返回 { "1-1": "2026-09-02", ... }；表不存在时抛错，由调用方 try/catch 吞掉（不影响词状态同步）。
  function pullLessonDone(userId) {
    if (!sb) return Promise.resolve({});
    var PAGE = 1000;
    var map = {};
    function fetchPage(offset) {
      return sb.from('lesson_done')
        .select('*')
        .eq('user_id', userId)
        .range(offset, offset + PAGE - 1)
        .then(function (r) {
          if (r.error) throw r.error;
          var rows = r.data || [];
          rows.forEach(function (row) {
            map[row.unit + '-' + row.lesson] = String(row.done_on || '').slice(0, 10);
          });
          if (rows.length === PAGE) return fetchPage(offset + PAGE);
          return map;
        });
    }
    return fetchPage(0);
  }

  function pushLessonDone(userId, map) {
    if (!sb) return Promise.resolve();
    var keys = Object.keys(map || {});
    var rows = keys.map(function (k) {
      var parts = String(k).split('-');
      return {
        user_id: userId,
        unit: Number(parts[0]),
        lesson: Number(parts[1]),
        done_on: map[k],
        updated_at: new Date().toISOString()
      };
    });
    var CHUNK = 200;
    var chain = Promise.resolve();
    for (var i = 0; i < rows.length; i += CHUNK) {
      (function (chunk) {
        chain = chain.then(function () {
          return sb.from('lesson_done').upsert(chunk, { onConflict: 'user_id,unit,lesson' });
        }).then(function (r) {
          if (r.error) throw r.error;
        });
      })(rows.slice(i, i + CHUNK));
    }
    return chain;
  }

  window.Cloud = {
    configured: isConfigured,
    ensure: ensure,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    currentUser: currentUser,
    pull: pull,
    push: push,
    pullLessonDone: pullLessonDone,
    pushLessonDone: pushLessonDone
  };
})();
