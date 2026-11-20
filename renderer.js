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
    demoRate: 16,
    demoJitter: 0.5,
};

const {
    SmartSpectraSDK,
    ProcessingStatus,
    ValidationCode,
    breathingMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { API_KEY } = require('./config.local.js');

if (API_KEY === 'YOUR_API_KEY_HERE') {
    console.warn('[sample] API_KEY is the placeholder value — configure your key before starting.');
}

const $ = (id) => document.getElementById(id);
const els = {
    statusBadge: $('status-badge'),
    demoBanner: $('demo-banner'),
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
    result: $('result'),
    resultDetail: $('result-detail'),
    btnBegin: $('btn-begin'),
    btnStartReading: $('btn-start-reading'),
    btnDemo: $('btn-demo'),
    btnTryAgain: $('btn-try-again'),
    btnStartOver: $('btn-start-over'),
    sections: {
        welcome: $('welcome'),
        setup: $('setup'),
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
let sessionStartedAt = null;
let readingStableRate = null;
let lastStableBreathing = null;
let currentPace = null;
let demoMode = false;
let demoReadingRate = SESSION_CONFIG.demoRate;

function showSection(name) {
    for (const [sectionName, section] of Object.entries(els.sections)) {
        section.hidden = sectionName !== name;
    }
}

function setDemoBanner(visible) {
    els.demoBanner.hidden = !visible;
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

function buildSdk() {
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
    const target = clamp(rate * SESSION_CONFIG.firstGuidePaceMultiplier, SESSION_CONFIG.minPace, SESSION_CONFIG.maxPace);
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
    if (cyclePosition < inhaleMs) {
        scale = 1 + 0.18 * (cyclePosition / inhaleMs);
        els.guideWord.textContent = 'Breathe in';
    } else {
        scale = 1.18 - 0.18 * ((cyclePosition - inhaleMs) / (cycleMs * SESSION_CONFIG.exhaleFraction));
        els.guideWord.textContent = 'Breathe out';
    }
    els.guideOrb.style.transform = `scale(${scale})`;
    guideAnimationFrame = requestAnimationFrame(animateGuide);
}

let guideStartedAt = 0;

function startGuide() {
    const remaining = sessionTimeRemaining();
    if (remaining <= 0) {
        showResult();
        return;
    }
    const guideDuration = Math.min(SESSION_CONFIG.guideMs, remaining);
    els.guideMessage.textContent = readingStableRate == null
        ? 'A steady reading was not available, so the pace is unchanged.'
        : 'Follow the orb at a slow, comfortable pace.';
    els.guideWord.textContent = 'Breathe in';
    showSection('guide');
    guideStartedAt = performance.now();
    guideAnimationFrame = requestAnimationFrame(animateGuide);
    guideTimer = setTimeout(() => {
        if (sessionIsOver()) {
            showResult();
        } else {
            startReadingBurst();
        }
    }, guideDuration);
}

function processReading(rate) {
    updatePace(rate);
    if (currentPace === null) currentPace = SESSION_CONFIG.fallbackPace;
    if (sessionIsOver()) {
        showResult();
    } else {
        startGuide();
    }
}

async function finishReadingBurst() {
    clearTimers();
    await stopMeasurement();
    if (demoMode) {
        demoReadingRate = SESSION_CONFIG.demoRate +
            (Math.random() * 2 - 1) * SESSION_CONFIG.demoJitter;
        lastStableBreathing = demoReadingRate;
    }
    processReading(demoMode ? demoReadingRate : readingStableRate);
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

function startDemoReading() {
    readingStableRate = null;
    showSection('reading');
    startCountdown();
}

function startDemoSession() {
    demoMode = true;
    demoReadingRate = SESSION_CONFIG.demoRate;
    setDemoBanner(true);
    sessionStartedAt = performance.now();
    currentPace = null;
    lastStableBreathing = null;
    startDemoReading();
}

function showResult() {
    clearTimers();
    els.result.textContent = lastStableBreathing == null
        ? "I couldn't get a steady reading this time."
        : `about ${Math.round(lastStableBreathing)} breaths per minute`;
    els.resultDetail.textContent = 'Wellness only. This is not a medical or diagnostic reading.';
    showSection('result');
}

function resetFlow() {
    clearTimers();
    sessionStartedAt = null;
    readingStableRate = null;
    lastStableBreathing = null;
    currentPace = null;
    demoMode = false;
    setDemoBanner(false);
    els.errorBanner.hidden = true;
    els.btnStartReading.disabled = false;
    showSection('welcome');
}

function beginSession(startReading) {
    sessionStartedAt = performance.now();
    currentPace = null;
    lastStableBreathing = null;
    startReading();
}

els.btnBegin.addEventListener('click', () => showSection('setup'));
els.btnStartReading.addEventListener('click', () => beginSession(startMeasurement));
els.btnDemo.addEventListener('click', () => beginSession(startDemoSession));
els.btnTryAgain.addEventListener('click', () => beginSession(demoMode ? startDemoSession : startMeasurement));
els.btnStartOver.addEventListener('click', async () => {
    clearTimers();
    await stopMeasurement();
    resetFlow();
});

showSection('welcome');

window.addEventListener('beforeunload', () => {
    clearTimers();
    stopCamera();
    if (sdk) {
        try { sdk.destroy(); } catch (error) { console.error('destroy() failed:', error); }
    }
});
