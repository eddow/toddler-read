# Toddler Read

Toddler Read is a QR-code audio reader for young children. It has two parts:

- A tiny reader client that scans QR codes and plays audio or speaks text.
- A Svelte QR card generator that creates printable cards for the reader.

The Android app packages the reader client with Capacitor. The generator also
publishes the reader as a PWA at `/reader/` and can expose the generated APK as
`tr.apk`, so a caregiver can open either install path from the generator page.

## Links

[![Open App](https://img.shields.io/badge/Open_App-toddler--read.netlify.app-00ad9f?style=for-the-badge&logo=netlify&logoColor=white)](https://toddler-read.netlify.app/)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/emedware)

## Repository Layout

```text
.
|-- reader/       # QR scanner client used by the Android app
|-- generator/    # Svelte card generator
|-- android/      # Capacitor Android project
|-- client.md     # Reader/client behavior and QR payload reference
`-- generator.md  # Generator workflow, storage, import/export, and builds
```

## Install

Install the root dependencies:

```sh
npm install
```

Install the generator dependencies:

```sh
npm --prefix generator install
```

## Common Commands

Build the Android debug APK:

```sh
npm run android:build
```

Build the APK first, then build the Svelte generator:

```sh
npm run buld:all
```

Run the generator locally:

```sh
npm --prefix generator run dev
```

Run Svelte checks for the generator:

```sh
npm --prefix generator run check
```

Open the Android project in Android Studio:

```sh
npm run android:open
```

Install the debug APK on a connected Android device:

```sh
npm run adb:install
```

## Android APK

The APK is built at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

To check that file from the root package:

```sh
npm run android:apk
```

When the generator is built, its Vite plugin copies that APK to:

```text
generator/dist/tr.apk
```

During generator development, `/tr.apk` is served from the latest Android debug
APK if it exists.

## Reader Client

The reader scans QR codes from the camera, then plays a QR payload as audio or
text-to-speech. It returns to the scanner after playback finishes unless the
manual controls are open; in that mode, only Stop returns to scanning.

The same reader source is published as a PWA:

```text
generator/dist/reader/
```

During generator development, `/reader/` is served directly from the root
`reader/` folder. On iPhone, open that URL in Safari and use Share, then Add to
Home Screen.

See [client.md](client.md) for supported QR payloads and reader behavior.

## QR Card Generator

The generator manages printable cards with an image and up to four corner QR
codes. Each QR code contains a `tts:<language>:<text>` payload for the reader.
Cards are stored locally in IndexedDB and can be imported/exported as JSON.

See [generator.md](generator.md) for the full workflow.

## Supported APIs

Toddler Read can optionally call third-party APIs directly from the browser for
translation, image search, and image generation. API keys stay in local browser
storage and are sent only to the selected provider when you use that feature.

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
  [![Pixabay API](https://img.shields.io/badge/Pixabay-API-2EC66D?style=for-the-badge&logo=pixabay&logoColor=white)](https://pixabay.com/api/docs/)
  [![Unsplash API](https://img.shields.io/badge/Unsplash-API-000000?style=for-the-badge&logo=unsplash&logoColor=white)](https://unsplash.com/documentation)
- Image generation:
  [![Leonardo.Ai API](https://img.shields.io/badge/Leonardo.Ai-API-111827?style=for-the-badge)](https://docs.leonardo.ai)
  [![Built with Pollinations.ai](https://img.shields.io/badge/Built%20with-Pollinations.ai-111111?style=for-the-badge)](https://pollinations.ai)
  [![OpenAI API](https://img.shields.io/badge/OpenAI-API-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/docs/guides/image-generation)

If you don't know, with 5€/$ in both deepseek and pollinations, you generate & translate hundreds of cards

## Notes

- Camera access requires HTTPS or localhost in regular browsers.
- Android text-to-speech uses the device TTS engine through Capacitor, with
  browser speech synthesis as a fallback outside Android.
- The root script is currently named `buld:all` to match the requested command.
