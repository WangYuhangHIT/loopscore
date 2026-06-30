'use strict';
/**
 * round.js — shared rounding helper (was duplicated verbatim across evaluator /
 * roleMetrics / teamMetrics / trends). round(x, n) → x rounded to n decimals.
 */
function round(x, n = 2) { return Math.round(x * 10 ** n) / 10 ** n; }

module.exports = { round };
