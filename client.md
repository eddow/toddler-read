# Toddler Read Client

The client is the playback side of Toddler Read. It turns QR payloads into a
simple full-screen audio or text-to-speech experience, using very large controls
for young children.

## Entry Points

- `reader/index.html` is the QR scanner used by the Android/Capacitor app.
- `index.html` is a direct browser player that reads a payload from the URL
  hash.

Direct player examples:

```text
index.html#tts:en:Hello
index.html#tts:ro:Buna%20ziua
index.html#https%3A%2F%2Fexample.com%2Fsound.mp3
```

If the direct player has no hash, it tries to play `no.mp3`.

## Scanner Flow

`reader/index.html` starts on the camera scanner. It uses the browser
`BarcodeDetector` API when QR support is available, and falls back to `jsQR`
from `reader/jsQR.js`.

The flow is:

1. Start the environment-facing camera.
2. Poll for QR codes.
3. Stop scanning when a QR code is found.
4. Play audio or speak text from the QR payload.
5. Return to the scanner when playback ends or Stop is pressed.

Camera access requires HTTPS or localhost in a browser. In the packaged Android
app, Capacitor provides the app shell and permissions.

## QR Payloads

Each QR code contains plain text. The client chooses playback behavior from the
payload format.

## Text-To-Speech

Use this format:

```text
tts:<language-code>:<text>
```

Examples:

```text
tts:en:Hello
tts:fr:Bonjour
tts:ro:Buna ziua
tts:en-US:Hello there
```

Behavior:

- The client detects the `tts:` prefix.
- The language code is passed to Android native TTS in the Android app.
- In a regular browser, the language code is passed to
  `SpeechSynthesisUtterance.lang`.
- The text after the second colon is spoken.
- Play restarts the current utterance from the beginning.
- Stop cancels speech and returns to scanning.
- When speech ends, the scanner starts again.

Language codes should be normal BCP 47-style tags, such as `en`, `fr`, `ro`,
`de`, `en-US`, or `fr-FR`. Voice selection depends on the device or browser.

## Audio URL

Use a full URL:

```text
https://example.com/sounds/cow.mp3
```

Behavior:

- `http://` and `https://` payloads are treated as audio URLs.
- The audio element loads and plays the URL.
- Play restarts from the beginning.
- Stop cancels playback and returns to scanning.
- When audio ends, the scanner starts again.

## Data URI Audio

Use a data URI:

```text
data:audio/mpeg;base64,...
```

The client plays the embedded audio through the same audio element flow.

## Raw Base64 Audio

If the payload is long base64-looking text, the scanner wraps it as MP3 data:

```text
data:audio/mpeg;base64,<payload>
```

This is mainly a fallback for compact audio experiments. Large audio payloads
make QR codes dense and hard to scan, so hosted audio URLs or TTS payloads are
usually easier.

## Other Text

Any other payload is treated as a possible path or relative URL.

Example:

```text
sounds/cow.mp3
```

## Controls

The scanner reader starts with a single large pause-style button while playback
is active. Tapping it reveals Play and Stop.

- Play restarts the current audio or TTS.
- Stop cancels playback and returns to scanning.
- Playback end also returns to scanning.

The direct player shows Play and Stop immediately because it does not manage a
camera scanner.

## Dependencies

`reader/jsQR.js` is copied from the root `jsqr` dependency:

```sh
npm run reader:deps
```

`android:sync`, `android:build`, and related Android commands run this copy step
before syncing Capacitor.
