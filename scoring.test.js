/* Тесты правил подсчёта. Запуск: node scoring.test.js */
var S = require('./scoring');

var failures = 0;
function eq(got, want, msg) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.error('FAIL: ' + msg + '\n  получили: ' + g + '\n  ожидали:  ' + w); }
  else { console.log('ok: ' + msg); }
}

// --- База ---
eq(S.baseScore(3, 3, 7).points, 60, 'угадал 3 → +60');
eq(S.baseScore(3, 1, 7).points, -20, 'промах на 2 → -20');
eq(S.baseScore(3, 5, 7).points, -20, 'перебор на 2 → -20');
eq(S.baseScore(0, 0, 7).points, 70, 'ноль угадан в раунде 7 → +70');
eq(S.baseScore(0, 2, 7).points, -70, 'ноль не угадан в раунде 7 → -70');

// --- Бонусы только при угаданной ставке ---
var defs = S.DEFAULT_BONUSES;

// угадал 3, поймал русалкой СК (+50) и одну 14 (+10)
var r1 = S.roundScore({ bid: 3, tricks: 3, bonuses: { mermaid: 1, tile14: 1 } }, 7, defs);
eq(r1.base, 60, 'r1 база 60');
eq(r1.bonusTotal, 60, 'r1 бонусы 50+10=60');
eq(r1.total, 120, 'r1 итого 120');
eq(r1.bonusesCounted, true, 'r1 бонусы засчитаны');

// промахнулся — бонусы НЕ засчитываются
var r2 = S.roundScore({ bid: 2, tricks: 3, bonuses: { mermaid: 1 } }, 7, defs);
eq(r2.base, -10, 'r2 база -10');
eq(r2.bonusTotal, 0, 'r2 бонусы обнулены при промахе');
eq(r2.total, -10, 'r2 итого -10');
eq(r2.bonusesIgnored, true, 'r2 помечает что бонусы проигнорированы');

// выключенный бонус (pir_mer) не считается даже при вводе
var r3 = S.roundScore({ bid: 1, tricks: 1, bonuses: { pir_mer: 2 } }, 5, defs);
eq(r3.bonusTotal, 0, 'r3 выключенный бонус не засчитан');
eq(r3.total, 20, 'r3 итого только база 20');

// тот же бонус, но включённый — считается
var defsOn = defs.map(function (d) { return d.id === 'pir_mer' ? Object.assign({}, d, { enabled: true }) : d; });
var r4 = S.roundScore({ bid: 1, tricks: 1, bonuses: { pir_mer: 2 } }, 5, defsOn);
eq(r4.bonusTotal, 40, 'r4 включённый бонус ×2 = 40');
eq(r4.total, 60, 'r4 итого 20+40=60');

// --- Итоги по партии ---
var game = {
  players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  bonuses: defs,
  rounds: [
    { n: 1, entries: { a: { bid: 1, tricks: 1 }, b: { bid: 0, tricks: 0 } } },     // a:+20  b:+10
    { n: 2, entries: { a: { bid: 0, tricks: 1 }, b: { bid: 2, tricks: 2, bonuses: { tile14: 1 } } } }, // a:-20 b:+40+10=50
  ],
};
eq(S.totals(game), { a: 0, b: 60 }, 'итоги партии a=0 b=60');

console.log(failures === 0 ? '\nВСЕ ТЕСТЫ ПРОШЛИ' : '\n' + failures + ' ПАДЕНИЙ');
process.exit(failures === 0 ? 0 : 1);
