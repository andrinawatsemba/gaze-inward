// renderer.js
// Copyright (C) 2026 Presage Technologies, Inc.
//
// SPDX-License-Identifier: LicenseRef-Proprietary

'use strict';

const SESSION_CONFIG = {
    totalMs: 5 * 60 * 1000,
    readingMs: 35 * 1000,
    guideMs: 75 * 1000,
    firstGuidePaceMultiplier: 0.9,
    paceStep: 1,
    minPace: 6,
    maxPace: 20,
    inhaleFraction: 0.4,
    exhaleFraction: 0.6,
    fallbackPace: 12,
    simulatedRate: 16,
    simulatedJitter: 0.5,
};
const HISTORY_KEY = 'gaze-inward-session-history';
let simulationEnabled = false;
try {
    simulationEnabled = localStorage.getItem('gazeSim') === '1';
} catch (error) {
    console.error('Could not read the developer simulation switch:', error);
}

const {
    SmartSpectraSDK,
    ProcessingStatus,
    ValidationCode,
    breathingMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

const $ = (id) => document.getElementById(id);
const els = {
    statusBadge: $('status-badge'),
    simulationBanner: $('simulation-banner'),
    errorBanner: $('error-banner'),
    errorCode: $('error-code'),
    errorMessage: $('error-message'),
    validation: $('validation'),
    preview: $('preview'),
    previewReading: $('preview-reading'),
    countdown: $('countdown'),
    guideOrb: $('guide-orb'),
    guideWord: $('guide-word'),
    guideMessage: $('guide-message'),
    summaryList: $('summary-list'),
    selfReportButtons: document.querySelectorAll('[data-self-report]'),
    historyList: $('history-list'),
    btnClearHistory: $('btn-clear-history'),
    btnBeginCamera: $('btn-begin-camera'),
    btnPracticeCameraFree: $('btn-practice-camera-free'),
    btnStartReading: $('btn-start-reading'),
    btnStartCameraFree: $('btn-start-camera-free'),
    cameraFreePace: $('camera-free-pace'),
    cameraFreePaceValue: $('camera-free-pace-value'),
    btnPractice: $('btn-practice'),
    btnPracticeBack: $('btn-practice-back'),
    btnTryAgain: $('btn-try-again'),
    btnStartOver: $('btn-start-over'),
    result: $('result'),
    resultDetail: $('result-detail'),
    sections: {
        welcome: $('welcome'),
        setup: $('setup'),
        cameraFree: $('camera-free'),
        practice: $('practice'),
        reading: $('reading'),
        guide: $('guide'),
        result: $('result-section'),
    },
};

const STATUS_NAMES = Object.fromEntries(
    Object.entries(ProcessingStatus).map(([k, v]) => [v, k.replace(/^k/, '')]),
);
const VALIDATION_NAMES = Object.fromEntries(
    Object.entries(ValidationCode).map(([k, v]) => [v, k.replace(/^k/, '')]),
);

let sdk = null;
let activeStream = null;
let countdownTimer = null;
let guideTimer = null;
let guideAnimationFrame = null;
let guideStartedAt = 0;
let sessionStartedAt = null;
let readingStableRate = null;
let lastStableBreathing = null;
let currentPace = null;
let sessionMode = 'camera';
let simulatedReadingRate = SESSION_CONFIG.simulatedRate;
let sessionReadings = [];
let currentSession = null;
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function showSection(name) {
    for (const [sectionName, section] of Object.entries(els.sections)) {
        section.hidden = sectionName !== name;
    }
    document.body.classList.toggle('guide-active', name === 'guide');
}

function setSimulationBanner(visible) {
    els.simulationBanner.hidden = !visible;
}

function setValidation(code, hint) {
    const name = VALIDATION_NAMES[code] || `Code(${code})`;
    els.validation.textContent = hint || name;
    els.validation.className = 'hint ' + (
        code === ValidationCode.kOk ? 'hint-ok' :
        code === ValidationCode.kCameraTuning ? 'hint-warn' :
        'hint-err'
    );
}

function clearTimers() {
    if (countdownTimer !== null) clearInterval(countdownTimer);
    if (guideTimer !== null) clearTimeout(guideTimer);
    if (guideAnimationFrame !== null) cancelAnimationFrame(guideAnimationFrame);
    countdownTimer = null;
    guideTimer = null;
    guideAnimationFrame = null;
}

function stopCamera() {
    if (activeStream) {
        for (const track of activeStream.getTracks()) track.stop();
    }
    activeStream = null;
    els.preview.srcObject = null;
    els.previewReading.srcObject = null;
}

function readHistory() {
    try {
        const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(stored) ? stored : [];
    } catch (error) {
        console.error('Could not read local session history:', error);
        return [];
    }
}

function writeHistory(history) {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
        console.error('Could not save local session history:', error);
    }
}

function persistSession(session) {
    const history = readHistory();
    const existing = history.findIndex((entry) => entry.id === session.id);
    if (existing === -1) history.push(session);
    else history[existing] = session;
    writeHistory(history);
    renderHistory();
}

function sessionModeLabel(session) {
    return session.mode || 'camera';
}

function renderHistory() {
    const history = readHistory().slice(-5).reverse();
    els.historyList.replaceChildren();
    if (history.length === 0) {
        const empty = document.createElement('li');
        empty.textContent = 'No past sessions yet.';
        empty.className = 'history-empty';
        els.historyList.appendChild(empty);
        return;
    }
    for (const session of history) {
        const item = document.createElement('li');
        const readings = session.readings.map((reading) => (
            reading.rate == null
                ? `no steady reading / ${reading.pace} breaths/min`
                : `${Math.round(reading.rate)} breaths/min / ${reading.pace} breaths/min`
        ));
        item.textContent = `${new Date(session.date).toLocaleString()} — ${sessionModeLabel(session)} — ${readings.join(', ')}`;
        els.historyList.appendChild(item);
    }
}

function renderSummary() {
    els.summaryList.replaceChildren();
    for (const reading of sessionReadings) {
        const item = document.createElement('li');
        const rate = reading.rate == null
            ? 'no steady reading'
            : `about ${Math.round(reading.rate)} breaths per minute`;
        item.textContent = `${rate} — guide pace ${reading.pace} breaths per minute`;
        els.summaryList.appendChild(item);
    }
}

function saveSelfReport(report) {
    if (!currentSession) return;
    currentSession.selfReport = report;
    persistSession(currentSession);
    for (const button of els.selfReportButtons) {
        button.classList.toggle('selected', button.dataset.selfReport === report);
    }
}

function buildSdk() {
    const { API_KEY } = require('./config.local.js');
    if (API_KEY === 'YOUR_API_KEY_HERE') {
        console.warn('[sample] API_KEY is the placeholder value — configure your key before starting.');
    }
    sdk = new SmartSpectraSDK({
        apiKey: API_KEY,
        enableTelemetry: false,
        requestedMetrics: [...breathingMetrics],
        enableAccumulatedOutput: false,
    });

    sdk.on('processingStatus', (status) => {
        const label = STATUS_NAMES[status] || `Status(${status})`;
        els.statusBadge.textContent = label;
        els.statusBadge.className = `status status-${label.toLowerCase()}`;
    });

    sdk.on('validationStatus', (code, timestampUs, hint) => {
        console.log(`[sample] validationStatus ${VALIDATION_NAMES[code] || code} ts=${timestampUs} hint=${hint || '-'}`);
        setValidation(code, hint);
    });

    sdk.on('metrics', (buf, timestampUs) => {
        try {
            const metrics = decodeMetrics(buf);
            for (const reading of metrics.breathing?.rate || []) {
                if (reading.stable === true) {
                    readingStableRate = reading.value;
                    lastStableBreathing = reading.value;
                }
            }
        } catch (error) {
            console.error(`[sample] failed to decode Metrics (${buf.byteLength}B ts=${timestampUs}):`, error);
        }
    });

    sdk.on('error', (code, message, retryable) => {
        console.error(`[sample] error code=${code} retryable=${retryable}: ${message}`);
        els.errorBanner.hidden = false;
        els.errorCode.textContent = code;
        els.errorMessage.textContent = retryable ? `${message} (retryable)` : message;
    });

    sdk.on('streamAvailable', (stream) => {
        activeStream = stream;
        els.preview.srcObject = stream;
        els.previewReading.srcObject = stream;
        els.preview.play().catch(() => {});
        els.previewReading.play().catch(() => {});
    });
}

async function stopMeasurement() {
    if (sdk) {
        try {
            await sdk.stop();
        } catch (error) {
            console.error('stop() failed:', error);
        }
        try {
            sdk.destroy();
        } catch (error) {
            console.error('destroy() failed:', error);
        }
        sdk = null;
    }
    stopCamera();
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function roundToHalf(value) {
    return Math.round(value * 2) / 2;
}

function updatePace(rate) {
    if (rate == null) return;
    const target = clamp(
        rate * SESSION_CONFIG.firstGuidePaceMultiplier,
        SESSION_CONFIG.minPace,
        SESSION_CONFIG.maxPace,
    );
    if (currentPace === null) {
        currentPace = roundToHalf(target);
        return;
    }
    const difference = target - currentPace;
    currentPace = clamp(
        currentPace + clamp(difference, -SESSION_CONFIG.paceStep, SESSION_CONFIG.paceStep),
        SESSION_CONFIG.minPace,
        SESSION_CONFIG.maxPace,
    );
}

function sessionTimeRemaining() {
    return SESSION_CONFIG.totalMs - (performance.now() - sessionStartedAt);
}

function sessionIsOver() {
    return sessionTimeRemaining() <= 0;
}

function animateGuide(timestamp) {
    if (els.sections.guide.hidden) return;
    const cycleMs = 60 * 1000 / currentPace;
    const elapsed = timestamp - guideStartedAt;
    const cyclePosition = elapsed % cycleMs;
    const inhaleMs = cycleMs * SESSION_CONFIG.inhaleFraction;
    let scale;
    let brightness;
    if (cyclePosition < inhaleMs) {
        scale = 1 + 0.18 * (cyclePosition / inhaleMs);
        brightness = 1 + 0.08 * (cyclePosition / inhaleMs);
        els.guideWord.textContent = 'Breathe in';
    } else {
        scale = 1.18 - 0.18 * ((cyclePosition - inhaleMs) / (cycleMs * SESSION_CONFIG.exhaleFraction));
        brightness = 1.08 - 0.08 * ((cyclePosition - inhaleMs) / (cycleMs * SESSION_CONFIG.exhaleFraction));
        els.guideWord.textContent = 'Breathe out';
    }
    els.guideOrb.style.transform = reduceMotionQuery.matches ? 'scale(1)' : `scale(${scale})`;
    els.guideOrb.style.filter = `brightness(${reduceMotionQuery.matches ? brightness : 1})`;
    guideAnimationFrame = requestAnimationFrame(animateGuide);
}

function startGuide() {
    const remaining = sessionTimeRemaining();
    if (remaining <= 0) {
        showResult();
        return;
    }
    const guideDuration = Math.min(SESSION_CONFIG.guideMs, remaining);
    els.guideMessage.textContent = sessionMode === 'camera-free'
        ? 'Camera-free mode: the pace stays fixed.'
        : readingStableRate == null
            ? 'A steady reading was not available, so the pace is unchanged.'
            : 'Follow the orb at a slow, comfortable pace.';
    els.guideWord.textContent = 'Breathe in';
    showSection('guide');
    guideStartedAt = performance.now();
    guideAnimationFrame = requestAnimationFrame(animateGuide);
    guideTimer = setTimeout(() => {
        if (sessionIsOver()) showResult();
        else startReadingBurst();
    }, guideDuration);
}

function processReading(rate) {
    updatePace(rate);
    if (currentPace === null) currentPace = SESSION_CONFIG.fallbackPace;
    sessionReadings.push({
        rate: rate == null ? null : Number(rate),
        pace: currentPace,
    });
    if (sessionIsOver()) showResult();
    else startGuide();
}

async function finishReadingBurst() {
    clearTimers();
    await stopMeasurement();
    if (simulationEnabled) {
        simulatedReadingRate = SESSION_CONFIG.simulatedRate +
            (Math.random() * 2 - 1) * SESSION_CONFIG.simulatedJitter;
        lastStableBreathing = simulatedReadingRate;
    }
    processReading(simulationEnabled ? simulatedReadingRate : readingStableRate);
}

function startCountdown() {
    const startedAt = performance.now();
    const update = () => {
        const remaining = Math.max(0, SESSION_CONFIG.readingMs - (performance.now() - startedAt));
        els.countdown.textContent = `${Math.ceil(remaining / 1000)} seconds`;
    };
    update();
    countdownTimer = setInterval(update, 250);
    guideTimer = setTimeout(finishReadingBurst, SESSION_CONFIG.readingMs);
}

async function startMeasurement() {
    els.errorBanner.hidden = true;
    els.btnStartReading.disabled = true;
    readingStableRate = null;
    showSection('setup');
    try {
        if (!sdk) buildSdk();
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } },
            audio: false,
        });
        activeStream = stream;
        console.log('[gaze] camera settings:', stream.getVideoTracks()[0].getSettings());
        sdk.useMediaStream(stream);
        els.preview.srcObject = stream;
        els.preview.play().catch(() => {});
        await sdk.start();
        els.previewReading.srcObject = stream;
        els.previewReading.play().catch(() => {});
        showSection('reading');
        startCountdown();
    } catch (error) {
        els.errorBanner.hidden = false;
        els.errorCode.textContent = error.code ?? 'JS';
        els.errorMessage.textContent = error.message;
        await stopMeasurement();
        els.btnStartReading.disabled = false;
        showSection('setup');
    }
}

function startSimulatedReading() {
    readingStableRate = null;
    showSection('reading');
    startCountdown();
}

function startReadingBurst() {
    if (simulationEnabled) startSimulatedReading();
    else startMeasurement();
}

function startCameraSession() {
    sessionMode = 'camera';
    setSimulationBanner(simulationEnabled);
    sessionStartedAt = performance.now();
    currentPace = null;
    lastStableBreathing = null;
    sessionReadings = [];
    currentSession = null;
    startReadingBurst();
}

function startCameraFreeSession() {
    sessionMode = 'camera-free';
    setSimulationBanner(false);
    sessionStartedAt = performance.now();
    currentPace = Number(els.cameraFreePace.value);
    lastStableBreathing = null;
    sessionReadings = [{ rate: null, pace: currentPace }];
    currentSession = null;
    startGuide();
}

function showResult() {
    clearTimers();
    if (!currentSession) {
        currentSession = {
            id: `${Date.now()}-${Math.random()}`,
            date: new Date().toISOString(),
            readings: sessionReadings,
            paces: sessionReadings.map((reading) => reading.pace),
            selfReport: null,
            mode: sessionMode,
        };
        persistSession(currentSession);
    }
    if (sessionMode === 'camera-free') {
        els.result.textContent = `Pace used: ${currentPace} breaths per minute`;
    } else {
        els.result.textContent = lastStableBreathing == null
            ? "I couldn't get a steady reading this time."
            : `about ${Math.round(lastStableBreathing)} breaths per minute`;
    }
    renderSummary();
    els.resultDetail.textContent = 'These numbers are shown for interest only. They are not a score.';
    for (const button of els.selfReportButtons) {
        button.classList.toggle('selected', button.dataset.selfReport === currentSession.selfReport);
    }
    setSimulationBanner(false);
    showSection('result');
}

function resetFlow() {
    clearTimers();
    sessionStartedAt = null;
    readingStableRate = null;
    lastStableBreathing = null;
    currentPace = null;
    sessionReadings = [];
    currentSession = null;
    sessionMode = 'camera';
    setSimulationBanner(false);
    els.errorBanner.hidden = true;
    els.btnStartReading.disabled = false;
    showSection('welcome');
}

function showCameraSetup() {
    showSection('setup');
}

els.btnBeginCamera.addEventListener('click', showCameraSetup);
els.btnPracticeCameraFree.addEventListener('click', () => showSection('cameraFree'));
els.btnStartReading.addEventListener('click', startCameraSession);
els.btnStartCameraFree.addEventListener('click', startCameraFreeSession);
els.cameraFreePace.addEventListener('input', () => {
    els.cameraFreePaceValue.textContent = els.cameraFreePace.value;
});
els.btnPractice.addEventListener('click', () => showSection('practice'));
els.btnPracticeBack.addEventListener('click', () => showSection('welcome'));
els.btnTryAgain.addEventListener('click', () => {
    if (sessionMode === 'camera-free') showSection('cameraFree');
    else showCameraSetup();
});
els.btnStartOver.addEventListener('click', async () => {
    clearTimers();
    await stopMeasurement();
    resetFlow();
});
for (const button of els.selfReportButtons) {
    button.addEventListener('click', () => saveSelfReport(button.dataset.selfReport));
}
els.btnClearHistory.addEventListener('click', () => {
    try {
        localStorage.removeItem(HISTORY_KEY);
    } catch (error) {
        console.error('Could not clear local session history:', error);
    }
    renderHistory();
});

showSection('welcome');
renderHistory();

window.addEventListener('beforeunload', () => {
    clearTimers();
    stopCamera();
    if (sdk) {
        try { sdk.destroy(); } catch (error) { console.error('destroy() failed:', error); }
    }
});
