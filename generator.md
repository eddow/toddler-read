# Toddler Read Generator

The generator is a Svelte/Vite app in `generator/`. It creates printable QR
cards for the Toddler Read client. Each card can contain an image plus up to
four language-specific QR codes placed in the corners.

## What It Generates

Each QR code contains a text-to-speech payload:

```text
tts:<language-code>:<text>
```

For example:

```text
tts:en:Hello
tts:ro:Buna ziua
```

The reader client scans those payloads and speaks the text using Android native
TTS or browser speech synthesis.

## Running Locally

Install dependencies:

```sh
npm --prefix generator install
```

Start the dev server:

```sh
npm --prefix generator run dev
```

Run Svelte checks:

```sh
npm --prefix generator run check
```

Build the generator:

```sh
npm --prefix generator run build
```

The generator `build` script first runs the root Android build, then runs Vite.
From the repo root, this equivalent combined command is also available:

```sh
npm run buld:all
```

## Android APK Link

The generator displays install options for the reader:

- `/reader/` for the iPhone/web PWA.
- `/tr.apk` for the Android APK, when available.

During development, `/tr.apk` is served from:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

During production build, `generator/vite.config.ts` copies the APK to:

```text
generator/dist/tr.apk
```

If the Android APK has not been built yet, the generator build fails with a
message telling you to run `npm run android:build`.

For Netlify/web builds, `TODDLER_READ_SKIP_APK=1` skips the APK copy but still
publishes the reader PWA to:

```text
generator/dist/reader/
```

During development, `/reader/` is served from the root `reader/` folder.

## Card Workflow

Use the generator to:

- Create new cards.
- Attach or paste an image for the card.
- Enter text for each configured language.
- Translate missing texts from selected source languages.
- Preview the printable PNG.
- Open the generated PNG in a new tab.
- Manage multiple cards in a table.
- Import and export the card library as JSON.

Cards are stored locally in the browser with IndexedDB under the
`toddler-read-generator` database. UI settings such as language setup, grid
size, view mode, translation options, and provider configuration are stored in
local storage.

## PDF Layout

The generator supports A-series PDF formats:

```text
A3, A4, A5, A6
```

The PDF layout size controls the printed card grid:

```text
1, 2, 3, 4
```

Portrait pages use an `N x N` grid. Landscape pages keep cards portrait-oriented
and use a `2N x N` grid. The default is `A5: 1x1 portrait`.

Options:

- `QR margin` reserves extra image space around QR corners.
- `QR text` prints a short text label near each QR code.
- Language flags/markers are shown over QR codes and can be customized in
  Settings.

## Languages

Language setup lives in Settings. Each configured corner has:

- `Corner`: the read-only QR corner assigned to that row.
- `Code`: the language code used in the generated `tts:` payload.
- `Flag`: the marker shown on the QR code.

The generator auto-picks common flag markers for language or region codes when
possible. Custom markers can be entered manually.

## Translation

Translation is optional. The generator supports:

- Gemini.
- OpenAI-compatible providers.
- Custom OpenAI-compatible endpoints.

Settings store the provider, API key, model, base URL when needed, and prompt
template locally in the browser.

In the editor, each language row has translation controls:

- Source: use this row's text as source context.
- Produce: generate text for this row.

The Translate button is enabled when there is an API key, model, at least one
source text, and at least one target language.

## Provider Credits

Optional provider APIs are called directly from the browser when configured:

- Translation:
  [![Gemini API](https://img.shields.io/badge/Gemini-API-4285F4?style=for-the-badge&logo=googlegemini&logoColor=white)](https://ai.google.dev/gemini-api)
  [![OpenAI API](https://img.shields.io/badge/OpenAI-API-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com)
  [![DeepSeek API](https://img.shields.io/badge/DeepSeek-API-4D6BFF?style=for-the-badge)](https://platform.deepseek.com)
  [![Z.AI API](https://img.shields.io/badge/Z.AI-API-111111?style=for-the-badge)](https://docs.z.ai)
  [![Groq API](https://img.shields.io/badge/Groq-API-F55036?style=for-the-badge&logo=groq&logoColor=white)](https://console.groq.com)
  and custom OpenAI-compatible endpoints.
- Image search:
  [![Pexels API](https://img.shields.io/badge/Pexels-API-05A081?style=for-the-badge&logo=pexels&logoColor=white)](https://www.pexels.com/api/)
  [![Flaticon API](https://img.shields.io/badge/Flaticon-API-0C9ED9?style=for-the-badge)](https://www.flaticon.com/api)
- Image generation:
  [![Leonardo.Ai API](https://img.shields.io/badge/Leonardo.Ai-API-111827?style=for-the-badge)](https://docs.leonardo.ai)
  [![Built with Pollinations.ai](https://img.shields.io/badge/Built%20with-Pollinations.ai-111111?style=for-the-badge)](https://pollinations.ai)

## Import And Export

Export downloads:

```text
toddler-read-cards.json
```

The JSON contains:

```json
{
  "version": 1,
  "cards": [
    {
      "imageDataUrl": "data:image/...",
      "texts": {
        "en": "Hello",
        "ro": "Buna ziua"
      }
    }
  ]
}
```

Import merges cards when possible:

- Exact duplicates are skipped.
- Cards with the same image and missing language texts are merged.
- Cards with the same image but conflicting text are imported separately.

## Build Outputs

After a successful generator build:

```text
generator/dist/index.html
generator/dist/assets/
generator/dist/reader/
generator/dist/tr.apk
```
