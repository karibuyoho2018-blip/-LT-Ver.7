'use strict';

const MODE_LABELS = {
  normal: '通常時',
  hazard: 'HAZARD RUSH',
  survival: 'SURVIVAL CHANCE',
  xtreme: 'HAZARD RUSH XTREME',
  premium: 'HAZARD RUSH PREMIUM',
};

const game = {
  logicState: createInitialState(),
  rate: 4,
  spinsPer1k: 18,
  balls: 0,
  investment: 0,
  normalSpins: 0,
  currentNormalSpins: 0,
  firstHits: 0,
  rushEntries: 0,
  ltEntries: 0,
  rightHits: 0,
  rightDraws: 0,
  rightSpins: 0,
  holdSpins: 0,
  premiumSpins: 0,
  log: [],
  message: '1,000円分 / 10,000円分で通常時を消化',
  busy: false,
  pendingEvent: null,
};

const SOUND_ASSETS = Object.freeze({
  re: 'assets/re-alert.wav',
  tyrant: 'assets/tyrant.wav',
  jackpot: 'assets/jackpot.wav',
});

const DEFAULT_SOUND_SETTINGS = Object.freeze({
  master: 0.70,
  re: 1.00,
  tyrant: 1.00,
  jackpot: 1.00,
  muted: false,
});

const soundSettings = { ...DEFAULT_SOUND_SETTINGS };
const soundPlayers = {};
const SOUND_STORAGE_KEY = 'bio-re2-lt-sound-v07';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function yenPerBall(){ return Number(game.rate); }
function ballsPer1000(){ return 1000 / yenPerBall(); }
function ballsPerNormalSpin(){ return ballsPer1000() / Number(game.spinsPer1k); }
function balanceYen(){ return Math.round(game.balls * yenPerBall() - game.investment); }
function fmt(n){ return Math.floor(n).toLocaleString('ja-JP'); }
function pct(n){ return Number.isFinite(n) ? `${(n*100).toFixed(1)}%` : '0%'; }

function spendForNormalSpin(){
  const cost = ballsPerNormalSpin();
  if (game.balls >= cost) {
    game.balls -= cost;
    return;
  }
  const shortage = cost - game.balls;
  const unitBalls = ballsPer1000();
  const units = Math.ceil(shortage / unitBalls);
  game.investment += units * 1000;
  game.balls += units * unitBalls;
  game.balls -= cost;
}

function addBalls(actual){ game.balls += actual; }

function addLog(tag, text, balls = 0, type = ''){
  game.log.unshift({ tag, text, balls, type });
  if (game.log.length > 120) game.log.pop();
}

function setBusy(flag){
  game.busy = flag;
  render(false);
}

function clearRouteCard(){
  const card = document.getElementById('stage-route');
  if (!card) return;
  card.hidden = true;
  card.className = 'stage-route';
  document.getElementById('route-title').textContent = '';
  document.getElementById('route-meta').textContent = '';
  document.getElementById('route-expect').textContent = '';
}

function setRouteCard(kind, item, options = {}){
  const card = document.getElementById('stage-route');
  if (!card || !item) return;
  card.hidden = false;
  card.className = `stage-route route-card-${kind} route-${item.id}`;
  document.getElementById('route-title').textContent = options.title || item.label;
  const stars = options.stars != null ? `★${Number(options.stars).toFixed(options.stars % 1 ? 1 : 0)}` : '';
  const location = options.location || item.location || '';
  document.getElementById('route-meta').textContent = [location, stars].filter(Boolean).join(' / ');
  document.getElementById('route-expect').textContent = options.expectText || `期待度 ${Math.round(item.reliability * 100)}%`;
}

function setStage(type, main, sub = '', kicker = 'BIOHAZARD RE:2', progress = null, extraClass = ''){
  const stage = document.getElementById('machine-stage');
  stage.className = `machine-stage stage-${type}${extraClass ? ` ${extraClass}` : ''}`;
  document.getElementById('stage-kicker').textContent = kicker;
  document.getElementById('stage-main').textContent = main;
  document.getElementById('stage-sub').textContent = sub;
  if (progress !== null) document.getElementById('stage-bar-fill').style.width = `${Math.max(0, Math.min(100, progress))}%`;
  else document.getElementById('stage-bar-fill').style.width = '0%';
  clearRouteCard();
}

function showNormalPendingStage(data){
  if (data.alert) {
    const turn = `${data.interval}回転目`;
    if (data.result.outcome === 'first_premium') {
      setStage('reach', '全回転リーチ', `${turn} / LT直行のプレミア変動`, 'RE: CUSTOM', null, 'reach-fullrotation');
      setRouteCard('normal', { id:'fullrotation', label:'全回転リーチ', reliability:1 }, {
        title:'全回転リーチ', location:'PREMIUM', expectText:'大当たり濃厚 / 1% LT直行'
      });
    } else {
      const r = data.reach;
      setStage('reach', r.label, `${turn} / 当落結果を押してください`, 'RE: CUSTOM', null, `reach-${r.id}`);
      setRouteCard('normal', r, { stars:r.stars });
    }
  } else {
    setStage('hot', 'EMERGENCY', `${data.interval}回転目 / 先バレなし激熱変動`, 'SUDDEN CHANCE');
    setRouteCard('normal', { id:'sudden', label:'突発・激熱変動', reliability:1 }, {
      title:'突発・激熱変動', location:'NO RE: ALERT', expectText:'大当たり変動'
    });
  }
}

function showTyrantPendingStage(data){
  const r = data.tyrantRoute;
  const finalText = data.before.stRemaining === 1 ? ' / ST最終変動' : '';
  setStage('tyrant', 'TYRANT', `${r.label}へ発展${finalText}`, 'SURVIVAL CHANCE', null, `tyrant-${r.id}`);
  setRouteCard('tyrant', r, { title:r.label, location:r.location });
}

function stageForCurrentState(){
  if (game.pendingEvent) {
    if (game.pendingEvent.kind === 'normal') {
      if (game.pendingEvent.phase === 'alert') {
        const d = game.pendingEvent.data;
        setStage('alert', 'RE:', `${d.interval}回転目`, 'WARNING');
      } else {
        showNormalPendingStage(game.pendingEvent.data);
      }
    } else if (game.pendingEvent.kind === 'tyrant') {
      showTyrantPendingStage(game.pendingEvent.data);
    }
    return;
  }

  const s = game.logicState;
  if (s.mode === MODES.NORMAL) {
    setStage('idle', 'STANDBY', '1,000円分 / 10,000円分で開始');
    return;
  }
  if (s.mode === MODES.PREMIUM) {
    setStage('premium', 'PREMIUM', '次回大当たりでXTREME', 'HAZARD RUSH');
    return;
  }
  if (s.phase === RIGHT_PHASES.HOLD) {
    const main = s.mode === MODES.HAZARD ? 'HAZARD LAST 4' : 'LAST HOLD';
    setStage('hold', main, `残保留 ${s.holdRemaining}個`, MODE_LABELS[s.mode]);
    return;
  }
  const max = stLengthFor(s.mode);
  const done = max - s.stRemaining;
  const progress = max ? done / max * 100 : 0;
  const type = s.mode === MODES.SURVIVAL ? 'survival' : s.mode === MODES.XTREME ? 'xtreme' : 'hazard';
  setStage(type, MODE_LABELS[s.mode], `ST 残り${s.stRemaining}回`, 'RUSH ACTIVE', progress);
}

async function showModeEntry(mode, sub = '突入！', customMain = null, customKicker = null){
  const overlay = document.getElementById('mode-entry');
  const cls = mode === MODES.HAZARD ? 'hazard' : mode === MODES.SURVIVAL ? 'survival' : mode === MODES.XTREME ? 'xtreme' : mode === MODES.PREMIUM ? 'premium' : 'normal';
  overlay.className = `mode-entry ${cls}`;
  document.getElementById('entry-kicker').textContent = customKicker || (mode === MODES.NORMAL ? 'RESULT' : 'MODE CHANGE');
  document.getElementById('entry-main').textContent = customMain || MODE_LABELS[mode];
  document.getElementById('entry-sub').textContent = sub;
  overlay.setAttribute('aria-hidden', 'false');
  void overlay.offsetWidth;
  overlay.classList.add('show');
  await wait(820);
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  await wait(100);
}

function clamp01(value){ return Math.max(0, Math.min(1, Number(value) || 0)); }

function loadSoundSettings(){
  try {
    const saved = JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;
    ['master','re','tyrant','jackpot'].forEach(key => {
      if (Number.isFinite(Number(saved[key]))) soundSettings[key] = clamp01(saved[key]);
    });
    soundSettings.muted = !!saved.muted;
  } catch (_) {}
}

function saveSoundSettings(){
  try { localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(soundSettings)); } catch (_) {}
}

function effectiveVolume(key){
  if (soundSettings.muted) return 0;
  return clamp01(soundSettings.master) * clamp01(soundSettings[key]);
}

function initSoundPlayers(){
  Object.entries(SOUND_ASSETS).forEach(([key, src]) => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = effectiveVolume(key);
    soundPlayers[key] = audio;
  });
}

function updateLiveSoundVolumes(){
  Object.keys(soundPlayers).forEach(key => { soundPlayers[key].volume = effectiveVolume(key); });
}

function stopSound(key){
  const audio = soundPlayers[key];
  if (!audio) return;
  try { audio.pause(); audio.currentTime = 0; } catch (_) {}
}

function stopAllSounds(except = null){
  Object.keys(soundPlayers).forEach(key => { if (key !== except) stopSound(key); });
}

function playSound(key, { stopOthers = false } = {}){
  const audio = soundPlayers[key];
  if (!audio || effectiveVolume(key) <= 0) return;
  try {
    if (stopOthers) stopAllSounds(key);
    audio.pause();
    audio.currentTime = 0;
    audio.volume = effectiveVolume(key);
    audio.play().catch(() => {});
  } catch (_) {}
}

// 音が実際に鳴り始めた瞬間と画面演出の開始を合わせる。
// ミュート中や再生できない環境では即座に画面だけ開始する。
async function playSoundSynced(key, onStart, { stopOthers = false } = {}){
  const audio = soundPlayers[key];
  if (!audio || effectiveVolume(key) <= 0) {
    onStart();
    return;
  }
  if (stopOthers) stopAllSounds(key);
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = effectiveVolume(key);
    await new Promise(resolve => {
      let started = false;
      const startVisual = () => {
        if (started) return;
        started = true;
        audio.removeEventListener('playing', startVisual);
        onStart();
        resolve();
      };
      audio.addEventListener('playing', startVisual, { once:true });
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(startVisual);
      setTimeout(startVisual, 700);
    });
  } catch (_) {
    onStart();
  }
}

function syncSoundControls(){
  const map = { master:'volume-master', re:'volume-re', tyrant:'volume-tyrant', jackpot:'volume-jackpot' };
  Object.entries(map).forEach(([key, id]) => {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    if (input) input.value = String(Math.round(soundSettings[key] * 100));
    if (output) output.value = `${Math.round(soundSettings[key] * 100)}%`;
  });
  const mute = document.getElementById('audio-mute');
  if (mute) mute.textContent = soundSettings.muted ? 'ミュート解除' : 'ミュート';
}

function bindSoundControls(){
  const map = { master:'volume-master', re:'volume-re', tyrant:'volume-tyrant', jackpot:'volume-jackpot' };
  Object.entries(map).forEach(([key, id]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', e => {
      soundSettings[key] = clamp01(Number(e.target.value) / 100);
      const output = document.getElementById(`${id}-value`);
      if (output) output.value = `${Math.round(soundSettings[key] * 100)}%`;
      updateLiveSoundVolumes();
      saveSoundSettings();
    });
  });

  document.getElementById('audio-mute').addEventListener('click', () => {
    soundSettings.muted = !soundSettings.muted;
    updateLiveSoundVolumes();
    saveSoundSettings();
    syncSoundControls();
  });

  document.querySelectorAll('.audio-preview').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.sound;
      playSound(key, { stopOthers:true });
      const labels = { re:'先バレ音', tyrant:'タイラント出現音', jackpot:'大当たり音' };
      game.message = `${labels[key] || 'サウンド'}を試聴中`;
      render(false);
    });
  });
}

function takeNormalSpin(){
  if (game.logicState.mode !== MODES.NORMAL) return null;
  spendForNormalSpin();
  game.normalSpins++;
  game.currentNormalSpins++;
  const result = applySpin(game.logicState);
  const isHit = result.outcome !== 'miss';
  const custom = document.getElementById('re-custom').checked;
  const alert = custom && rollReAlertForOutcome(result.outcome);
  let reach = null;
  if (alert && result.outcome !== 'first_premium') reach = rollNormalReach(isHit);
  return { result, alert, isHit, interval:game.currentNormalSpins, reach };
}

function finalizeNormalSpin(data, { silentMiss = false } = {}){
  const { result, interval } = data;
  game.logicState = result.state;

  if (result.outcome === 'miss') {
    if (!silentMiss) game.message = `${game.currentNormalSpins}回転目…ハズレ`;
    return;
  }

  game.firstHits++;
  game.currentNormalSpins = 0;
  addBalls(result.actual);

  if (result.outcome === 'first_premium') {
    game.rushEntries++;
    game.message = `全回転！ V図柄 10R ${fmt(result.actual)}球 → HAZARD RUSH PREMIUM`;
    addLog('初当たり', `${interval}回転 / 全回転 10R → PREMIUM`, result.actual, 'lt');
  } else if (result.outcome === 'first_rush') {
    game.rushEntries++;
    game.message = `BATTLE BONUS成功！ 2R ${fmt(result.actual)}球 → HAZARD RUSH`;
    addLog('初当たり', `${interval}回転 / 2R → HAZARD RUSH`, result.actual, 'rush');
  } else {
    game.message = `BATTLE BONUS失敗… 2R ${fmt(result.actual)}球 → 通常時`;
    addLog('初当たり', `${interval}回転 / 2R → 通常`, result.actual, 'win');
  }
}

async function animateNormalPending(data){
  addLog('RE:', `${data.interval}回転目で先バレ発生`, 0, 'alert');
  await playSoundSynced('re', () => {
    setStage('alert', 'RE:', `${data.interval}回転目`, 'WARNING');
    game.message = `先バレ発生！ ${data.interval}回転目 / 「発展先を見る」を押してください`;
    render(false);
  }, { stopOthers:true });
}

async function revealNormalReach(data){
  showNormalPendingStage(data);
  game.message = data.result.outcome === 'first_premium'
    ? `${data.interval}回転目 / 全回転リーチへ発展！ 「当落結果を見る」で決着`
    : `${data.interval}回転目 / ${data.reach.label}（期待度${Math.round(data.reach.reliability*100)}%）へ発展 / 「当落結果を見る」で決着`;
  render(false);
}

async function animateNormalReveal(data){
  const { result, isHit } = data;

  showNormalPendingStage(data);
  await wait(380);

  if (result.outcome === 'first_premium') {
    setStage('judge', 'COMPLETE', '運命の図柄が揃う', 'FULL ROTATION', null, 'reach-fullrotation');
  } else {
    setStage('judge', 'JUDGE', `${data.reach.label} / 生存か、感染か。`, 'FINAL', null, `reach-${data.reach.id}`);
  }
  await wait(650);

  if (!isHit) {
    setStage('lose', 'MISSION FAILED', 'RE:先バレはハズレ…', 'RESULT');
    await wait(560);
    return;
  }

  // 通常時の先バレから大当たりした場合は、RUSH突入可否に関係なく大当たり音を鳴らす。
  playSound('jackpot', { stopOthers:true });

  if (result.outcome === 'first_premium') {
    setStage('win', 'V FEVER', 'FULL ROTATION / 1500 BONUS', 'PREMIUM', null, 'reach-fullrotation');
  } else if (result.outcome === 'first_rush') {
    setStage('win', 'BATTLE WIN', 'SUPER TYRANT撃破', '2R BONUS');
  } else {
    setStage('lose', 'BATTLE LOSE', 'BONUS獲得 / RUSH非突入', '2R BONUS');
  }
  await wait(720);
}

async function afterNormalResult(data){
  const outcome = data.result.outcome;
  if (outcome === 'first_premium') {
    await showModeEntry(MODES.PREMIUM, '突入！', 'HAZARD RUSH PREMIUM', 'FULL ROTATION');
  } else if (outcome === 'first_rush') {
    await showModeEntry(MODES.HAZARD, '突入！');
  } else if (outcome === 'first_fail') {
    await showModeEntry(MODES.NORMAL, '通常時へ', 'RUSH 突入ならず', 'BATTLE BONUS');
  }
}

function takeRightSpin(){
  const before = { ...game.logicState };
  if (before.mode === MODES.NORMAL) return null;

  if (before.phase === RIGHT_PHASES.HOLD) game.holdSpins++;
  else if (before.phase === RIGHT_PHASES.ST) game.rightSpins++;
  else if (before.phase === RIGHT_PHASES.PREMIUM) game.premiumSpins++;
  game.rightDraws++;

  const result = applySpin(game.logicState);
  const isHit = ['right_to_xtreme','right_to_survival','right_to_hazard'].includes(result.outcome);
  const tyrantCue = before.mode === MODES.SURVIVAL && before.phase === RIGHT_PHASES.ST && rollTyrantCue(isHit);
  const tyrantRoute = tyrantCue ? rollTyrantRoute(isHit) : null;
  return { before, result, isHit, tyrantCue, tyrantRoute };
}

function finalizeRightSpin(data, { silentMiss = false } = {}){
  const { before, result } = data;
  game.logicState = result.state;

  if (result.outcome === 'miss') {
    if (!silentMiss) game.message = `${MODE_LABELS[before.mode]} / ST残り${game.logicState.stRemaining}回`;
    return;
  }

  if (result.outcome === 'enter_hold') {
    if (result.meta.survivalToHazardHold) {
      game.message = 'SURVIVAL CHANCE駆け抜け → HAZARD RUSH 残保留4回転へ';
      addLog('モード移行', 'SURVIVAL終了 → HAZARD RUSH 残保留4個', 0, 'rush');
    } else {
      game.message = `${MODE_LABELS[before.mode]} ST終了 → 残保留4個を抽選`;
      addLog('残保留', `${MODE_LABELS[before.mode]} → 残保留4個`, 0, 'alert');
    }
    return;
  }

  if (result.outcome === 'hold_miss') {
    game.message = `${MODE_LABELS[before.mode]} 残保留ハズレ / あと${game.logicState.holdRemaining}個`;
    return;
  }

  if (result.outcome === 'rush_end') {
    game.message = `${MODE_LABELS[before.mode]} 残保留終了 → 通常時へ`;
    addLog('RUSH終了', `${MODE_LABELS[before.mode]} 駆け抜け`, 0, '');
    return;
  }

  game.rightHits++;
  addBalls(result.actual);
  const chain = !!result.meta.holdChain;
  const premium3000 = !!result.meta.premiumCompletion;
  const bonusPrefix = chain ? '保留連！ HAZARD RUSH 3000（1500×2）' : premium3000 ? 'PREMIUM 3000（1500×2）完遂' : '1500 BONUS';

  if (result.outcome === 'right_to_xtreme') {
    if (result.meta.enteredXtreme) {
      game.ltEntries++;
      game.message = `${bonusPrefix} → LT突入！ HAZARD RUSH XTREME`;
      addLog('LT突入', `${MODE_LABELS[before.mode]} → XTREME${chain ? ' / 保留連3000' : premium3000 ? ' / PREMIUM 3000' : ''}`, result.actual, 'lt');
    } else {
      game.message = `${bonusPrefix} → XTREME継続`;
      addLog(chain ? '保留連3000' : '大当たり', `XTREME継続${chain ? '（1500×2表示）' : ''}`, result.actual, 'lt');
    }
  } else if (result.outcome === 'right_to_survival') {
    game.message = `${bonusPrefix} → SURVIVAL CHANCE`;
    if (result.meta.specialFinalZone && before.mode !== MODES.HAZARD) game.message += '（最終変動振分け）';
    addLog(chain ? '保留連3000' : '大当たり', `${MODE_LABELS[before.mode]} → SURVIVAL${chain ? ' / 3000' : ''}`, result.actual, 'rush');
  } else {
    game.message = `${bonusPrefix} → HAZARD RUSH`;
    if (result.meta.specialFinalZone && before.mode !== MODES.HAZARD) game.message += '（最終変動振分け）';
    addLog(chain ? '保留連3000' : '大当たり', `${MODE_LABELS[before.mode]} → HAZARD${chain ? ' / 3000' : ''}`, result.actual, 'rush');
  }
}

async function animateTyrantPending(data){
  playSound('tyrant', { stopOthers:true });
  showTyrantPendingStage(data);
  game.message = `タイラント出現！ ${data.tyrantRoute.label}（期待度${Math.round(data.tyrantRoute.reliability*100)}%） / 「当落結果を見る」で決着`;
  addLog('TYRANT', `${data.tyrantRoute.label} / 期待度${Math.round(data.tyrantRoute.reliability*100)}%`, 0, 'alert');
  render(false);
  await wait(650);
}

async function animateTyrantReveal(data){
  const { result, isHit, tyrantRoute } = data;
  showTyrantPendingStage(data);
  await wait(320);
  setStage('judge', 'SURVIVE?', `${tyrantRoute.label} / 逃げ切ればLT`, 'TYRANT BATTLE', null, `tyrant-${tyrantRoute.id}`);
  setRouteCard('tyrant', tyrantRoute, { title:tyrantRoute.label, location:tyrantRoute.location });
  await wait(900);

  if (isHit) {
    stopSound('tyrant');
    playSound('jackpot');
    if (result.outcome === 'right_to_xtreme') {
      setStage('win', 'ESCAPE SUCCESS', 'LUCKY TRIGGER 発動', tyrantRoute.label, null, `tyrant-${tyrantRoute.id}`);
    } else {
      setStage('win', 'BONUS', 'ST最終変動のため33%・67%振分け', tyrantRoute.label, null, `tyrant-${tyrantRoute.id}`);
    }
    await wait(850);
  } else {
    stopSound('tyrant');
    setStage('lose', 'ESCAPE FAILED', '次変動へ', tyrantRoute.label, null, `tyrant-${tyrantRoute.id}`);
    await wait(650);
  }
}

async function animateRightSpin(data, compact = false){
  const { before, result, isHit } = data;

  if (result.outcome === 'enter_hold') {
    return;
  }

  if (result.outcome === 'hold_miss' || result.outcome === 'rush_end') {
    const left = result.outcome === 'rush_end' ? 0 : result.state.holdRemaining;
    const holdMain = before.mode === MODES.HAZARD ? 'HAZARD HOLD' : 'HOLD';
    setStage(result.outcome === 'rush_end' ? 'lose' : 'hold', result.outcome === 'rush_end' ? 'RUSH END' : holdMain, left ? `残保留 あと${left}個` : '残保留終了', MODE_LABELS[before.mode]);
    await wait(compact ? 220 : 460);
    return;
  }

  if (!isHit) {
    const type = before.mode === MODES.XTREME ? 'xtreme' : before.mode === MODES.PREMIUM ? 'premium' : before.mode === MODES.HAZARD ? 'hazard' : 'survival';
    const remaining = before.phase === RIGHT_PHASES.PREMIUM ? '次回まで' : `ST ${Math.max(0, before.stRemaining - 1)}回`;
    setStage(type, MODE_LABELS[before.mode], remaining, 'RUSH ACTIVE');
    await wait(compact ? 60 : 140);
    return;
  }

  if (result.meta.holdChain) {
    setStage('bonus3000', '3000 BONUS', '保留連！ 1500 × 2', 'HAZARD RUSH');
    await wait(compact ? 420 : 860);
  } else if (result.meta.premiumCompletion) {
    setStage('bonus3000', '3000 COMPLETE', 'PREMIUM 1500 + 1500', 'V PREMIUM');
    await wait(compact ? 420 : 860);
  } else {
    setStage('win', '1500 BONUS', '10R FEVER', MODE_LABELS[before.mode]);
    await wait(compact ? 300 : 580);
  }
}

async function afterRightResult(data){
  const { before, result } = data;
  if (result.outcome === 'rush_end') {
    await showModeEntry(MODES.NORMAL, '通常時へ', 'RUSH END', 'RESULT');
    return;
  }
  if (result.outcome === 'right_to_xtreme' && result.meta.enteredXtreme) {
    await showModeEntry(MODES.XTREME, 'LT突入！', 'HAZARD RUSH XTREME', 'LUCKY TRIGGER');
  } else if (result.outcome === 'right_to_survival') {
    await showModeEntry(MODES.SURVIVAL, '突入！', 'SURVIVAL CHANCE', 'NEXT STAGE');
  } else if (result.outcome === 'right_to_hazard' && before.mode !== MODES.HAZARD) {
    await showModeEntry(MODES.HAZARD, '突入！');
  }
}

async function revealPendingResult(){
  if (game.busy || !game.pendingEvent) return;
  const pending = game.pendingEvent;

  // 通常時先バレは 先バレ → 発展先ボタン → リーチ表示 → 当落ボタン の2段階。
  if (pending.kind === 'normal' && pending.phase === 'alert') {
    pending.phase = 'reach';
    revealNormalReach(pending.data);
    return;
  }

  setBusy(true);
  game.pendingEvent = null;
  try {
    if (pending.kind === 'normal') {
      const data = pending.data;
      await animateNormalReveal(data);
      finalizeNormalSpin(data);
      render(false);
      await afterNormalResult(data);
    } else if (pending.kind === 'tyrant') {
      const data = pending.data;
      await animateTyrantReveal(data);
      finalizeRightSpin(data);
      render(false);
      await afterRightResult(data);
    }
  } finally {
    setBusy(false);
    stageForCurrentState();
  }
}

async function drawResidualHold(){
  if (game.busy || game.pendingEvent || game.logicState.mode === MODES.NORMAL || game.logicState.phase !== RIGHT_PHASES.HOLD) return;
  setBusy(true);
  try {
    const data = takeRightSpin();
    if (!data) return;
    await animateRightSpin(data, false);
    finalizeRightSpin(data);
    render(false);
    await afterRightResult(data);
  } finally {
    setBusy(false);
    stageForCurrentState();
  }
}

async function autoNormal(yen){
  if (game.busy || game.pendingEvent || game.logicState.mode !== MODES.NORMAL) return;
  setBusy(true);
  try {
    const target = Math.max(1, Math.floor((yen / 1000) * game.spinsPer1k));
    let consumed = 0;
    let eventFound = false;

    for (let i = 0; i < target; i++) {
      const data = takeNormalSpin();
      if (!data) break;
      consumed++;

      // RE:先バレが発生したら停止して当落ボタン待ち。
      if (data.alert) {
        eventFound = true;
        game.pendingEvent = { kind:'normal', phase:'alert', data };
        await animateNormalPending(data);
        break;
      }

      finalizeNormalSpin(data, { silentMiss:true });
    }

    if (!eventFound && game.logicState.mode === MODES.NORMAL) {
      game.message = `${consumed}回転分を消化 / 現在${game.currentNormalSpins}回転`;
    }
  } finally {
    setBusy(false);
    stageForCurrentState();
  }
}

async function rightOne(){
  if (game.busy || game.pendingEvent || game.logicState.mode === MODES.NORMAL || game.logicState.phase === RIGHT_PHASES.HOLD) return;
  setBusy(true);
  try {
    const data = takeRightSpin();
    if (!data) return;

    if (data.tyrantCue) {
      game.pendingEvent = { kind:'tyrant', data };
      await animateTyrantPending(data);
      return;
    }

    const stop = data.isHit || data.result.outcome === 'rush_end' || data.result.outcome === 'enter_hold';
    if (stop) {
      await animateRightSpin(data, false);
      finalizeRightSpin(data);
      render(false);
      await afterRightResult(data);
      return;
    }

    finalizeRightSpin(data, { silentMiss:true });
    const s = game.logicState;
    if (s.mode === MODES.PREMIUM) game.message = '1回転消化 / PREMIUM継続中';
    else if (s.phase === RIGHT_PHASES.ST) game.message = `1回転消化 / ST残り${s.stRemaining}回`;
    render(false);
  } finally {
    setBusy(false);
    stageForCurrentState();
  }
}

async function rightTen(){
  if (game.busy || game.pendingEvent || game.logicState.mode === MODES.NORMAL || game.logicState.phase === RIGHT_PHASES.HOLD) return;
  setBusy(true);
  try {
    let consumed = 0;
    let stoppedOnEvent = false;

    for (let i = 0; i < 10; i++) {
      const data = takeRightSpin();
      if (!data) break;
      consumed++;

      // SURVIVALのタイラントは結果を伏せて停止。
      if (data.tyrantCue) {
        stoppedOnEvent = true;
        game.pendingEvent = { kind:'tyrant', data };
        await animateTyrantPending(data);
        break;
      }

      const stop = data.isHit || data.result.outcome === 'rush_end' || data.result.outcome === 'enter_hold';
      if (stop) {
        stoppedOnEvent = true;
        await animateRightSpin(data, true);
        finalizeRightSpin(data);
        render(false);
        await afterRightResult(data);
        break;
      }
      finalizeRightSpin(data, { silentMiss:true });
    }

    if (!stoppedOnEvent && consumed > 0) {
      const s = game.logicState;
      if (s.mode === MODES.PREMIUM) game.message = `${consumed}回転分を消化 / PREMIUM継続中`;
      else if (s.phase === RIGHT_PHASES.ST) game.message = `${consumed}回転分を消化 / ST残り${s.stRemaining}回`;
      render(false);
    }
  } finally {
    setBusy(false);
    stageForCurrentState();
  }
}

async function rushSkip(){
  if (game.busy || game.pendingEvent || game.logicState.mode === MODES.NORMAL || game.logicState.phase === RIGHT_PHASES.HOLD) return;
  setBusy(true);
  try {
    for (let guard = 0; guard < 20000; guard++) {
      const data = takeRightSpin();
      if (!data) break;

      if (data.tyrantCue) {
        game.pendingEvent = { kind:'tyrant', data };
        await animateTyrantPending(data);
        break;
      }

      const stop = data.isHit || data.result.outcome === 'rush_end' || data.result.outcome === 'enter_hold';
      if (stop) {
        await animateRightSpin(data, true);
        finalizeRightSpin(data);
        render(false);
        await afterRightResult(data);
        break;
      }
      finalizeRightSpin(data, { silentMiss:true });
    }
  } finally {
    setBusy(false);
    stageForCurrentState();
  }
}

function resetGame(){
  if (game.busy) return;
  stopAllSounds();
  game.logicState = createInitialState();
  game.balls = 0;
  game.investment = 0;
  game.normalSpins = 0;
  game.currentNormalSpins = 0;
  game.firstHits = 0;
  game.rushEntries = 0;
  game.ltEntries = 0;
  game.rightHits = 0;
  game.rightDraws = 0;
  game.rightSpins = 0;
  game.holdSpins = 0;
  game.premiumSpins = 0;
  game.log = [];
  game.pendingEvent = null;
  game.message = '1,000円分 / 10,000円分で通常時を消化';
  render();
}

function modeClass(mode){
  if (mode === MODES.HAZARD) return 'mode-hazard';
  if (mode === MODES.SURVIVAL) return 'mode-survival';
  if (mode === MODES.XTREME) return 'mode-xtreme';
  if (mode === MODES.PREMIUM) return 'mode-premium';
  return 'mode-normal';
}

function applyModeTheme(mode){
  document.body.dataset.mode = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  const colors = { normal:'#08090b', hazard:'#071725', survival:'#071d13', xtreme:'#26070a', premium:'#241b07' };
  if (meta) meta.setAttribute('content', colors[mode] || colors.normal);
}

function phaseText(){
  const s = game.logicState;
  if (s.mode === MODES.NORMAL) return '図柄揃い 1/199.8';
  if (s.mode === MODES.PREMIUM) return '右打ち 1/45.8 ／ 実質次回大当たりまで';
  if (s.phase === RIGHT_PHASES.HOLD) {
    return `${MODE_LABELS[s.mode]} ／ 残保留${s.holdRemaining}個を個別抽選 ／ 当たりは33% SURVIVAL・67% HAZARD`;
  }
  const special = s.stRemaining === 1 ? ' ／ 最終変動の当たりは33% SURVIVAL・67% HAZARD' : '';
  return `右打ち 1/45.8 ／ ST残り${s.stRemaining}回（残保留4個は別抽選）${special}`;
}

function renderHoldDots(){
  const el = document.getElementById('hold-dots');
  const s = game.logicState;
  if (s.phase !== RIGHT_PHASES.HOLD) {
    el.innerHTML = '';
    el.classList.remove('show');
    return;
  }
  el.classList.add('show');
  const used = BIO_SPEC.HOLD - s.holdRemaining;
  el.innerHTML = Array.from({length:BIO_SPEC.HOLD}, (_, i) => `<i class="${i < used ? 'used' : 'live'}"></i>`).join('');
}

function renderSpinBadge(){
  const badge = document.getElementById('spin-badge');
  if (!badge) return;
  if (game.pendingEvent && game.pendingEvent.kind === 'normal') {
    const d = game.pendingEvent.data;
    badge.textContent = `RE:先バレ ${d.interval}回転目`;
    badge.className = 'spin-badge alert';
    return;
  }
  if (game.logicState.mode === MODES.NORMAL) {
    badge.textContent = `現在 ${game.currentNormalSpins}回転`;
    badge.className = 'spin-badge';
  } else {
    badge.textContent = MODE_LABELS[game.logicState.mode];
    badge.className = `spin-badge ${modeClass(game.logicState.mode)}`;
  }
}

function render(resetStage = true){
  const s = game.logicState;
  applyModeTheme(s.mode);

  const modeEl = document.getElementById('mode');
  modeEl.textContent = MODE_LABELS[s.mode];
  modeEl.className = `mode ${modeClass(s.mode)}`;

  const remainingLabel = document.getElementById('remaining-label');
  const remaining = document.getElementById('remaining');
  if (s.mode === MODES.NORMAL) {
    remainingLabel.textContent = '残り';
    remaining.textContent = '－';
  } else if (s.mode === MODES.PREMIUM) {
    remainingLabel.textContent = '次回まで';
    remaining.textContent = '∞';
  } else if (s.phase === RIGHT_PHASES.HOLD) {
    remainingLabel.textContent = '残保留';
    remaining.textContent = `${s.holdRemaining}個`;
  } else {
    remainingLabel.textContent = 'ST残り';
    remaining.textContent = `${s.stRemaining}回`;
  }

  document.getElementById('phase').textContent = phaseText();
  document.getElementById('result-message').textContent = game.message;
  document.getElementById('balls').textContent = fmt(game.balls);
  document.getElementById('investment').textContent = fmt(game.investment);
  const bal = balanceYen();
  const balEl = document.getElementById('balance');
  balEl.textContent = `${bal >= 0 ? '+' : ''}${fmt(bal)}`;
  balEl.style.color = bal > 0 ? '#73c994' : bal < 0 ? '#ec6f76' : '#f0c45e';

  document.getElementById('normal-spins').textContent = fmt(game.normalSpins);
  document.getElementById('first-hits').textContent = fmt(game.firstHits);
  document.getElementById('first-prob').textContent = game.firstHits ? `1/${(game.normalSpins/game.firstHits).toFixed(1)}` : '1/―';
  document.getElementById('rush-entries').textContent = fmt(game.rushEntries);
  document.getElementById('rush-entry-rate').textContent = game.firstHits ? pct(game.rushEntries/game.firstHits) : '0%';
  document.getElementById('lt-entries').textContent = fmt(game.ltEntries);
  document.getElementById('right-hits').textContent = fmt(game.rightHits);
  document.getElementById('right-prob').textContent = game.rightHits ? `1/${(game.rightDraws/game.rightHits).toFixed(1)}` : '1/―';
  document.getElementById('right-spins').textContent = fmt(game.rightSpins);
  document.getElementById('hold-spins').textContent = `${fmt(game.holdSpins)}個`;

  const normal = s.mode === MODES.NORMAL;
  const inHold = s.phase === RIGHT_PHASES.HOLD;
  const pending = !!game.pendingEvent;
  const auto1000 = document.getElementById('auto-1000');
  const auto10000 = document.getElementById('auto-10000');
  const resultCheck = document.getElementById('result-check');
  const right1 = document.getElementById('right-1');
  const right10 = document.getElementById('right-10');
  const holdSpin = document.getElementById('hold-spin');
  const rushSkipBtn = document.getElementById('rush-skip');

  auto1000.hidden = !normal;
  auto10000.hidden = !normal;
  resultCheck.hidden = !pending;
  right1.hidden = normal || inHold;
  right10.hidden = normal || inHold;
  holdSpin.hidden = normal || !inHold;
  rushSkipBtn.hidden = normal || inHold;

  auto1000.disabled = game.busy || !normal || pending;
  auto10000.disabled = game.busy || !normal || pending;
  resultCheck.disabled = game.busy || !pending;
  right1.disabled = game.busy || normal || inHold || pending;
  right10.disabled = game.busy || normal || inHold || pending;
  holdSpin.disabled = game.busy || normal || !inHold || pending;
  rushSkipBtn.disabled = game.busy || normal || inHold || pending;
  document.getElementById('reset-btn').disabled = game.busy;

  if (pending) {
    if (game.pendingEvent.kind === 'tyrant') {
      resultCheck.textContent = 'タイラント 当落結果を見る';
    } else if (game.pendingEvent.phase === 'alert') {
      resultCheck.textContent = '発展先を見る';
    } else {
      resultCheck.textContent = '当落結果を見る';
    }
  }

  document.getElementById('log').innerHTML = game.log.length ? game.log.map(r => `
    <div class="log-row ${r.type}">
      <span class="tag">${r.tag}</span><span>${r.text}</span><span class="balls">${r.balls ? '+'+fmt(r.balls)+'球' : ''}</span>
    </div>`).join('') : '<div class="log-row"><span class="tag">―</span><span>まだ履歴はありません</span><span></span></div>';

  renderHoldDots();
  renderSpinBadge();
  if (resetStage && !game.busy) stageForCurrentState();
}

document.getElementById('auto-1000').addEventListener('click', () => autoNormal(1000));
document.getElementById('auto-10000').addEventListener('click', () => autoNormal(10000));
document.getElementById('result-check').addEventListener('click', revealPendingResult);
document.getElementById('right-1').addEventListener('click', rightOne);
document.getElementById('right-10').addEventListener('click', rightTen);
document.getElementById('hold-spin').addEventListener('click', drawResidualHold);
document.getElementById('rush-skip').addEventListener('click', rushSkip);
document.getElementById('reset-btn').addEventListener('click', resetGame);
document.getElementById('rate').addEventListener('change', e => { game.rate = Number(e.target.value); render(); });
document.getElementById('spins-per-1k').addEventListener('change', e => {
  const v = Math.min(40, Math.max(1, Number(e.target.value) || 18));
  game.spinsPer1k = v;
  e.target.value = v.toFixed(1);
  render();
});

loadSoundSettings();
initSoundPlayers();
syncSoundControls();
bindSoundControls();
render();
