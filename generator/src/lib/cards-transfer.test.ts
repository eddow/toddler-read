import { describe, expect, it } from 'vitest';
import type { StoredCard } from './cards-db';
import {
  compressCardsExportPayload,
  createCardsExportPayload,
  parseImportCards,
  planCardImport,
  readCardsImportPayload
} from './cards-transfer';

const imageA = 'data:image/png;base64,aaaa';
const imageB = 'data:image/png;base64,bbbb';

describe('cards transfer exports', () => {
  it('creates an image-less JSON payload while preserving editable card data', () => {
    const payload = createCardsExportPayload(
      [
        {
          id: 'local-1',
          imageDataUrl: imageA,
          imageTransform: { zoom: 1.5, offsetX: 0.1, offsetY: -0.1 },
          texts: { en: 'Apple' },
          tags: ['fruit'],
          versoCardId: 'local-2'
        }
      ],
      { includeImages: false }
    );

    expect(payload).toEqual({
      version: 1,
      cards: [
        {
          id: 'local-1',
          texts: { en: 'Apple' },
          tags: ['fruit'],
          versoCardId: 'local-2'
        }
      ]
    });
    expect(payload.cards[0]).not.toHaveProperty('imageDataUrl');
    expect(payload.cards[0]).not.toHaveProperty('imageTransform');
  });
});

describe('cards transfer imports', () => {
  it('reads old plain full JSON exports', async () => {
    const file = new File(
      [JSON.stringify({ version: 1, cards: [{ id: 'import-1', imageDataUrl: imageA, texts: { en: 'Apple' } }] })],
      'toddler-read-cards.json',
      { type: 'application/json' }
    );

    const payload = await readCardsImportPayload(file);

    expect(parseImportCards(payload)).toEqual([{ id: 'import-1', imageDataUrl: imageA, texts: { en: 'Apple' } }]);
  });

  it('reads native gzip JSON exports', async () => {
    const payload = createCardsExportPayload([{ id: 'import-1', imageDataUrl: imageA, texts: { en: 'Apple' } }], {
      includeImages: true
    });
    const compressed = await compressCardsExportPayload(payload);
    const file = new File([compressed], 'toddler-read-cards.json.gz', { type: 'application/gzip' });

    expect(await readCardsImportPayload(file)).toEqual(payload);
  });
});

describe('cards transfer merge planning', () => {
  it('merges an image-less import into a local card with an image', () => {
    const plan = planCardImport(
      [card({ id: 'local-1', imageDataUrl: imageA, texts: { en: 'Apple' } })],
      [{ id: 'local-1', texts: { en: 'Apple', fr: 'Pomme' } }]
    );

    expect(plan.cardsToAdd).toEqual([]);
    expect(plan.cardsToMerge).toEqual([
      card({ id: 'local-1', imageDataUrl: imageA, texts: { en: 'Apple', fr: 'Pomme' } })
    ]);
    expect(plan.conflictSeparateCount).toBe(0);
  });

  it('fills a missing local image from an imported card', () => {
    const plan = planCardImport(
      [card({ id: 'local-1', texts: { en: 'Apple' } })],
      [{ id: 'local-1', imageDataUrl: imageA, imageTransform: { zoom: 1.2, offsetX: 0, offsetY: 0 }, texts: { en: 'Apple' } }]
    );

    expect(plan.cardsToAdd).toEqual([]);
    expect(plan.cardsToMerge).toEqual([
      card({
        id: 'local-1',
        imageDataUrl: imageA,
        imageTransform: { zoom: 1.2, offsetX: 0, offsetY: 0 },
        texts: { en: 'Apple' }
      })
    ]);
  });

  it('keeps conflicting language text as a separate card', () => {
    const plan = planCardImport(
      [card({ id: 'local-1', texts: { en: 'Apple' } })],
      [{ id: 'local-1', texts: { en: 'Pear' } }],
      { createId: () => 'generated-1' }
    );

    expect(plan.cardsToMerge).toEqual([]);
    expect(plan.cardsToAdd).toEqual([card({ id: 'generated-1', texts: { en: 'Pear' } })]);
    expect(plan.conflictSeparateCount).toBe(1);
  });

  it('keeps conflicting images as a separate card when both sides have image data', () => {
    const plan = planCardImport(
      [card({ id: 'local-1', imageDataUrl: imageA, texts: { en: 'Apple' } })],
      [{ id: 'local-1', imageDataUrl: imageB, texts: { en: 'Apple' } }],
      { createId: () => 'generated-1' }
    );

    expect(plan.cardsToMerge).toEqual([]);
    expect(plan.cardsToAdd).toEqual([card({ id: 'generated-1', imageDataUrl: imageB, texts: { en: 'Apple' } })]);
    expect(plan.conflictSeparateCount).toBe(1);
  });

  it('unions differing tags without creating a duplicate', () => {
    const plan = planCardImport(
      [card({ id: 'local-1', texts: { en: 'Apple' }, tags: ['fruit'] })],
      [{ id: 'local-1', texts: { en: 'Apple' }, tags: ['food'] }]
    );

    expect(plan.cardsToAdd).toEqual([]);
    expect(plan.cardsToMerge).toEqual([card({ id: 'local-1', texts: { en: 'Apple' }, tags: ['food', 'fruit'] })]);
  });

  it('merges different IDs when shared text is compatible', () => {
    const plan = planCardImport(
      [card({ id: 'local-1', texts: { en: 'Apple' } })],
      [{ id: 'import-1', texts: { en: 'Apple', fr: 'Pomme' } }]
    );

    expect(plan.cardsToAdd).toEqual([]);
    expect(plan.cardsToMerge).toEqual([card({ id: 'local-1', texts: { en: 'Apple', fr: 'Pomme' } })]);
    expect(plan.importIdMap.get('import-1')).toBe('local-1');
  });

  it('does not merge different IDs without shared matching text', () => {
    const plan = planCardImport(
      [card({ id: 'local-1', texts: { en: 'Apple' } })],
      [{ id: 'import-1', texts: { fr: 'Pomme' } }]
    );

    expect(plan.cardsToMerge).toEqual([]);
    expect(plan.cardsToAdd).toEqual([card({ id: 'import-1', texts: { fr: 'Pomme' } })]);
  });
});

function card(card: StoredCard): StoredCard {
  return card;
}
