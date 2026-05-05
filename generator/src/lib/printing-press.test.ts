import { describe, expect, it } from 'vitest';
import { getA4CutLayout, getA4PageSize, type CardGridSize } from './card';
import {
  buildPrintLayout,
  dedupeSelectedRectoIds,
  linkVersoCards,
  mirrorSlotIndex,
  normalizeVersoLinks,
  removeCardAndVersoLinks,
  unlinkVersoCard
} from './printing-press';
import type { VersoLinkCard } from './printing-press';

const cards = (ids: string[]): VersoLinkCard[] => ids.map((id) => ({ id }));

describe('printing press links', () => {
  it('creates reversible one-to-one verso links', () => {
    const linked = linkVersoCards(cards(['a', 'b']), 'a', 'b');

    expect(linked.find((card) => card.id === 'a')?.versoCardId).toBe('b');
    expect(linked.find((card) => card.id === 'b')?.versoCardId).toBe('a');
  });

  it('replaces old links when a new link is made', () => {
    const first = linkVersoCards(cards(['a', 'b', 'c', 'd']), 'a', 'b');
    const second = linkVersoCards(linkVersoCards(first, 'c', 'd'), 'a', 'c');

    expect(second.find((card) => card.id === 'a')?.versoCardId).toBe('c');
    expect(second.find((card) => card.id === 'c')?.versoCardId).toBe('a');
    expect(second.find((card) => card.id === 'b')?.versoCardId).toBeUndefined();
    expect(second.find((card) => card.id === 'd')?.versoCardId).toBeUndefined();
  });

  it('rejects self-links', () => {
    const linked = linkVersoCards(cards(['a']), 'a', 'a');

    expect(linked[0].versoCardId).toBeUndefined();
  });

  it('unlinks both sides from either card', () => {
    const linked = linkVersoCards(cards(['a', 'b']), 'a', 'b');
    const unlinked = unlinkVersoCard(linked, 'b');

    expect(unlinked.find((card) => card.id === 'a')?.versoCardId).toBeUndefined();
    expect(unlinked.find((card) => card.id === 'b')?.versoCardId).toBeUndefined();
  });

  it('removes links that point to a deleted card', () => {
    const linked = linkVersoCards(cards(['a', 'b', 'c']), 'a', 'b');
    const remaining = removeCardAndVersoLinks(linked, 'b');

    expect(remaining.map((card) => card.id)).toEqual(['a', 'c']);
    expect(remaining.find((card) => card.id === 'a')?.versoCardId).toBeUndefined();
  });

  it('normalizes dangling and non-reciprocal verso links', () => {
    const normalized = normalizeVersoLinks([
      { id: 'a', versoCardId: 'b' },
      { id: 'b', versoCardId: 'a' },
      { id: 'c', versoCardId: 'missing' },
      { id: 'd', versoCardId: 'e' },
      { id: 'e' }
    ]);

    expect(normalized.find((card) => card.id === 'a')?.versoCardId).toBe('b');
    expect(normalized.find((card) => card.id === 'b')?.versoCardId).toBe('a');
    expect(normalized.find((card) => card.id === 'c')?.versoCardId).toBeUndefined();
    expect(normalized.find((card) => card.id === 'd')?.versoCardId).toBeUndefined();
  });
});

describe('printing press layout', () => {
  it.each([1, 2, 3, 4] as const)('uses a gutter twice the outer cut margin for %ix%i sheets', (gridSize) => {
    const pageSize = getA4PageSize();
    const layout = getA4CutLayout(gridSize);

    expect(layout.gutter).toBe(layout.margin * 2);
    expect(sheetSpan(layout.cardWidth, layout.margin, layout.gutter, gridSize)).toBeCloseTo(pageSize.width);
    expect(sheetSpan(layout.cardHeight, layout.margin, layout.gutter, gridSize)).toBeCloseTo(pageSize.height);
  });

  it.each([
    [1, [0]],
    [2, [1, 0, 3, 2]],
    [3, [2, 1, 0, 5, 4, 3, 8, 7, 6]],
    [4, [3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12]]
  ] as const)('mirrors %ix%i slots horizontally', (gridSize, expected) => {
    expect(expected.map((_, index) => mirrorSlotIndex(index, gridSize))).toEqual(expected);
  });

  it('chunks selected recto cards into pages', () => {
    const layout = buildPrintLayout(cards(['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd', 'e'], 2);

    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0].rectoSlots).toEqual(['a', 'b', 'c', 'd']);
    expect(layout.pages[1].rectoSlots).toEqual(['e', undefined, undefined, undefined]);
  });

  it('uses blank mirrored slots when verso links are missing', () => {
    const linked = linkVersoCards(cards(['a', 'b', 'c']), 'a', 'b');
    const layout = buildPrintLayout(linked, ['a', 'c'], 2);

    expect(layout.pages[0].versoSlots).toEqual([undefined, 'b', undefined, undefined]);
  });

  it('deduplicates selected linked pairs with first selected as recto', () => {
    const linked = linkVersoCards(cards(['a', 'b']), 'a', 'b');

    expect(dedupeSelectedRectoIds(linked, ['a', 'b'])).toEqual(['a']);
    expect(dedupeSelectedRectoIds(linked, ['b', 'a'])).toEqual(['b']);
  });

  it('keeps unrelated selected cards in first-selected order', () => {
    const linked = linkVersoCards(cards(['a', 'b', 'c', 'd']), 'a', 'b');

    expect(dedupeSelectedRectoIds(linked, ['c', 'a', 'd', 'b'])).toEqual(['c', 'a', 'd']);
  });
});

function sheetSpan(cardSize: number, margin: number, gutter: number, gridSize: CardGridSize): number {
  return margin * 2 + cardSize * gridSize + gutter * (gridSize - 1);
}
