'use strict';
const assert = require('assert');
const {
  BIO_SPEC, MODES, RIGHT_PHASES, applySpin, makeRightState, getPhase, THEORETICAL,
  NORMAL_REACHES, TYRANT_ROUTES, TYRANT_FAKE_RATE, reAlertOutcomeProbabilities,
  rollNormalReach, rollTyrantCue, rollTyrantRoute, rollReAlertForOutcome
} = require('./logic.js');

function seq(values){ let i=0; return () => values[Math.min(i++, values.length-1)]; }

let r = applySpin({mode:MODES.NORMAL}, seq([0, 0]));
assert.equal(r.outcome, 'first_premium');
assert.equal(r.state.mode, MODES.PREMIUM);
assert.equal(r.nominal, 1500);

r = applySpin({mode:MODES.NORMAL}, seq([0, 0.20]));
assert.equal(r.outcome, 'first_rush');
assert.equal(r.state.mode, MODES.HAZARD);
assert.equal(r.state.stRemaining, 53);
assert.equal(r.nominal, 300);

// 49%のRUSH非突入初当たりも存在する。
r = applySpin({mode:MODES.NORMAL}, seq([0, 0.90]));
assert.equal(r.outcome, 'first_fail');
assert.equal(r.state.mode, MODES.NORMAL);
assert.equal(r.nominal, 300);

// RE:カスタムON時はRUSH非突入当たりも必ず先バレを経由する。
assert.equal(rollReAlertForOutcome('first_fail', () => 0.999999), true);

r = applySpin(makeRightState(MODES.HAZARD), seq([0, 0.10]));
assert.equal(r.state.mode, MODES.SURVIVAL);
assert.equal(r.state.stRemaining, 53);
assert.equal(r.state.chainWindow, 4);

r = applySpin(makeRightState(MODES.SURVIVAL), seq([0]));
assert.equal(r.state.mode, MODES.XTREME);
assert.equal(r.meta.enteredXtreme, true);

// SURVIVAL ST最終変動は上位直行ではなく33/67振分け。
r = applySpin({mode:MODES.SURVIVAL, phase:RIGHT_PHASES.ST, stRemaining:1, holdRemaining:4, chainWindow:0}, seq([0, 0.50]));
assert.equal(r.state.mode, MODES.HAZARD);
assert.equal(r.meta.specialFinalZone, true);

// SURVIVAL最終変動を外すと、残保留4個はHAZARD RUSH演出へ移行。
r = applySpin({mode:MODES.SURVIVAL, phase:RIGHT_PHASES.ST, stRemaining:1, holdRemaining:4, chainWindow:0}, seq([0.9]));
assert.equal(r.outcome, 'enter_hold');
assert.equal(r.state.phase, RIGHT_PHASES.HOLD);
assert.equal(r.state.mode, MODES.HAZARD);
assert.equal(r.state.holdRemaining, 4);
assert.equal(r.meta.survivalToHazardHold, true);

// XTREMEは従来どおりXTREMEのまま残保留へ。
r = applySpin({mode:MODES.XTREME, phase:RIGHT_PHASES.ST, stRemaining:1, holdRemaining:4, chainWindow:0}, seq([0.9]));
assert.equal(r.outcome, 'enter_hold');
assert.equal(r.state.mode, MODES.XTREME);
assert.equal(r.state.phase, RIGHT_PHASES.HOLD);

// 残保留1個消化。
r = applySpin({mode:MODES.HAZARD, phase:RIGHT_PHASES.HOLD, stRemaining:0, holdRemaining:4, chainWindow:0}, seq([0.9]));
assert.equal(r.outcome, 'hold_miss');
assert.equal(r.state.holdRemaining, 3);

// 残保留当たりは33/67振分け。
r = applySpin({mode:MODES.HAZARD, phase:RIGHT_PHASES.HOLD, stRemaining:0, holdRemaining:2, chainWindow:0}, seq([0, 0.10]));
assert.equal(r.state.mode, MODES.SURVIVAL);
assert.equal(r.meta.fromHold, true);
assert.equal(r.meta.specialFinalZone, true);

// 10R後4抽選以内の当たりは保留連3000演出フラグ。
r = applySpin({mode:MODES.XTREME, phase:RIGHT_PHASES.ST, stRemaining:87, holdRemaining:4, chainWindow:4}, seq([0]));
assert.equal(r.outcome, 'right_to_xtreme');
assert.equal(r.meta.holdChain, true);

// PREMIUM次回当たりはXTREME＋3000完遂フラグ。
r = applySpin(makeRightState(MODES.PREMIUM), seq([0]));
assert.equal(r.state.mode, MODES.XTREME);
assert.equal(r.meta.premiumCompletion, true);

const phase = getPhase({mode:MODES.XTREME, phase:RIGHT_PHASES.HOLD, stRemaining:0, holdRemaining:4, chainWindow:0});
assert.equal(phase.stRemaining, 0);
assert.equal(phase.holdRemaining, 4);
assert.equal(phase.specialFinalZone, true);

// RE:カスタムON時は通常時の全当たりが必ず先バレを経由し、
// 先バレ全体は約1/99.9、期待度50%になる。
const rap = reAlertOutcomeProbabilities();
const pHit = BIO_SPEC.NORMAL_HIT_PROB;
const pPremium = pHit * BIO_SPEC.FIRST_PREMIUM_RATE;
const pOtherHit = pHit - pPremium;
const pMiss = 1 - pHit;
const pAlert = pPremium * rap.premium + pOtherHit * rap.otherHit + pMiss * rap.miss;
const pAlertHit = pPremium * rap.premium + pOtherHit * rap.otherHit;
assert.equal(rap.premium, 1);
assert.equal(rap.otherHit, 1);
assert(Math.abs(pAlert - BIO_SPEC.RE_ALERT_RATE) < 1e-12);
assert(Math.abs(pAlertHit - pHit) < 1e-12);
assert(Math.abs(pAlertHit / pAlert - 0.50) < 1e-12);

// タイラントのハズレ時出現率は期待度4ルートと1/45.8を両立する値。
assert(TYRANT_FAKE_RATE > 0.033 && TYRANT_FAKE_RATE < 0.034);

console.log('All deterministic tests passed.');
console.log('Theoretical HAZARD continuation:', (THEORETICAL.hazardContinuation*100).toFixed(3)+'%');
console.log('Theoretical XTREME continuation:', (THEORETICAL.xtremeContinuation*100).toFixed(3)+'%');
console.log('RE alert total:', '1/'+(1/pAlert).toFixed(3), 'reliability:', (pAlertHit/pAlert*100).toFixed(3)+'%', '(全当たり先バレ経由)');
console.log('Tyrant fake cue rate:', (TYRANT_FAKE_RATE*100).toFixed(4)+'%');
console.log('Normal reaches:', NORMAL_REACHES.map(x=>`${x.label}:${x.reliability*100}%`).join(' / '));
console.log('Tyrant routes:', TYRANT_ROUTES.map(x=>`${x.label}:${x.reliability*100}%`).join(' / '));
