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
text-to-speech. It returns to the scanner after playback finishes or when Stop
is pressed.

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

## Notes

- Camera access requires HTTPS or localhost in regular browsers.
- Android text-to-speech uses the device TTS engine through Capacitor, with
  browser speech synthesis as a fallback outside Android.
- The root script is currently named `buld:all` to match the requested command.
