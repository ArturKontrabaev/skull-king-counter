/* Skull King Counter — UI + состояние. Vanilla JS, хранение в localStorage. */
(function () {
  'use strict';

  var STORE = 'skullking_game_v1';
  var TOTAL_ROUNDS = Scoring.TOTAL_ROUNDS; // 10

  // ---------- состояние ----------
  var state = {
    screen: 'setup', // 'setup' | 'game' | 'history' | 'settings'
    game: null,
  };

  function uid() {
    return 'p' + Math.random().toString(36).slice(2, 8) + (Date.now() % 100000);
  }

  function cloneBonuses() {
    return Scoring.DEFAULT_BONUSES.map(function (b) { return Object.assign({}, b); });
  }

  function newGame(players) {
    return {
      players: players, // [{id,name}]
      bonuses: cloneBonuses(),
      rounds: [], // заполняется по ходу
      finished: false,
    };
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
    try { localStorage.setItem(STORE, JSON.stringify(state.game)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return null;
      var g = JSON.parse(raw);
      if (!g || !g.players) return null;
      if (!g.bonuses) g.bonuses = cloneBonuses();
      return g;
    } catch (e) { return null; }
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
  }

  // ---------- экран: настройка игроков ----------
  var setupNames = [];
  function renderSetup() {
    if (!setupNames.length) setupNames = ['', ''];
    app.appendChild(el('h2', { class: 'screen-title', text: 'Игроки' }));

    var card = el('card', {});
    card = el('div', { class: 'card' });
    setupNames.forEach(function (name, i) {
      var input = el('input', {
        type: 'text', value: name, placeholder: 'Игрок ' + (i + 1),
        oninput: function (ev) { setupNames[i] = ev.target.value; },
      });
      var rm = el('button', { class: 'rm', text: '×', title: 'Убрать', onclick: function () {
        setupNames.splice(i, 1); render();
      } });
      if (setupNames.length <= 2) rm.disabled = true, rm.style.opacity = '.3';
      card.appendChild(el('div', { class: 'player-row' }, [
        el('span', { class: 'drag', text: '≡' }), input, rm,
      ]));
    });
    app.appendChild(card);

    app.appendChild(el('button', { class: 'btn ghost sm', text: '+ Добавить игрока', onclick: function () {
      setupNames.push(''); render();
    } }));

    app.appendChild(el('div', { class: 'spacer' }));
    app.appendChild(el('button', { class: 'btn gold', text: '🏴‍☠️ Начать партию', onclick: function () {
      var names = setupNames.map(function (s) { return s.trim(); }).filter(Boolean);
      if (names.length < 2) { alert('Нужно минимум 2 игрока'); return; }
      var players = names.map(function (n) { return { id: uid(), name: n }; });
      state.game = newGame(players);
      startRound(state.game, 1);
      state.screen = 'game';
      save(); render();
    } }));

    if (load()) {
      app.appendChild(el('button', { class: 'btn ghost sm', text: 'Продолжить прошлую партию', onclick: function () {
        state.game = load(); state.screen = 'game'; render();
      } }));
    }
  }

  // ---------- экран: раунд ----------
  function renderGame() {
    var game = state.game;
    if (game.finished) return renderFinished();
    var round = currentRound(game);
    var tot = Scoring.totals(game);

    // шапка раунда
    app.appendChild(el('div', { class: 'round-head' }, [
      el('div', {}, [
        el('span', { class: 'rnum', text: 'Раунд ' + round.n }),
        el('div', { class: 'cards', text: round.n + ' ' + plural(round.n, ['карта', 'карты', 'карт']) + ' на руках' }),
      ]),
      el('span', { class: 'phase-pill', text: round.phase === 'bids' ? 'СТАВКИ' : 'ВЗЯТКИ' }),
    ]));

    var card = el('div', { class: 'card' });
    game.players.forEach(function (p) {
      card.appendChild(renderPlayerInRound(game, round, p, tot[p.id]));
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

    // кнопка перехода
    var cta = el('div', { class: 'sticky-cta' });
    if (round.phase === 'bids') {
      cta.appendChild(el('button', { class: 'btn', text: 'Раунд сыгран →', onclick: function () {
        round.phase = 'tricks'; save(); render();
      } }));
    } else {
      var last = round.n >= TOTAL_ROUNDS;
      cta.appendChild(el('button', { class: 'btn gold', text: last ? '🏆 Завершить партию' : 'Завершить раунд ' + round.n + ' →', onclick: function () {
        round.phase = 'done';
        if (last) { game.finished = true; }
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

    // нижние действия: настройка бонусов + новая игра (явными кнопками)
    app.appendChild(el('div', { class: 'spacer' }));
    app.appendChild(el('button', { class: 'btn ghost sm', text: '⚙️ Настройка бонусов', onclick: function () {
      state.screen = 'settings'; render(); window.scrollTo(0, 0);
    } }));
    app.appendChild(el('button', { class: 'btn ghost sm', text: '🔄 Новая игра', onclick: resetGame }));
  }

  function renderPlayerInRound(game, round, player, totalScore) {
    var entry = round.entries[player.id];
    var block = el('div', { class: 'pscore' });

    block.appendChild(el('div', { class: 'pname-row' }, [
      el('span', { class: 'pname', text: player.name }),
      el('span', { class: 'ptotal', text: 'всего: ' + totalScore }),
    ]));

    if (round.phase === 'bids') {
      block.appendChild(el('div', { class: 'field-label', text: 'Ставка (0…' + round.n + ')' }));
      block.appendChild(stepper(entry.bid, 0, round.n, function (v) { entry.bid = v; save(); render(); }));
    } else {
      block.appendChild(el('div', { class: 'field-label', text: 'Ставил ' + entry.bid + ' · взял (0…' + round.n + ')' }));
      block.appendChild(stepper(entry.tricks, 0, round.n, function (v) { entry.tricks = v; save(); render(); }));

      // бонусы (только включённые)
      var enabled = game.bonuses.filter(function (b) { return b.enabled; });
      if (enabled.length) {
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

      // результат + расшифровка
      var r = Scoring.roundScore(entry, round.n, game.bonuses);
      block.appendChild(resultLine(r));
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
      why += ' · <span class="warn">бонусы не засчитаны (ставка не угадана)</span>';
    }
    return el('div', { class: 'result', html:
      '<span class="sum ' + cls + '">' + (r.total > 0 ? '+' : '') + r.total + '</span> за раунд' +
      '<div class="why">' + why + '</div>' });
  }

  // ---------- stepper ----------
  function stepper(value, min, max, onchange) {
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
    app.appendChild(el('div', { class: 'spacer' }));
    app.appendChild(el('button', { class: 'btn gold', text: '🏴‍☠️ Новая партия', onclick: resetGame }));
  }

  // ---------- экран: история ----------
  function renderHistory() {
    var game = state.game;
    app.appendChild(el('h2', { class: 'screen-title', text: 'История партии' }));
    if (!game || !game.rounds.length) {
      app.appendChild(el('div', { class: 'card muted', text: 'Пока нет сыгранных раундов.' }));
    } else {
      var played = game.rounds.filter(function (r) { return r.phase === 'done'; });
      if (!played.length) app.appendChild(el('div', { class: 'card muted', text: 'Ни одного завершённого раунда.' }));
      played.slice().reverse().forEach(function (round) {
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
    if (!confirm('Начать новую партию? Текущая будет стёрта.')) return;
    try { localStorage.removeItem(STORE); } catch (e) {}
    state.game = null;
    setupNames = [];
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
  var saved = load();
  if (saved) { state.game = saved; state.screen = 'game'; }
  render();
})();
