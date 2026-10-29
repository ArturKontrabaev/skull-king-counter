/* Skull King Counter — UI + состояние. Vanilla JS, хранение в localStorage. */
(function () {
  'use strict';

  var STORE = 'skullking_game_v1';
  var TOTAL_ROUNDS = Scoring.TOTAL_ROUNDS; // 10

  // --- Supabase (онлайн-стол: все видят партию live) ---
  // Publishable-ключ публичный по дизайну (доступ рулит RLS), поэтому ок в браузере.
  var SUPA_URL = 'https://geponnogqgteczpdmdmt.supabase.co';
  var SUPA_KEY = 'sb_publishable_NWaNkQuvmfEaz1aQz-NbhA_OY8Pj1m0';
  function supaHeaders(extra) {
    var h = { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  // метка устройства (без регистрации) — для режима «ведущий / просмотр»
  var DEVICE_ID = (function () {
    try {
      var k = 'skullking_device', v = localStorage.getItem(k);
      if (!v) { v = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem(k, v); }
      return v;
    } catch (e) { return 'd' + Math.random().toString(36).slice(2, 10); }
  })();
  // редактировать может: если ведущий не назначен (старые партии) ИЛИ это наше устройство
  function canEdit() { return !state.game || !state.game.controllerId || state.game.controllerId === DEVICE_ID; }
  function takeControl() {
    if (!state.game) return;
    state.game.controllerId = DEVICE_ID;
    save(); render();
  }

  // ---------- состояние ----------
  var state = {
    screen: 'setup', // 'setup' | 'game' | 'history' | 'settings' | 'edit'
    game: null,
    editingRoundIndex: null, // индекс раунда в правке (для экрана 'edit')
  };

  function uid() {
    return 'p' + Math.random().toString(36).slice(2, 8) + (Date.now() % 100000);
  }

  function cloneBonuses() {
    return Scoring.DEFAULT_BONUSES.map(function (b) { return Object.assign({}, b); });
  }

  function newGame(players) {
    return {
      id: 'g' + uid(),       // id партии (для сверки при импорте по ссылке)
      rev: 1,                // версия (растёт при каждом сохранении)
      players: players, // [{id,name}]
      bonuses: cloneBonuses(),
      rounds: [], // заполняется по ходу
      finished: false,
      archived: false,
      dealerStart: players.length ? Math.floor(Math.random() * players.length) : 0,
      controllerId: DEVICE_ID, // кто ведёт счёт (создатель партии)
    };
  }

  // кто раздаёт в раунде n: стартовый дилер + (n-1) по кругу (следующий в списке)
  function dealerForRound(game, n) {
    if (!game.players.length) return null;
    var idx = ((game.dealerStart || 0) + (n - 1)) % game.players.length;
    return game.players[idx];
  }

  function startRound(game, n) {
    var entries = {};
    game.players.forEach(function (p) {
      entries[p.id] = { bid: 0, tricks: 0, bonuses: {} };
    });
    game.rounds.push({ n: n, phase: 'bids', entries: entries });
  }

  function currentRound(game) {
    return game.rounds[game.rounds.length - 1] || null;
  }

  // ---------- хранение ----------
  function save() {
    try {
      if (state.game) state.game.rev = (state.game.rev || 1) + 1; // монотонная версия
      localStorage.setItem(STORE, JSON.stringify(state.game));
    } catch (e) {}
    cloudPushGame(); // общий стол — отправить партию в облако (дебаунс)
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return null;
      var g = JSON.parse(raw);
      if (!g || !g.players) return null;
      if (!g.bonuses) g.bonuses = cloneBonuses();
      if (!g.id) g.id = 'g' + uid();
      if (!g.rev) g.rev = 1;
      return g;
    } catch (e) { return null; }
  }

  // ---------- общая база игроков + архив партий (одна на всю компанию, в облаке) ----------
  var LINEUP = 'skullking_lineup_v1';   // последний состав (локальная мелочь, не общая)
  var CREW_STORE = 'skullking_crew_v2'; // локальное зеркало общей базы (v2 — сброс тестового мусора)
  var crew = { players: [], history: [], removed: [] };
  try { var _cm = JSON.parse(localStorage.getItem(CREW_STORE)); if (_cm) crew = { players: _cm.players || [], history: _cm.history || [], removed: _cm.removed || [] }; } catch (e) {}
  function persistCrew() { try { localStorage.setItem(CREW_STORE, JSON.stringify(crew)); } catch (e) {} }

  function jget(key, def) { try { var v = JSON.parse(localStorage.getItem(key)); return v || def; } catch (e) { return def; } }
  function jset(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function loadRoster() { return crew.players; }
  function saveRoster(r) {
    // надгробия: id, которые были в базе, а теперь удалены — чтобы не «воскресали» при слиянии
    var keep = {}; r.forEach(function (p) { keep[p.id] = 1; });
    (crew.players || []).forEach(function (p) { if (!keep[p.id] && crew.removed.indexOf(p.id) < 0) crew.removed.push(p.id); });
    crew.players = r; persistCrew(); cloudPushCrew();
  }
  function loadHistory() { return crew.history; }
  function saveHistory(h) { crew.history = h; persistCrew(); cloudPushCrew(); }

  function archiveGame(game) {
    if (game.archived) return;
    var tot = Scoring.totals(game);
    var scores = {};
    game.players.forEach(function (p) { scores[p.id] = tot[p.id] || 0; });
    var winner = game.players.slice().sort(function (a, b) { return (scores[b.id] || 0) - (scores[a.id] || 0); })[0];
    var hist = loadHistory();
    hist.push({
      finishedAt: new Date().toISOString(),
      players: game.players.map(function (p) { return { id: p.id, name: p.name }; }),
      scores: scores,
      winnerId: winner ? winner.id : null,
    });
    saveHistory(hist);
    game.archived = true;
  }

  function playerStats(id) {
    var games = 0, wins = 0, sum = 0, best = null;
    loadHistory().forEach(function (g) {
      if (!g.scores || !(id in g.scores)) return;
      games++; var s = g.scores[id]; sum += s;
      if (best === null || s > best) best = s;
      if (g.winnerId === id) wins++;
    });
    return { games: games, wins: wins, avg: games ? Math.round(sum / games) : 0, best: best === null ? 0 : best };
  }

  // ---------- передача партии ссылкой (без сервера: состояние зашито в URL) ----------
  function gameToLink(game) {
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(game))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.origin + location.pathname + '?s=' + b64;
  }
  function linkToGame(s) {
    try {
      var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      var g = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (g && g.players) {
        if (!g.bonuses) g.bonuses = cloneBonuses();
        if (!g.id) g.id = 'g' + uid();
        if (!g.rev) g.rev = 1;
        return g;
      }
    } catch (e) {}
    return null;
  }
  function stripShareParam() {
    try { if (window.history && history.replaceState && location.search) history.replaceState(null, '', location.pathname); } catch (e) {}
  }
  function copyTableLink() {
    var url = location.origin + location.pathname;
    var msg = 'Ссылка на общий стол скопирована. Кто откроет — видит и ведёт ту же партию и базу.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { alert(msg); }, function () { window.prompt('Ссылка на стол:', url); });
    } else {
      window.prompt('Ссылка на стол:', url);
    }
  }

  // ---------- ЕДИНЫЙ ОБЩИЙ СТОЛ (Supabase) ----------
  // Один адрес = одна текущая партия (id='current') + одна база (id='crew').
  // Кто открыл ссылку — видит и редактирует одно и то же, всё синхронно.
  var CURRENT_ID = 'current';
  var CREW_ID = 'crew';
  var gamePushTimer = null, crewPushTimer = null, pollTimer = null;

  function cloudPushGameNow() {
    if (!state.game) return;
    fetch(SUPA_URL + '/rest/v1/games', {
      method: 'POST', headers: supaHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({ id: CURRENT_ID, state: state.game }),
    }).catch(function () {});
  }
  function cloudPushGame() { if (!state.game) return; if (gamePushTimer) clearTimeout(gamePushTimer); gamePushTimer = setTimeout(cloudPushGameNow, 700); }
  function cloudPushCrewNow() {
    fetch(SUPA_URL + '/rest/v1/rosters', {
      method: 'POST', headers: supaHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({ id: CREW_ID, data: crew }),
    }).catch(function () {});
  }
  function cloudPushCrew() { if (crewPushTimer) clearTimeout(crewPushTimer); crewPushTimer = setTimeout(cloudPushCrewNow, 700); }

  function cloudFetchGame(cb) {
    fetch(SUPA_URL + '/rest/v1/games?id=eq.' + CURRENT_ID + '&select=state', { headers: supaHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { cb(rows && rows[0] ? rows[0].state : null); })
      .catch(function () { cb(null); });
  }
  function cloudFetchCrew(cb) {
    fetch(SUPA_URL + '/rest/v1/rosters?id=eq.' + CREW_ID + '&select=data', { headers: supaHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { cb(rows && rows[0] ? rows[0].data : null); })
      .catch(function () { cb(null); });
  }
  // слияние общей базы: объединение игроков (со всех устройств), минус удалённые (надгробия)
  function mergeCrew(remote) {
    remote = remote || {};
    var removed = {};
    (crew.removed || []).concat(remote.removed || []).forEach(function (id) { removed[id] = 1; });
    var seen = {}, players = [];
    (crew.players || []).concat(remote.players || []).forEach(function (p) {
      if (!p || seen[p.id] || removed[p.id]) return; seen[p.id] = 1; players.push(p);
    });
    var hSeen = {}, history = [];
    (crew.history || []).concat(remote.history || []).forEach(function (g) {
      var k = (g && g.finishedAt) || JSON.stringify(g); if (hSeen[k]) return; hSeen[k] = 1; history.push(g);
    });
    return { players: players, history: history, removed: Object.keys(removed) };
  }
  function crewKey(c) {
    return JSON.stringify({
      p: (c.players || []).map(function (x) { return x.id + ':' + x.name; }),
      r: (c.removed || []).slice().sort(),
      h: (c.history || []).length,
    });
  }
  // применить облачную базу: слить, обновить локально если изменилось, залить если облако отстаёт
  function adoptCrew(remote) {
    var merged = mergeCrew(remote || {});
    var changedLocal = crewKey(merged) !== crewKey(crew);
    var changedRemote = !remote || crewKey(merged) !== crewKey(remote);
    if (changedLocal) { crew = merged; persistCrew(); }
    if (changedRemote) cloudPushCrew();
    return changedLocal;
  }

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPolling() { stopPolling(); pollTimer = setInterval(pollTick, 2500); }
  function pollTick() {
    // общий стол — проверяем ВСЕГДА (даже на экране старта), чтобы подхватить
    // созданную другим устройством партию и расходиться, если стол очистили.
    cloudFetchGame(function (remote) {
      if (remote) {
        if (!state.game || remote.id !== state.game.id || (remote.rev || 0) > (state.game.rev || 0)) {
          state.game = remote;
          try { localStorage.setItem(STORE, JSON.stringify(remote)); } catch (e) {}
          if (state.screen === 'setup') state.screen = 'game';
          if (state.screen === 'game' || state.screen === 'history') render();
        }
      } else if (state.game && (state.screen === 'game' || state.screen === 'history')) {
        // стол очищен (кто-то начал новую игру) — на экран старта
        state.game = null;
        try { localStorage.removeItem(STORE); } catch (e) {}
        state.screen = 'setup'; render();
      }
    });
    // Общую базу НЕ трогаем, пока игрок активно её редактирует (экран старта/база) —
    // иначе опрос перерисовывает экран и мешает добавлять. Чужие правки подтянутся при входе.
    if (state.screen !== 'setup' && state.screen !== 'players') {
      cloudFetchCrew(function (data) { adoptCrew(data); });
    }
  }

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  var app = document.getElementById('app');
  function render() {
    app.innerHTML = '';
    if (state.screen === 'setup') renderSetup();
    else if (state.screen === 'game') renderGame();
    else if (state.screen === 'history') renderHistory();
    else if (state.screen === 'settings') renderSettings();
    else if (state.screen === 'edit') renderEditRound();
    else if (state.screen === 'players') renderPlayers();
  }

  // ---------- экран: старт партии (выбор состава из базы) ----------
  var setupSelected = null; // id в порядке выбора; null = ещё не инициализирован
  var setupNewName = '';
  var dragFrom = null;       // индекс перетаскиваемого игрока (десктоп drag&drop)
  var focusNewPlayer = false; // вернуть фокус в поле ввода после добавления (для Enter-подряд)
  function renderSetup() {
    var roster = loadRoster();
    var byId = {}; roster.forEach(function (p) { byId[p.id] = true; });
    if (setupSelected === null) {
      setupSelected = jget(LINEUP, []).filter(function (id) { return byId[id]; });
    } else {
      setupSelected = setupSelected.filter(function (id) { return byId[id]; });
    }
    var nameById = {}; roster.forEach(function (p) { nameById[p.id] = p.name; });

    app.appendChild(el('h2', { class: 'screen-title', text: 'Кто играет' }));

    if (!roster.length) {
      app.appendChild(el('div', { class: 'card muted', text: 'База игроков пуста — добавь первого ниже.' }));
    } else {
      var card = el('div', { class: 'card' });
      roster.forEach(function (p) {
        var pos = setupSelected.indexOf(p.id);
        var sel = pos >= 0;
        card.appendChild(el('div', { class: 'pick-row' + (sel ? ' on' : ''), onclick: function () {
          var i = setupSelected.indexOf(p.id);
          if (i >= 0) setupSelected.splice(i, 1); else setupSelected.push(p.id);
          render();
        } }, [
          el('span', { class: 'pick-box', text: sel ? String(pos + 1) : '' }),
          el('span', { class: 'pick-name', text: p.name }),
        ]));
      });
      app.appendChild(card);
      app.appendChild(el('div', { class: 'muted', text: 'Тапай игроков — номер = очередь хода. Порядок меняй стрелками ниже.' }));
    }

    // порядок хода выбранных: перетаскивание (мышь) + стрелки — дилер идёт по этому списку
    if (setupSelected.length) {
      var ord = el('div', { class: 'card' });
      ord.appendChild(el('div', { class: 'field-label', text: 'Порядок хода (тащи мышью или стрелками · дилер по списку)' }));
      setupSelected.forEach(function (id, i) {
        var up = el('button', { class: 'ord-btn', text: '↑', onclick: function () {
          var t = setupSelected[i - 1]; setupSelected[i - 1] = setupSelected[i]; setupSelected[i] = t; render();
        } });
        var dn = el('button', { class: 'ord-btn', text: '↓', onclick: function () {
          var t = setupSelected[i + 1]; setupSelected[i + 1] = setupSelected[i]; setupSelected[i] = t; render();
        } });
        if (i === 0) up.disabled = true;
        if (i === setupSelected.length - 1) dn.disabled = true;
        var row = el('div', { class: 'ord-row', draggable: 'true',
          ondragstart: function (e) { dragFrom = i; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (_) {} },
          ondragover: function (e) { e.preventDefault(); },
          ondrop: function (e) {
            e.preventDefault();
            if (dragFrom != null && dragFrom !== i) {
              var it = setupSelected.splice(dragFrom, 1)[0];
              setupSelected.splice(i, 0, it);
            }
            dragFrom = null; render();
          },
          ondragend: function () { dragFrom = null; },
        }, [
          el('span', { class: 'drag', text: '≡' }),
          el('span', { class: 'pick-box', text: String(i + 1) }),
          el('span', { class: 'pick-name', text: nameById[id] }),
          up, dn,
        ]);
        ord.appendChild(row);
      });
      app.appendChild(ord);
    }

    var addSetupPlayer = function () {
      var name = (setupNewName || '').trim(); if (!name) return;
      var r = loadRoster(); var pl = { id: uid(), name: name };
      r.push(pl); saveRoster(r); setupSelected.push(pl.id); setupNewName = '';
      focusNewPlayer = true; render();
    };
    var newInput = el('input', { type: 'text', value: setupNewName, placeholder: 'Имя нового игрока',
      oninput: function (e) { setupNewName = e.target.value; },
      onkeydown: function (e) { if (e.key === 'Enter' || e.keyCode === 13) { setupNewName = e.target.value; addSetupPlayer(); } } });
    app.appendChild(el('div', { class: 'player-row' }, [ newInput,
      el('button', { class: 'rm', text: '+', title: 'Добавить в базу', onclick: addSetupPlayer }),
    ]));
    if (focusNewPlayer) { focusNewPlayer = false; setTimeout(function () { try { newInput.focus(); } catch (e) {} }, 0); }

    app.appendChild(el('div', { class: 'spacer' }));
    app.appendChild(el('button', { class: 'btn gold', text: '🏴‍☠️ Начать партию', onclick: function () {
      if (setupSelected.length < 2) { alert('Выбери минимум 2 игрока'); return; }
      var players = setupSelected.map(function (id) { return { id: id, name: nameById[id] }; });
      jset(LINEUP, setupSelected.slice());
      state.game = newGame(players);
      startRound(state.game, 1);
      stripShareParam(); // новая партия — вычистить старую ссылку из адреса
      state.screen = 'game';
      save(); render(); window.scrollTo(0, 0);
    } }));

    if (setupSelected.length) {
      app.appendChild(el('button', { class: 'btn ghost sm', text: 'Сбросить состав', onclick: function () {
        setupSelected = []; render();
      } }));
    }
    app.appendChild(el('button', { class: 'btn ghost sm', text: '👥 База игроков и статистика', onclick: function () {
      state.screen = 'players'; render(); window.scrollTo(0, 0);
    } }));

    if (load()) {
      app.appendChild(el('button', { class: 'btn ghost sm', text: 'Продолжить прошлую партию', onclick: function () {
        state.game = load(); state.screen = 'game'; render();
      } }));
    }
  }

  // ---------- экран: база игроков + статистика ----------
  var playersNewName = '';
  function renderPlayers() {
    app.appendChild(el('h2', { class: 'screen-title', text: 'База игроков' }));
    var roster = loadRoster();
    if (!roster.length) {
      app.appendChild(el('div', { class: 'card muted', text: 'Пока никого. Добавь игроков ниже.' }));
    } else {
      var card = el('div', { class: 'card' });
      roster.forEach(function (p, i) {
        var st = playerStats(p.id);
        card.appendChild(el('div', { class: 'pscore' }, [
          el('div', { class: 'bonus-edit' }, [
            el('input', { class: 'bl', type: 'text', value: p.name, oninput: function (e) {
              var r = loadRoster(); if (r[i]) { r[i].name = e.target.value; saveRoster(r); }
            } }),
            el('button', { class: 'rm', text: '×', onclick: function () {
              if (!confirm('Удалить ' + p.name + ' из базы? Статы прошлых партий останутся.')) return;
              var r = loadRoster(); r.splice(i, 1); saveRoster(r); render();
            } }),
          ]),
          el('div', { class: 'why', html: 'партий: <b>' + st.games + '</b> · побед: <b>' + st.wins +
            '</b> · ср. счёт: <b>' + st.avg + '</b> · рекорд: <b>' + st.best + '</b>' }),
        ]));
      });
      app.appendChild(card);
    }

    var addRosterPlayer = function () {
      var name = (playersNewName || '').trim(); if (!name) return;
      var r = loadRoster(); r.push({ id: uid(), name: name }); saveRoster(r); playersNewName = '';
      focusNewPlayer = true; render();
    };
    var newInput = el('input', { type: 'text', value: playersNewName, placeholder: 'Имя нового игрока',
      oninput: function (e) { playersNewName = e.target.value; },
      onkeydown: function (e) { if (e.key === 'Enter' || e.keyCode === 13) { playersNewName = e.target.value; addRosterPlayer(); } } });
    app.appendChild(el('div', { class: 'player-row' }, [ newInput,
      el('button', { class: 'rm', text: '+', onclick: addRosterPlayer }),
    ]));
    if (focusNewPlayer) { focusNewPlayer = false; setTimeout(function () { try { newInput.focus(); } catch (e) {} }, 0); }

    app.appendChild(el('div', { class: 'spacer' }));
    if (loadHistory().length) {
      app.appendChild(el('button', { class: 'btn danger sm', text: '🗑️ Очистить статистику (архив партий)', onclick: function () {
        if (!confirm('Стереть архив прошлых партий и статы? Сами игроки останутся.')) return;
        saveHistory([]); render();
      } }));
    }
    app.appendChild(el('button', { class: 'btn', text: '← Назад', onclick: function () {
      state.screen = 'setup'; render(); window.scrollTo(0, 0);
    } }));
  }

  // ---------- экран: раунд ----------
  function renderGame() {
    var game = state.game;
    if (game.finished) return renderFinished();
    var round = currentRound(game);
    var tot = Scoring.totals(game);
    var ro = !canEdit(); // режим просмотра (не ведущий)

    // шапка раунда
    var dealer = dealerForRound(game, round.n);
    app.appendChild(el('div', { class: 'round-head' }, [
      el('div', {}, [
        el('span', { class: 'rnum', text: 'Раунд ' + round.n }),
        el('div', { class: 'cards', text: round.n + ' ' + plural(round.n, ['карта', 'карты', 'карт']) + ' на руках' }),
        dealer ? (ro
          ? el('div', { class: 'dealer', text: '🎲 раздаёт: ' + dealer.name })
          : el('div', { class: 'dealer tappable', text: '🎲 раздаёт: ' + dealer.name + ' · сменить ▸',
              onclick: function () { game.dealerStart = ((game.dealerStart || 0) + 1) % game.players.length; save(); render(); } })) : null,
        el('div', { class: 'online', text: ro ? '🌐 общий стол · 👀 просмотр' : '🌐 общий стол · ✍️ вы ведёте счёт' }),
      ]),
      el('span', { class: 'phase-pill', text: round.phase === 'bids' ? 'СТАВКИ' : 'ВЗЯТКИ' }),
    ]));

    var card = el('div', { class: 'card' });
    game.players.forEach(function (p) {
      card.appendChild(renderPlayerInRound(game, round, p, tot[p.id], round.phase, ro));
    });
    app.appendChild(card);

    // валидация суммы взяток в фазе взяток
    if (round.phase === 'tricks') {
      var sumT = game.players.reduce(function (s, p) { return s + (round.entries[p.id].tricks || 0); }, 0);
      if (sumT !== round.n) {
        app.appendChild(el('div', { class: 'card', html:
          '<span class="why warn">⚠️ Сумма взяток = ' + sumT + ', а разыграно должно быть ' + round.n +
          '. Проверь ввод (кракен/эскейпы могут давать расхождение — тогда ок).</span>' }));
      }
    }

    // кнопка перехода / режим просмотра
    var cta = el('div', { class: 'sticky-cta' });
    if (ro) {
      cta.appendChild(el('div', { class: 'card', html: '<span class="muted">👀 Режим просмотра — счёт ведёт другой игрок. Обновляется автоматически.</span>' }));
      cta.appendChild(el('button', { class: 'btn', text: '✋ Взять ведение', onclick: takeControl }));
    } else if (round.phase === 'bids') {
      cta.appendChild(el('button', { class: 'btn', text: 'Раунд сыгран →', onclick: function () {
        round.phase = 'tricks'; save(); render();
      } }));
    } else {
      var last = round.n >= TOTAL_ROUNDS;
      cta.appendChild(el('button', { class: 'btn gold', text: last ? '🏆 Завершить партию' : 'Завершить раунд ' + round.n + ' →', onclick: function () {
        round.phase = 'done';
        if (last) { game.finished = true; archiveGame(game); }
        else { startRound(game, round.n + 1); }
        save(); render(); window.scrollTo(0, 0);
      } }));
      cta.appendChild(el('button', { class: 'btn ghost sm', text: '← Вернуться к ставкам', onclick: function () {
        round.phase = 'bids'; save(); render();
      } }));
    }
    app.appendChild(cta);

    // лидерборд
    app.appendChild(el('h2', { class: 'screen-title', text: 'Общий счёт' }));
    app.appendChild(renderLeaderboard(game, tot));

    // нижние действия
    app.appendChild(el('div', { class: 'spacer' }));
    app.appendChild(el('button', { class: 'btn ghost sm', text: '📨 Пригласить (скопировать адрес)', onclick: copyTableLink }));
    if (!ro) {
      app.appendChild(el('button', { class: 'btn ghost sm', text: '⚙️ Настройка бонусов', onclick: function () {
        state.screen = 'settings'; render(); window.scrollTo(0, 0);
      } }));
      app.appendChild(el('button', { class: 'btn ghost sm', text: '🔄 Новая игра', onclick: resetGame }));
    }
  }

  function renderPlayerInRound(game, round, player, totalScore, mode, readonly) {
    var entry = round.entries[player.id];
    var block = el('div', { class: 'pscore' });

    block.appendChild(el('div', { class: 'pname-row' }, [
      el('span', { class: 'pname', text: player.name }),
      el('span', { class: 'ptotal', text: 'всего: ' + totalScore }),
    ]));

    var showBid = mode === 'bids' || mode === 'edit';
    var showTricks = mode === 'tricks' || mode === 'edit';

    if (showBid) {
      block.appendChild(el('div', { class: 'field-label', text: 'Ставка (0…' + round.n + ')' }));
      block.appendChild(stepper(entry.bid, 0, round.n, function (v) { entry.bid = v; save(); render(); }, readonly));
    }

    if (showTricks) {
      var tlabel = mode === 'edit'
        ? 'Взял взяток (0…' + round.n + ')'
        : 'Ставил ' + entry.bid + ' · взял (0…' + round.n + ')';
      block.appendChild(el('div', { class: 'field-label', text: tlabel }));
      block.appendChild(stepper(entry.tricks, 0, round.n, function (v) { entry.tricks = v; save(); render(); }, readonly));

      // бонусы — только если угадал ставку (bid==tricks) И взял ≥1 взятку
      // (в режиме просмотра чипы не показываем — бонусы видны в расшифровке ниже)
      var enabled = game.bonuses.filter(function (b) { return b.enabled; });
      if (!readonly && enabled.length && entry.tricks > 0 && entry.bid === entry.tricks) {
        var wrap = el('div', { class: 'bonuses' });
        enabled.forEach(function (b) {
          var cnt = entry.bonuses[b.id] || 0;
          var chip = el('div', { class: 'chip' + (cnt > 0 ? ' active' : ''), onclick: function (ev) {
            if (ev.target.classList.contains('dec')) return;
            entry.bonuses[b.id] = cnt + 1; save(); render();
          } }, [
            el('span', { class: 'dec', text: '−', onclick: function () {
              entry.bonuses[b.id] = Math.max(0, cnt - 1); save(); render();
            } }),
            el('span', { class: 'cnt', text: String(cnt) }),
            el('span', { text: b.label }),
            el('span', { class: 'pts', text: '+' + b.points }),
          ]);
          wrap.appendChild(chip);
        });
        block.appendChild(wrap);
      }

      block.appendChild(resultLine(Scoring.roundScore(entry, round.n, game.bonuses)));
    }
    return block;
  }

  function resultLine(r) {
    var cls = r.total > 0 ? 'pos' : (r.total < 0 ? 'neg' : '');
    var why = r.baseReason;
    r.bonusBreakdown.forEach(function (b) {
      why += ' · <span class="b">' + esc(b.label) + (b.count > 1 ? ' ×' + b.count : '') + ' → +' + b.sum + '</span>';
    });
    if (r.bonusesIgnored) {
      why += ' · <span class="warn">бонусы не засчитаны (' + (r.bonusesIgnoredReason || 'ставка не угадана') + ')</span>';
    }
    return el('div', { class: 'result', html:
      '<span class="sum ' + cls + '">' + (r.total > 0 ? '+' : '') + r.total + '</span> за раунд' +
      '<div class="why">' + why + '</div>' });
  }

  // ---------- экран: правка сыгранного раунда ----------
  function renderEditRound() {
    var game = state.game;
    var idx = state.editingRoundIndex;
    var round = game && idx != null ? game.rounds[idx] : null;
    if (!round) { state.screen = 'history'; return render(); }
    var tot = Scoring.totals(game);

    var edealer = dealerForRound(game, round.n);
    app.appendChild(el('div', { class: 'round-head' }, [
      el('div', {}, [
        el('span', { class: 'rnum', text: '✏️ Правка · Раунд ' + round.n }),
        el('div', { class: 'cards', text: round.n + ' ' + plural(round.n, ['карта', 'карты', 'карт']) + ' на руках' }),
        edealer ? el('div', { class: 'dealer tappable', text: '🎲 раздаёт: ' + edealer.name + ' · сменить ▸',
          onclick: function () { game.dealerStart = ((game.dealerStart || 0) + 1) % game.players.length; save(); render(); } }) : null,
      ]),
      el('span', { class: 'phase-pill', text: 'ПРАВКА' }),
    ]));

    var card = el('div', { class: 'card' });
    game.players.forEach(function (p) {
      card.appendChild(renderPlayerInRound(game, round, p, tot[p.id], 'edit'));
    });
    app.appendChild(card);

    var sumT = game.players.reduce(function (s, p) { return s + (round.entries[p.id].tricks || 0); }, 0);
    if (sumT !== round.n) {
      app.appendChild(el('div', { class: 'card', html:
        '<span class="why warn">⚠️ Сумма взяток = ' + sumT + ', а разыграно должно быть ' + round.n + '.</span>' }));
    }

    var cta = el('div', { class: 'sticky-cta' });
    cta.appendChild(el('button', { class: 'btn gold', text: '✅ Готово', onclick: function () {
      state.editingRoundIndex = null; state.screen = 'history'; save(); render(); window.scrollTo(0, 0);
    } }));
    app.appendChild(cta);

    app.appendChild(el('h2', { class: 'screen-title', text: 'Общий счёт (пересчитан)' }));
    app.appendChild(renderLeaderboard(game, tot));
  }

  // ---------- stepper ----------
  function stepper(value, min, max, onchange, readonly) {
    if (readonly) return el('div', { class: 'stepper' }, [ el('div', { class: 'val', text: String(value) }) ]);
    var minus = el('button', { text: '−', onclick: function () { if (value > min) onchange(value - 1); } });
    var plus = el('button', { text: '+', onclick: function () { if (value < max) onchange(value + 1); } });
    if (value <= min) minus.disabled = true;
    if (value >= max) plus.disabled = true;
    return el('div', { class: 'stepper' }, [
      minus,
      el('div', { class: 'val', text: String(value) }),
      plus,
    ]);
  }

  // ---------- лидерборд ----------
  function renderLeaderboard(game, tot) {
    var rows = game.players.map(function (p) { return { name: p.name, score: tot[p.id] || 0 }; });
    rows.sort(function (a, b) { return b.score - a.score; });
    var card = el('div', { class: 'card lb' });
    rows.forEach(function (row, i) {
      card.appendChild(el('div', { class: 'lb-row' + (i === 0 ? ' first' : '') }, [
        el('span', { class: 'lb-rank', text: i === 0 ? '👑' : String(i + 1) }),
        el('span', { class: 'lb-name', text: row.name }),
        el('span', { class: 'lb-score', text: String(row.score) }),
      ]));
    });
    return card;
  }

  // ---------- экран: завершено ----------
  function renderFinished() {
    var game = state.game;
    var tot = Scoring.totals(game);
    var rows = game.players.map(function (p) { return { name: p.name, score: tot[p.id] || 0 }; });
    rows.sort(function (a, b) { return b.score - a.score; });
    app.appendChild(el('div', { class: 'winner', text: '🏆 Победил: ' + rows[0].name + ' (' + rows[0].score + ')' }));
    app.appendChild(renderLeaderboard(game, tot));
    app.appendChild(el('button', { class: 'btn ghost sm', text: '🗺️ Разбор по раундам', onclick: function () { state.screen = 'history'; render(); window.scrollTo(0, 0); } }));
    app.appendChild(el('button', { class: 'btn ghost sm', text: '📨 Пригласить (скопировать адрес)', onclick: copyTableLink }));
    app.appendChild(el('div', { class: 'spacer' }));
    if (canEdit()) {
      app.appendChild(el('button', { class: 'btn gold', text: '🏴‍☠️ Новая партия', onclick: resetGame }));
    } else {
      app.appendChild(el('button', { class: 'btn', text: '✋ Взять ведение', onclick: takeControl }));
    }
  }

  // ---------- экран: история ----------
  function renderHistory() {
    var game = state.game;
    app.appendChild(el('h2', { class: 'screen-title', text: 'История партии' }));
    if (!game || !game.rounds.length) {
      app.appendChild(el('div', { class: 'card muted', text: 'Пока нет сыгранных раундов.' }));
    } else {
      var played = [];
      game.rounds.forEach(function (r, i) { if (r.phase === 'done') played.push({ round: r, idx: i }); });
      if (!played.length) app.appendChild(el('div', { class: 'card muted', text: 'Ни одного завершённого раунда.' }));
      played.slice().reverse().forEach(function (o) {
        var round = o.round, idx = o.idx;
        var det = el('details', { class: 'card hround' });
        var sumLine = el('summary', {}, [
          el('span', { text: 'Раунд ' + round.n }),
          el('span', { class: 'muted', text: round.n + ' карт' }),
        ]);
        det.appendChild(sumLine);
        game.players.forEach(function (p) {
          var r = Scoring.roundScore(round.entries[p.id], round.n, game.bonuses);
          var why = r.baseReason;
          r.bonusBreakdown.forEach(function (b) { why += '; ' + b.label + (b.count > 1 ? ' ×' + b.count : '') + ' +' + b.sum; });
          det.appendChild(el('div', { class: 'hrow' }, [
            el('span', { class: 'hn', text: p.name }),
            el('span', { class: 'hwhy', text: why }),
            el('span', { class: 'hs', text: (r.total > 0 ? '+' : '') + r.total }),
          ]));
        });
        if (canEdit()) {
          det.appendChild(el('button', { class: 'btn ghost sm', text: '✏️ Редактировать раунд ' + round.n, onclick: function () {
            state.editingRoundIndex = idx; state.screen = 'edit'; render(); window.scrollTo(0, 0);
          } }));
        }
        app.appendChild(det);
      });
    }
    app.appendChild(el('button', { class: 'btn ghost sm', text: '← Назад', onclick: function () { state.screen = 'game'; render(); } }));
  }

  // ---------- экран: настройки ----------
  function renderSettings() {
    var game = state.game;
    app.appendChild(el('h2', { class: 'screen-title', text: 'Бонусы' }));
    app.appendChild(el('div', { class: 'muted', html: 'Включённые бонусы появляются кнопками в фазе взяток. Засчитываются только игроку, который угадал ставку.<div class="spacer"></div>' }));

    if (!game) {
      app.appendChild(el('div', { class: 'card muted', text: 'Настройки бонусов доступны внутри партии. Начни партию.' }));
      app.appendChild(el('button', { class: 'btn ghost sm', text: '← Назад', onclick: function () { state.screen = 'setup'; render(); } }));
      return;
    }

    var card = el('div', { class: 'card' });
    game.bonuses.forEach(function (b, i) {
      var row = el('div', { class: 'bonus-edit' }, [
        el('input', { class: 'bl', type: 'text', value: b.label, oninput: function (e) { b.label = e.target.value; save(); } }),
        el('input', { class: 'bp', type: 'number', value: b.points, oninput: function (e) { b.points = parseInt(e.target.value, 10) || 0; save(); } }),
        el('div', { class: 'toggle' + (b.enabled ? ' on' : ''), onclick: function (e) {
          b.enabled = !b.enabled; save();
          e.target.classList.toggle('on', b.enabled);
        } }),
        el('button', { class: 'rm', text: '×', onclick: function () { game.bonuses.splice(i, 1); save(); render(); } }),
      ]);
      card.appendChild(row);
    });
    app.appendChild(card);

    app.appendChild(el('button', { class: 'btn ghost sm', text: '+ Добавить бонус', onclick: function () {
      game.bonuses.push({ id: 'b' + uid(), label: 'Новый бонус', points: 10, enabled: true }); save(); render();
    } }));

    app.appendChild(el('div', { class: 'spacer' }));
    app.appendChild(el('button', { class: 'btn ghost sm', text: 'Сбросить бонусы к стандартным', onclick: function () {
      game.bonuses = cloneBonuses(); save(); render();
    } }));

    app.appendChild(el('div', { class: 'spacer' }));
    app.appendChild(el('button', { class: 'btn danger sm', text: '🔄 Новая игра (стереть текущую)', onclick: resetGame }));

    app.appendChild(el('div', { class: 'spacer' }));
    app.appendChild(el('button', { class: 'btn', text: '← Назад', onclick: function () { state.screen = 'game'; render(); } }));
  }

  function resetGame() {
    if (!confirm('Начать новую партию? Текущий стол будет стёрт у всех.')) return;
    try { localStorage.removeItem(STORE); } catch (e) {}
    state.game = null;
    // очистить общий стол, чтобы у всех устройств тоже сбросилось на экран старта
    fetch(SUPA_URL + '/rest/v1/games?id=eq.' + CURRENT_ID, { method: 'DELETE', headers: supaHeaders() }).catch(function () {});
    setupSelected = []; setupNewName = '';
    stripShareParam();
    state.screen = 'setup';
    render();
  }

  // ---------- утилита склонения ----------
  function plural(n, forms) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
  }

  // ---------- навигация ----------
  document.getElementById('nav-history').addEventListener('click', function () {
    state.screen = state.screen === 'history' ? (state.game ? 'game' : 'setup') : 'history';
    render(); window.scrollTo(0, 0);
  });
  document.getElementById('nav-settings').addEventListener('click', function () {
    state.screen = state.screen === 'settings' ? (state.game ? 'game' : 'setup') : 'settings';
    render(); window.scrollTo(0, 0);
  });

  // ---------- старт ----------
  // Единый общий стол: сразу показываем локальное зеркало, затем подтягиваем из облака.
  var local = load();
  if (local) { state.game = local; state.screen = 'game'; }
  render();

  cloudFetchGame(function (remote) {
    if (!remote) return;
    if (!state.game || remote.id !== state.game.id || (remote.rev || 0) >= (state.game.rev || 0)) {
      state.game = remote; state.screen = 'game';
      try { localStorage.setItem(STORE, JSON.stringify(remote)); } catch (e) {}
      render();
    }
  });
  cloudFetchCrew(function (data) {
    if (adoptCrew(data) && (state.screen === 'setup' || state.screen === 'players')) render();
  });
  startPolling();
})();
