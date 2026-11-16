# Infinite Slide

An endless first-person ride down a glowing slide. Static web page: no build step, no libraries.

## Files
- `index.html` — page, start screen, buttons
- `shader.js` — the slide visuals (WebGL2 fragment shader)
- `main.js` — tilt / touch / keyboard input, speed, full screen, wake lock
- `audio.js` — whoosh and generated music
- `manifest.webmanifest`, `icon-*.png` — home-screen app setup
- `a2hs/` — home-screen walkthrough pop-up (philfung/add-to-homescreen 4.6.0, MIT); shows on phones in a browser, up to 3 times, never in the home-screen app
- `reference/` — photos of the real slide

## Run on the Mac
```bash
python3 -m http.server 8765 --bind 127.0.0.1
```
Open http://127.0.0.1:8765/ — arrow keys or WASD steer, drag works too, `M` mutes.

## Test on iPhone / iPad (needs an https address)
1. Open the https link in Safari.
2. Share > Add to Home Screen, then open it from the new icon.
3. Hold the device sideways the way you want to ride and tap Start.
4. Tap Allow when asked for Motion & Orientation access.
5. Check: left/right tilt steers, forward dives and speeds up, back climbs and slows,
   blur grows with speed, the roof opens and closes, sound plays (ringer switch must be on).
6. If a direction is backwards: reload, tick "Flip steering" or "Flip forward / back" on the start screen.

## Controls
- Neutral is the angle you hold when you tap Start. The target button re-centers.
- Speed never drops below a slow crawl and tops out at a ceiling.

## Not tested yet
Tilt on a real iPhone or iPad, home-screen full screen, and frame rate on device.
