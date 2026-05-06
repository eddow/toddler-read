import { describe, expect, it } from 'vitest';

import { buildQrPayload, toRenderableEntries } from './card';

describe('card QR payloads', () => {
  it('wraps normal text as TTS', () => {
    expect(buildQrPayload('en', 'cow')).toBe('tts:en:cow');
  });

  it('uses absolute URLs directly', () => {
    expect(buildQrPayload('en', 'https://example.com/cow.mp3')).toBe('https://example.com/cow.mp3');
    expect(buildQrPayload('en', 'http://example.com/cow.mp3')).toBe('http://example.com/cow.mp3');
  });

  it('uses data payloads directly', () => {
    expect(buildQrPayload('en', 'data:audio/mpeg;base64,abc123')).toBe('data:audio/mpeg;base64,abc123');
  });

  it('uses audio file paths directly', () => {
    expect(buildQrPayload('en', 'sounds/cow.mp3')).toBe('sounds/cow.mp3');
    expect(buildQrPayload('en', './sounds/cow.ogg?cache=1')).toBe('./sounds/cow.ogg?cache=1');
  });

  it('uses direct payloads in renderable entries', () => {
    expect(toRenderableEntries([{ id: '1', lang: 'en', text: 'https://example.com/cow.mp3' }])[0]?.payload).toBe(
      'https://example.com/cow.mp3'
    );
  });
});
