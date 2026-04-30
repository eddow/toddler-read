# Toddler Audio Player

A single‑page, tap‑friendly audio player for 2‑3 year olds.

Allows you to transform a mini-smartphone to an QR-codes-audio-book reader.

## How to use

There are many mini smartphone, for ~50$, you can get:
- Soyes XS16
- Rainbuvvy XS15

My setup is:
- Android
- QR Scanner: Binary Eye: Settings > Automated actions > (add)
  - regex: `.*`
  - Action type: Open URL
  - URL template: `https://toddler-read.netlify.app#{RESULT}`
- Browser: Chrome (allows "quitting" by "going back")
  - If someone knows other browsers who have this *and* fullscreen (no url-bar) option, I'd be interested