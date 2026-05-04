# Toddler Read Client

This app turns QR codes into a very simple audio player for young children. The
client scans one QR code, stops scanning, plays or speaks the content, then
returns to the scanner when playback finishes or when Stop is pressed.

## Client Entry Points

- `reader/index.html` is the main scanner used by the Android/Capacitor app.
- `index.html` is a direct player that reads the content from the URL hash.

The direct player can be opened with URLs like:

```text
index.html#tts:en:Hello
index.html#https%3A%2F%2Fexample.com%2Fsound.mp3
```

## QR Code Payloads

Each QR code contains plain text. The client decides what to do from the
payload format.

### Text-to-Speech

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
- The language code is passed to the device/browser TTS engine as
  `SpeechSynthesisUtterance.lang`.
- The text after the second colon is spoken.
- Pressing Play while TTS is already speaking restarts it from the beginning.
- Pressing Stop cancels speech and returns to scanning.
- When speech ends, the app returns to scanning.

The current implementation uses the browser/device `speechSynthesis` API. It
does not use cloud TTS or API keys.

### Audio URL

Use a full URL:

```text
https://example.com/sounds/cow.mp3
```

Behavior:

- The client treats `http://` and `https://` payloads as audio URLs.
- The audio element loads and plays the URL.
- Pressing Play while audio is already playing restarts from the beginning.
- Pressing Stop stops playback and returns to scanning.
- When audio ends, the app returns to scanning.

### Data URI Audio

Use a data URI:

```text
data:audio/mpeg;base64,...
```

Behavior:

- The client treats `data:` payloads as directly embedded audio.
- Playback behavior is the same as for audio URLs.

### Raw Base64 Audio

If a payload is long base64-looking text, the client tries to play it as MP3:

```text
<base64 mp3 bytes>
```

Behavior:

- The client checks that the payload only contains base64 characters and is
  longer than 100 characters.
- It wraps the payload as `data:audio/mpeg;base64,<payload>`.
- Playback behavior is the same as for audio URLs.

### Other Text

Any other payload is treated as a possible audio path or relative URL.

Example:

```text
sounds/cow.mp3
```

## Playback Controls

The player has toddler-sized Play and Stop controls.

- Play restarts the current audio or TTS from the beginning.
- Stop cancels the current audio or TTS and returns to scanning.
- For the scanner flow, finishing audio or TTS also returns to scanning.

## TTS Notes

Language codes should be normal BCP 47-style tags, such as `en`, `fr`, `ro`,
`de`, `en-US`, or `fr-FR`.

Actual voice choice depends on the Android/WebView/browser speech engine and
installed voices. If the requested language is unavailable, the system may use a
fallback voice.
