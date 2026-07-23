const canvas = document.querySelector('#arena');
const ctx = canvas.getContext('2d');
const shell = document.querySelector('.arena-shell');
const overlay = document.querySelector('#overlay');
const startPanel = document.querySelector('#start-panel');
const resultPanel = document.querySelector('#result-panel');
const startButton = document.querySelector('#start-button');
const restartButton = document.querySelector('#restart-button');
const soundToggle = document.querySelector('#sound-toggle');

const ui = {
  score: document.querySelector('#score'), accuracy: document.querySelector('#accuracy'),
  combo: document.querySelector('#combo'), timer: document.querySelector('#timer'),
  hits: document.querySelector('#hits'), misses: document.querySelector('#misses'),
  liveReaction: document.querySelector('#live-reaction'), best: document.querySelector('#best-score'),
  resultScore: document.querySelector('#result-score'), resultAccuracy: document.querySelector('#result-accuracy'),
  resultReaction: document.querySelector('#result-reaction'), resultHits: document.querySelector('#result-hits'),
  resultCombo: document.querySelector('#result-combo'),
};

const WORLD = { width: 1200, height: 675, top: 64 };
const RADII = { large: 52, standard: 43, small: 34 };
const state = {
  phase: 'idle', duration: 60, size: 'standard', timeLeft: 60, score: 0,
  hits: 0, misses: 0, streak: 0, maxStreak: 0, reactions: [], targets: [],
  particles: [], ripples: [], pointer: { x: 600, y: 360, visible: false },
  lastFrame: 0, endAt: 0, muted: false, shake: 0, audio: null,
};

function bestKey() { return `gridshot-best-${state.duration}-${state.size}`; }
function getBest() { return Number(localStorage.getItem(bestKey()) || 0); }

function resize() {
  const rect = shell.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(canvas.width / WORLD.width, 0, 0, canvas.height / WORLD.height, 0, 0);
}

function pickPosition(ignoreIndex = -1) {
  const radius = RADII[state.size];
  const marginX = radius + 54;
  const marginTop = WORLD.top + radius + 38;
  const marginBottom = radius + 40;
  let candidate = { x: WORLD.width / 2, y: WORLD.height / 2 };
  for (let attempt = 0; attempt < 60; attempt++) {
    candidate = {
      x: marginX + Math.random() * (WORLD.width - marginX * 2),
      y: marginTop + Math.random() * (WORLD.height - marginTop - marginBottom),
    };
    const clear = state.targets.every((target, index) => index === ignoreIndex || Math.hypot(target.x - candidate.x, target.y - candidate.y) > radius * 3.25);
    if (clear) break;
  }
  return candidate;
}

function createTarget(index) {
  const position = pickPosition(index);
  return { ...position, radius: RADII[state.size], bornAt: performance.now(), scale: 0, pulse: Math.random() * Math.PI * 2 };
}

function resetStats() {
  Object.assign(state, { timeLeft: state.duration, score: 0, hits: 0, misses: 0, streak: 0, maxStreak: 0, reactions: [], particles: [], ripples: [], shake: 0 });
  state.targets = [];
  for (let index = 0; index < 3; index++) state.targets.push(createTarget(index));
  updateHud();
}

function startGame() {
  resetStats();
  state.phase = 'running';
  state.endAt = performance.now() + state.duration * 1000;
  overlay.classList.add('hidden');
  setOptionsDisabled(true);
  ensureAudio();
}

function finishGame() {
  if (state.phase !== 'running') return;
  state.phase = 'result';
  state.timeLeft = 0;
  const accuracy = getAccuracy();
  const average = getAverageReaction();
  const previousBest = getBest();
  if (state.score > previousBest) localStorage.setItem(bestKey(), String(state.score));
  ui.resultScore.textContent = state.score.toLocaleString();
  ui.resultAccuracy.textContent = `${accuracy}%`;
  ui.resultReaction.textContent = `${average || 0} ms`;
  ui.resultHits.textContent = state.hits;
  ui.resultCombo.textContent = state.maxStreak;
  ui.best.textContent = Math.max(previousBest, state.score).toLocaleString();
  startPanel.classList.add('hidden');
  resultPanel.classList.remove('hidden');
  overlay.classList.remove('hidden');
  setOptionsDisabled(false);
  updateHud();
  playTone(120, .18, 'sine', .08);
}

function getAccuracy() {
  const shots = state.hits + state.misses;
  return shots ? Math.round(state.hits / shots * 100) : 100;
}

function getAverageReaction() {
  if (!state.reactions.length) return 0;
  return Math.round(state.reactions.reduce((sum, value) => sum + value, 0) / state.reactions.length);
}

function updateHud() {
  ui.score.textContent = state.score.toLocaleString();
  ui.accuracy.textContent = `${getAccuracy()}%`;
  ui.combo.textContent = state.streak;
  ui.hits.textContent = state.hits;
  ui.misses.textContent = state.misses;
  ui.timer.textContent = state.timeLeft.toFixed(1);
  ui.timer.classList.toggle('urgent', state.timeLeft <= 10 && state.phase === 'running');
  const average = getAverageReaction();
  ui.liveReaction.textContent = average ? `${average} ms` : '-- ms';
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * WORLD.width / rect.width, y: (event.clientY - rect.top) * WORLD.height / rect.height };
}

function hitTarget(index, now) {
  const target = state.targets[index];
  const reaction = Math.max(1, Math.round(now - target.bornAt));
  state.reactions.push(reaction);
  state.hits++;
  state.streak++;
  state.maxStreak = Math.max(state.maxStreak, state.streak);
  const speedBonus = Math.max(0, 220 - Math.round(reaction * .24));
  const comboBonus = Math.min(180, state.streak * 4);
  state.score += 100 + speedBonus + comboBonus;
  spawnHitEffect(target.x, target.y, target.radius);
  state.targets[index] = createTarget(index);
  playTone(520 + Math.min(state.streak, 20) * 15, .035, 'square', .025);
}

function miss(point) {
  state.misses++;
  state.streak = 0;
  state.shake = 5;
  state.ripples.push({ x: point.x, y: point.y, age: 0, hit: false });
  playTone(95, .045, 'sawtooth', .02);
}

function handleShot(event) {
  if (state.phase !== 'running') return;
  const point = canvasPoint(event);
  state.pointer = { ...point, visible: true };
  const now = performance.now();
  let hitIndex = -1;
  let nearest = Infinity;
  state.targets.forEach((target, index) => {
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance <= target.radius && distance < nearest) { hitIndex = index; nearest = distance; }
  });
  if (hitIndex >= 0) hitTarget(hitIndex, now); else miss(point);
  updateHud();
}

function spawnHitEffect(x, y, radius) {
  state.ripples.push({ x, y, age: 0, hit: true });
  for (let index = 0; index < 14; index++) {
    const angle = Math.PI * 2 * index / 14 + Math.random() * .2;
    const speed = 80 + Math.random() * 170;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: .25 + Math.random() * .22, size: 3 + Math.random() * 4 });
  }
}

function ensureAudio() {
  if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audio.state === 'suspended') state.audio.resume();
}

function playTone(frequency, duration, type, volume) {
  if (state.muted) return;
  ensureAudio();
  const oscillator = state.audio.createOscillator();
  const gain = state.audio.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, state.audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, state.audio.currentTime + duration);
  oscillator.connect(gain).connect(state.audio.destination);
  oscillator.start();
  oscillator.stop(state.audio.currentTime + duration);
}

function drawBackground() {
  ctx.fillStyle = '#101619';
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  const gradient = ctx.createRadialGradient(WORLD.width / 2, WORLD.height / 2, 20, WORLD.width / 2, WORLD.height / 2, 700);
  gradient.addColorStop(0, '#1b272a');
  gradient.addColorStop(1, '#0b0f11');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, WORLD.top, WORLD.width, WORLD.height - WORLD.top);
  ctx.strokeStyle = '#ffffff0b';
  ctx.lineWidth = 1;
  for (let x = 70; x < WORLD.width; x += 106) { ctx.beginPath(); ctx.moveTo(x, WORLD.top); ctx.lineTo(x, WORLD.height); ctx.stroke(); }
  for (let y = WORLD.top + 48; y < WORLD.height; y += 88) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke(); }
  ctx.strokeStyle = '#58e8dc16';
  ctx.strokeRect(24, WORLD.top + 20, WORLD.width - 48, WORLD.height - WORLD.top - 44);
}

function drawTarget(target, time) {
  const radius = target.radius * target.scale;
  const pulse = 1 + Math.sin(time * .005 + target.pulse) * .025;
  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = '#ff5c66';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#ff5c66';
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#eef5f5';
  ctx.beginPath(); ctx.arc(0, 0, radius * .67, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff5c66';
  ctx.beginPath(); ctx.arc(0, 0, radius * .34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, radius * .1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawEffects(dt) {
  state.particles.forEach((particle) => {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= .97;
    particle.vy *= .97;
    const alpha = Math.max(0, 1 - particle.age / particle.life);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#58e8dc';
    ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
  });
  state.particles = state.particles.filter((particle) => particle.age < particle.life);
  state.ripples.forEach((ripple) => {
    ripple.age += dt;
    const alpha = Math.max(0, 1 - ripple.age / .28);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ripple.hit ? '#58e8dc' : '#ff5c66';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(ripple.x, ripple.y, 10 + ripple.age * 130, 0, Math.PI * 2); ctx.stroke();
  });
  state.ripples = state.ripples.filter((ripple) => ripple.age < .28);
  ctx.globalAlpha = 1;
}

function drawCrosshair() {
  if (!state.pointer.visible || state.phase !== 'running') return;
  const { x, y } = state.pointer;
  ctx.strokeStyle = '#f7fbfb';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 14, y); ctx.lineTo(x - 4, y);
  ctx.moveTo(x + 4, y); ctx.lineTo(x + 14, y);
  ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 4);
  ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 14);
  ctx.stroke();
  ctx.fillStyle = '#58e8dc';
  ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
}

function frame(time) {
  const dt = Math.min((time - state.lastFrame) / 1000 || 0, .04);
  state.lastFrame = time;
  if (state.phase === 'running') {
    state.timeLeft = Math.max(0, (state.endAt - performance.now()) / 1000);
    if (state.timeLeft <= 0) finishGame();
    state.targets.forEach((target) => { target.scale = Math.min(1, target.scale + dt * 8); });
    updateHud();
  }
  state.shake = Math.max(0, state.shake - dt * 34);
  ctx.save();
  if (state.shake) ctx.translate((Math.random() - .5) * state.shake, (Math.random() - .5) * state.shake);
  drawBackground();
  if (state.phase === 'running') state.targets.forEach((target) => drawTarget(target, time));
  drawEffects(dt);
  drawCrosshair();
  ctx.restore();
  requestAnimationFrame(frame);
}

function setOptionsDisabled(disabled) {
  document.querySelectorAll('.segmented button').forEach((button) => { button.disabled = disabled; });
}

function bindSegmented(containerId, key, transform = (value) => value) {
  const container = document.querySelector(containerId);
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    container.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    state[key] = transform(button.dataset.value);
    state.timeLeft = state.duration;
    ui.best.textContent = getBest().toLocaleString();
    updateHud();
  });
}

canvas.addEventListener('pointerdown', handleShot);
canvas.addEventListener('pointermove', (event) => { state.pointer = { ...canvasPoint(event), visible: true }; });
canvas.addEventListener('pointerleave', () => { state.pointer.visible = false; });
startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', startGame);
soundToggle.addEventListener('click', () => {
  state.muted = !state.muted;
  soundToggle.classList.toggle('muted', state.muted);
  soundToggle.setAttribute('aria-label', state.muted ? '开启音效' : '关闭音效');
  soundToggle.querySelector('span').textContent = state.muted ? '×' : '♪';
});
window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && state.phase !== 'running') { event.preventDefault(); startGame(); }
  if (event.code === 'KeyR' && state.phase === 'running') startGame();
});

bindSegmented('#duration-options', 'duration', Number);
bindSegmented('#size-options', 'size');
ui.best.textContent = getBest().toLocaleString();
resize();
resetStats();
requestAnimationFrame(frame);
