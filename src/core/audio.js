/**
 * Эффекты синтезируются через WebAudio, фоновая композиция играет отдельным
 * media-источником через общий master, поэтому mute и тишина локаций едины.
 */

const MUSIC_GAIN = 0.18;
const MUSIC_URL = new URL('../../assets/audio/main-loop.mp3', import.meta.url).href;
const automatedBrowser = () => navigator.webdriver === true;
const musicProbeRequested = () => new URLSearchParams(location.search).has('music-test');

let ac = null;
// QA-браузеры стартуют полностью беззвучно: не только музыка, но и синтезированные SFX.
let muted = automatedBrowser();
let master = null;
let sfxBus = null;
let ambientBus = null;
let musicBus = null;
let music = null;
let ambientNodes = [];
let sceneKey = '';

export function initAudio() {
  if (ac) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  ac = new Ctx();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ac.destination);
  sfxBus = ac.createGain();
  ambientBus = ac.createGain();
  musicBus = ac.createGain();
  sfxBus.connect(master);
  ambientBus.connect(master);
  musicBus.connect(master);
  ambientBus.gain.value = 0;
  musicBus.gain.value = MUSIC_GAIN;

  music = new Audio(MUSIC_URL);
  music.loop = true;
  music.preload = 'metadata';
  // Автоматические браузерные прогоны никогда не выводят звук на устройство.
  music.muted = automatedBrowser();
  const musicSource = ac.createMediaElementSource(music);
  musicSource.connect(musicBus);
}

export function resumeAudio() {
  initAudio();
  if (ac?.state === 'suspended') ac.resume();
  if (music?.paused && (!automatedBrowser() || musicProbeRequested())) {
    music.play().catch(() => { /* следующий жест игрока повторит запуск */ });
  }
}

export function toggleMute() {
  muted = !muted;
  // Автоматизированный Chrome нельзя раззвучить даже тестовым нажатием N.
  if (master && ac) master.gain.setTargetAtTime((muted || automatedBrowser()) ? 0 : 0.9, ac.currentTime, 0.02);
  return muted;
}
export const isMuted = () => muted;

/** Узкий read-only статус для QA без доступа к WebAudio-узлам. */
export const audioState = () => ({
  initialized: Boolean(ac && music),
  musicPaused: music?.paused ?? true,
  musicLoop: music?.loop ?? false,
  musicMuted: music?.muted ?? false,
  musicUrl: MUSIC_URL,
  muted,
});

/** Короткий тон с опциональным глиссандо. */
function tone(freq, dur, type = 'square', vol = 0.06, slide = 0) {
  if (muted || !ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(sfxBus ?? master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Затухающий белый шум — взрывы, дробовик. */
function noise(dur, vol = 0.12) {
  if (muted || !ac) return;
  const len = (ac.sampleRate * dur) | 0;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  const gain = ac.createGain();
  src.buffer = buf;
  gain.gain.value = vol;
  src.connect(gain);
  gain.connect(sfxBus ?? master);
  src.start();
}

const later = (ms, fn) => setTimeout(fn, ms);

export const sfx = {
  laser:    () => tone(720, 0.06, 'square', 0.035, -420),
  shotgun:  () => { noise(0.12, 0.08); tone(200, 0.1, 'square', 0.04, -90); },
  plasma:   () => tone(190, 0.16, 'sine', 0.05, -70),
  missile:  () => tone(320, 0.12, 'triangle', 0.04, 160),
  rail:     () => { tone(1200, 0.22, 'sawtooth', 0.06, -900); noise(0.15, 0.05); },
  droneShot:() => tone(900, 0.04, 'square', 0.018, -300),
  enemyShot:() => tone(300, 0.07, 'sawtooth', 0.028, -140),
  hit:      () => tone(240, 0.05, 'sawtooth', 0.04, -120),
  boom:     () => { noise(0.35, 0.14); tone(90, 0.3, 'sine', 0.07, -60); },
  bigBoom:  () => { noise(0.8, 0.2); tone(60, 0.7, 'sine', 0.11, -35); },
  hurt:     () => { tone(160, 0.18, 'sawtooth', 0.07, -90); noise(0.12, 0.08); },
  pickup:   () => tone(880, 0.07, 'triangle', 0.05, 420),
  scrap:    () => tone(660, 0.05, 'triangle', 0.03, 220),
  dash:     () => tone(420, 0.16, 'sine', 0.05, 520),
  select:   () => tone(520, 0.07, 'square', 0.04, 180),
  confirm:  () => tone(660, 0.12, 'triangle', 0.06, 260),
  denied:   () => tone(180, 0.16, 'square', 0.05, -60),
  levelUp:  () => [523, 659, 784, 1046].forEach((f, i) => later(i * 80, () => tone(f, 0.18, 'triangle', 0.06))),
  waveClear:() => [659, 784, 988].forEach((f, i) => later(i * 90, () => tone(f, 0.22, 'triangle', 0.055))),
  alarm:    () => [0, 220, 440].forEach((d) => later(d, () => tone(180, 0.2, 'square', 0.07, 90))),
};

function stopAmbient() {
  for (const node of ambientNodes) {
    try { node.stop?.(); } catch { /* узел уже остановлен */ }
    try { node.disconnect?.(); } catch { /* контекст уже закрыт */ }
  }
  ambientNodes = [];
}

/**
 * Единственный ambient-контроллер локаций. Старт получает низкий тревожный
 * гул, а Диссонанс — медленно расстраиваемый интервал. Сингулярность глушит
 * обе шины целиком, поэтому даже отложенные sfx не нарушают абсолютную тишину.
 */
export function setAudioScene({ location = 'open', silent = false, hallucinating = false } = {}) {
  initAudio();
  if (!ac || !sfxBus || !ambientBus) return;
  const nextKey = `${location}:${silent ? 1 : 0}:${hallucinating ? 1 : 0}`;
  if (nextKey === sceneKey) return;
  sceneKey = nextKey;

  sfxBus.gain.setTargetAtTime(silent ? 0 : 1, ac.currentTime, 0.025);
  musicBus.gain.setTargetAtTime(silent ? 0 : MUSIC_GAIN, ac.currentTime, 0.08);
  ambientBus.gain.setTargetAtTime(0, ac.currentTime, 0.04);
  stopAmbient();
  if (silent) return;

  const dissonant = hallucinating || location === 'dissonance';
  if (location !== 'start' && !dissonant) return;

  const frequencies = dissonant ? [54, 76.3] : [42, 63];
  for (const [index, frequency] of frequencies.entries()) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = index ? 'triangle' : 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = index ? 0.035 : 0.055;
    osc.connect(gain);
    gain.connect(ambientBus);
    osc.start();
    ambientNodes.push(osc, gain);

    if (dissonant) {
      const lfo = ac.createOscillator();
      const depth = ac.createGain();
      lfo.frequency.value = 0.11 + index * 0.037;
      depth.gain.value = 34 + index * 17;
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start();
      ambientNodes.push(lfo, depth);
    }
  }
  ambientBus.gain.setTargetAtTime(dissonant ? 0.28 : 0.22, ac.currentTime, 0.35);
}
