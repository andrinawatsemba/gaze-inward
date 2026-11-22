# Gaze Inward

A short open-eyes breathing meditation for students. The app reads your breathing rate with your camera using Presage's SmartSpectra SDK, then guides you with a soft circle paced close to your own breathing. Wellness only.

A demo video is embedded in the DEV post for the Presage SmartSpectra SDK Challenge.

## How it works
1. **Reading (about 35 seconds):** the camera and the SmartSpectra SDK measure your breathing rate. The app keeps the last reading the SDK marks as stable.
2. **Guide (about 75 seconds):** the camera and SDK switch off. A circle expands and shrinks at a pace set from your reading: about 10% slower than your own rate, moved by at most 1 breath per minute between check-ins, and kept between 6 and 20 breaths per minute.
3. **Repeat** for about 5 minutes, then see a summary and say how you feel. The summary shows numbers for interest only. It is not a score.

If a reading isn't steady, the app keeps the previous pace and says so. If there has been no reading yet, it starts at 12 breaths per minute.

There is also a **Camera-free mode**: you choose a pace and the circle follows it. It does not adapt to you, and it uses no camera and no SDK. A **How to practice** page explains open-eyes soft gaze and breath-following.

## Consent and data handling
- **Camera:** used only during the short readings, and only after you press "Begin with the camera". It is switched off after each reading.
- **Video:** this app does not record or store video or images.
- **What is stored:** after each session, a short summary (date, mode, breathing rates, paces, and your "how do you feel" answer) is saved on your computer only, in the app's local storage.
- **Sharing:** the app does not send this summary anywhere.
- **Retention and deletion:** summaries stay until you press "Clear history" on the welcome screen or delete the app's data.
- **SDK telemetry:** turned off (`enableTelemetry: false`).
- **Presage service:** according to Presage's documentation, breathing metrics are computed on your device, and the Presage service is used to check your API key and subscription. An internet connection is therefore required for the camera mode.
- **AI services:** none used. The SDK's optional insight feature is not used.

## Requirements
- A 64-bit Windows computer (developed and tested on Windows).
- Node.js 20 or newer (developed with Node 24).
- For the camera mode: a webcam, an internet connection, and a free Presage API key from https://physiology.presagetech.com/auth/register
- Camera-free mode needs no camera, key or internet connection.

## Setup
```
git clone https://github.com/andrinawatsemba/gaze-inward.git
cd gaze-inward
npm install
copy config.example.js config.local.js
```
Open `config.local.js` and replace `YOUR_API_KEY_HERE` with your key. This file is ignored by git, so your key stays private.

```
npm start
```
Run `npm start` from a normal terminal such as PowerShell, not VS Code's built-in terminal (it sets a variable that stops Electron from opening). The first install downloads a large native package (about 100 MB).

## Tested hardware and honest limits
- Developed and tested on a single laptop: an Intel Core i5-5300U (2 cores, 8 GB RAM) with its built-in webcam. It has not been tested on any other computer.
- On this laptop, continuous live SDK runs stall after roughly 35 to 60 seconds, so the app uses short 35-second readings with the camera off in between. A stronger computer may do better, but that is untested.
- On this laptop, four consecutive 30-second live readings ran cleanly in Presage's quickstart sample, which this app is built on. The app's own reading screen started the SDK and showed the camera preview, hint and countdown, and stopped in dim light with the SDK's frame-rate error (the camera must deliver at least 25 frames per second). On some later runs the SDK start timed out on this laptop. A full 5-minute camera session has not been verified end to end.
- Breathing readings need good, even light, a still seated person, and your face and upper chest in view. Dark or striped clothing, talking and movement make readings unreliable. The app asks the camera for 320x240 at 30 fps to keep the load low.

## Developer test switch
To test the adaptive loop without a camera, open View > Toggle Developer Tools, run `localStorage.setItem('gazeSim','1')` in the Console, and reload. A banner shows that the rate is simulated. Remove it with `localStorage.removeItem('gazeSim')`.

## Wellness only
Gaze Inward is for general wellness. It does not diagnose, treat or monitor any condition and gives no medical advice. SmartSpectra metrics are for general wellness and informational purposes only and have not been cleared by the FDA. If you feel dizzy or uncomfortable, breathe normally and stop.

## Credits
Built on Presage's [electron-quickstart sample](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart) and the SmartSpectra Node SDK. Presage's code and SDK are provided under [Presage's Terms of Service](https://physiology.presagetech.com/tos); no open-source licence is granted for them. Built with the help of GitHub Copilot.