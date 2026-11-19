// ---------- Settings ----------
const DEFAULT_SECONDS = 5 * 60;  // starting countdown: 5 minutes
const TICK_MS = 250;             // how often the screen refreshes
const ALARM_BEEP_GAP_MS = 700;   // time between alarm beeps
const ALARM_MAX_MS = 30 * 1000;  // alarm stops by itself after 30 seconds

// ---------- Page elements (found by their ids in index.html) ----------
const timeDisplay = document.getElementById("time-display");
const statusMain = document.getElementById("status-main");
const statusSub = document.getElementById("status-sub");
const subtitle = document.getElementById("subtitle");
const footerNote = document.getElementById("footer-note");
const startBtn = document.getElementById("start-btn");
const resetBtn = document.getElementById("reset-btn");
const stopAlarmBtn = document.getElementById("stop-alarm-btn");
const modeCountdownBtn = document.getElementById("mode-countdown-btn");
const modeStopwatchBtn = document.getElementById("mode-stopwatch-btn");
const presetsSection = document.getElementById("presets-section");
const timeForm = document.getElementById("time-form");
const hoursInput = document.getElementById("input-hours");
const minutesInput = document.getElementById("input-minutes");
const secondsInput = document.getElementById("input-seconds");
const formError = document.getElementById("form-error");
const presetButtons = document.querySelectorAll(".preset-btn");

// ---------- State: everything the timer needs to remember ----------
let mode = "countdown";               // "countdown" | "stopwatch"
let status = "idle";                  // "idle" | "running" | "paused" | "finished"
let intervalId = null;                // the repeating tick, or null if stopped

// Countdown
let totalMs = DEFAULT_SECONDS * 1000; // the full length we reset back to
let remainingMs = totalMs;            // time left right now
let endTime = 0;                      // the exact moment the countdown finishes

// Stopwatch
let elapsedMs = 0;                    // time counted so far
let startTime = 0;                    // the moment the count started (shifted by pauses)

// Alarm
let audioContext = null;              // browser sound engine (created on first click)
let alarmIntervalId = null;           // repeating beep, or null if silent
let alarmTimeoutId = null;            // auto-stop timer for the alarm

// ---------- Helpers ----------

// Turn seconds into "HH:MM:SS". Example: 3725 -> "01:02:05"
function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function stopTicking() {
  clearInterval(intervalId);
  intervalId = null;
}

// Put the current total into the three input boxes so they always match.
function syncInputs(totalSeconds) {
  hoursInput.value = Math.floor(totalSeconds / 3600);
  minutesInput.value = Math.floor((totalSeconds % 3600) / 60);
  secondsInput.value = totalSeconds % 60;
}

// ---------- Drawing the screen ----------

// Shows the right parts of the page for the current mode.
function renderMode() {
  const isStopwatch = mode === "stopwatch";

  modeCountdownBtn.classList.toggle("is-active", !isStopwatch);
  modeStopwatchBtn.classList.toggle("is-active", isStopwatch);
  modeCountdownBtn.setAttribute("aria-pressed", String(!isStopwatch));
  modeStopwatchBtn.setAttribute("aria-pressed", String(isStopwatch));

  // Presets and the custom time form only make sense for a countdown.
  presetsSection.hidden = isStopwatch;
  timeForm.hidden = isStopwatch;

  subtitle.textContent = isStopwatch
    ? "Stopwatch - Dark mode only"
    : "Countdown - Dark mode only";
  footerNote.textContent = isStopwatch
    ? "Counts up every second"
    : "Counts down every second";
}

// Shows the time, status text and button labels for the current state.
function render() {
  if (mode === "stopwatch") {
    timeDisplay.textContent = formatTime(Math.floor(elapsedMs / 1000));
    statusSub.textContent = "Counting up";
  } else {
    // Math.ceil so the display shows 00:05:00 at the start and
    // reaches 00:00:00 exactly when the time is up.
    timeDisplay.textContent = formatTime(Math.ceil(remainingMs / 1000));
    statusSub.textContent = "Total: " + formatTime(totalMs / 1000);
  }

  if (status === "running") {
    statusMain.textContent = "Running";
    startBtn.textContent = "Pause";
  } else if (status === "paused") {
    statusMain.textContent = "Paused";
    startBtn.textContent = "Resume";
  } else if (status === "finished") {
    statusMain.textContent = "Time's up";
    startBtn.textContent = "Start again";
  } else {
    statusMain.textContent = "Ready";
    startBtn.textContent = "Start";
  }

  // "Stop alarm" is only visible while the alarm is sounding.
  stopAlarmBtn.hidden = alarmIntervalId === null;
}

// ---------- Alarm sound ----------
// Browsers only allow sound after the user has clicked something,
// so we create the sound engine when the user presses Start.
function unlockAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === "suspended") audioContext.resume();
  } catch (error) {
    audioContext = null; // no sound available; the timer still works
  }
}

// One short beep made with code, so no sound file is needed.
function playBeep() {
  if (!audioContext) return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.4);
  } catch (error) {
    // If one beep fails, ignore it and try again on the next one.
  }
}

function startAlarm() {
  stopAlarm();
  playBeep();
  alarmIntervalId = setInterval(playBeep, ALARM_BEEP_GAP_MS);
  alarmTimeoutId = setTimeout(function () {
    stopAlarm();
    render();
  }, ALARM_MAX_MS);
}

function stopAlarm() {
  clearInterval(alarmIntervalId);
  clearTimeout(alarmTimeoutId);
  alarmIntervalId = null;
  alarmTimeoutId = null;
}

// ---------- Timer actions ----------

// Runs every TICK_MS while the timer is running.
function tick() {
  // Work out the time from the clock, not by adding or subtracting 1 each tick.
  // This stays accurate even if the browser delays our timer.
  if (mode === "stopwatch") {
    elapsedMs = Date.now() - startTime;
    render();
    return;
  }

  remainingMs = Math.max(0, endTime - Date.now());
  if (remainingMs === 0) {
    finish();
    return;
  }
  render();
}

function start() {
  if (intervalId !== null) return; // already running, do nothing
  stopAlarm();

  if (mode === "stopwatch") {
    startTime = Date.now() - elapsedMs; // keeps the time already counted
  } else {
    unlockAudio();
    endTime = Date.now() + remainingMs;
  }

  intervalId = setInterval(tick, TICK_MS);
  status = "running";
  render();
}

function pause() {
  stopTicking();

  if (mode === "stopwatch") {
    elapsedMs = Date.now() - startTime;
    status = "paused";
    render();
    return;
  }

  remainingMs = Math.max(0, endTime - Date.now());
  if (remainingMs === 0) {
    finish();
    return;
  }
  status = "paused";
  render();
}

function finish() {
  stopTicking();
  remainingMs = 0;
  status = "finished";
  startAlarm();
  render();
}

function reset() {
  stopTicking();
  stopAlarm();
  remainingMs = totalMs;
  elapsedMs = 0;
  status = "idle";
  render();
}

// Replace the countdown length with a new one (used by the form and the presets).
function setDuration(totalSeconds) {
  stopTicking();
  stopAlarm();
  totalMs = totalSeconds * 1000;
  remainingMs = totalMs;
  status = "idle";
  syncInputs(totalSeconds);
  render();
}

// Switch between "countdown" and "stopwatch". This stops and resets the timer.
function setMode(newMode) {
  if (newMode === mode) return;
  stopTicking();
  stopAlarm();
  mode = newMode;
  status = "idle";
  remainingMs = totalMs; // the countdown remembers the length you chose
  elapsedMs = 0;
  formError.textContent = "";
  renderMode();
  render();
}

// ---------- Custom time form ----------

// Check one input box. Returns { value } if it is fine, or { error } if not.
function readField(input, label, max) {
  const raw = input.value.trim();
  if (raw === "") {
    return { error: label + " is empty. Enter 0 or more." };
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    return { error: label + " must be a whole number." };
  }
  if (value < 0 || value > max) {
    return { error: label + " must be between 0 and " + max + "." };
  }
  return { value: value };
}

function handleFormSubmit(event) {
  event.preventDefault(); // stop the browser from reloading the page

  const fields = [
    readField(hoursInput, "Hours", 99),
    readField(minutesInput, "Minutes", 59),
    readField(secondsInput, "Seconds", 59),
  ];

  const problem = fields.find((field) => field.error);
  if (problem) {
    formError.textContent = problem.error;
    return;
  }

  const totalSeconds =
    fields[0].value * 3600 + fields[1].value * 60 + fields[2].value;

  if (totalSeconds === 0) {
    formError.textContent = "Time must be more than 0 seconds.";
    return;
  }

  formError.textContent = "";
  setDuration(totalSeconds);
}

// ---------- Presets ----------
function handlePresetClick(event) {
  const seconds = Number(event.currentTarget.dataset.seconds);
  if (!Number.isInteger(seconds) || seconds <= 0) return;
  formError.textContent = "";
  setDuration(seconds);
}

// ---------- Button wiring ----------
function handleStartClick() {
  if (status === "running") {
    pause();
  } else if (status === "finished") {
    reset();
    start();
  } else {
    start(); // from "idle" or "paused"
  }
}

function handleStopAlarmClick() {
  stopAlarm();
  render();
}

startBtn.addEventListener("click", handleStartClick);
resetBtn.addEventListener("click", reset);
stopAlarmBtn.addEventListener("click", handleStopAlarmClick);
modeCountdownBtn.addEventListener("click", function () {
  setMode("countdown");
});
modeStopwatchBtn.addEventListener("click", function () {
  setMode("stopwatch");
});
timeForm.addEventListener("submit", handleFormSubmit);
presetButtons.forEach(function (button) {
  button.addEventListener("click", handlePresetClick);
});

// Show the starting state when the page loads.
syncInputs(DEFAULT_SECONDS);
renderMode();
render();