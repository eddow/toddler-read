# Toddler Audio Player

A single‑page, tap‑friendly audio player for 2‑3 year olds.

Allows you to transform a mini-smartphone to an QR-codes-audio-book reader.

## How to use

There are many minismartphone, for 40/60$, you can get:
- Soyes XS16
- Rainbuvvy XS15

My setup is:
- Android
- QR Scanner: Binary Eye: Settings > Automated actions > (add)
  - regex: .*
  - Action type: Open URL
  - URL template: link to index.html globally accessible
- Browser: Fully Kiosk

## Limitations
- `window.close()` may not work on all mobile browsers. If it fails, the page will come back to a blank page as a fallback.