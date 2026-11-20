# Gaze Inward: project rules

Electron app built on Presage's SmartSpectra electron-quickstart. A 5-minute breathing meditation for students, paced from the user's measured breathing rate. Wellness only.

## Hard rules
- Never hardcode or print the API key. It comes only from config.local.js (gitignored). Never create or edit config.local.js.
- Keep `enableTelemetry: false` in the SDK constructor.
- Request breathing metrics only. Do not request cardio, face, or any breathing metric the SDK does not offer.
- Keep the camera setup in startMeasurement(): getUserMedia at 320x240 and 30 fps, then sdk.useMediaStream(stream). Do not change the resolution or frame rate.
- Never let chart or data buffers grow without limit.
- Stop the camera tracks whenever a reading ends.
- No medical, diagnostic, relaxation-score or focus claims. Words like "your breathing rate" are fine. Say "wellness only" where results appear.
- Plain, calm, simple wording in the UI. No jargon.
- Keep changes small and tell me which files you edited. Do not add new dependencies without asking.

## Known limit
On the developer's laptop (2015 dual-core) a continuous live run stalls after about 40 seconds. The app therefore uses short measuring bursts (about 35 s) with the camera off in between.