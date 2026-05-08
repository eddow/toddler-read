import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  buildImageGenerationPrompt,
  defaultImageSearchProviderConfigs,
  normalizeImageSearchFilters,
  normalizeStoredImageSearchProviderConfigs
} from './image-search';

describe('image provider configuration', () => {
  it('includes Pixabay, Unsplash, and OpenAI defaults', () => {
    expect(defaultImageSearchProviderConfigs()).toMatchObject({
      pixabay: { apiKey: '' },
      unsplash: { apiKey: '' },
      openai: { apiKey: '', model: DEFAULT_OPENAI_IMAGE_MODEL }
    });
  });

  it('normalizes stored OpenAI image model fallback', () => {
    expect(normalizeStoredImageSearchProviderConfigs({ openai: { apiKey: 'key' } }).openai).toEqual({
      apiKey: 'key',
      model: DEFAULT_OPENAI_IMAGE_MODEL,
      accessToken: undefined,
      accessTokenExpiresAt: undefined
    });
  });
});

describe('image search filters', () => {
  it('defaults filters to broad search values', () => {
    expect(normalizeImageSearchFilters(undefined)).toEqual({
      pixabayImageType: 'all',
      pixabayCategory: '',
      unsplashOrderBy: 'relevant'
    });
  });

  it('keeps valid Pixabay and Unsplash filters', () => {
    expect(
      normalizeImageSearchFilters({
        pixabayImageType: 'illustration',
        pixabayCategory: 'animals',
        unsplashOrderBy: 'latest'
      })
    ).toEqual({
      pixabayImageType: 'illustration',
      pixabayCategory: 'animals',
      unsplashOrderBy: 'latest'
    });
  });

  it('drops unsupported filter values', () => {
    expect(
      normalizeImageSearchFilters({
        pixabayImageType: 'gif',
        pixabayCategory: 'dinosaurs',
        unsplashOrderBy: 'popular'
      })
    ).toEqual({
      pixabayImageType: 'all',
      pixabayCategory: '',
      unsplashOrderBy: 'relevant'
    });
  });
});

describe('image generation prompts', () => {
  it('uses English text directly when available', () => {
    expect(
      buildImageGenerationPrompt('Subject: {{texts}}. Hint: {{query}}', 'soft colors', {
        textsByLanguage: {
          en: 'cat',
          fr: 'chat',
          ro: 'pisica'
        }
      })
    ).toBe('Subject: cat. Hint: soft colors');
  });

  it('formats non-English card texts as readable language phrases', () => {
    expect(
      buildImageGenerationPrompt('Subject: {{texts}}', '', {
        textsByLanguage: {
          fr: 'chat',
          ro: 'pisica'
        }
      })
    ).toBe('Subject: in French: "chat", in Romanian: "pisica"');
  });

  it('appends readable text when the template omits the texts placeholder', () => {
    expect(
      buildImageGenerationPrompt('Subject: {{query}}', 'dog card', {
        textsByLanguage: {
          en: 'dog'
        }
      })
    ).toBe(`Subject: dog card
Card texts. These language values are translations of the same concept:
dog`);
  });
});
