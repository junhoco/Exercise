// ===== Program Definitions =====
const PROGRAMS = {
  kettlebell: {
    id: 'kettlebell', name: '케틀벨 트레이닝', icon: '🏋️',
    subtitle: '근력 & 파워 트레이닝',
    workTime: 30, restTime: 30, rounds: 10, sets: 3, setRest: 60
  },
  interval: {
    id: 'interval', name: '인터벌 트레이닝', icon: '⚡',
    subtitle: '고강도 심폐 트레이닝',
    workTime: 20, restTime: 10, rounds: 8, sets: 4, setRest: 60
  },
  f45: {
    id: 'f45', name: 'F45 트레이닝', icon: '🔥',
    subtitle: '기능성 서킷 트레이닝',
    workTime: 40, restTime: 20, rounds: 12, sets: 3, setRest: 90
  }
};

// ===== State =====
let currentProgram = null;
let config = {};
let timerState = 'idle'; // idle | countdown | work | rest | setRest | paused | done
let pausedFrom = '';
let currentRound = 1;
let currentSet = 1;
let timeLeft = 0;
let totalTime = 0;
let intervalId = null;
let startTime = null;

// ===== Audio =====
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
}

function beep(freq, dur, vol = 0.3) {
  ensureAudio();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.start(); o.stop(audioCtx.currentTime + dur);
}

function playWorkBeep() { beep(880, 0.15); setTimeout(() => beep(1100, 0.2), 180); }
function playRestBeep() { beep(660, 0.2); }
function playCountdownBeep() { beep(440, 0.1, 0.2); }
function playCompleteBeep() {
  beep(523, 0.15); setTimeout(() => beep(659, 0.15), 200);
  setTimeout(() => beep(784, 0.15), 400); setTimeout(() => beep(1047, 0.3), 600);
}

// ===== Vibration & Notifications (Galaxy Band support) =====
let notifPermission = 'default';

function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(p => { notifPermission = p; });
  } else if ('Notification' in window) {
    notifPermission = Notification.permission;
  }
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function sendNotification(title, body, tag) {
  // Vibrate phone
  vibrate([200, 100, 200]);
  // Send notification (mirrors to Galaxy Band)
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, {
      body: body,
      icon: './icon-192.svg',
      tag: tag || 'workout-timer',
      renotify: true,
      vibrate: [200, 100, 200]
    });
    setTimeout(() => n.close(), 4000);
  }
}

function notifyWorkStart() {
  vibrate([200, 100, 300]);
  sendNotification('💪 운동 시작!', `라운드 ${currentRound}/${config.rounds} · 세트 ${currentSet}/${config.sets}`, 'work');
}

function notifyRestStart() {
  vibrate([150, 80, 150]);
  sendNotification('😮‍💨 휴식!', `${config.restTime}초 휴식`, 'rest');
}

function notifySetRest() {
  vibrate([300, 150, 300]);
  sendNotification('☕ 세트 휴식', `세트 ${currentSet} 완료! ${config.setRest}초 휴식`, 'set-rest');
}

function notifyComplete() {
  vibrate([200, 100, 200, 100, 400]);
  sendNotification('🎉 운동 완료!', `${currentProgram.name} 끝! 수고하셨습니다!`, 'complete');
}

// ===== DOM =====
const $ = (s) => document.getElementById(s);
const homeScreen = $('homeScreen');
const timerScreen = $('timerScreen');
const completeScreen = $('completeScreen');
const programList = $('programList');
const timerTitle = $('timerTitle');
const stateBadge = $('stateBadge');
const stateText = $('stateText');
const timerRing = $('timerRing');
const timerTime = $('timerTime');
const roundDisplay = $('roundDisplay');
const setDisplay = $('setDisplay');
const progressPercent = $('progressPercent');
const progressFill = $('progressFill');
const btnPlayPause = $('btnPlayPause');
const iconPlay = $('iconPlay');
const iconPause = $('iconPause');
const countdownOverlay = $('countdownOverlay');
const countdownNumber = $('countdownNumber');
const settingsModal = $('settingsModal');

const CIRCUMFERENCE = 2 * Math.PI * 115; // ~722.57

// ===== LocalStorage =====
function saveConfig(id, cfg) {
  const all = JSON.parse(localStorage.getItem('workoutConfigs') || '{}');
  all[id] = cfg; localStorage.setItem('workoutConfigs', JSON.stringify(all));
}

function loadConfig(id) {
  const all = JSON.parse(localStorage.getItem('workoutConfigs') || '{}');
  return all[id] || null;
}

// ===== Render Home Screen =====
function renderHome() {
  programList.innerHTML = '';
  Object.values(PROGRAMS).forEach(p => {
    const saved = loadConfig(p.id);
    const cfg = saved || p;
    const totalSec = (cfg.workTime + cfg.restTime) * cfg.rounds * cfg.sets;
    const min = Math.floor(totalSec / 60);
    const card = document.createElement('div');
    card.className = 'program-card';
    card.dataset.program = p.id;
    card.innerHTML = `
      <div class="card-top">
        <div class="card-icon">${p.icon}</div>
        <div><div class="card-title">${p.name}</div><div class="card-subtitle">${p.subtitle}</div></div>
      </div>
      <div class="card-stats">
        <div class="stat"><span class="stat-value">${cfg.workTime}s</span><span class="stat-label">운동</span></div>
        <div class="stat"><span class="stat-value">${cfg.restTime}s</span><span class="stat-label">휴식</span></div>
        <div class="stat"><span class="stat-value">${cfg.rounds}</span><span class="stat-label">라운드</span></div>
        <div class="stat"><span class="stat-value">~${min}m</span><span class="stat-label">총시간</span></div>
      </div>`;
    card.addEventListener('click', () => selectProgram(p.id));
    programList.appendChild(card);
  });
}

// ===== Screen Navigation =====
function showScreen(screen) {
  [homeScreen, timerScreen, completeScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

// ===== Select Program =====
function selectProgram(id) {
  currentProgram = PROGRAMS[id];
  const saved = loadConfig(id);
  config = saved ? { ...saved } : {
    workTime: currentProgram.workTime, restTime: currentProgram.restTime,
    rounds: currentProgram.rounds, sets: currentProgram.sets,
    setRest: currentProgram.setRest || 60
  };
  resetTimer();
  timerTitle.textContent = currentProgram.name;
  showScreen(timerScreen);
}

// ===== Timer Logic =====
function resetTimer() {
  clearInterval(intervalId); intervalId = null;
  timerState = 'idle'; pausedFrom = '';
  currentRound = 1; currentSet = 1;
  timeLeft = config.workTime; totalTime = config.workTime;
  updateDisplay();
  setPlayIcon(false);
}

function updateDisplay() {
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  timerTime.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Ring
  const progress = totalTime > 0 ? (totalTime - timeLeft) / totalTime : 0;
  timerRing.setAttribute('stroke-dashoffset', CIRCUMFERENCE * (1 - progress));

  // State classes
  let stateClass = 'work';
  let badgeClass = 'ready';
  let label = '준비';
  if (timerState === 'work') { stateClass = 'work'; badgeClass = 'work'; label = '운동'; }
  else if (timerState === 'rest') { stateClass = 'rest'; badgeClass = 'rest'; label = '휴식'; }
  else if (timerState === 'setRest') { stateClass = 'set-rest'; badgeClass = 'set-rest'; label = '세트 휴식'; }
  else if (timerState === 'paused') {
    stateClass = pausedFrom === 'rest' ? 'rest' : pausedFrom === 'setRest' ? 'set-rest' : 'work';
    badgeClass = 'ready'; label = '일시정지';
  }

  timerRing.className.baseVal = `timer-ring-progress ${stateClass}`;
  timerTime.className = `timer-time ${stateClass}`;
  stateBadge.className = `state-badge ${badgeClass}`;
  stateText.textContent = label;

  // Progress
  roundDisplay.textContent = `${currentRound} / ${config.rounds}`;
  setDisplay.textContent = `${currentSet} / ${config.sets}`;
  const totalRounds = config.rounds * config.sets;
  const done = (currentSet - 1) * config.rounds + (currentRound - 1);
  const pct = Math.round((done / totalRounds) * 100);
  progressPercent.textContent = `${pct}%`;
  progressFill.style.width = `${pct}%`;
}

function setPlayIcon(playing) {
  iconPlay.style.display = playing ? 'none' : 'block';
  iconPause.style.display = playing ? 'block' : 'none';
  btnPlayPause.classList.toggle('playing', playing);
}

function startCountdown(cb) {
  timerState = 'countdown';
  let count = 3;
  countdownOverlay.classList.add('active');
  countdownNumber.textContent = count;
  playCountdownBeep();
  const cdInterval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(cdInterval);
      countdownOverlay.classList.remove('active');
      cb();
    } else {
      countdownNumber.textContent = count;
      countdownNumber.style.animation = 'none';
      void countdownNumber.offsetWidth;
      countdownNumber.style.animation = 'countdown-pop 0.6s ease-out';
      playCountdownBeep();
    }
  }, 1000);
}

function togglePlayPause() {
  ensureAudio();
  requestNotifPermission();
  if (timerState === 'idle') {
    startCountdown(() => { timerState = 'work'; totalTime = config.workTime; timeLeft = config.workTime; setPlayIcon(true); startInterval(); playWorkBeep(); notifyWorkStart(); updateDisplay(); });
  } else if (timerState === 'paused') {
    timerState = pausedFrom; setPlayIcon(true); startInterval();
  } else if (['work', 'rest', 'setRest'].includes(timerState)) {
    pausedFrom = timerState; timerState = 'paused'; clearInterval(intervalId); intervalId = null; setPlayIcon(false); updateDisplay();
  }
}

function startInterval() {
  clearInterval(intervalId);
  intervalId = setInterval(tick, 1000);
  updateDisplay();
}

function tick() {
  timeLeft--;
  if (timeLeft <= 0) {
    if (timerState === 'work') {
      if (currentRound >= config.rounds && currentSet >= config.sets) { finish(); return; }
      if (currentRound >= config.rounds) {
        // Set rest
        timerState = 'setRest'; totalTime = config.setRest; timeLeft = config.setRest; playRestBeep(); notifySetRest();
      } else {
        timerState = 'rest'; totalTime = config.restTime; timeLeft = config.restTime; playRestBeep(); notifyRestStart();
      }
    } else if (timerState === 'rest') {
      currentRound++; timerState = 'work'; totalTime = config.workTime; timeLeft = config.workTime; playWorkBeep(); notifyWorkStart();
    } else if (timerState === 'setRest') {
      currentSet++; currentRound = 1; timerState = 'work'; totalTime = config.workTime; timeLeft = config.workTime; playWorkBeep(); notifyWorkStart();
    }
  } else if (timeLeft <= 3 && timeLeft > 0) {
    playCountdownBeep();
  }
  updateDisplay();
}

function finish() {
  clearInterval(intervalId); intervalId = null;
  timerState = 'done'; playCompleteBeep(); notifyComplete();
  const totalRounds = config.rounds * config.sets;
  const totalSec = (config.workTime + config.restTime) * totalRounds;
  const workSec = config.workTime * totalRounds;
  const mins = Math.floor(totalSec / 60); const secs = totalSec % 60;
  $('completeSubtitle').textContent = `${currentProgram.name} 완료!`;
  $('completeStats').innerHTML = `
    <div class="complete-stat"><span class="complete-stat-value">${mins}:${String(secs).padStart(2, '0')}</span><span class="complete-stat-label">총 시간</span></div>
    <div class="complete-stat"><span class="complete-stat-value">${totalRounds}</span><span class="complete-stat-label">총 라운드</span></div>
    <div class="complete-stat"><span class="complete-stat-value">${config.sets}</span><span class="complete-stat-label">총 세트</span></div>
    <div class="complete-stat"><span class="complete-stat-value">${Math.floor(workSec / 60)}m</span><span class="complete-stat-label">운동 시간</span></div>`;
  showScreen(completeScreen);
}

// ===== Settings Modal =====
let tempConfig = {};

function openSettings() {
  tempConfig = { ...config };
  $('settingWork').textContent = tempConfig.workTime;
  $('settingRest').textContent = tempConfig.restTime;
  $('settingRounds').textContent = tempConfig.rounds;
  $('settingSets').textContent = tempConfig.sets;
  $('settingSetRest').textContent = tempConfig.setRest;
  $('modalTitle').textContent = `${currentProgram.name} 설정`;
  settingsModal.classList.add('active');
}

function closeSettings() { settingsModal.classList.remove('active'); }

function adjustSetting(setting, dir) {
  const limits = { workTime: [5, 300], restTime: [5, 300], rounds: [1, 50], sets: [1, 20], setRest: [10, 300] };
  const steps = { workTime: 5, restTime: 5, rounds: 1, sets: 1, setRest: 10 };
  const [min, max] = limits[setting];
  tempConfig[setting] = Math.max(min, Math.min(max, tempConfig[setting] + dir * steps[setting]));
  const elMap = { workTime: 'settingWork', restTime: 'settingRest', rounds: 'settingRounds', sets: 'settingSets', setRest: 'settingSetRest' };
  $(elMap[setting]).textContent = tempConfig[setting];
}

function saveSettings() {
  config = { ...tempConfig };
  saveConfig(currentProgram.id, config);
  closeSettings(); resetTimer(); renderHome();
}

// ===== Event Listeners =====
$('btnPlayPause').addEventListener('click', togglePlayPause);
$('btnReset').addEventListener('click', () => { resetTimer(); updateDisplay(); });
$('btnBack').addEventListener('click', () => {
  resetTimer(); showScreen(homeScreen); renderHome();
});
$('btnSettings').addEventListener('click', openSettings);
$('btnModalCancel').addEventListener('click', closeSettings);
$('btnModalSave').addEventListener('click', saveSettings);
$('btnHome').addEventListener('click', () => { showScreen(homeScreen); renderHome(); });

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

document.querySelectorAll('.btn-adjust').forEach(btn => {
  btn.addEventListener('click', () => {
    adjustSetting(btn.dataset.setting, parseInt(btn.dataset.dir));
  });
});

// ===== Init =====
renderHome();
