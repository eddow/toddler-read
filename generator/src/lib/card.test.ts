import { describe, expect, it } from 'vitest';

import { buildQrPayload, markerForLanguage, toRenderableEntries } from './card';

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

  it('generates flag markers from language regions', () => {
    expect(markerForLanguage('en-US')).toEqual({ marker: '🇺🇸', markerKind: 'flag' });
    expect(markerForLanguage('pt-BR')).toEqual({ marker: '🇧🇷', markerKind: 'flag' });
  });

  it('uses default regions for known bare languages', () => {
    expect(markerForLanguage('ro')).toEqual({ marker: '🇷🇴', markerKind: 'flag' });
    expect(markerForLanguage('en')).toEqual({ marker: '🇬🇧', markerKind: 'flag' });
    expect(markerForLanguage('sv')).toEqual({ marker: '🇸🇪', markerKind: 'flag' });
  });

  it('uses script markers for languages without a useful default flag', () => {
    expect(markerForLanguage('ar')).toEqual({ marker: 'ض', markerKind: 'code' });
    expect(markerForLanguage('zh')).toEqual({ marker: '中', markerKind: 'code' });
    expect(markerForLanguage('hi')).toEqual({ marker: 'ह', markerKind: 'code' });
  });

  it('falls back to language codes for unknown languages', () => {
    expect(markerForLanguage('zz')).toEqual({ marker: 'ZZ', markerKind: 'code' });
  });

  it('auto-generates missing entry markers but preserves explicit overrides', () => {
    expect(toRenderableEntries([{ id: '1', lang: 'en-US', text: 'cow' }])[0]?.marker).toBe('🇺🇸');
    expect(toRenderableEntries([{ id: '1', lang: 'en-US', text: 'cow', marker: 'US' }])[0]?.markerKind).toBe('code');
    expect(toRenderableEntries([{ id: '1', lang: 'en-US', text: 'cow', marker: '' }])[0]?.marker).toBe('');
  });
});
