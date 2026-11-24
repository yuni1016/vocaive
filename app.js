/* 보카이브 실습 앱 — 로그인과 학습 플로우 (데이터는 브라우저 localStorage에 저장) */
(function () {
  'use strict';

  // ---------- 데이터 ----------
  var BOOK = window.VOCAIVE_BOOK;
  var DAYS = BOOK.days.map(function (d) {
    return {
      day: d.day,
      title: d.chapterTitle,
      summary: d.summaryKo,
      words: [].concat(d.words || []),
      reviewIds: [].concat(d.reviewWordIds || []).filter(Boolean)
    };
  });
  var WORDS = {};
  DAYS.forEach(function (d) { d.words.forEach(function (w) { w.day = d.day; WORDS[w.id] = w; }); });
  var ALL = Object.keys(WORDS).map(function (k) { return WORDS[k]; });
  var TOTAL = ALL.length;
  function no(id) { return 'No.' + id.split('-')[1]; }
  function dayOf(n) { return DAYS.filter(function (d) { return d.day === n; })[0]; }
  function pageRange(d) {
    var pages = d.words.map(function (w) { return w.page; });
    return Math.min.apply(null, pages) + '~' + Math.max.apply(null, pages);
  }

  // ---------- 저장소 (Supabase Auth + vocaive_progress 테이블) ----------
  var cfg = window.VOCAIVE_CONFIG || {};
  var sb = window.supabase && cfg.supabaseUrl && cfg.supabaseKey
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey)
    : null;
  var TABLE = 'vocaive_progress';
  var currentUser = null;
  function me() { return currentUser; }
  function newProgress() {
    return { completedDays: [], xp: 0, streak: 0, lastStudyDate: null, wrongIds: [], badges: [], dailyXp: 0, dailyDate: null, bestCombo: 0, reviewedCount: 0 };
  }
  function fromRow(r) {
    return {
      completedDays: r.completed_days || [], xp: r.xp || 0, streak: r.streak || 0, lastStudyDate: r.last_study_date,
      wrongIds: r.wrong_ids || [], badges: r.badges || [], dailyXp: r.daily_xp || 0, dailyDate: r.daily_date,
      bestCombo: r.best_combo || 0, reviewedCount: r.reviewed_count || 0
    };
  }
  // 로그인한 사용자의 학습 기록을 불러오고, 처음이면 빈 기록을 만든다
  function loadUser(user) {
    return sb.from(TABLE).select('*').eq('user_id', user.id).maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      var meta = user.user_metadata || {};
      currentUser = {
        id: user.id,
        email: user.email,
        name: meta.name || meta.nickname || user.email.split('@')[0],
        progress: res.data ? fromRow(res.data) : newProgress()
      };
      if (!res.data) return saveProgress(currentUser);
    });
  }
  // ?demo 로 열면 로그인 없이 체험 (기록은 저장하지 않음)
  var DEMO = /[?&]demo\b/.test(window.location.search);
  function saveProgress(u) {
    if (DEMO) return Promise.resolve();
    var p = u.progress;
    return sb.from(TABLE).upsert({
      user_id: u.id,
      completed_days: p.completedDays,
      xp: p.xp,
      streak: p.streak,
      last_study_date: p.lastStudyDate,
      wrong_ids: p.wrongIds,
      badges: p.badges,
      daily_xp: p.dailyXp,
      daily_date: p.dailyDate,
      best_combo: p.bestCombo,
      reviewed_count: p.reviewedCount,
      updated_at: new Date().toISOString()
    }).then(function (res) {
      if (res.error) { console.error(res.error); toast('학습 기록을 저장하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
    });
  }
  function putUser(u) { saveProgress(u); }
  function authMessage(err) {
    var m = (err && err.message) || '';
    if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
    if (/email not confirmed/i.test(m)) return '메일 인증이 아직 안 됐어요. 받은 메일의 링크를 눌러 주세요.';
    if (/already registered|already exists/i.test(m)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
    if (/database error saving new user/i.test(m)) return '이미 쓰이고 있는 이름이에요. 다른 이름을 입력해 주세요.';
    if (/rate limit|too many/i.test(m)) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
    if (/password/i.test(m)) return '비밀번호 조건을 확인해 주세요. (' + m + ')';
    return '문제가 생겼어요: ' + m;
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'alert'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  // ---------- 계산 ----------
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function gapDays(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  function streakNow(p) { return p.lastStudyDate && gapDays(p.lastStudyDate, today()) <= 1 ? p.streak : 0; }

  // ---------- 게임 요소: 레벨, 오늘의 목표, 배지 ----------
  var DAILY_GOAL = 50;
  // 레벨 n → n+1에 필요한 XP: 100, 150, 200, ...
  function levelInfo(xp) {
    var lv = 1, need = 100, rest = xp;
    while (rest >= need) { rest -= need; lv++; need += 50; }
    return { lv: lv, cur: rest, need: need, pct: Math.round(rest / need * 100) };
  }
  function todayXp(p) { return p.dailyDate === today() ? p.dailyXp : 0; }
  var BADGES = [
    { id: 'first_day', name: '첫 발자국', desc: '첫 Day 완료', mark: '1', test: function (p) { return p.completedDays.length >= 1; } },
    { id: 'perfect', name: '퍼펙트', desc: 'Day 퀴즈 10문제 모두 정답', mark: '10', test: function (p, c) { return c.perfect; } },
    { id: 'combo5', name: '콤보 마스터', desc: '5문제 연속 정답', mark: '5x', test: function (p) { return p.bestCombo >= 5; } },
    { id: 'streak3', name: '꾸준함', desc: '3일 연속 학습', mark: '3d', test: function (p) { return p.streak >= 3; } },
    { id: 'streak7', name: '일주일 개근', desc: '7일 연속 학습', mark: '7d', test: function (p) { return p.streak >= 7; } },
    { id: 'goal', name: '오늘 목표 달성', desc: '하루 ' + DAILY_GOAL + ' XP 모으기', mark: 'XP', test: function (p) { return todayXp(p) >= DAILY_GOAL; } },
    { id: 'words50', name: '단어 수집가', desc: '단어 카드 50장 모으기', mark: '50', test: function (p) { return collected(p).length >= 50; } },
    { id: 'reviewer', name: '복습왕', desc: '복습으로 단어 10개 다시 익히기', mark: 'R', test: function (p) { return p.reviewedCount >= 10; } },
    { id: 'book1', name: '한 권 완독', desc: '책 한 권의 Day 모두 완료', mark: 'B', test: function (p) { return p.completedDays.length >= DAYS.length; } }
  ];
  function badgeById(id) { return BADGES.filter(function (b) { return b.id === id; })[0]; }
  function badgeIcon(b, earned, size) {
    size = size || 56;
    var fill = earned ? '#FFC94D' : '#E8E6EF', ring = earned ? '#D69A12' : '#CBC8D6', ink = earned ? '#1E1B2E' : '#6E6A82';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 56 56" aria-hidden="true">' +
      '<path d="M18 40l-4 14 8-4 6 6 2-15M38 40l4 14-8-4-6 6-2-15" fill="' + (earned ? '#4F46E5' : '#CBC8D6') + '"/>' +
      '<circle cx="28" cy="24" r="20" fill="' + fill + '" stroke="' + ring + '" stroke-width="3"/>' +
      '<text x="28" y="30" text-anchor="middle" font-size="' + (b.mark.length > 2 ? 12 : 15) + '" font-weight="900" font-family="Noto Sans KR, sans-serif" fill="' + ink + '">' + b.mark + '</text></svg>';
  }

  // ---------- 효과음 (Web Audio, 파일 없이 합성) ----------
  var soundOn = true;
  try { soundOn = localStorage.getItem('vocaive.sound') !== 'off'; } catch (e) {}
  var audioCtx = null;
  function tones(notes) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t0 = audioCtx.currentTime;
      notes.forEach(function (n) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = n.type || 'triangle'; o.frequency.value = n.f;
        g.gain.setValueAtTime(0.0001, t0 + n.t);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + n.t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + n.t); o.stop(t0 + n.t + n.d + 0.05);
      });
    } catch (e) { /* 소리 재생 실패는 무시 */ }
  }
  var SFX = {
    right: function () { tones([{ f: 660, t: 0, d: 0.12 }, { f: 880, t: 0.1, d: 0.18 }]); },
    combo: function () { tones([{ f: 660, t: 0, d: 0.1 }, { f: 880, t: 0.08, d: 0.1 }, { f: 1175, t: 0.16, d: 0.2 }]); },
    wrong: function () { tones([{ f: 220, t: 0, d: 0.22, type: 'sine' }, { f: 180, t: 0.12, d: 0.25, type: 'sine' }]); },
    fanfare: function () { tones([{ f: 523, t: 0, d: 0.14 }, { f: 659, t: 0.12, d: 0.14 }, { f: 784, t: 0.24, d: 0.14 }, { f: 1047, t: 0.36, d: 0.4 }]); }
  };

  // ---------- 축하 효과 (색종이) ----------
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var box = document.createElement('div');
    box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
    var colors = ['#4F46E5', '#FFC94D', '#12866F', '#F29D1A', '#8B83F0'];
    for (var i = 0; i < 60; i++) {
      var s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.6) + 's';
      s.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      s.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3400);
  }
  function collected(p) {
    var ids = [];
    DAYS.forEach(function (d) { if (p.completedDays.indexOf(d.day) >= 0) d.words.forEach(function (w) { ids.push(w.id); }); });
    return ids;
  }
  function nextDay(p) {
    var d = DAYS.filter(function (x) { return p.completedDays.indexOf(x.day) < 0; })[0];
    return d ? d.day : null;
  }
  function dayState(p, n) {
    if (p.completedDays.indexOf(n) >= 0) return 'done';
    return n === nextDay(p) ? 'current' : 'locked';
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
  // 예문 속 표제어(활용형 포함) 위치 찾기: shook, hid 같은 불규칙형은 못 찾을 수 있음
  function findInSentence(word, sentence) {
    var stem = word.toLowerCase().replace(/e$/, '');
    if (stem.length > 4) stem = stem.slice(0, stem.length - 1);
    var m = sentence.match(/[A-Za-z']+/g) || [];
    for (var i = 0; i < m.length; i++) { if (m[i].toLowerCase().indexOf(stem) === 0) return m[i]; }
    return null;
  }
  function highlight(sentence, word) {
    var hit = findInSentence(word, sentence);
    if (!hit) return esc(sentence);
    return esc(sentence).replace(esc(hit), '<mark>' + esc(hit) + '</mark>');
  }

  // ---------- 아이콘 ----------
  var I = {
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6E6A82" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: function (c, s) { return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>'; },
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C2410C" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6E6A82" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
    play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#1E1B2E" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    chev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6E6A82" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    speaker: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 010 6"/></svg>',
    flame: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#F29D1A" aria-hidden="true"><path d="M12 2c1 4 6 6 6 12a6 6 0 01-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z"/></svg>',
    star: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#4F46E5" aria-hidden="true"><path d="M12 2l3 7 7 .6-5.3 4.6 1.6 7L12 17.5 5.7 21.2l1.6-7L2 9.6 9 9z"/></svg>',
    redo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M20 4v5h-5M4 20v-5h5"/></svg>',
    home: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7v9H4z"/></svg>',
    drawer: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M10 7.5h4M10 16.5h4"/></svg>',
    review: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M20 4v5h-5M4 20v-5h5"/></svg>',
    user: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>'
  };
  function mascot(size, happy) {
    var face = happy
      ? '<path d="M38 66q10 -12 20 0M74 66q10 -12 20 0" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M50 88q16 18 32 0" stroke="#FFC94D" stroke-width="7" stroke-linecap="round" fill="none"/>'
      : '<circle cx="48" cy="66" r="12" fill="#FFFFFF"/><circle cx="84" cy="66" r="12" fill="#FFFFFF"/><circle cx="51" cy="68" r="5" fill="#1E1B2E"/><circle cx="87" cy="68" r="5" fill="#1E1B2E"/><path d="M52 92q14 12 28 0" stroke="#FFC94D" stroke-width="6" stroke-linecap="round" fill="none"/>';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 132 132" role="img" aria-label="보카이브 마스코트" style="position:relative">' +
      '<circle cx="66" cy="70" r="52" fill="#4F46E5"/><path d="M36 30l10 18M96 30l-10 18" stroke="#4F46E5" stroke-width="10" stroke-linecap="round"/>' + face + '</svg>';
  }
  function icard(w, extra) {
    extra = extra || '';
    return '<div class="icard ' + extra + '"><div class="no"><span>' + no(w.id) + '</span>' +
      (extra.indexOf('again') >= 0 ? '<span>다시 볼</span>' : '<i></i>') + '</div>' +
      '<span class="w' + (w.word.length > 8 ? ' long' : '') + '" lang="en">' + esc(w.word) + '</span><span class="m">' + esc(w.meaning.split(',')[0]) + '</span></div>';
  }
  function tabbar(active) {
    var tabs = [['home', '홈', I.home], ['archive', '아카이브', I.drawer], ['review', '복습', I.review], ['profile', '프로필', I.user]];
    return '<nav class="tabbar" aria-label="주요 메뉴">' + tabs.map(function (t) {
      return '<button type="button" class="tab" data-go="' + t[0] + '"' + (t[0] === active ? ' aria-current="page"' : '') + '>' + t[2] + t[1] + '</button>';
    }).join('') + '</nav>';
  }

  // ---------- 라우터 ----------
  var route = { name: 'login', params: {} };
  var quiz = null; // 진행 중인 퀴즈
  var app = document.getElementById('app');

  function go(name, params) {
    route = { name: name, params: params || {} };
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    var u = me();
    if (!u && ['login', 'signup', 'loading'].indexOf(route.name) < 0) route = { name: 'login', params: {} };
    if (u && (route.name === 'login' || route.name === 'signup')) route = { name: 'home', params: {} };
    app.className = 'phone' + (['login', 'cards', 'result'].indexOf(route.name) >= 0 ? ' tinted' : '');
    app.innerHTML = SCREENS[route.name](u, route.params);
    if (route.name === 'match' && match) animateFlips();
    var focus = app.querySelector('[autofocus]');
    if (focus) focus.focus();
  }

  // ---------- 화면 ----------
  var SCREENS = {};

  SCREENS.loading = function () {
    return '<div class="login-hero">' + mascot(110) + '<p class="sub" style="font-weight:700">보카이브를 여는 중…</p></div>';
  };

  SCREENS.login = function (u, p) {
    return '<div class="login-hero">' +
      '<div class="mascot-stage"><div class="mini-card left"><span>No.001</span><i></i><i></i><i></i></div>' +
      '<div class="mini-card right"><span>No.' + String(TOTAL).padStart(3, '0') + '</span><i></i><i></i><i></i></div>' + mascot(132) + '</div>' +
      '<h1 class="display">보카이브</h1><span class="tagline-pill">VOCA + ARCHIVE</span>' +
      '<p class="sub" style="margin:4px 0 0;font-weight:500">읽은 책의 단어를 차곡차곡 모아요</p></div>' +
      '<form class="sheet" data-form="login" novalidate>' +
      '<label class="field">이메일<input name="email" type="email" autocomplete="email" placeholder="you@example.com" value="' + esc(p.email || '') + '"></label>' +
      '<label class="field">비밀번호<input name="password" type="password" autocomplete="current-password" placeholder="8자 이상"></label>' +
      (p.notice ? '<p class="form-notice" role="status">' + esc(p.notice) + '</p>' : '') +
      '<p class="form-error" role="alert">' + esc(p.error || '') + '</p>' +
      '<button class="btn btn-primary" type="submit">내 아카이브 열기</button>' +
      '<p class="sub" style="margin:4px 0 0;text-align:center;font-size:14px">처음이에요 <button type="button" class="link-btn" data-go="signup">회원가입</button></p></form>';
  };

  SCREENS.signup = function (u, p) {
    return '<div class="topbar"><button type="button" class="icon-btn" data-go="login" aria-label="로그인으로 돌아가기">' + I.back + '</button></div>' +
      '<form class="content" data-form="signup" novalidate>' +
      '<h1 class="display" style="margin:0;font-size:32px;line-height:1.3">나만의 단어<br>아카이브 만들기</h1>' +
      '<p class="sub" style="margin:0 0 20px">세 가지만 입력하면 바로 시작해요.</p>' +
      '<label class="field">이름<input name="name" type="text" autocomplete="nickname" maxlength="12" placeholder="현우 (2~12자)" value="' + esc(p.name || '') + '"></label>' +
      '<label class="field">이메일<input name="email" type="email" autocomplete="email" placeholder="you@example.com" value="' + esc(p.email || '') + '"></label>' +
      '<label class="field">비밀번호<input name="password" type="password" autocomplete="new-password" placeholder="8자 이상"><span class="hint">8자 이상 입력해 주세요</span></label>' +
      '<p class="form-error" role="alert">' + esc(p.error || '') + '</p>' +
      '<div style="margin-top:auto;display:flex;flex-direction:column;gap:14px">' +
      '<div class="book-row" style="background:var(--tint);border:none"><div class="cover"></div><span class="sub" style="font-size:13px">가입하면 <b style="color:var(--ink)">' + esc(BOOK.book.title.split(':')[0]) + '</b>이 서재에 바로 담겨요.</span></div>' +
      '<button class="btn btn-primary" type="submit">가입하고 시작하기</button></div></form>';
  };

  function header(u) {
    var pr = u.progress;
    return '<div class="topbar"><div class="brand"><b>보카이브</b><small>VOCAIVE</small></div>' +
      '<div class="pills"><span class="pill streak" aria-label="연속 학습일">' + I.flame + streakNow(pr) + '일</span>' +
      '<span class="pill xp" aria-label="레벨 ' + levelInfo(pr.xp).lv + ', 경험치 ' + pr.xp + '">' + I.star + 'Lv.' + levelInfo(pr.xp).lv + '</span></div></div>';
  }
  // 오늘의 목표 링 + 레벨 막대
  function goalCard(pr) {
    var t = todayXp(pr), pct = Math.min(1, t / DAILY_GOAL), lv = levelInfo(pr.xp);
    var r = 22, c = 2 * Math.PI * r;
    var done = t >= DAILY_GOAL;
    return '<div class="goal-card">' +
      '<div class="ring" role="img" aria-label="오늘의 목표 ' + DAILY_GOAL + ' XP 중 ' + t + ' XP">' +
      '<svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="' + r + '" fill="none" stroke="#EAEBFF" stroke-width="8"/>' +
      '<circle cx="30" cy="30" r="' + r + '" fill="none" stroke="' + (done ? '#12866F' : '#FFC94D') + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 30 30)"/></svg>' +
      '<span>' + (done ? I.check('#12866F', 22) : Math.round(pct * 100) + '%') + '</span></div>' +
      '<div class="goal-text"><b>' + (done ? '오늘 목표 달성!' : '오늘의 목표 ' + t + ' / ' + DAILY_GOAL + ' XP') + '</b>' +
      '<span>Lv.' + lv.lv + ' · 다음 레벨까지 ' + (lv.need - lv.cur) + ' XP</span>' +
      '<div class="lv-bar"><span style="width:' + lv.pct + '%"></span></div></div></div>';
  }

  SCREENS.home = function (u) {
    var pr = u.progress;
    var ids = collected(pr);
    var recent = ids.slice(-3).map(function (id) { return WORDS[id]; });
    var nd = nextDay(pr);
    var fan = recent.length
      ? '<div class="fan">' + recent.map(function (w) { return icard(w); }).join('') + '</div>'
      : '<p class="empty-note">첫 Day를 끝내면 단어 카드가 여기에 모여요</p>';
    // Day 경로: 현재 Day 앞뒤로 4칸
    var center = nd || DAYS.length;
    var start = Math.max(1, Math.min(center - 2, DAYS.length - 3));
    var path = '';
    for (var n = start; n < start + 4 && n <= DAYS.length; n++) {
      var st = dayState(pr, n);
      if (n > start) path += '<span class="bar' + (st === 'done' || (st === 'current' && dayState(pr, n - 1) === 'done') ? ' done' : '') + '"></span>';
      path += '<span class="node ' + st + '" aria-label="Day ' + n + ' ' + ({ done: '완료', current: '진행할 차례', locked: '잠김' })[st] + '">' +
        (st === 'done' ? I.check('#FFFFFF') : st === 'current' ? n : I.lock) + '</span>';
    }
    var cta = nd
      ? '<button type="button" class="btn btn-primary" data-go="cards" data-day="' + nd + '"><span>Day ' + nd + ' 단어 모으기</span><span style="font-size:13px;font-weight:500">새 단어 ' + dayOf(nd).words.length + '</span></button>'
      : '<button type="button" class="btn btn-primary" data-go="archive">모든 Day 완료! 아카이브 보기</button>';
    return header(u) + '<div class="content">' + goalCard(pr) +
      '<button type="button" class="panel" data-go="archive" style="border:none;text-align:left;width:100%">' +
      '<div class="panel-head"><span class="display">내 단어 아카이브</span><strong>' + ids.length + ' / ' + TOTAL + ' 모음</strong></div>' +
      '<div class="progress thin"><span style="width:' + Math.round(ids.length / TOTAL * 100) + '%"></span></div>' + fan + '</button>' +
      '<button type="button" class="book-row" data-go="book"><div class="cover"></div><div class="meta"><small>서재 No.01</small><b>' +
      esc(BOOK.book.title.split(':')[0]) + '</b><span>' + DAYS.length + '개 중 ' + pr.completedDays.length + '개 Day 완료</span></div>' + I.chev + '</button>' +
      '<div class="path">' + path + '</div>' + cta + '</div>' + tabbar('home');
  };

  SCREENS.book = function (u) {
    var pr = u.progress;
    var ids = collected(pr);
    var rows = DAYS.map(function (d) {
      var st = dayState(pr, d.day);
      var dot = st === 'done' ? I.check('#FFFFFF', 16) : st === 'current' ? I.play : I.lock;
      var sub = st === 'current'
        ? '<span>새 단어 ' + d.words.length + (d.reviewIds.length ? ' · 다시 나온 단어 ' + d.reviewIds.length : '') + ' · 책 p.' + pageRange(d) + '</span>'
        : '';
      return '<button type="button" class="day-row ' + st + '"' + (st === 'locked' ? ' disabled aria-disabled="true"' : ' data-go="cards" data-day="' + d.day + '"') + '>' +
        '<span class="dot">' + dot + '</span><span class="t"><b>Day ' + d.day + ' · ' + esc(d.title) + '</b>' + sub + '</span>' +
        '<span class="n">' + (st === 'done' ? '다시 보기' : d.words.length + '단어') + '</span></button>';
    }).join('');
    return '<div class="book-head"><button type="button" class="icon-btn" data-go="home" aria-label="홈으로 돌아가기" style="margin-left:-8px">' + I.back + '</button>' +
      '<div style="display:flex;gap:16px;align-items:center"><div class="cover-lg">DRAGON<br>MASTERS 1</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px"><small class="muted" style="font-size:11px;font-weight:700">서재 No.01 · ' + esc(BOOK.book.publisher) + '</small>' +
      '<span class="display" style="font-size:22px;line-height:1.2">' + esc(BOOK.book.title.split(':')[0]) + '</span>' +
      '<span class="sub" style="font-size:13px">' + esc((BOOK.book.title.split(':')[1] || '').trim()) + '</span></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><div class="progress thin"><span style="width:' + Math.round(pr.completedDays.length / DAYS.length * 100) + '%"></span></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:var(--primary-dark)"><span>Day ' + pr.completedDays.length + ' / ' + DAYS.length + ' 완료</span><span>단어 ' + ids.length + ' / ' + TOTAL + ' 모음</span></div></div></div>' +
      '<div class="day-list">' + rows + '</div>';
  };

  SCREENS.cards = function (u, p) {
    var d = dayOf(p.day);
    var i = p.i || 0;
    var w = d.words[i];
    var last = i === d.words.length - 1;
    var dots = d.words.map(function (_, k) { return '<i' + (k <= i ? ' class="on"' : '') + '></i>'; }).join('');
    return '<div class="topbar"><button type="button" class="icon-btn" data-go="book" aria-label="학습 닫기">' + I.close + '</button>' +
      '<div class="dots" aria-hidden="true">' + dots + '</div><span class="count">' + (i + 1) + '/' + d.words.length + '</span></div>' +
      '<div class="content"><div><span class="sub" style="font-size:13px;font-weight:700">Day ' + d.day + ' · ' + esc(d.title) + '</span>' +
      '<h1 class="section-title">새 단어를 살펴봐요</h1></div>' +
      '<div class="study-card"><div class="card-head"><span class="hole">' + no(w.id) + '</span><span>책 p.' + w.page + '</span></div>' +
      '<div class="card-body"><div class="word-line"><div><span class="big" lang="en">' + esc(w.word) + '</span><small>' + esc(w.pos) + '</small></div>' +
      '<button type="button" class="speak-btn" data-speak="' + esc(w.word) + '" aria-label="' + esc(w.word) + ' 발음 듣기">' + I.speaker + '</button></div>' +
      '<div class="dash"></div><div><div class="label">뜻</div><div class="meaning">' + esc(w.meaning) + '</div></div>' +
      '<div class="example"><span class="label">예문</span><span class="en" lang="en">' + highlight(w.example, w.word) + '</span><span class="ko">' + esc(w.exampleKo) + '</span></div></div></div>' +
      '<p class="sub" style="text-align:center;font-size:13px;margin:4px 0 0">' + d.words.length + '장을 다 보면 카드 뒤집기와 퀴즈가 이어져요</p>' +
      '<div class="row-btns"><button type="button" class="btn btn-ghost" data-card="' + (i - 1) + '"' + (i === 0 ? ' disabled' : '') + '>이전</button>' +
      (last ? '<button type="button" class="btn btn-primary" data-start-match="' + d.day + '">카드 뒤집기</button>'
            : '<button type="button" class="btn btn-primary" data-card="' + (i + 1) + '">다음</button>') + '</div></div>';
  };

  // ---------- 짝 맞추기 (카드 → 짝 맞추기 → 퀴즈) ----------
  var match = null;
  var matchTimer = null;
  var MATCH_PER_ROUND = 3; // 라운드마다 6장 (3쌍, 3×2 배치)
  var USE_STAR = false;    // true면 보너스 별 카드 1장 추가 (홀수 배치용)
  var STAR_XP = 5;
  function startMatch(dayNum) {
    var d = dayOf(dayNum);
    var ids = d.words.map(function (w) { return w.id; });
    var rounds = [];
    for (var k = 0; k < ids.length; k += MATCH_PER_ROUND) rounds.push(ids.slice(k, k + MATCH_PER_ROUND));
    // 6쌍이 안 되는 라운드는 채움: 이 Day의 복습 단어 → 앞 Day 단어 → 이 Day의 다른 라운드 단어
    var earlier = [];
    DAYS.forEach(function (x) { if (x.day < dayNum) x.words.forEach(function (w) { earlier.push(w.id); }); });
    var pool = d.reviewIds.concat(shuffle(earlier), shuffle(ids));
    rounds.forEach(function (round) {
      for (var p = 0; p < pool.length && round.length < MATCH_PER_ROUND; p++) {
        if (round.indexOf(pool[p]) < 0) round.push(pool[p]);
      }
    });
    var pairs = rounds.length * MATCH_PER_ROUND;
    match = {
      day: dayNum, rounds: rounds, r: 0, cards: [], open: [], done: [], lock: false, preview: false, starFound: false, stars: 0,
      mistakes: 0, bonusLimit: pairs, start: null, time: 0, finished: false, xp: 0
    };
    setupRound();
    clearInterval(matchTimer);
    matchTimer = setInterval(function () {
      var el = document.getElementById('match-time');
      if (!match || match.finished || !match.start || !el) return;
      el.textContent = Math.floor((Date.now() - match.start) / 1000) + '초';
    }, 1000);
  }
  // 라운드 시작: 카드를 섞어 3초 동안 앞면을 보여 준 뒤 모두 뒤집음
  var PREVIEW_MS = 3000;
  function setupRound() {
    var ids = match.rounds[match.r];
    match.cards = shuffle(ids.map(function (id) { return { side: 'en', id: id }; })
      .concat(ids.map(function (id) { return { side: 'ko', id: id }; }))
      .concat(USE_STAR ? [{ side: 'star', id: 'star' }] : []));
    match.open = []; match.done = []; match.lock = true; match.preview = true; match.shown = null; match.starFound = false;
    setTimeout(function () {
      if (!match) return;
      match.preview = false; match.lock = false;
      if (!match.start) match.start = Date.now();
      render();
    }, PREVIEW_MS);
  }
  function koLabel(w) { return w.meaning.split(',')[0].trim(); }
  function isOpenNow(i) {
    var c = match.cards[i];
    if (c.side === 'star') return match.preview || match.starFound;
    return match.preview || match.done.indexOf(c.id) >= 0 || match.open.indexOf(i) >= 0;
  }
  // 화면을 다시 그린 뒤, 직전 상태에서 현재 상태로 class를 바꿔 뒤집기 애니메이션이 보이게 함
  function animateFlips() {
    var els = app.querySelectorAll('.fcard');
    // rAF는 탭이 가려지면 멈출 수 있어 짧은 setTimeout 사용
    setTimeout(function () {
      if (!match) return;
      els.forEach(function (el, i) { el.classList.toggle('open', isOpenNow(i)); });
      match.shown = match.cards.map(function (_, i) { return isOpenNow(i); });
    }, 30);
  }
  function flipCard(i) {
    if (!match || match.finished || match.lock) return;
    var c = match.cards[i];
    if (!c) return;
    // 보너스 별: 짝 없이 혼자 뒤집히고 +5 XP, 짝 맞추기 순서에는 영향 없음
    if (c.side === 'star') {
      if (match.starFound) return;
      match.starFound = true; match.stars++; SFX.combo();
      return render();
    }
    if (match.done.indexOf(c.id) >= 0 || match.open.indexOf(i) >= 0) return;
    if (c.side === 'en') speak(WORDS[c.id].word);
    match.open.push(i);
    if (match.open.length < 2) { tones([{ f: 520, t: 0, d: 0.06 }]); return render(); }
    var a = match.cards[match.open[0]], b = match.cards[match.open[1]];
    if (a.id === b.id && a.side !== b.side) {
      // 짝 성공: 두 장은 앞면으로 고정
      match.done.push(a.id); match.open = []; SFX.right();
      if (match.done.length === match.rounds[match.r].length) {
        if (match.r < match.rounds.length - 1) {
          match.lock = true; render();
          setTimeout(function () { if (!match) return; match.r++; setupRound(); render(); }, 700);
          return;
        }
        match.finished = true;
        match.time = Math.round((Date.now() - match.start) / 1000);
        match.xp = 10 + (match.mistakes <= match.bonusLimit ? 10 : 0) + match.stars * STAR_XP;
        clearInterval(matchTimer);
        if (match.mistakes <= match.bonusLimit) { SFX.fanfare(); confetti(); }
      }
      return render();
    }
    // 짝이 아니면 잠깐 보여 준 뒤 다시 뒤집음
    match.mistakes++; match.lock = true; SFX.wrong();
    render();
    setTimeout(function () { if (!match) return; match.open = []; match.lock = false; render(); }, 900);
  }

  SCREENS.match = function () {
    var d = dayOf(match.day);
    var cards = match.cards.map(function (c, i) {
      if (c.side === 'star') {
        var starOpen = match.shown && match.shown.length === match.cards.length ? match.shown[i] : false;
        return '<button type="button" class="fcard star' + (starOpen ? ' open' : '') + (match.starFound ? ' done' : '') + '" data-flip="' + i + '" aria-label="' +
          (isOpenNow(i) ? '보너스 별, ' + STAR_XP + ' XP' : (i + 1) + '번 카드, 뒤집기') + '"' + (match.starFound ? ' disabled' : '') + '>' +
          '<span class="inner"><span class="face back" aria-hidden="true"><b>V</b></span>' +
          '<span class="face front"><svg width="34" height="34" viewBox="0 0 24 24" fill="#FFC94D" stroke="#D69A12" stroke-width="1.2" aria-hidden="true"><path d="M12 2l3 7 7 .6-5.3 4.6 1.6 7L12 17.5 5.7 21.2l1.6-7L2 9.6 9 9z"/></svg>' +
          '<small>보너스</small>+' + STAR_XP + ' XP</span></span></button>';
      }
      var w = WORDS[c.id];
      var isDone = match.done.indexOf(c.id) >= 0;
      var isOpen = isOpenNow(i);
      var drawnOpen = match.shown && match.shown.length === match.cards.length ? match.shown[i] : false; // 직전 상태로 그림
      var isWrong = match.open.length === 2 && match.open.indexOf(i) >= 0 && !isDone;
      var cls = 'fcard ' + c.side + (drawnOpen ? ' open' : '') + (isDone ? ' done' : '') + (isWrong ? ' wrong' : '');
      var label = c.side === 'en' ? esc(w.word) : esc(koLabel(w));
      var aria = isOpen ? (c.side === 'en' ? '영단어 ' : '뜻 ') + (c.side === 'en' ? w.word : koLabel(w)) : (i + 1) + '번 카드, 뒤집기';
      return '<button type="button" class="' + cls + '" data-flip="' + i + '" aria-label="' + esc(aria) + '"' + (isDone ? ' disabled' : '') + '>' +
        '<span class="inner"><span class="face back" aria-hidden="true"><b>V</b></span>' +
        '<span class="face front"' + (c.side === 'en' ? ' lang="en"' : '') + '><small>' + (c.side === 'en' ? 'ENGLISH' : '뜻') + '</small>' + label + '</span></span></button>';
    }).join('');
    var dots = match.rounds.map(function (_, i) { return '<i' + (i < match.r || (i === match.r && match.finished) ? ' class="on"' : i === match.r ? ' class="on half"' : '') + '></i>'; }).join('');
    var good = match.mistakes <= match.bonusLimit;
    var fb = match.finished
      ? '<div class="feedback ok" role="status"><div class="head"><div><div class="display">카드 뒤집기 완료!</div>' +
        '<div style="font-size:13px;font-weight:700">' + match.time + '초 · 실수 ' + match.mistakes + '번' + (USE_STAR ? ' · 별 ' + match.stars + '개' : '') + ' · +' + match.xp + ' XP</div></div>' +
        '<span class="combo">' + (good ? '기억력 굿!' : '완료') + '</span></div>' +
        '<button type="button" class="btn btn-ok" data-start-quiz="' + d.day + '" autofocus>퀴즈 시작</button></div>'
      : '';
    var hint = match.preview
      ? '<p class="preview-note" role="status">카드 위치를 기억하세요! 곧 뒤집혀요</p>'
      : '<p class="sub" style="text-align:center;font-size:13px;margin:4px 0 0">두 장을 뒤집어 영단어와 뜻을 짝지어요' + (USE_STAR ? ' · 숨은 별을 찾으면 +' + STAR_XP + ' XP' : '') + ' · 실수 ' + match.bonusLimit + '번 이하면 +10 XP</p>';
    var t = match.finished ? match.time : match.start ? Math.floor((Date.now() - match.start) / 1000) : 0;
    return '<div class="topbar"><button type="button" class="icon-btn" data-quit-match aria-label="카드 뒤집기 닫기">' + I.close + '</button>' +
      '<div class="dots" aria-hidden="true">' + dots + '</div><span class="count" id="match-time">' + t + '초</span></div>' +
      '<div class="content"><div><span class="sub" style="font-size:13px;font-weight:700">Day ' + d.day + ' · 라운드 ' + (match.r + 1) + '/' + match.rounds.length + '</span>' +
      '<div class="q-title-row"><h1 class="section-title">카드 뒤집기</h1>' + (match.mistakes ? '<span class="combo small">실수 ' + match.mistakes + '</span>' : '') + '</div></div>' +
      hint + '<div class="flip-grid">' + cards + '</div>' +
      (match.finished ? '' : '<button type="button" class="link-btn" style="align-self:center" data-start-quiz="' + d.day + '">건너뛰고 퀴즈로</button>') +
      '</div>' + fb;
  };

  // ---------- 퀴즈 ----------
  function makeQuestion(w, type, retry) {
    var first = function (x) { return x.meaning.split(',')[0].trim(); };
    var others = ALL.filter(function (x) { return x.id !== w.id; });
    var same = others.filter(function (x) { return x.pos === w.pos; });
    // 같은 품사 우선, 뜻(첫 번째)과 철자가 겹치지 않는 보기 3개
    var used = [first(w)], usedWord = [w.word], pick = [];
    shuffle(same).concat(shuffle(others)).forEach(function (x) {
      if (pick.length < 3 && used.indexOf(first(x)) < 0 && usedWord.indexOf(x.word) < 0) { pick.push(x); used.push(first(x)); usedWord.push(x.word); }
    });
    var hit = findInSentence(w.word, w.example);
    if (type === 'blank' && !hit) type = 'meaning';
    var q = { wordId: w.id, type: type, retry: !!retry, answer: w.id };
    var opts = shuffle([w].concat(pick));
    if (type === 'meaning') {
      q.title = '알맞은 뜻을 골라요';
      q.options = opts.map(function (x) { return { id: x.id, label: x.meaning.split(',')[0] }; });
    } else if (type === 'word') {
      q.title = '뜻에 맞는 단어를 골라요';
      q.options = opts.map(function (x) { return { id: x.id, label: x.word, en: true }; });
    } else {
      q.title = '빈칸에 들어갈 단어를 골라요';
      q.sentence = esc(w.example).replace(esc(hit), '_____');
      q.options = opts.map(function (x) { return { id: x.id, label: x.word, en: true }; });
    }
    return q;
  }
  function startQuiz(mode, dayNum, ids) {
    var types = ['meaning', 'word', 'blank'];
    var list = shuffle(ids).slice(0, 10);
    quiz = {
      mode: mode, day: dayNum,
      queue: list.map(function (id, k) { return makeQuestion(WORDS[id], types[k % 3]); }),
      idx: 0, firstTry: 0, scored: list.length, wrong: [], rightIds: [], answered: null,
      story: null, storyAnswered: null,
      combo: 0, maxCombo: 0, comboBonus: 0
    };
  }
  function storyQuestion(d) {
    // 스포일러 방지: 오답 보기는 이미 읽은 앞 챕터에서만 고름 (Day 1은 줄거리 문제 없음)
    var others = shuffle(DAYS.filter(function (x) { return x.day < d.day; })).slice(0, 3);
    if (!others.length) return null;
    return { options: shuffle([d].concat(others)).map(function (x) { return { id: x.day, label: x.summary }; }), answer: d.day };
  }

  SCREENS.quiz = function (u) {
    var q = quiz.queue[quiz.idx];
    var w = WORDS[q.wordId];
    var a = quiz.answered;
    var pct = Math.round((quiz.idx + (a ? 1 : 0)) / (quiz.queue.length + (quiz.mode === 'day' ? 1 : 0)) * 100);
    var main;
    if (q.type === 'meaning') {
      main = '<button type="button" class="speak-btn" data-speak="' + esc(w.word) + '" aria-label="' + esc(w.word) + ' 발음 듣기">' + I.speaker + '</button>' +
        '<div><span class="big" lang="en">' + esc(w.word) + '</span><small>' + esc(w.pos) + '</small></div>';
    } else if (q.type === 'word') {
      main = '<div><span class="big">' + esc(w.meaning) + '</span><small>' + esc(w.pos) + '</small></div>';
    } else {
      main = '<div><span class="sentence" lang="en">' + q.sentence + '</span><small>' + esc(w.exampleKo) + '</small></div>';
    }
    var opts = q.options.map(function (o) {
      var cls = 'opt', icon = '';
      if (a) {
        if (o.id === q.answer) { cls += a.ok ? ' right' : ' missed'; icon = I.check('#12866F'); }
        else if (o.id === a.chosen) { cls += ' wrong'; icon = I.x; }
      }
      return '<button type="button" class="' + cls + '" data-answer="' + o.id + '"' + (a ? ' disabled' : '') + (o.en ? ' lang="en"' : '') + '>' + icon + esc(o.label) + '</button>';
    }).join('');
    var fb = '';
    if (a) {
      fb = a.ok
        ? '<div class="feedback ok" role="status"><div class="head"><div><div class="display">' + (q.retry ? '이번엔 맞혔어요!' : '정답! 아카이브에 모았어요') + '</div><div style="font-size:13px;font-weight:700">' + (q.retry ? '복습 탭에서 한 번 더 확인해요' : '+10 XP' + (a.bonus ? ' · 콤보 보너스 +' + a.bonus : '')) + '</div></div>' +
          (!q.retry && quiz.combo >= 2 ? '<span class="combo" aria-label="' + quiz.combo + '문제 연속 정답">' + quiz.combo + ' 콤보</span>' : '<span class="stamp">' + no(w.id) + '</span>') + '</div>' +
          '<button type="button" class="btn btn-ok" data-next autofocus>계속</button></div>'
        : '<div class="feedback bad" role="status"><div><div class="display">아쉬워요! 정답은 \'' + esc(q.type === 'meaning' ? w.meaning.split(',')[0] : w.word) + '\'</div>' +
          '<div style="font-size:14px" lang="en">' + highlight(w.example, w.word) + '</div></div>' +
          (q.retry ? '' : '<span class="note">' + I.redo + '이 단어는 마지막에 한 번 더 나와요</span>') +
          '<button type="button" class="btn btn-bad" data-next autofocus>계속</button></div>';
    }
    var headLeft = quiz.mode === 'day' ? 'Day ' + quiz.day + ' · 책 p.' + w.page : '복습 · Day ' + w.day;
    return '<div class="topbar"><button type="button" class="icon-btn" data-quit aria-label="퀴즈 닫기">' + I.close + '</button>' +
      '<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct + '%"></span></div>' +
      '<span class="count">' + (q.retry ? '다시' : (quiz.idx + 1) + '/' + quiz.scored) + '</span></div>' +
      '<div class="content"><div class="q-title-row"><h1 class="section-title">' + q.title + '</h1>' +
      (quiz.combo >= 2 && !a ? '<span class="combo small">' + quiz.combo + ' 콤보 중</span>' : '') + '</div>' +
      '<div class="q-card"><div class="card-head"><span class="hole">' + no(w.id) + '</span><span>' + headLeft + '</span></div><div class="q-main">' + main + '</div></div>' +
      '<div class="options">' + opts + '</div></div>' + fb;
  };

  SCREENS.story = function () {
    var d = dayOf(quiz.day);
    var s = quiz.story;
    var a = quiz.storyAnswered;
    var opts = s.options.map(function (o) {
      var cls = 'opt', icon = '';
      if (a) {
        if (o.id === s.answer) { cls += a.ok ? ' right' : ' missed'; icon = I.check('#12866F'); }
        else if (o.id === a.chosen) { cls += ' wrong'; icon = I.x; }
      }
      return '<button type="button" class="' + cls + '" data-story="' + o.id + '"' + (a ? ' disabled' : '') + '>' + icon + esc(o.label) + '</button>';
    }).join('');
    var fb = a
      ? '<div class="feedback ' + (a.ok ? 'ok' : 'bad') + '" role="status"><div class="display">' + (a.ok ? '정답! 줄거리를 잘 기억하고 있어요' : '아쉬워요! 위에 표시된 내용이 정답이에요') + '</div>' +
        '<button type="button" class="btn ' + (a.ok ? 'btn-ok' : 'btn-bad') + '" data-finish autofocus>결과 보기</button></div>'
      : '';
    return '<div class="topbar"><button type="button" class="icon-btn" data-quit aria-label="퀴즈 닫기">' + I.close + '</button>' +
      '<div class="progress"><span style="width:' + (a ? 100 : 92) + '%"></span></div><span class="count">마지막</span></div>' +
      '<div class="content"><span class="story-badge">마지막 문제 · 줄거리</span>' +
      '<h1 class="section-title" style="line-height:1.35">Day ' + d.day + ' "' + esc(d.title) + '"<br>내용으로 맞는 것은?</h1>' +
      '<div class="book-row" style="background:var(--tint);border:none"><div class="cover" style="width:34px;height:46px"></div><span class="sub" style="font-size:13px">책 p.' + pageRange(d) + '를 떠올려 보세요</span></div>' +
      '<div class="options stack">' + opts + '</div></div>' + fb;
  };

  function finishQuiz(u) {
    var pr = u.progress;
    var res = { mode: quiz.mode, day: quiz.day, firstTry: quiz.firstTry, scored: quiz.scored, wrong: quiz.wrong.slice(), storyOk: !!(quiz.storyAnswered && quiz.storyAnswered.ok), maxCombo: quiz.maxCombo };
    var before = pr.wrongIds.length;
    var wrongSet = pr.wrongIds.filter(function (id) { return quiz.rightIds.indexOf(id) < 0; });
    var cleared = before - wrongSet.length;
    quiz.wrong.forEach(function (id) { if (wrongSet.indexOf(id) < 0) wrongSet.push(id); });
    pr.wrongIds = wrongSet;
    if (quiz.mode === 'review') pr.reviewedCount += cleared;
    res.cleared = cleared;

    // XP 내역
    var parts = [['정답 ' + quiz.firstTry + '개', quiz.firstTry * 10]];
    var perfect = quiz.firstTry === quiz.scored && quiz.scored > 0;
    if (quiz.mode === 'day') {
      parts.push(['Day 완료', 20]);
      if (res.storyOk) parts.push(['줄거리 정답', 10]);
      res.isNew = pr.completedDays.indexOf(quiz.day) < 0;
      if (res.isNew) { pr.completedDays.push(quiz.day); pr.completedDays.sort(function (a, b) { return a - b; }); }
    }
    if (quiz.matchResult) parts.push(['카드 뒤집기 (' + quiz.matchResult.time + '초, 실수 ' + quiz.matchResult.mistakes + (quiz.matchResult.stars ? ', 별 ' + quiz.matchResult.stars : '') + ')', quiz.matchResult.xp]);
    if (quiz.comboBonus) parts.push(['콤보 보너스 (최고 ' + quiz.maxCombo + '연속)', quiz.comboBonus]);
    if (perfect) parts.push(['퍼펙트', 20]);
    var gain = parts.reduce(function (s, x) { return s + x[1]; }, 0);
    res.parts = parts.filter(function (x) { return x[1] > 0; });
    res.perfect = perfect;

    var t = today();
    if (pr.lastStudyDate !== t) {
      pr.streak = pr.lastStudyDate && gapDays(pr.lastStudyDate, t) === 1 ? pr.streak + 1 : 1;
      pr.lastStudyDate = t;
    }
    var goalBefore = todayXp(pr) >= DAILY_GOAL;
    var lvBefore = levelInfo(pr.xp).lv;
    if (pr.dailyDate !== t) { pr.dailyDate = t; pr.dailyXp = 0; }
    pr.dailyXp += gain;
    pr.xp += gain;
    pr.bestCombo = Math.max(pr.bestCombo, quiz.maxCombo);
    res.gain = gain;
    res.streak = pr.streak;
    res.levelUp = levelInfo(pr.xp).lv > lvBefore ? levelInfo(pr.xp).lv : 0;
    res.goalReached = !goalBefore && todayXp(pr) >= DAILY_GOAL;
    // 새 배지
    res.newBadges = BADGES.filter(function (b) { return pr.badges.indexOf(b.id) < 0 && b.test(pr, { perfect: perfect && quiz.mode === 'day' }); })
      .map(function (b) { return b.id; });
    pr.badges = pr.badges.concat(res.newBadges);
    putUser(u);
    quiz = null;
    go('result', res);
    if (res.levelUp || res.perfect || res.goalReached || res.newBadges.length) { SFX.fanfare(); confetti(); }
  }

  SCREENS.result = function (u, r) {
    var pr = u.progress;
    var ids = collected(pr);
    var title, sub, cards = '';
    if (r.mode === 'day') {
      var d = dayOf(r.day);
      title = 'Day ' + r.day + ' 완료!';
      sub = esc(d.title) + ' · 책 p.' + pageRange(d);
      var shown = d.words.slice(0, 3);
      cards = '<div class="white-panel"><div class="panel-head"><span class="display" style="font-size:19px">' + (r.isNew ? '새로 모은 카드 ' : '다시 본 카드 ') + d.words.length + '장</span><strong>' + ids.length + ' / ' + TOTAL + '</strong></div>' +
        '<div class="fan">' + shown.map(function (w) { return icard(w, 'fresh'); }).join('') + '</div>' +
        (d.words.length > 3 ? '<p class="sub" style="margin:0;text-align:center;font-size:13px;font-weight:700">외 ' + (d.words.length - 3) + '장</p>' : '');
    } else {
      title = '복습 완료!';
      sub = '다시 볼 단어 ' + pr.wrongIds.length + '개 남았어요';
      cards = '<div class="white-panel">';
    }
    var again = r.wrong.length
      ? '<div class="again-row"><b>다시 볼 단어</b>' + r.wrong.map(function (id) { return '<span><strong>' + esc(WORDS[id].word) + '</strong> ' + esc(WORDS[id].meaning.split(',')[0]) + '</span>'; }).join('') + '</div>'
      : '<p class="sub" style="margin:0;text-align:center;font-size:14px;font-weight:700">틀린 단어 없이 모두 맞혔어요!</p>';
    var lv = levelInfo(pr.xp);
    var banners = '';
    if (r.levelUp) banners += '<div class="banner level"><b>레벨 업!</b><span>Lv.' + r.levelUp + '이 되었어요</span></div>';
    if (r.perfect) banners += '<div class="banner perfect"><b>퍼펙트!</b><span>첫 시도에 모두 맞혔어요</span></div>';
    if (r.goalReached) banners += '<div class="banner goal"><b>오늘 목표 달성!</b><span>오늘 ' + todayXp(pr) + ' XP를 모았어요</span></div>';
    var nb = r.newBadges || [];
    var badgeHtml = nb.length
      ? '<div class="new-badge"><small>새 배지 ' + nb.length + '개</small><div class="nb-row">' + nb.map(function (id) {
          var b = badgeById(id);
          return '<div class="nb">' + badgeIcon(b, true, 44) + '<b>' + esc(b.name) + '</b></div>';
        }).join('') + '</div></div>'
      : '';
    var breakdown = '<div class="white-panel xp-panel"><div class="panel-head"><span class="display" style="font-size:19px">얻은 XP</span><strong>+' + r.gain + '</strong></div>' +
      (r.parts || []).map(function (x) { return '<div class="xp-line"><span>' + esc(x[0]) + '</span><b>+' + x[1] + '</b></div>'; }).join('') +
      '<div class="xp-line lv"><span>Lv.' + lv.lv + '</span><div class="lv-bar"><span style="width:' + lv.pct + '%"></span></div><small>' + lv.cur + '/' + lv.need + '</small></div></div>';
    return '<div class="result">' + mascot(96, true) +
      '<h1 class="display" style="margin:0;font-size:32px">' + title + '</h1><span class="sub" style="font-size:14px">' + sub + '</span>' +
      banners + badgeHtml +
      '<div class="stats"><div class="stat"><b>' + r.firstTry + '/' + r.scored + '</b><span>정답</span></div>' +
      '<div class="stat"><b>' + (r.maxCombo || 0) + '</b><span>최고 콤보</span></div>' +
      '<div class="stat warm"><b>' + r.streak + '일</b><span>연속 학습</span></div></div>' +
      breakdown + cards + again + '</div></div>' +
      '<div class="bottom-actions"><button type="button" class="btn btn-primary" data-go="archive">아카이브에서 보기</button>' +
      '<button type="button" class="btn btn-ghost" data-go="home">홈으로</button></div>';
  };

  SCREENS.archive = function (u, p) {
    var pr = u.progress;
    var filter = p.filter || 'all';
    var ids = collected(pr);
    var list = (filter === 'again' ? pr.wrongIds.slice() : ids.slice()).reverse();
    var nd = nextDay(pr);
    var cells = '';
    if (filter === 'all' && nd) {
      var nextNo = 'No.' + String(ids.length + 1).padStart(3, '0');
      cells += '<div class="icard empty" aria-label="다음 카드"><span style="font-size:10px;font-weight:900;color:var(--primary-text)">' + nextNo + '</span><b>?</b><span class="muted" style="font-size:10px">Day ' + nd + '에서</span></div>';
    }
    cells += list.map(function (id) {
      var w = WORDS[id];
      return '<button type="button" class="icard' + (pr.wrongIds.indexOf(id) >= 0 ? ' again' : '') + '" data-speak="' + esc(w.word) + '" aria-label="' + esc(w.word) + ', ' + esc(w.meaning) + ', 발음 듣기">' +
        '<div class="no"><span>' + no(id) + '</span>' + (pr.wrongIds.indexOf(id) >= 0 ? '<span>다시 볼</span>' : '<i></i>') + '</div>' +
        '<span class="w' + (w.word.length > 8 ? ' long' : '') + '" lang="en">' + esc(w.word) + '</span><span class="m">' + esc(w.meaning.split(',')[0]) + '</span></button>';
    }).join('');
    var empty = !list.length
      ? '<p class="empty-note">' + (filter === 'again' ? '다시 볼 단어가 없어요. 잘하고 있어요!' : '아직 모은 카드가 없어요. 홈에서 Day 1을 시작해 보세요.') + '</p>'
      : '';
    return '<div class="topbar" style="flex-direction:column;align-items:stretch;gap:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end"><h1 class="display" style="margin:0;font-size:28px">내 단어 아카이브</h1><span class="count">' + ids.length + ' / ' + TOTAL + '</span></div>' +
      '<div class="progress thin" style="background:var(--soft)"><span style="width:' + Math.round(ids.length / TOTAL * 100) + '%"></span></div>' +
      '<div class="chips"><button type="button" class="chip" data-filter="all" aria-pressed="' + (filter === 'all') + '">전체</button>' +
      '<button type="button" class="chip" data-filter="again" aria-pressed="' + (filter === 'again') + '">다시 볼 단어 ' + pr.wrongIds.length + '</button></div></div>' +
      '<div class="content"><div class="grid3">' + cells + '</div>' + empty +
      (list.length ? '<p class="sub" style="margin:0;text-align:center;font-size:12px">카드를 누르면 발음을 들을 수 있어요</p>' : '') + '</div>' + tabbar('archive');
  };

  SCREENS.review = function (u) {
    var n = u.progress.wrongIds.length;
    return header(u) + '<div class="content" style="justify-content:center;align-items:center;text-align:center;gap:16px">' + mascot(110, n === 0) +
      '<h1 class="display" style="margin:0;font-size:26px">' + (n ? '다시 볼 단어 ' + n + '개' : '복습할 단어가 없어요') + '</h1>' +
      '<p class="sub" style="margin:0">' + (n ? '틀렸던 단어만 모아 최대 10문제로 다시 풀어요.<br>맞히면 다시 볼 단어에서 빠져요.' : 'Day 퀴즈에서 틀린 단어가 여기에 모여요.') + '</p>' +
      (n ? '<button type="button" class="btn btn-primary" data-start-review>복습 시작</button>' : '<button type="button" class="btn btn-ghost" data-go="home">홈으로</button>') +
      '</div>' + tabbar('review');
  };

  SCREENS.profile = function (u) {
    var pr = u.progress;
    return header(u) + '<div class="content">' +
      '<div class="profile-card"><b>' + esc(u.name) + '</b><span class="sub" style="font-size:14px">' + esc(u.email) + '</span>' +
      '<div class="xp-line lv" style="margin-top:10px"><span>Lv.' + levelInfo(pr.xp).lv + '</span><div class="lv-bar"><span style="width:' + levelInfo(pr.xp).pct + '%"></span></div><small>' + levelInfo(pr.xp).cur + '/' + levelInfo(pr.xp).need + ' XP</small></div></div>' +
      '<div class="stats" style="margin-top:4px"><div class="stat" style="background:var(--tint)"><b>' + collected(pr).length + '</b><span>모은 단어</span></div>' +
      '<div class="stat" style="background:var(--tint)"><b>' + pr.xp + '</b><span>총 XP</span></div>' +
      '<div class="stat warm"><b>' + streakNow(pr) + '일</b><span>연속 학습</span></div></div>' +
      '<div class="panel-head" style="margin-top:8px"><span class="display" style="font-size:20px">배지</span><strong>' + pr.badges.length + ' / ' + BADGES.length + '</strong></div>' +
      '<div class="badge-grid">' + BADGES.map(function (b) {
        var got = pr.badges.indexOf(b.id) >= 0;
        return '<div class="badge' + (got ? '' : ' locked') + '">' + badgeIcon(b, got) + '<b>' + esc(b.name) + '</b><span>' + esc(b.desc) + '</span></div>';
      }).join('') + '</div>' +
      '<label class="switch-row"><span>효과음</span><input type="checkbox" data-sound' + (soundOn ? ' checked' : '') + '></label>' +
      '<p class="sub" style="font-size:13px;margin:0">학습 기록은 계정에 저장돼서 다른 기기에서 로그인해도 이어서 할 수 있어요.</p>' +
      '<div style="margin-top:auto;display:flex;flex-direction:column;gap:10px">' +
      '<button type="button" class="btn btn-ghost" data-reset>학습 기록 초기화</button>' +
      '<button type="button" class="btn btn-ghost" data-logout>로그아웃</button></div></div>' + tabbar('profile');
  };

  // ---------- 이벤트 ----------
  app.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    var f = new FormData(form);
    var email = String(f.get('email') || '').trim().toLowerCase();
    var password = String(f.get('password') || '');
    var submit = form.querySelector('[type="submit"]');
    var busy = function () { submit.disabled = true; submit.textContent = '확인 중…'; };
    var offline = function (screen, p) { return function (err) { console.error(err); p.error = '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'; go(screen, p); }; };
    if (form.dataset.form === 'login') {
      if (!email || !password) return go('login', { email: email, error: '이메일과 비밀번호를 입력해 주세요.' });
      busy();
      sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        if (res.error) return go('login', { email: email, error: authMessage(res.error) });
        return loadUser(res.data.user).then(function () { go('home'); });
      }).catch(offline('login', { email: email }));
    } else {
      var name = String(f.get('name') || '').trim();
      var p = { name: name, email: email };
      if (name.length < 2 || name.length > 12) { p.error = '이름은 2~12자로 입력해 주세요.'; return go('signup', p); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { p.error = '이메일 형식을 확인해 주세요.'; return go('signup', p); }
      if (password.length < 8) { p.error = '비밀번호는 8자 이상이어야 해요.'; return go('signup', p); }
      busy();
      sb.auth.signUp({
        email: email,
        password: password,
        // nickname: Quiz 프로젝트의 가입 트리거가 profiles.nickname(2~12자, 중복 불가)으로 사용
        options: { data: { name: name, nickname: name, app: 'vocaive' }, emailRedirectTo: window.location.origin + window.location.pathname }
      }).then(function (res) {
        if (res.error) { p.error = authMessage(res.error); return go('signup', p); }
        // 메일 인증이 켜져 있으면 세션 없이 돌아옴
        if (!res.data.session) return go('login', { email: email, notice: email + '로 인증 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.' });
        return loadUser(res.data.user).then(function () { go('home'); });
      }).catch(offline('signup', p));
    }
  });

  app.addEventListener('change', function (e) {
    if (e.target.matches('[data-sound]')) {
      soundOn = e.target.checked;
      try { localStorage.setItem('vocaive.sound', soundOn ? 'on' : 'off'); } catch (err) {}
      if (soundOn) SFX.right();
    }
  });

  app.addEventListener('click', function (e) {
    var t = e.target.closest('button, [data-go]');
    if (!t || t.disabled) return;
    var u = me();
    var d = t.dataset;
    if (d.speak) { speak(d.speak); return; }
    if (d.go) {
      if (d.go === 'cards') return go('cards', { day: Number(d.day), i: 0 });
      return go(d.go);
    }
    if (d.card !== undefined) return go('cards', { day: route.params.day, i: Number(d.card) });
    if (d.startMatch) { startMatch(Number(d.startMatch)); return go('match'); }
    if (d.flip !== undefined) return flipCard(Number(d.flip));
    if (d.quitMatch !== undefined) {
      if (window.confirm('카드 뒤집기를 그만둘까요?')) { clearInterval(matchTimer); match = null; go('book'); }
      return;
    }
    if (d.startQuiz) {
      var day = dayOf(Number(d.startQuiz));
      var m = match && match.day === day.day && match.finished ? match : null;
      clearInterval(matchTimer); match = null;
      startQuiz('day', day.day, day.words.map(function (w) { return w.id; }).concat(day.reviewIds));
      if (m) quiz.matchResult = { xp: m.xp, time: m.time, mistakes: m.mistakes, stars: m.stars };
      return go('quiz');
    }
    if (d.startReview !== undefined) { startQuiz('review', null, u.progress.wrongIds); return go('quiz'); }
    if (d.answer && quiz && !quiz.answered) {
      var q = quiz.queue[quiz.idx];
      var ok = d.answer === q.answer;
      quiz.answered = { chosen: d.answer, ok: ok };
      if (ok) {
        if (!q.retry) quiz.firstTry++;
        if (quiz.rightIds.indexOf(q.wordId) < 0 && quiz.wrong.indexOf(q.wordId) < 0) quiz.rightIds.push(q.wordId);
      } else if (!q.retry) {
        quiz.wrong.push(q.wordId);
        quiz.queue.push(makeQuestion(WORDS[q.wordId], 'meaning', true));
      }
      if (!ok && q.retry && quiz.wrong.indexOf(q.wordId) < 0) quiz.wrong.push(q.wordId);
      // 콤보: 첫 시도 문제만 계산, 3연속부터 정답마다 +5 XP
      if (!q.retry) {
        if (ok) {
          quiz.combo++;
          quiz.maxCombo = Math.max(quiz.maxCombo, quiz.combo);
          if (quiz.combo >= 3) { quiz.comboBonus += 5; quiz.answered.bonus = 5; }
        } else {
          quiz.combo = 0;
        }
      }
      if (ok) { (quiz.combo >= 3 ? SFX.combo : SFX.right)(); } else { SFX.wrong(); }
      var said = WORDS[q.wordId].word;
      setTimeout(function () { speak(said); }, soundOn ? 380 : 0);
      return render();
    }
    if (d.next !== undefined && quiz) {
      quiz.answered = null;
      quiz.idx++;
      if (quiz.idx < quiz.queue.length) return render();
      if (quiz.mode === 'day') {
        quiz.story = storyQuestion(dayOf(quiz.day));
        if (quiz.story) return go('story');
      }
      return finishQuiz(u);
    }
    if (d.story && quiz && !quiz.storyAnswered) {
      quiz.storyAnswered = { chosen: Number(d.story), ok: Number(d.story) === quiz.story.answer };
      (quiz.storyAnswered.ok ? SFX.right : SFX.wrong)();
      return render();
    }
    if (d.finish !== undefined && quiz) return finishQuiz(u);
    if (d.quit !== undefined) {
      if (window.confirm('퀴즈를 그만둘까요? 이번 Day의 진행 내용은 저장되지 않아요.')) { var back = quiz && quiz.mode === 'day' ? 'book' : 'review'; quiz = null; go(back); }
      return;
    }
    if (d.filter) return go('archive', { filter: d.filter });
    if (d.reset !== undefined) {
      if (window.confirm('모은 단어, XP, 연속 학습일이 모두 지워져요. 초기화할까요?')) { u.progress = newProgress(); putUser(u); go('home'); }
      return;
    }
    if (d.logout !== undefined) {
      if (DEMO) { window.location.href = window.location.pathname; return; }
      sb.auth.signOut().finally(function () { currentUser = null; quiz = null; go('login'); });
    }
  });

  // ---------- 시작 ----------
  if (DEMO) {
    currentUser = { id: 'demo', email: '체험 모드 (기록 저장 안 됨)', name: '체험', progress: newProgress() };
    go('home');
    return;
  }
  if (!sb) {
    app.innerHTML = '<div class="login-hero"><h1 class="display" style="font-size:28px">설정이 필요해요</h1>' +
      '<p class="sub" style="text-align:center">config.js에 Supabase URL과 publishable key를 넣어 주세요.</p></div>';
    return;
  }
  go('loading');
  // 저장된 세션이 있으면 바로 홈으로 (메일 인증 링크로 돌아온 경우도 여기서 처리됨)
  sb.auth.getSession().then(function (res) {
    var s = res.data && res.data.session;
    if (!s) return go('login');
    return loadUser(s.user).then(function () { go('home'); });
  }).catch(function (err) {
    console.error(err);
    go('login', { error: '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  });
})();
