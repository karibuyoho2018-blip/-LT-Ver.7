'use strict';

const BIO_SPEC = Object.freeze({
  NORMAL_DENOM: 199.8,
  RUSH_DENOM: 45.8,
  NORMAL_HIT_PROB: 1 / 199.8,
  RUSH_HIT_PROB: 1 / 45.8,

  // 特図1
  FIRST_PREMIUM_RATE: 0.01,
  FIRST_RUSH_RATE: 0.50,
  FIRST_FAIL_RATE: 0.49,

  // HAZARD RUSH中 / ST最終変動+残保留での振分け
  TO_SURVIVAL_RATE: 0.33,
  TO_HAZARD_RATE: 0.67,

  // 電サポ回数。残保留は別管理する。
  HAZARD_ST: 53,
  SURVIVAL_ST: 53,
  XTREME_ST: 87,
  HOLD: 4,

  // RE:カスタム
  // LTver.向けRE:先バレ調整。全大当たりを先バレ経由にするため、
  // 期待度50%を優先すると発生率は理論上ほぼ1/99.9になる。
  RE_ALERT_RATE: 1 / 99.9,
  RE_ALERT_RELIABILITY: 0.50,

  TWO_R_BALLS: 300,
  TEN_R_BALLS: 1500,
  HOLD_CHAIN_WINDOW: 4,
});

const MODES = Object.freeze({
  NORMAL: 'normal',
  HAZARD: 'hazard',
  SURVIVAL: 'survival',
  XTREME: 'xtreme',
  PREMIUM: 'premium',
});

const RIGHT_PHASES = Object.freeze({
  ST: 'st',
  HOLD: 'hold',
  PREMIUM: 'premium',
});

// ★は演出上の目安を実期待度に変換。
// ★3 = 30%、★3.5 = 50%、★4 = 70%。
// v0.7では先バレ全体約50%に合わせ、全回転を除く先バレの期待度が約49.75%になるよう配分。
const NORMAL_REACHES = Object.freeze([
  Object.freeze({ id: 'zombie', label: 'ゾンビ群リーチ', stars: 3.0, reliability: 0.30, weight: 0.153 }),
  Object.freeze({ id: 'licker', label: 'リッカーリーチ', stars: 3.0, reliability: 0.30, weight: 0.153 }),
  Object.freeze({ id: 'alligator', label: 'アリゲーターリーチ', stars: 3.5, reliability: 0.50, weight: 0.200 }),
  Object.freeze({ id: 'g2', label: 'G STAGE 2 リーチ', stars: 3.5, reliability: 0.50, weight: 0.200 }),
  Object.freeze({ id: 'g3', label: 'G STAGE 3 リーチ', stars: 4.0, reliability: 0.70, weight: 0.294 }),
]);

// SURVIVAL CHANCE タイラント演出。
// ルートの出現比率は通常40 / EAST30 / SHOWER20 / CHIEF10。
// 重み付き平均期待度40%なので、全当たりでタイラントを出しつつ
// 右打ち1/45.8を維持するハズレ時出現率は約3.348%。
const TYRANT_ROUTES = Object.freeze([
  Object.freeze({ id: 'short', label: '通常', location: 'SHORT RANGE', reliability: 0.30, weight: 0.40 }),
  Object.freeze({ id: 'east', label: 'EAST PASSAGE', location: '東側通路', reliability: 0.40, weight: 0.30 }),
  Object.freeze({ id: 'shower', label: 'SHOWER ROOM', location: 'シャワー室', reliability: 0.50, weight: 0.20 }),
  Object.freeze({ id: 'chief', label: "CHIEF’S OFFICE", location: '署長室', reliability: 0.60, weight: 0.10 }),
]);

function weightedReliability(items) {
  return items.reduce((sum, item) => sum + item.weight * item.reliability, 0);
}

const TYRANT_CUE_RELIABILITY = weightedReliability(TYRANT_ROUTES); // 0.40
const TYRANT_FAKE_RATE = (
  (BIO_SPEC.RUSH_HIT_PROB / TYRANT_CUE_RELIABILITY) - BIO_SPEC.RUSH_HIT_PROB
) / (1 - BIO_SPEC.RUSH_HIT_PROB);

function toActualBalls(nominal) {
  return nominal - nominal / 15;
}

function stLengthFor(mode) {
  switch (mode) {
    case MODES.HAZARD: return BIO_SPEC.HAZARD_ST;
    case MODES.SURVIVAL: return BIO_SPEC.SURVIVAL_ST;
    case MODES.XTREME: return BIO_SPEC.XTREME_ST;
    default: return 0;
  }
}

function createInitialState() {
  return {
    mode: MODES.NORMAL,
    phase: null,
    stRemaining: 0,
    holdRemaining: 0,
    chainWindow: 0,
  };
}

function makeRightState(mode, options = {}) {
  if (mode === MODES.PREMIUM) {
    return {
      mode,
      phase: RIGHT_PHASES.PREMIUM,
      stRemaining: null,
      holdRemaining: 0,
      chainWindow: 0,
    };
  }
  return {
    mode,
    phase: RIGHT_PHASES.ST,
    stRemaining: stLengthFor(mode),
    holdRemaining: BIO_SPEC.HOLD,
    chainWindow: Math.max(0, Number(options.chainWindow) || 0),
  };
}

function buildResult(state, outcome, nominal = 0, meta = {}) {
  return { state, outcome, nominal, actual: toActualBalls(nominal), meta };
}

function rollFirstHitType(rng = Math.random) {
  const r = rng();
  if (r < BIO_SPEC.FIRST_PREMIUM_RATE) return 'first_premium';
  if (r < BIO_SPEC.FIRST_PREMIUM_RATE + BIO_SPEC.FIRST_RUSH_RATE) return 'first_rush';
  return 'first_fail';
}

function spinNormal(rng = Math.random) {
  if (rng() >= BIO_SPEC.NORMAL_HIT_PROB) return 'miss';
  return rollFirstHitType(rng);
}

function rollHazardDestination(rng = Math.random) {
  return rng() < BIO_SPEC.TO_SURVIVAL_RATE ? MODES.SURVIVAL : MODES.HAZARD;
}

function getPhase(state) {
  if (!state || state.mode === MODES.NORMAL) {
    return { label: '通常時', phase: null, stRemaining: 0, holdRemaining: 0, specialFinalZone: false };
  }
  if (state.mode === MODES.PREMIUM) {
    return { label: MODES.PREMIUM, phase: RIGHT_PHASES.PREMIUM, stRemaining: null, holdRemaining: 0, specialFinalZone: false };
  }
  const specialFinalZone = state.phase === RIGHT_PHASES.HOLD ||
    (state.phase === RIGHT_PHASES.ST && state.stRemaining === 1);
  return {
    label: state.mode,
    phase: state.phase,
    stRemaining: state.stRemaining,
    holdRemaining: state.holdRemaining,
    specialFinalZone,
  };
}

function decrementChainWindow(state) {
  if (!state.chainWindow) return 0;
  return Math.max(0, state.chainWindow - 1);
}

function stateAfterRightHit(destination) {
  return makeRightState(destination, { chainWindow: BIO_SPEC.HOLD_CHAIN_WINDOW });
}

function applySpin(state, rng = Math.random) {
  if (!state || state.mode === MODES.NORMAL) {
    const outcome = spinNormal(rng);
    if (outcome === 'miss') return buildResult(createInitialState(), 'miss');

    if (outcome === 'first_premium') {
      return buildResult(makeRightState(MODES.PREMIUM), outcome, BIO_SPEC.TEN_R_BALLS, {
        enteredRush: true,
        directPremium: true,
      });
    }
    if (outcome === 'first_rush') {
      return buildResult(makeRightState(MODES.HAZARD), outcome, BIO_SPEC.TWO_R_BALLS, {
        enteredRush: true,
      });
    }
    return buildResult(createInitialState(), outcome, BIO_SPEC.TWO_R_BALLS, { enteredRush: false });
  }

  const before = { ...state };
  const inPremium = before.mode === MODES.PREMIUM;
  const inResidualHold = before.phase === RIGHT_PHASES.HOLD;
  const isFinalSt = before.phase === RIGHT_PHASES.ST && before.stRemaining === 1;
  const specialFinalZone = inResidualHold || isFinalSt;
  const holdChain = !inPremium && before.phase === RIGHT_PHASES.ST && before.chainWindow > 0;
  const hit = rng() < BIO_SPEC.RUSH_HIT_PROB;

  if (!hit) {
    if (inPremium) {
      return buildResult({ ...before }, 'miss', 0, { previousMode: before.mode, phase: before.phase });
    }

    if (before.phase === RIGHT_PHASES.ST) {
      if (before.stRemaining > 1) {
        return buildResult({
          ...before,
          stRemaining: before.stRemaining - 1,
          chainWindow: decrementChainWindow(before),
        }, 'miss', 0, {
          previousMode: before.mode,
          phase: RIGHT_PHASES.ST,
        });
      }

      // SURVIVAL CHANCEを駆け抜けた後の残保留4個はHAZARD RUSHとして見せる。
      const residualMode = before.mode === MODES.SURVIVAL ? MODES.HAZARD : before.mode;
      return buildResult({
        ...before,
        mode: residualMode,
        phase: RIGHT_PHASES.HOLD,
        stRemaining: 0,
        holdRemaining: BIO_SPEC.HOLD,
        chainWindow: 0,
      }, 'enter_hold', 0, {
        previousMode: before.mode,
        phase: RIGHT_PHASES.ST,
        residualMode,
        survivalToHazardHold: before.mode === MODES.SURVIVAL,
      });
    }

    const nextHold = before.holdRemaining - 1;
    if (nextHold <= 0) {
      return buildResult(createInitialState(), 'rush_end', 0, {
        previousMode: before.mode,
        fromHold: true,
        holdIndex: BIO_SPEC.HOLD,
      });
    }
    return buildResult({ ...before, holdRemaining: nextHold }, 'hold_miss', 0, {
      previousMode: before.mode,
      fromHold: true,
      holdIndex: BIO_SPEC.HOLD - nextHold,
    });
  }

  if (inPremium) {
    return buildResult(stateAfterRightHit(MODES.XTREME), 'right_to_xtreme', BIO_SPEC.TEN_R_BALLS, {
      previousMode: before.mode,
      enteredXtreme: true,
      premiumCompletion: true,
      specialFinalZone: false,
      holdChain: false,
    });
  }

  if (before.mode === MODES.HAZARD || specialFinalZone) {
    const destination = rollHazardDestination(rng);
    return buildResult(stateAfterRightHit(destination),
      destination === MODES.SURVIVAL ? 'right_to_survival' : 'right_to_hazard',
      BIO_SPEC.TEN_R_BALLS,
      {
        previousMode: before.mode,
        specialFinalZone,
        fromHold: inResidualHold,
        holdChain,
        enteredXtreme: false,
      });
  }

  return buildResult(stateAfterRightHit(MODES.XTREME), 'right_to_xtreme', BIO_SPEC.TEN_R_BALLS, {
    previousMode: before.mode,
    specialFinalZone: false,
    fromHold: false,
    holdChain,
    enteredXtreme: before.mode !== MODES.XTREME,
  });
}

function reAlertProbabilities() {
  const pHit = BIO_SPEC.NORMAL_HIT_PROB;
  const pAlert = BIO_SPEC.RE_ALERT_RATE;
  const reliability = BIO_SPEC.RE_ALERT_RELIABILITY;
  const pAlertAndHit = pAlert * reliability;
  return {
    onHit: Math.min(1, pAlertAndHit / pHit),
    onMiss: Math.max(0, (pAlert - pAlertAndHit) / (1 - pHit)),
  };
}

// RE:カスタムON時は、通常時の全当たりが必ず先バレを経由する。
// その上で全体の先バレ発生率を約1/99.9にするため、
// ハズレ側にも一定割合で先バレを発生させる。
function reAlertOutcomeProbabilities() {
  const pHit = BIO_SPEC.NORMAL_HIT_PROB;
  const pAlert = BIO_SPEC.RE_ALERT_RATE;
  const hitAlert = 1;
  const missAlert = Math.max(0, Math.min(1, (pAlert - pHit * hitAlert) / (1 - pHit)));
  return { premium: 1, otherHit: 1, miss: missAlert };
}

function rollReAlert(isHit, rng = Math.random) {
  const probs = reAlertProbabilities();
  return rng() < (isHit ? probs.onHit : probs.onMiss);
}

function rollReAlertForOutcome(outcome, rng = Math.random) {
  const probs = reAlertOutcomeProbabilities();
  if (outcome === 'first_premium') return rng() < probs.premium;
  if (outcome === 'first_rush' || outcome === 'first_fail') return rng() < probs.otherHit;
  return rng() < probs.miss;
}

function weightedPick(items, getWeight, rng = Math.random) {
  const weights = items.map(item => Math.max(0, getWeight(item)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[0];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pickRouteByOutcome(items, isHit, overallHitRate, rng = Math.random) {
  return weightedPick(items, item => {
    if (isHit) return item.weight * item.reliability / overallHitRate;
    return item.weight * (1 - item.reliability) / (1 - overallHitRate);
  }, rng);
}

function regularAlertHitRate() {
  const probs = reAlertOutcomeProbabilities();
  const pHit = BIO_SPEC.NORMAL_HIT_PROB;
  const pPremium = pHit * BIO_SPEC.FIRST_PREMIUM_RATE;
  const pOtherHit = pHit - pPremium;
  const pRegularAlert = pOtherHit * probs.otherHit + (1 - pHit) * probs.miss;
  if (pRegularAlert <= 0) return 0.5;
  return (pOtherHit * probs.otherHit) / pRegularAlert;
}

const NORMAL_REACH_BASE_HIT_RATE = regularAlertHitRate();

function rollNormalReach(isHit, rng = Math.random) {
  return pickRouteByOutcome(NORMAL_REACHES, isHit, NORMAL_REACH_BASE_HIT_RATE, rng);
}

function rollTyrantCue(isHit, rng = Math.random) {
  return isHit || rng() < TYRANT_FAKE_RATE;
}

function rollTyrantRoute(isHit, rng = Math.random) {
  return pickRouteByOutcome(TYRANT_ROUTES, isHit, TYRANT_CUE_RELIABILITY, rng);
}

function theoreticalContinuation(stSpins, denominator = BIO_SPEC.RUSH_DENOM) {
  const p = 1 / denominator;
  return 1 - Math.pow(1 - p, stSpins + BIO_SPEC.HOLD);
}

const THEORETICAL = Object.freeze({
  hazardContinuation: theoreticalContinuation(BIO_SPEC.HAZARD_ST),
  xtremeContinuation: theoreticalContinuation(BIO_SPEC.XTREME_ST),
  survivalToXtremeBeforeFinalZone: 1 - Math.pow(1 - BIO_SPEC.RUSH_HIT_PROB, BIO_SPEC.SURVIVAL_ST - 1),
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BIO_SPEC, MODES, RIGHT_PHASES, NORMAL_REACHES, TYRANT_ROUTES,
    TYRANT_CUE_RELIABILITY, TYRANT_FAKE_RATE, NORMAL_REACH_BASE_HIT_RATE,
    toActualBalls, stLengthFor, createInitialState, makeRightState, rollFirstHitType,
    spinNormal, rollHazardDestination, getPhase, applySpin, reAlertProbabilities,
    reAlertOutcomeProbabilities, rollReAlert, rollReAlertForOutcome, rollNormalReach,
    rollTyrantCue, rollTyrantRoute, theoreticalContinuation, THEORETICAL,
  };
}
