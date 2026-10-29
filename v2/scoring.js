/*
 * Skull King — чистый модуль подсчёта очков (классика + русалки).
 * Никакого DOM/хранилища: вход — запись раунда, выход — очки + расшифровка.
 * Работает и в браузере (<script>), и в node (require) — для тестов.
 */
(function (root) {
  'use strict';

  // --- Бонусы по умолчанию (используются при создании новой партии) ---
  // id — стабильный ключ, label — что покажем, points — очки за 1 шт, enabled — вкл по умолчанию.
  var DEFAULT_BONUSES = [
    { id: 'tile14',  label: '14',                  points: 10, enabled: true },
    { id: 'jolly',   label: 'Чёрная 14 (Jolly Roger)', points: 20, enabled: true },
    { id: 'pirate',  label: 'Пират пойман Скалл Кингом', points: 30, enabled: true },
    { id: 'mermaid', label: 'Скалл Кинг пойман русалкой', points: 50, enabled: true },
    { id: 'pir_mer', label: 'Пират ловит русалку',  points: 20, enabled: false },
  ];

  /**
   * Угадал ли игрок ставку (ставка === взятки). Для нулевой ставки — тоже совпадение.
   */
  function bidMatched(bid, tricks) {
    return bid === tricks;
  }

  /**
   * Базовые очки за раунд (без бонусов) + человекочитаемая причина.
   * roundN — номер раунда (= число карт на руках).
   */
  function baseScore(bid, tricks, roundN) {
    if (bid === 0) {
      if (tricks === 0) {
        return { points: 10 * roundN, reason: 'ноль угадан → +' + (10 * roundN) };
      }
      return { points: -10 * roundN, reason: 'ноль не угадан (взял ' + tricks + ') → ' + (-10 * roundN) };
    }
    if (bid === tricks) {
      return { points: 20 * bid, reason: 'угадал ' + bid + ' → +' + (20 * bid) };
    }
    var diff = Math.abs(bid - tricks);
    return { points: -10 * diff, reason: 'промах (ставка ' + bid + ', взял ' + tricks + ') → ' + (-10 * diff) };
  }

  /**
   * Полный расчёт за раунд для одного игрока.
   * entry = { bid, tricks, bonuses: { bonusId: count } }
   * bonusDefs = [{ id, label, points, enabled }]  (обычно game.bonuses)
   * Возвращает { base, baseReason, bonusTotal, bonusBreakdown:[{label,count,points,sum}],
   *              bonusesCounted, total }
   * Бонусы засчитываются ТОЛЬКО если ставка угадана.
   */
  function roundScore(entry, roundN, bonusDefs) {
    entry = entry || {};
    var bid = entry.bid || 0;
    var tricks = entry.tricks || 0;
    var bonuses = entry.bonuses || {};
    bonusDefs = bonusDefs || DEFAULT_BONUSES;

    var base = baseScore(bid, tricks, roundN);
    var matched = bidMatched(bid, tricks);
    // Бонусы возможны ТОЛЬКО если игрок угадал ставку И реально выиграл хотя бы одну
    // взятку — без выигранной взятки нечего было захватывать (14/пират/русалка/СК).
    var bonusesEligible = matched && tricks > 0;

    var breakdown = [];
    var bonusTotal = 0;
    if (bonusesEligible) {
      bonusDefs.forEach(function (def) {
        if (!def.enabled) return;
        var count = bonuses[def.id] || 0;
        if (count <= 0) return;
        var sum = count * def.points;
        bonusTotal += sum;
        breakdown.push({ label: def.label, count: count, points: def.points, sum: sum });
      });
    }

    // Были ли вообще введены бонусы (чтобы предупредить, что они не засчитаны)
    var hasBonusInput = bonusDefs.some(function (def) {
      return (bonuses[def.id] || 0) > 0;
    });
    var ignoredReason = '';
    if (!bonusesEligible && hasBonusInput) {
      ignoredReason = !matched ? 'ставка не угадана' : 'нет выигранных взяток';
    }

    return {
      base: base.points,
      baseReason: base.reason,
      bonusTotal: bonusTotal,
      bonusBreakdown: breakdown,
      bonusesCounted: bonusesEligible,
      bonusesIgnored: !bonusesEligible && hasBonusInput,
      bonusesIgnoredReason: ignoredReason,
      total: base.points + bonusTotal,
    };
  }

  /**
   * Итоговые суммы по игрокам через все сыгранные раунды.
   * game = { players:[{id,name}], rounds:[{n, entries:{playerId: entry}}], bonuses }
   * Возвращает { playerId: totalScore }.
   */
  function totals(game) {
    var acc = {};
    (game.players || []).forEach(function (p) { acc[p.id] = 0; });
    (game.rounds || []).forEach(function (round) {
      // в общий счёт — только ЗАВЕРШЁННЫЕ раунды (незавершённый не считаем предварительно).
      // (раунды без поля phase считаем — для обратной совместимости/тестов)
      if (round.phase && round.phase !== 'done') return;
      var entries = round.entries || {};
      Object.keys(entries).forEach(function (pid) {
        var r = roundScore(entries[pid], round.n, game.bonuses);
        acc[pid] = (acc[pid] || 0) + r.total;
      });
    });
    return acc;
  }

  var api = {
    DEFAULT_BONUSES: DEFAULT_BONUSES,
    bidMatched: bidMatched,
    baseScore: baseScore,
    roundScore: roundScore,
    totals: totals,
    TOTAL_ROUNDS: 10,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Scoring = api;
  }
})(typeof self !== 'undefined' ? self : this);
