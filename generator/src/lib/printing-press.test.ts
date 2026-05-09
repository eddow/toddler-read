import { describe, expect, it } from 'vitest';
import {
  getPdfCanvasPageSize,
  getPdfCutLayout,
  getPdfGrid,
  type CardGridSize,
  type PdfLayoutConfig,
  type PdfPageFormat,
  type PdfPageOrientation
} from './card';
import {
  buildPrintLayout,
  dedupeSelectedRectoIds,
  hasPrintPageVerso,
  linkVersoCards,
  mirrorSlotIndex,
  normalizeVersoLinks,
  removeCardAndVersoLinks,
  unlinkVersoCard
} from './printing-press';
import type { VersoLinkCard } from './printing-press';

const cards = (ids: string[]): VersoLinkCard[] => ids.map((id) => ({ id }));
const pdfConfig = (
  pageFormat: PdfPageFormat = 'A5',
  pageOrientation: PdfPageOrientation = 'portrait',
  gridSize: CardGridSize = 1
): PdfLayoutConfig => ({ pageFormat, pageOrientation, gridSize });

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
  it.each([
    [pdfConfig('A5', 'portrait', 1), { columns: 1, rows: 1 }],
    [pdfConfig('A5', 'landscape', 1), { columns: 2, rows: 1 }],
    [pdfConfig('A4', 'portrait', 2), { columns: 2, rows: 2 }],
    [pdfConfig('A4', 'landscape', 2), { columns: 4, rows: 2 }]
  ] as const)('computes PDF grids from page orientation and size', (config, expected) => {
    expect(getPdfGrid(config)).toEqual(expected);
  });

  it.each([
    pdfConfig('A3', 'portrait', 1),
    pdfConfig('A4', 'portrait', 2),
    pdfConfig('A5', 'landscape', 3),
    pdfConfig('A6', 'landscape', 4)
  ] as const)('uses a gutter twice the outer cut margin for PDF sheets', (config) => {
    const pageSize = getPdfCanvasPageSize(config);
    const layout = getPdfCutLayout(config);
    const grid = getPdfGrid(config);

    expect(layout.gutter).toBe(layout.margin * 2);
    expect(sheetSpan(layout.cardWidth, layout.margin, layout.gutter, grid.columns)).toBeCloseTo(pageSize.width);
    expect(sheetSpan(layout.cardHeight, layout.margin, layout.gutter, grid.rows)).toBeCloseTo(pageSize.height);
  });

  it.each([
    [1, [0]],
    [2, [1, 0, 3, 2]],
    [3, [2, 1, 0, 5, 4, 3]],
    [4, [3, 2, 1, 0, 7, 6, 5, 4]]
  ] as const)('mirrors slots horizontally across %i columns', (columns, expected) => {
    expect(expected.map((_, index) => mirrorSlotIndex(index, columns))).toEqual(expected);
  });

  it('chunks selected recto cards into pages', () => {
    const layout = buildPrintLayout(cards(['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd', 'e'], pdfConfig('A4', 'portrait', 2));

    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0].rectoSlots).toEqual(['a', 'b', 'c', 'd']);
    expect(layout.pages[1].rectoSlots).toEqual(['e', undefined, undefined, undefined]);
  });

  it('chunks selected recto cards into landscape pages', () => {
    const layout = buildPrintLayout(
      cards(['a', 'b', 'c', 'd', 'e']),
      ['a', 'b', 'c', 'd', 'e'],
      pdfConfig('A4', 'landscape', 1)
    );

    expect(layout.pages).toHaveLength(3);
    expect(layout.pages[0].rectoSlots).toEqual(['a', 'b']);
    expect(layout.pages[2].rectoSlots).toEqual(['e', undefined]);
  });

  it('prints selected cards with verso links before cards without verso links', () => {
    const linked = linkVersoCards(linkVersoCards(cards(['a', 'b', 'c', 'd', 'e']), 'b', 'c'), 'd', 'e');
    const layout = buildPrintLayout(linked, ['a', 'b', 'd'], pdfConfig('A4', 'portrait', 2));

    expect(layout.rectoCardIds).toEqual(['b', 'd', 'a']);
    expect(layout.pages[0].rectoSlots).toEqual(['b', 'd', 'a', undefined]);
  });

  it('uses blank mirrored slots when verso links are missing', () => {
    const linked = linkVersoCards(cards(['a', 'b', 'c']), 'a', 'b');
    const layout = buildPrintLayout(linked, ['a', 'c'], pdfConfig('A4', 'portrait', 2));

    expect(layout.pages[0].versoSlots).toEqual([undefined, 'b', undefined, undefined]);
  });

  it('identifies pages without any verso slots', () => {
    const linked = linkVersoCards(cards(['a', 'b', 'c']), 'a', 'b');
    const withVerso = buildPrintLayout(linked, ['a', 'c'], pdfConfig('A4', 'portrait', 2));
    const withoutVerso = buildPrintLayout(cards(['a', 'b', 'c']), ['a', 'b', 'c'], pdfConfig('A4', 'portrait', 2));

    expect(hasPrintPageVerso(withVerso.pages[0])).toBe(true);
    expect(hasPrintPageVerso(withoutVerso.pages[0])).toBe(false);
  });

  it('mirrors landscape verso slots across the page width', () => {
    const linked = linkVersoCards(cards(['a', 'b', 'c']), 'a', 'b');
    const layout = buildPrintLayout(linked, ['a', 'c'], pdfConfig('A5', 'landscape', 1));

    expect(layout.pages[0].versoSlots).toEqual([undefined, 'b']);
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

function sheetSpan(cardSize: number, margin: number, gutter: number, gridSize: number): number {
  return margin * 2 + cardSize * gridSize + gutter * (gridSize - 1);
}
