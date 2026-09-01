(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const ESC = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  const DATA = (window.WORD_DATA || []).slice();
  const DAY = 24 * 60 * 60 * 1000;
  const REVIEW_INTERVALS = [1, 2, 4, 7, 15];
  const MASTER_STAGE = 5;
  const UNIT_NUMS = Array.from(new Set(DATA.map((d) => d.unit))).sort((a, b) => a - b);

  const LS_STATE = 'cet4_word_state_v1';
  const LS_PREFS = 'cet4_prefs_v1';

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  let state = loadJSON(LS_STATE, {});
  let prefs = Object.assign({ mode: 'choice', order: 'seq' }, loadJSON(LS_PREFS, {}));
  const saveState = () => {
    saveJSON(LS_STATE, state);
    queueSync();
  };
  const savePrefs = () => saveJSON(LS_PREFS, prefs);
  function wordState(w) {
    if (!state[w]) state[w] = { fav: false, wrong: 0, correct: 0, last: null };
    const s = state[w];
    if (typeof s.previewed === 'undefined') s.previewed = false;
    if (typeof s.learned === 'undefined') s.learned = false;
    if (typeof s.stage === 'undefined') s.stage = 0;
    if (typeof s.reps === 'undefined') s.reps = 0;
    if (typeof s.nextReview === 'undefined') s.nextReview = 0;
    if (typeof s.lastRated === 'undefined') s.lastRated = null;
    return s;
  }

  const lessons = [];
  const lessonIdx = {};
  {
    const seen = new Set();
    for (const d of DATA) {
      const k = d.unit + '-' + d.lesson;
      if (!seen.has(k)) {
        seen.add(k);
        lessonIdx[k] = lessons.length;
        lessons.push({ u: d.unit, l: d.lesson });
      }
    }
  }
  const lessonLabel = (t) => 'Unit ' + t.u + ' · Lesson ' + t.l;
  const lessonKey = (u, l) => u + '-' + l;

  function getRangeWords(fromKey, toKey) {
    const fi = lessonIdx[fromKey];
    const ti = lessonIdx[toKey];
    const lo = Math.min(fi, ti);
    const hi = Math.max(fi, ti);
    return DATA.filter((d) => {
      const i = lessonIdx[d.unit + '-' + d.lesson];
      return i >= lo && i <= hi;
    });
  }

  let view = 'preview';
  function go(v) {
    view = v;
    $$('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
    $$('[data-view]').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    if (v === 'preview') renderPreview();
    if (v === 'review') renderReview();
    if (v === 'favorites') renderFavorites();
    if (v === 'wrong') renderWrong();
    if (v === 'login') renderLogin();
    window.scrollTo(0, 0);
  }

  let currentOrder = prefs.order;
  let currentMode = prefs.mode === 'card' ? 'memorize' : prefs.mode;

  function fillLessonSelect(sel) {
    sel.innerHTML = lessons
      .map((l) => '<option value="' + lessonKey(l.u, l.l) + '">' + ESC(lessonLabel(l)) + '</option>')
      .join('');
  }
  function initRangeSelects() {
    const pl = $('#prevLesson');
    if (pl) {
      fillLessonSelect(pl);
      pl.value = lessons[0].u + '-' + lessons[0].l;
    }
    const rf = $('#revFrom');
    const rt = $('#revTo');
    if (rf && rt) {
      fillLessonSelect(rf);
      fillLessonSelect(rt);
      rf.value = lessons[0].u + '-' + lessons[0].l;
      rt.value = lessons[lessons.length - 1].u + '-' + lessons[lessons.length - 1].l;
    }
  }
  function selectedPreview() {
    const k = $('#prevLesson').value;
    return getRangeWords(k, k);
  }
  function selectedReview() {
    return getRangeWords($('#revFrom').value, $('#revTo').value);
  }

  function syncSegUI() {
    $$('#orderSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.order === currentOrder));
    $$('#modeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === currentMode));
  }

  function renderUnitProgress() {
    let html = '';
    UNIT_NUMS.forEach((u) => {
      const list = DATA.filter((d) => d.unit === u);
      const total = list.length;
      const previewed = list.filter((d) => wordState(d.word).previewed).length;
      const mastered = list.filter((d) => isMastered(d.word)).length;
      const pct = total ? Math.round((previewed / total) * 100) : 0;
      html +=
        '<div class="lesson-row">' +
        '<div class="lr-top"><span class="lr-label">第 ' + u + ' 单元</span>' +
        '<span class="lr-num">已预习 ' + previewed + '/' + total + ' · ' + pct + '%' +
        (mastered ? ' <span class="lr-mastered">★' + mastered + '</span>' : '') +
        '</span></div>' +
        '<div class="lr-bar"><div class="lr-fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
    });
    $('#unitProgress').innerHTML = html || '<div class="empty">暂无数据</div>';
  }

  function renderPreview() {
    const range = selectedPreview();
    const unPre = range.filter((d) => !wordState(d.word).previewed);
    $('#prevNewHint').textContent =
      '本课共 ' + range.length + ' 词，未预习 ' + unPre.length + ' 词，点「开始背新单词」预习全部未预习的词。';
    renderUnitProgress();
  }

  function renderReview() {
    const due = dueWords();
    let learnedAll = 0, masteredAll = 0;
    for (const d of DATA) {
      if (wordState(d.word).learned) learnedAll++;
      if (isMastered(d.word)) masteredAll++;
    }
    $('#revDue').textContent = due.length;
    $('#revLearned').textContent = learnedAll;
    $('#revMem').textContent = masteredAll;

    let answered = 0, correct = 0, wrong = 0, fav = 0;
    for (const w of Object.keys(state)) {
      const s = state[w];
      if (s.correct > 0 || s.wrong > 0) answered++;
      correct += s.correct;
      wrong += s.wrong;
      if (s.fav) fav++;
    }
    const total = correct + wrong;
    $('#stAnswered').textContent = answered;
    $('#stAcc').textContent = total > 0 ? Math.round((correct / total) * 100) + '%' : '--';
    $('#stFav').textContent = fav;
    $('#stWrong').textContent = wrong > 0 ? Object.keys(state).filter((w) => state[w].wrong > 0).length : 0;

    const range = selectedReview();
    $('#revRangeCount').textContent = '当前复习范围共 ' + range.length + ' 个单词';
    const mastered = range.filter((d) => isMastered(d.word)).length;
    $('#revProgressSummary').textContent = '范围内共 ' + range.length + ' 词 · 已掌握 ' + mastered + ' · 已复习 ' + range.filter((d) => wordState(d.word).learned).length;
    $('#revProgress').innerHTML = renderLessonProgress(range, true);
    syncSegUI();
  }

  function markPreviewed(word) {
    const s = wordState(word);
    if (!s.previewed) s.previewed = true;
    if (!s.learned) {
      s.learned = true;
      s.stage = Math.min((s.stage || 0) + 1, MASTER_STAGE);
      s.reps = (s.reps || 0) + 1;
      s.nextReview = Date.now() + REVIEW_INTERVALS[0] * DAY;
      s.lastRated = 'know';
    }
    saveState();
  }

  function applyRating(word, rating) {
    const s = wordState(word);
    s.learned = true;
    s.lastRated = rating;
    const now = Date.now();
    if (rating === 'know') {
      s.reps = (s.reps || 0) + 1;
      s.stage = Math.min((s.stage || 0) + 1, MASTER_STAGE);
      const idx = Math.min(s.stage - 1, REVIEW_INTERVALS.length - 1);
      s.nextReview = now + REVIEW_INTERVALS[idx] * DAY;
    } else if (rating === 'fuzzy') {
      s.reps = (s.reps || 0) + 1;
      s.nextReview = now + REVIEW_INTERVALS[0] * DAY;
    } else {
      s.stage = 0;
      s.nextReview = now + REVIEW_INTERVALS[0] * DAY;
    }
    saveState();
    return s;
  }

  function isMastered(word) {
    return wordState(word).stage >= MASTER_STAGE;
  }

  function dueWords() {
    const now = Date.now();
    return DATA.filter((d) => {
      const s = wordState(d.word);
      return s.learned && s.nextReview > 0 && s.nextReview <= now;
    });
  }

  function nextReviewText(word) {
    const s = wordState(word);
    if (!s.nextReview) return '--';
    const d = Math.round((s.nextReview - Date.now()) / DAY);
    if (d <= 0) return '今天';
    return d + ' 天后';
  }

  function renderLessonProgress(range, useMastered) {
    const byL = new Map();
    for (const d of range) {
      const k = d.unit + '-' + d.lesson;
      if (!byL.has(k)) byL.set(k, { u: d.unit, l: d.lesson, list: [] });
      byL.get(k).list.push(d);
    }
    const keys = Array.from(byL.keys()).sort((a, b) => {
      const [au, al] = a.split('-').map(Number);
      const [bu, bl] = b.split('-').map(Number);
      return au - bu || al - bl;
    });
    let html = '';
    keys.forEach((k) => {
      const g = byL.get(k);
      const total = g.list.length;
      const doneCount = useMastered
        ? g.list.filter((d) => isMastered(d.word)).length
        : g.list.filter((d) => wordState(d.word).learned).length;
      const starred = g.list.filter((d) => isMastered(d.word)).length;
      const pct = Math.round((doneCount / total) * 100);
      html +=
        '<div class="lesson-row">' +
        '<div class="lr-top"><span class="lr-label">' + ESC(lessonLabel(g)) + '</span>' +
        '<span class="lr-num">' + (useMastered ? '已掌握 ' : '') + doneCount + '/' + total +
        (starred ? ' <span class="lr-mastered">★' + starred + '</span>' : '') +
        '</span></div>' +
        '<div class="lr-bar"><div class="lr-fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
    });
    if (!html) html = '<div class="empty">当前范围没有单词</div>';
    return html;
  }

  function startMemorizeNew() {
    const words = selectedPreview().filter((d) => !wordState(d.word).previewed);
    if (!words.length) { toast('本课没有可预习的新词'); return; }
    startPractice(words, { mode: 'memorize', order: 'seq', simple: true, returnView: 'preview' });
  }
  function startMemorizeReview() {
    const words = dueWords();
    if (!words.length) { toast('今日暂无待复习的词'); return; }
    startPractice(words, { mode: 'memorize', order: 'seq', returnView: 'review' });
  }

  let session = null;
  let lastSession = null;
  let lastWrongWords = [];

  function orderWords(words, order) {
    if (order === 'rand') return shuffle(words);
    if (order === 'unit') {
      const byUnit = new Map();
      for (const w of words) {
        if (!byUnit.has(w.unit)) byUnit.set(w.unit, []);
        byUnit.get(w.unit).push(w);
      }
      const units = Array.from(byUnit.keys()).sort((a, b) => a - b);
      const out = [];
      for (const u of units) out.push(...shuffle(byUnit.get(u)));
      return out;
    }
    return words.slice();
  }

  function isStudyView(v) {
    return v === 'preview' || v === 'review' || v === 'favorites' || v === 'wrong';
  }

  function startPractice(words, opts) {
    if (!words.length) { toast('该范围没有单词'); return; }
    const mode = opts.mode || currentMode;
    const order = opts.order || currentOrder;
    const returnView = (opts && opts.returnView) ? opts.returnView : (isStudyView(view) ? view : 'review');
    session = {
      words: orderWords(words, order),
      mode,
      order,
      idx: 0,
      answers: new Array(words.length).fill(null),
      revealed: new Array(words.length).fill(false),
      correct: 0,
      wrong: 0,
      know: 0,
      fuzzy: 0,
      unknown: 0,
      pool: words.slice(),
      optsCache: {},
      returnView,
      simple: !!(opts && opts.simple),
    };
    lastSession = session;
    go('practice');
    renderQuestion();
  }

  function getOptions(word) {
    if (session.optsCache[word.word]) return session.optsCache[word.word];
    const correct = word.meaning.trim();
    const seen = new Set([correct]);
    const cands = [];
    const pushUnique = (w) => {
      const m = (w.meaning || '').trim();
      if (w.word !== word.word && m && m !== correct && !seen.has(m)) {
        seen.add(m);
        cands.push(m);
      }
    };
    for (const w of session.pool) pushUnique(w);
    if (cands.length < 3) for (const w of DATA) pushUnique(w);
    const distract = shuffle(cands).slice(0, 3);
    const opts = shuffle([correct, ...distract]);
    session.optsCache[word.word] = opts;
    return opts;
  }

  function renderQuestion() {
    const s = session;
    if (s.idx >= s.words.length) return finish();
    const w = s.words[s.idx];
    const total = s.words.length;
    $('#progressFill').style.width = (((s.idx + 1) / total) * 100) + '%';
    $('#progressText').textContent = (s.idx + 1) + ' / ' + total;
    $('#practiceScore').textContent = s.mode === 'choice'
      ? '✅ ' + s.correct + '  ❌ ' + s.wrong
      : (s.simple ? '已学 ' + s.know : '认识 ' + s.know + ' · 模糊 ' + s.fuzzy + ' · 不知 ' + s.unknown);
    $('#prevBtn').disabled = s.idx === 0;
    $('#nextBtn').textContent = s.idx === total - 1 ? '完成 ✓' : '下一题 ›';
    $('#nextBtn').disabled = s.mode === 'choice' ? !s.answers[s.idx] : false;
    const ans = s.answers[s.idx];
    if (s.mode === 'choice') renderChoice(w, ans);
    else renderMemorizeQuestion(w, ans);
  }

  function starHTML(word) {
    const fav = wordState(word.word).fav;
    return '<button class="fav-btn" id="favBtn" title="' + (fav ? '取消收藏' : '收藏') + '">' + (fav ? '★' : '☆') + '</button>';
  }
  function exampleBox(w) {
    if (!w.example_en || !w.example_en.trim()) return '';
    const zh = w.example_zh && w.example_zh.trim() ? '<div class="zh">' + ESC(w.example_zh) + '</div>' : '';
    return '<div class="example-box"><div class="en">' + ESC(w.example_en) + '</div>' + zh + '</div>';
  }

  function renderChoice(w, ans) {
    const opts = getOptions(w);
    const letters = ['A', 'B', 'C', 'D'];
    const head =
      '<div class="q-top"><div>' +
      '<div class="q-word">' + ESC(w.word) + '</div>' +
      '<div class="q-pos">' + ESC(w.pos || '') + '</div>' +
      '<div class="q-sublabel">' + ESC(lessonLabel({ u: w.unit, l: w.lesson })) + ' · 选出正确释义</div>' +
      '</div>' + starHTML(w) + '</div>';
    let optsHtml = '<div class="opts">';
    if (!ans) {
      opts.forEach((m, i) => {
        optsHtml += '<button class="opt" data-i="' + i + '"><span class="letter">' + letters[i] + '</span><span>' + ESC(m) + '</span></button>';
      });
    } else {
      const correctMeaning = w.meaning.trim();
      opts.forEach((m, i) => {
        let cls = 'opt';
        if (m === correctMeaning) cls += ' correct';
        else if (m === opts[ans.pickedIndex]) cls += ' wrong';
        optsHtml += '<button class="' + cls + '" disabled><span class="letter">' + letters[i] + '</span><span>' + ESC(m) + '</span></button>';
      });
    }
    optsHtml += '</div>';
    let tail = '';
    if (ans) {
      const good = ans.correct;
      tail =
        '<div class="answer-tag ' + (good ? 'good' : 'bad') + '">' + (good ? '✓ 回答正确' : '✗ 回答错误，正确答案：' + ESC(w.meaning)) + '</div>' +
        exampleBox(w);
    }
    $('#questionBox').innerHTML = head + optsHtml + tail;
    if (!ans) {
      $$('#questionBox .opt').forEach((btn) => {
        btn.addEventListener('click', function () {
          const i = Number(this.dataset.i);
          const isCorrect = opts[i] === w.meaning.trim();
          session.answers[session.idx] = { correct: isCorrect, pickedIndex: i };
          session.correct += isCorrect ? 1 : 0;
          session.wrong += isCorrect ? 0 : 1;
          markAnswered(w.word, isCorrect);
          renderQuestion();
        });
      });
    }
    wireFav();
  }

  function renderMemorizeQuestion(w, ans) {
    const simple = !!session.simple;
    let html =
      '<div class="card-q">' +
      '<div style="display:flex;justify-content:flex-end;margin-bottom:6px;">' + starHTML(w) + '</div>' +
      '<div class="q-word">' + ESC(w.word) + '</div>' +
      '<div class="q-pos">' + ESC(w.pos || '') + '</div>' +
      '<div class="q-sublabel">' + ESC(lessonLabel({ u: w.unit, l: w.lesson })) + '</div>';

    if (simple) {
      html +=
        '<div class="card-body"><div class="card-meaning">' + ESC(w.meaning) + '</div>' +
        exampleBox(w) +
        '<div class="hint center-hint">点「下一题」继续。</div></div>';
    } else {
      const revealed = session.revealed[session.idx];
      if (!revealed && !ans) {
        html += '<div><button class="reveal-btn" id="revealBtn">显示释义</button></div>';
      } else {
        html += '<div class="card-body"><div class="card-meaning">' + ESC(w.meaning) + '</div>' + exampleBox(w);
        if (!ans) {
          html +=
            '<div class="ratings">' +
            '<button class="rating-btn know" id="knowBtn">😄 认识</button>' +
            '<button class="rating-btn fuzzy" id="fuzzyBtn">😐 模糊</button>' +
            '<button class="rating-btn unknown" id="unknownBtn">😵 不认识</button>' +
            '</div>';
        } else {
          const label = ans.rating === 'know' ? '认识' : ans.rating === 'fuzzy' ? '模糊' : '不认识';
          const cls = ans.rating === 'know' ? 'good' : 'bad';
          const extra = ans.rating === 'know' ? '（下次复习：' + nextReviewText(w.word) + '）' : '（明天可再复习）';
          html += '<div class="answer-tag ' + cls + '">已记录：' + label + extra + '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
    $('#questionBox').innerHTML = html;

    if (!simple) {
      const revealBtn = $('#revealBtn');
      if (revealBtn) {
        revealBtn.addEventListener('click', function () {
          session.revealed[session.idx] = true;
          renderQuestion();
        });
      }
      const map = { knowBtn: 'know', fuzzyBtn: 'fuzzy', unknownBtn: 'unknown' };
      if (!ans) {
        Object.keys(map).forEach((id) => {
          const btn = $('#' + id);
          if (!btn) return;
          btn.addEventListener('click', function () {
            const rating = map[id];
            session.answers[session.idx] = { rating: rating };
            if (rating === 'know') session.know += 1;
            else if (rating === 'fuzzy') session.fuzzy += 1;
            else session.unknown += 1;
            applyRating(w.word, rating);
            renderQuestion();
          });
        });
      }
    } else if (!ans) {
      session.answers[session.idx] = { rating: 'know', auto: true };
      session.know += 1;
      markPreviewed(w.word);
    }
    wireFav();
  }

  function markAnswered(word, ok) {
    const s = wordState(word);
    if (ok) {
      s.correct = (s.correct || 0) + 1;
      s.last = 'c';
    } else {
      s.wrong = (s.wrong || 0) + 1;
      s.last = 'w';
    }
    saveState();
  }

  function wireFav() {
    const fb = $('#favBtn');
    if (!fb) return;
    fb.addEventListener('click', function () {
      const w = session.words[session.idx];
      const s = wordState(w.word);
      s.fav = !s.fav;
      saveState();
      fb.textContent = s.fav ? '★' : '☆';
      fb.title = s.fav ? '取消收藏' : '收藏';
      toast(s.fav ? '已收藏' : '已取消收藏');
    });
  }

  function finish() {
    const s = session;
    const total = s.words.length;
    const answered = s.answers.filter((a) => a !== null).length;
    lastSession = s;

    if (s.mode === 'memorize') {
      if (s.simple) {
        $('#resultNum').textContent = answered;
        $('#resultLabel').textContent = '已预习单词';
        $('#resultDet').textContent = '共 ' + total + ' 词 · 已预习 ' + answered + ' 词';
        $('#retryWrong').textContent = '再学一遍';
        $('#resultWrongList').innerHTML = '<div class="card"><div class="empty">✅ 本课已预习，到「复习单词」巩固。</div></div>';
        go('result');
        return;
      }
      lastWrongWords = s.words.filter((w, i) => s.answers[i] && s.answers[i].rating !== 'know');
      $('#resultNum').textContent = s.know;
      $('#resultLabel').textContent = '本轮认识';
      $('#resultDet').textContent = '共 ' + total + ' 词 · 认识 ' + s.know + ' · 模糊 ' + s.fuzzy + ' · 不认识 ' + s.unknown;
      $('#retryWrong').textContent = '复习待复习';
      const wrongListEl = $('#resultWrongList');
      wrongListEl.innerHTML = lastWrongWords.length
        ? '<div class="wrong-review-title">本轮待复习词（' + lastWrongWords.length + '）</div>' + lastWrongWords.map(wordItemHTML).join('')
        : '<div class="card"><div class="empty">🎉 全部认识，太棒了！</div></div>';
      go('result');
      return;
    }

    lastWrongWords = s.words.filter((w, i) => s.answers[i] && !s.answers[i].correct);
    $('#retryWrong').textContent = '错题重做';
    $('#resultNum').textContent = answered === 0 ? '--' : Math.round((s.correct / answered) * 100) + '%';
    $('#resultLabel').textContent = '正确率';
    $('#resultDet').textContent = '共 ' + total + ' 题 · 已答 ' + answered + ' 题 · 答对 ' + s.correct + ' · 答错 ' + s.wrong;
    const wrongListEl = $('#resultWrongList');
    if (lastWrongWords.length === 0) {
      wrongListEl.innerHTML = answered === 0
        ? '<div class="card"><div class="empty">本次未作答任何题目。</div></div>'
        : '<div class="card"><div class="empty">🎉 全部答对，太棒了！</div></div>';
    } else {
      wrongListEl.innerHTML = '<div class="wrong-review-title">本次错题回顾（' + lastWrongWords.length + '）</div>' + lastWrongWords.map(wordItemHTML).join('');
    }
    go('result');
  }

  function wordItemHTML(w) {
    const s = wordState(w.word);
    const meta = 'Unit ' + w.unit + ' · Lesson ' + w.lesson + (s.wrong > 0 ? ' · 错 ' + s.wrong + ' 次' : '');
    const onWrong = view === 'wrong';
    const btnLabel = onWrong ? '移出错题' : '取消收藏';
    return (
      '<div class="word-item" data-word="' + ESC(w.word) + '">' +
      '<div class="wi-main">' +
      '<div><span class="wi-word">' + ESC(w.word) + '</span><span class="wi-pos">' + ESC(w.pos || '') + '</span></div>' +
      '<div class="wi-meaning">' + ESC(w.meaning) + '</div>' +
      '<div class="wi-meta">' + ESC(meta) + '</div>' +
      '</div>' +
      '<div class="wi-actions"><button class="wi-btn" data-remove="' + onWrong + '">' + btnLabel + '</button></div>' +
      '</div>'
    );
  }

  function renderFavorites() {
    const q = ($('#favSearch').value || '').trim().toLowerCase();
    const words = DATA.filter((d) => wordState(d.word).fav && (!q || d.word.toLowerCase().includes(q) || (d.meaning || '').toLowerCase().includes(q)));
    $('#favCount').textContent = words.length;
    $('#favList').innerHTML =
      words.length === 0
        ? '<div class="card"><div class="empty">' + (q ? '没有匹配的收藏' : '还没有收藏任何单词') + '</div></div>'
        : words.map(wordItemHTML).join('');
  }

  function renderWrong() {
    const q = ($('#wrongSearch').value || '').trim().toLowerCase();
    const words = DATA.filter((d) => wordState(d.word).wrong > 0 && (!q || d.word.toLowerCase().includes(q) || (d.meaning || '').toLowerCase().includes(q)));
    $('#wrongCount').textContent = words.length;
    $('#wrongList').innerHTML =
      words.length === 0
        ? '<div class="card"><div class="empty">' + (q ? '没有匹配的错题' : '错题本是空的，继续加油！') + '</div></div>'
        : words.map(wordItemHTML).join('');
  }

  function practiceFavorites() {
    startPractice(DATA.filter((d) => wordState(d.word).fav), { mode: currentMode, order: 'seq' });
  }
  function practiceWrong() {
    startPractice(DATA.filter((d) => wordState(d.word).wrong > 0), { mode: currentMode, order: 'seq' });
  }

  function resetPreview() {
    if (!confirm('确定重置「预习进度」吗？所有单词将重新变为未预习。')) return;
    for (const w of Object.keys(state)) if (state[w]) state[w].previewed = false;
    saveState();
    renderPreview();
    toast('已重置预习进度');
  }
  function resetReview() {
    if (!confirm('确定重置「复习进度」吗？所有词的复习记录（已学/已掌握/复习时间）将清空。')) return;
    for (const w of Object.keys(state)) {
      const s = state[w];
      s.learned = false;
      s.stage = 0;
      s.reps = 0;
      s.nextReview = 0;
      s.lastRated = null;
    }
    saveState();
    renderReview();
    toast('已重置复习进度');
  }

  const Cloud = window.Cloud || null;
  let queueSync = debounce(tryPush, 1200);
  async function tryPush() {
    if (!Cloud || !Cloud.configured()) return;
    try {
      const user = await Cloud.currentUser();
      if (user) await Cloud.push(user.id, state);
    } catch (e) {
      console.warn('sync push failed', e);
    }
  }
  async function mergeRemote() {
    if (!Cloud || !Cloud.configured()) return false;
    try {
      const user = await Cloud.currentUser();
      if (!user) return false;
      const remote = await Cloud.pull(user.id);
      let changed = false;
      for (const w of Object.keys(remote)) {
        if (!state[w]) {
          state[w] = remote[w];
          changed = true;
        }
      }
      if (changed) {
        saveJSON(LS_STATE, state);
        await Cloud.push(user.id, state);
      }
      return true;
    } catch (e) {
      console.warn('merge remote failed', e);
      return false;
    }
  }

  function renderLogin() {
    const banner = $('#cloudBanner');
    if (!Cloud || !Cloud.configured()) {
      banner.className = 'banner off';
      banner.textContent = '云端同步未配置。当前为本地模式：收藏与错题仅保存在当前浏览器。配置 Supabase 后即可三端同步（见 README.md）。';
    } else {
      banner.className = 'banner ok';
      banner.textContent = '云端同步已配置。登录后收藏与错题可在手机/平板/电脑之间同步。';
    }
    refreshUserPanel();
  }

  async function refreshUserPanel() {
    const isDone = Cloud && Cloud.configured();
    const panel = $('#userPanel');
    const form = $('#authForm');
    if (isDone) {
      try {
        const user = await Cloud.currentUser();
        if (user) {
          form.classList.add('hidden');
          panel.classList.remove('hidden');
          $('#userName').textContent = user.user_metadata && user.user_metadata.username ? user.user_metadata.username : (user.email || '已登录');
          syncStatusText();
        } else {
          form.classList.remove('hidden');
          panel.classList.add('hidden');
        }
      } catch (e) {
        form.classList.remove('hidden');
        panel.classList.add('hidden');
      }
    } else {
      form.classList.remove('hidden');
      panel.classList.add('hidden');
    }
  }

  function syncStatusText() {
    const st = $('#syncStatus');
    if (st) st.textContent = '收藏/错题已开启云端同步。';
  }

  async function doAuth(action) {
    const u = $('#authUser').value.trim();
    const p = $('#authPass').value;
    const hint = $('#authHint');
    if (!u) { hint.textContent = '请输入用户名'; return; }
    if (p.length < 6) { hint.textContent = '密码至少 6 位'; return; }
    if (!Cloud || !Cloud.configured()) { hint.textContent = '云端同步尚未配置，无法登录（见 README.md）。'; return; }
    hint.textContent = '加载同步服务…';
    $('#loginBtn').disabled = true;
    $('#registerBtn').disabled = true;
    try {
      await Cloud.ensure();
      if (action === 'login') await Cloud.signIn(u, p);
      else await Cloud.signUp(u, p);
      localStorage.setItem('cet4_last_user', u);
      hint.textContent = action === 'login' ? '登录成功' : '注册成功，请再次登录';
      await mergeRemote();
      refreshUserPanel();
      toast('登录成功');
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      hint.textContent = action === 'login' ? ('登录失败：' + msg) : ('注册失败（可能用户名已存在）：' + msg);
    } finally {
      $('#loginBtn').disabled = false;
      $('#registerBtn').disabled = false;
    }
  }

  function wireChipGroup(chipSel, fromSel, toSel, after) {
    $$(chipSel).forEach((c) =>
      c.addEventListener('click', function () {
        const kind = this.dataset.range;
        if (kind === 'all') {
          $(fromSel).value = lessons[0].u + '-' + lessons[0].l;
          $(toSel).value = lessons[lessons.length - 1].u + '-' + lessons[lessons.length - 1].l;
        } else {
          const u = Number(this.dataset.unit);
          const last = lessons.filter((l) => l.u === u).pop();
          $(fromSel).value = lessonKey(u, 1);
          $(toSel).value = last ? lessonKey(u, last.l) : lessonKey(u, 1);
        }
        after();
      })
    );
  }

  function bind() {
    $$('[data-view]').forEach((t) => t.addEventListener('click', () => go(t.dataset.view)));

    $('#prevLesson').addEventListener('change', renderPreview);
    $('#revFrom').addEventListener('change', renderReview);
    $('#revTo').addEventListener('change', renderReview);
    wireChipGroup('.rev-chip', '#revFrom', '#revTo', renderReview);

    $('#prevStartNew').addEventListener('click', startMemorizeNew);
    $('#revReviewBtn').addEventListener('click', startMemorizeReview);
    $('#revStartBtn').addEventListener('click', function () {
      startPractice(selectedReview(), { mode: currentMode, order: currentOrder });
    });

    $$('#orderSeg .seg-btn').forEach((b) =>
      b.addEventListener('click', function () {
        currentOrder = this.dataset.order;
        prefs.order = currentOrder;
        savePrefs();
        syncSegUI();
      })
    );
    $$('#modeSeg .seg-btn').forEach((b) =>
      b.addEventListener('click', function () {
        currentMode = this.dataset.mode;
        prefs.mode = currentMode;
        savePrefs();
        syncSegUI();
      })
    );

    $('#resetPreviewBtn').addEventListener('click', resetPreview);
    $('#resetReviewBtn').addEventListener('click', resetReview);

    $('#exitPractice').addEventListener('click', () => go(session ? session.returnView : (lastSession ? lastSession.returnView : 'preview')));
    $('#prevBtn').addEventListener('click', function () {
      if (session.idx > 0) { session.idx--; renderQuestion(); }
    });
    $('#nextBtn').addEventListener('click', function () {
      const s = session;
      if (s.mode === 'memorize' && !s.answers[s.idx]) {
        s.answers[s.idx] = { rating: 'know', auto: true };
        s.know += 1;
        applyRating(s.words[s.idx].word, 'know');
      } else if (s.mode === 'choice' && !s.answers[s.idx]) {
        return;
      }
      if (s.idx < s.words.length - 1) { s.idx++; renderQuestion(); }
      else finish();
    });
    $('#finishBtn').addEventListener('click', finish);

    $('#retryWrong').addEventListener('click', function () {
      if (lastSession && lastSession.mode === 'memorize' && lastSession.simple) {
        startPractice(lastSession.words, { mode: 'memorize', order: 'seq', simple: true, returnView: lastSession.returnView });
        return;
      }
      if (!lastWrongWords.length) { toast(lastSession && lastSession.mode === 'memorize' ? '没有待复习的词' : '没有错题'); return; }
      startPractice(lastWrongWords, { mode: lastSession.mode, order: 'seq', returnView: lastSession.returnView });
    });
    $('#againBtn').addEventListener('click', function () {
      if (lastSession) startPractice(lastSession.words, { mode: lastSession.mode, order: lastSession.order, simple: !!lastSession.simple, returnView: lastSession.returnView });
    });
    $('#backHomeBtn').addEventListener('click', () => go(lastSession ? lastSession.returnView : 'review'));

    $('#practiceFav').addEventListener('click', practiceFavorites);
    $('#practiceWrong').addEventListener('click', practiceWrong);
    $('#clearWrong').addEventListener('click', function () {
      if (!confirm('确定清空所有错题吗？')) return;
      for (const w of Object.keys(state)) if (state[w].wrong > 0) { state[w].wrong = 0; state[w].last = null; }
      saveState();
      renderWrong();
      toast('已清空错题');
    });
    $('#favSearch').addEventListener('input', renderFavorites);
    $('#wrongSearch').addEventListener('input', renderWrong);
    $('#clearFavSearch').addEventListener('click', function () {
      $('#favSearch').value = '';
      renderFavorites();
    });

    $('#favList').addEventListener('click', function (e) {
      const btn = e.target.closest('.wi-btn');
      if (!btn) return;
      const item = btn.closest('.word-item');
      const w = item && DATA.find((d) => d.word === item.dataset.word);
      if (!w) return;
      wordState(w.word).fav = false;
      saveState();
      toast('已取消收藏');
      renderFavorites();
    });
    $('#wrongList').addEventListener('click', function (e) {
      const btn = e.target.closest('.wi-btn');
      if (!btn) return;
      const item = btn.closest('.word-item');
      const w = item && DATA.find((d) => d.word === item.dataset.word);
      if (!w) return;
      const s = wordState(w.word);
      s.wrong = 0;
      s.last = null;
      saveState();
      toast('已移出错题本');
      renderWrong();
    });

    $('#loginBtn').addEventListener('click', () => doAuth('login'));
    $('#registerBtn').addEventListener('click', () => doAuth('register'));
    $('#logoutBtn').addEventListener('click', async function () {
      if (Cloud) { try { await Cloud.signOut(); } catch (e) {} }
      refreshUserPanel();
      toast('已退出登录');
    });
  }

  function init() {
    initRangeSelects();
    bind();
    go('preview');
    const last = localStorage.getItem('cet4_last_user');
    if (last) $('#authUser').value = last;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
