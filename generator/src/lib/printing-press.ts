import type { CardGridSize } from './card';

export type VersoLinkCard = {
  id: string;
  versoCardId?: string;
};

export type PrintPage = {
  rectoSlots: Array<string | undefined>;
  versoSlots: Array<string | undefined>;
};

export type PrintLayout = {
  gridSize: CardGridSize;
  rectoCardIds: string[];
  pages: PrintPage[];
};

export function linkVersoCards<T extends VersoLinkCard>(cards: T[], rectoId: string, versoId: string): T[] {
  if (rectoId === versoId) return cards;
  const rectoExists = cards.some((card) => card.id === rectoId);
  const versoExists = cards.some((card) => card.id === versoId);
  if (!rectoExists || !versoExists) return cards;

  const blockedIds = new Set([rectoId, versoId]);
  for (const card of cards) {
    if (card.id === rectoId || card.id === versoId) {
      if (card.versoCardId) blockedIds.add(card.versoCardId);
      continue;
    }
    if (card.versoCardId === rectoId || card.versoCardId === versoId) blockedIds.add(card.id);
  }

  return cards.map((card) => {
    if (card.id === rectoId) return { ...card, versoCardId: versoId };
    if (card.id === versoId) return { ...card, versoCardId: rectoId };
    if (blockedIds.has(card.id) || blockedIds.has(card.versoCardId ?? '')) {
      const { versoCardId: _removed, ...nextCard } = card;
      return nextCard as T;
    }
    return card;
  });
}

export function unlinkVersoCard<T extends VersoLinkCard>(cards: T[], cardId: string): T[] {
  const linkedId = cards.find((card) => card.id === cardId)?.versoCardId;
  if (!linkedId) return cards;

  return clearVersoLinks(cards, new Set([cardId, linkedId]));
}

export function removeCardAndVersoLinks<T extends VersoLinkCard>(cards: T[], cardId: string): T[] {
  return clearVersoLinks(
    cards.filter((card) => card.id !== cardId),
    new Set([cardId])
  );
}

export function normalizeVersoLinks<T extends VersoLinkCard>(cards: T[]): T[] {
  const cardIds = new Set(cards.map((card) => card.id));
  const normalizedCards = clearVersoLinks(
    cards,
    new Set(cards.filter((card) => card.versoCardId && !cardIds.has(card.versoCardId)).map((card) => card.id))
  );
  const cardById = new Map(normalizedCards.map((card) => [card.id, card]));

  return normalizedCards.map((card) => {
    const linked = card.versoCardId ? cardById.get(card.versoCardId) : undefined;
    if (!linked || linked.versoCardId === card.id) return card;
    const { versoCardId: _removed, ...nextCard } = card;
    return nextCard as T;
  });
}

export function buildPrintLayout<T extends VersoLinkCard>(
  cards: T[],
  rectoCardIds: string[],
  gridSize: CardGridSize
): PrintLayout {
  const slotsPerPage = gridSize * gridSize;
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const orderedRectoCardIds = orderRectoIdsForPrint(rectoCardIds, cardById);
  const pages: PrintPage[] = [];

  for (let start = 0; start < orderedRectoCardIds.length; start += slotsPerPage) {
    const rectoSlots: Array<string | undefined> = orderedRectoCardIds.slice(start, start + slotsPerPage);
    while (rectoSlots.length < slotsPerPage) rectoSlots.push(undefined);

    const versoSlots = Array<string | undefined>(slotsPerPage).fill(undefined);
    rectoSlots.forEach((cardId, index) => {
      if (!cardId) return;
      const versoCardId = cardById.get(cardId)?.versoCardId;
      const mirroredIndex = mirrorSlotIndex(index, gridSize);
      versoSlots[mirroredIndex] = versoCardId && cardById.has(versoCardId) ? versoCardId : undefined;
    });

    pages.push({ rectoSlots, versoSlots });
  }

  return {
    gridSize,
    rectoCardIds: orderedRectoCardIds,
    pages
  };
}

export function dedupeSelectedRectoIds<T extends VersoLinkCard>(cards: T[], selectedIds: string[]): string[] {
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const kept = new Set<string>();
  const skipped = new Set<string>();
  const result: string[] = [];

  for (const id of selectedIds) {
    if (kept.has(id) || skipped.has(id)) continue;
    const card = cardById.get(id);
    if (!card) continue;

    result.push(id);
    kept.add(id);
    if (card.versoCardId) skipped.add(card.versoCardId);
  }

  return result;
}

export function mirrorSlotIndex(index: number, gridSize: CardGridSize): number {
  const row = Math.floor(index / gridSize);
  const col = index % gridSize;
  return row * gridSize + (gridSize - 1 - col);
}

function clearVersoLinks<T extends VersoLinkCard>(cards: T[], blockedIds: Set<string>): T[] {
  return cards.map((card) => {
    if (!blockedIds.has(card.id) && !blockedIds.has(card.versoCardId ?? '')) return card;
    const { versoCardId: _removed, ...nextCard } = card;
    return nextCard as T;
  });
}

function orderRectoIdsForPrint<T extends VersoLinkCard>(ids: string[], cardById: Map<string, T>): string[] {
  const withVerso: string[] = [];
  const withoutVerso: string[] = [];

  for (const id of ids) {
    const versoCardId = cardById.get(id)?.versoCardId;
    if (versoCardId && cardById.has(versoCardId)) withVerso.push(id);
    else withoutVerso.push(id);
  }

  return [...withVerso, ...withoutVerso];
}
