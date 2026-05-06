import { createCardId, type StoredCard } from './cards-db';
import type { ImageTransform } from './card';

export type ImportCardInput = Omit<StoredCard, 'id'> & { id?: string };

export type ImportPlan = {
  cardsToAdd: StoredCard[];
  cardsToMerge: StoredCard[];
  importIdMap: Map<string, string>;
  versoLinks: Array<{ sourceId: string; targetId: string }>;
  skippedCount: number;
  conflictSeparateCount: number;
};

export type CardsExportPayload = {
  version: 1;
  cards: Array<{
    id: string;
    imageDataUrl?: string;
    imageTransform?: ImageTransform;
    texts: Record<string, string>;
    tags?: string[];
    versoCardId?: string;
  }>;
};

type PlanCardImportOptions = {
  createId?: () => string;
};

export function createCardsExportPayload(
  cards: StoredCard[],
  options: { includeImages: boolean }
): CardsExportPayload {
  return {
    version: 1,
    cards: cards.map((card) => ({
      id: card.id,
      ...(options.includeImages
        ? {
            imageDataUrl: card.imageDataUrl,
            imageTransform: card.imageTransform
          }
        : {}),
      texts: card.texts,
      tags: normalizeTags(card.tags),
      versoCardId: card.versoCardId
    }))
  };
}

export async function compressCardsExportPayload(payload: CardsExportPayload): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('Compressed export is not supported by this browser.');
  }

  const input = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const compressed = input.stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(compressed).blob();
  return new Blob([blob], { type: 'application/gzip' });
}

export async function readCardsImportPayload(file: File): Promise<unknown> {
  const text = (await isGzipFile(file)) ? await readGzipFileText(file) : await file.text();
  return JSON.parse(text);
}

export function parseImportCards(payload: unknown): ImportCardInput[] {
  if (!payload || typeof payload !== 'object') return [];
  const cardsPayload = (payload as { cards?: unknown }).cards;
  if (!Array.isArray(cardsPayload)) return [];

  return cardsPayload
    .map((card): ImportCardInput | undefined => {
      if (!card || typeof card !== 'object') return undefined;
      const candidate = card as Partial<StoredCard>;
      const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : undefined;
      const texts = normalizeImportTexts(candidate.texts);
      const imageDataUrl =
        normalizeCardImage(candidate.imageDataUrl).length > 0 ? normalizeCardImage(candidate.imageDataUrl) : undefined;
      const imageTransform = imageDataUrl ? normalizeImageTransformForImport(candidate.imageTransform) : undefined;
      const versoCardId =
        typeof candidate.versoCardId === 'string' && candidate.versoCardId.trim()
          ? candidate.versoCardId.trim()
          : undefined;
      const tags = normalizeTags(candidate.tags);
      if (!imageDataUrl && Object.keys(texts).length === 0) return undefined;
      return { id, imageDataUrl, imageTransform, texts, tags, versoCardId };
    })
    .filter((card): card is ImportCardInput => Boolean(card));
}

export function planCardImport(
  existingCards: StoredCard[],
  importCards: ImportCardInput[],
  options: PlanCardImportOptions = {}
): ImportPlan {
  const existingCardIds = new Set(existingCards.map((card) => card.id));
  const workingCards = existingCards.map((card) => normalizeStoredCardForImport(card));
  const cardsToAdd: StoredCard[] = [];
  const cardsToMerge = new Map<string, StoredCard>();
  const importIdMap = new Map<string, string>();
  const versoLinks: Array<{ sourceId: string; targetId: string }> = [];
  const nextId = options.createId ?? createCardId;
  let skippedCount = 0;
  let conflictSeparateCount = 0;

  for (const importCard of importCards) {
    const normalizedImportCard = normalizeImportCardInput(importCard);
    if (normalizedImportCard.id && normalizedImportCard.versoCardId) {
      versoLinks.push({
        sourceId: normalizedImportCard.id,
        targetId: normalizedImportCard.versoCardId
      });
    }

    const matchedCard = findMergeCandidate(workingCards, normalizedImportCard);

    if (!matchedCard) {
      const cardToAdd = {
        ...withoutVersoLink(normalizedImportCard),
        id: reusableImportCardId(normalizedImportCard.id, workingCards, nextId)
      };
      if (normalizedImportCard.id) importIdMap.set(normalizedImportCard.id, cardToAdd.id);
      cardsToAdd.push(cardToAdd);
      workingCards.push(cardToAdd);
      continue;
    }

    if (normalizedImportCard.id) importIdMap.set(normalizedImportCard.id, matchedCard.id);

    if (hasMergeConflict(matchedCard, normalizedImportCard)) {
      const cardToAdd = {
        ...withoutVersoLink(normalizedImportCard),
        id: reusableImportCardId(normalizedImportCard.id, workingCards, nextId)
      };
      if (normalizedImportCard.id) importIdMap.set(normalizedImportCard.id, cardToAdd.id);
      cardsToAdd.push(cardToAdd);
      workingCards.push(cardToAdd);
      conflictSeparateCount += 1;
      continue;
    }

    const mergedCard = mergeImportCard(matchedCard, normalizedImportCard);
    if (cardsEqual(matchedCard, mergedCard)) {
      skippedCount += 1;
      continue;
    }

    const workingIndex = workingCards.findIndex((card) => card.id === matchedCard.id);
    if (workingIndex >= 0) workingCards[workingIndex] = mergedCard;
    if (existingCardIds.has(mergedCard.id)) {
      cardsToMerge.set(mergedCard.id, mergedCard);
    } else {
      const addIndex = cardsToAdd.findIndex((card) => card.id === mergedCard.id);
      if (addIndex >= 0) cardsToAdd[addIndex] = mergedCard;
    }
  }

  return {
    cardsToAdd,
    cardsToMerge: [...cardsToMerge.values()],
    importIdMap,
    versoLinks,
    skippedCount,
    conflictSeparateCount
  };
}

export function normalizeCardImage(imageDataUrl: unknown): string {
  return typeof imageDataUrl === 'string' ? imageDataUrl.trim() : '';
}

export function normalizeTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;

  const normalized = [...new Set(tags.map(normalizeTag).filter((tag) => tag.length > 0))].sort((left, right) =>
    left.localeCompare(right)
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function findMergeCandidate(cards: StoredCard[], importCard: ImportCardInput): StoredCard | undefined {
  if (importCard.id) {
    const sameIdCard = cards.find((card) => card.id === importCard.id);
    if (sameIdCard) return sameIdCard;
  }

  return cards.find((card) => hasCompatibleTexts(card, importCard));
}

function hasCompatibleTexts(card: StoredCard, importCard: ImportCardInput): boolean {
  const importedEntries = Object.entries(importCard.texts);
  const hasIdenticalText = importedEntries.some(([language, text]) => card.texts[language] === text);
  if (!hasIdenticalText) return false;

  return importedEntries.every(([language, text]) => card.texts[language] === undefined || card.texts[language] === text);
}

function hasMergeConflict(card: StoredCard, importCard: ImportCardInput): boolean {
  const localImage = normalizeCardImage(card.imageDataUrl);
  const importedImage = normalizeCardImage(importCard.imageDataUrl);
  if (localImage && importedImage && localImage !== importedImage) return true;

  return Object.entries(importCard.texts).some(
    ([language, text]) => card.texts[language] !== undefined && card.texts[language] !== text
  );
}

function mergeImportCard(card: StoredCard, importCard: ImportCardInput): StoredCard {
  const localImage = normalizeCardImage(card.imageDataUrl);
  const importedImage = normalizeCardImage(importCard.imageDataUrl);
  const nextImageDataUrl = localImage || importedImage || undefined;
  const nextImageTransform = nextImageDataUrl
    ? card.imageTransform ?? (localImage ? undefined : importCard.imageTransform)
    : undefined;

  return {
    ...card,
    imageDataUrl: nextImageDataUrl,
    imageTransform: nextImageTransform,
    texts: normalizeTextRecord({
      ...importCard.texts,
      ...card.texts
    }),
    tags: mergeTags(card.tags, importCard.tags)
  };
}

function cardsEqual(left: StoredCard, right: StoredCard): boolean {
  return JSON.stringify(normalizeStoredCardForImport(left)) === JSON.stringify(normalizeStoredCardForImport(right));
}

function withoutVersoLink(card: ImportCardInput): Omit<ImportCardInput, 'versoCardId'> {
  const { versoCardId: _removed, ...nextCard } = card;
  return nextCard;
}

function normalizeStoredCardForImport(card: StoredCard): StoredCard {
  const imageDataUrl = normalizeCardImage(card.imageDataUrl) || undefined;
  return {
    id: card.id,
    imageDataUrl,
    imageTransform: imageDataUrl ? normalizeImageTransformForImport(card.imageTransform) : undefined,
    texts: normalizeTextRecord(card.texts),
    tags: normalizeTags(card.tags),
    versoCardId: normalizeImportCardId(card.versoCardId)
  };
}

function normalizeImportCardInput(card: ImportCardInput): ImportCardInput {
  const imageDataUrl = normalizeCardImage(card.imageDataUrl) || undefined;
  return {
    id: normalizeImportCardId(card.id),
    imageDataUrl,
    imageTransform: imageDataUrl ? normalizeImageTransformForImport(card.imageTransform) : undefined,
    texts: normalizeTextRecord(card.texts),
    tags: normalizeTags(card.tags),
    versoCardId: normalizeImportCardId(card.versoCardId)
  };
}

function normalizeImportCardId(id: unknown): string | undefined {
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

function reusableImportCardId(id: string | undefined, existingCards: StoredCard[], createId: () => string): string {
  return id && !existingCards.some((card) => card.id === id) ? id : createId();
}

function normalizeImageTransformForImport(transform: unknown): ImageTransform | undefined {
  if (!transform || typeof transform !== 'object') return undefined;
  const candidate = transform as Partial<ImageTransform>;
  const zoom = clampFinite(candidate.zoom, 0.5, 3, 1);
  const offsetX = clampFinite(candidate.offsetX, -1, 1, 0);
  const offsetY = clampFinite(candidate.offsetY, -1, 1, 0);
  if (zoom === 1 && offsetX === 0 && offsetY === 0) return undefined;

  return { zoom, offsetX, offsetY };
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeTextRecord(texts: unknown): Record<string, string> {
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return {};

  return Object.fromEntries(
    Object.entries(texts)
      .map(([language, text]) => [language.trim(), typeof text === 'string' ? text.trim() : ''])
      .filter(([language, text]) => language.length > 0 && text.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeImportTexts(texts: unknown): Record<string, string> {
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return {};

  return Object.fromEntries(
    Object.entries(texts)
      .map(([language, text]) => [language.trim(), typeof text === 'string' ? text.trim() : ''])
      .filter(([language, text]) => language.length > 0 && text.length > 0)
  );
}

export function normalizeTag(tag: unknown): string {
  return typeof tag === 'string' ? tag.trim() : '';
}

function mergeTags(left: unknown, right: unknown): string[] | undefined {
  return normalizeTags([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]);
}

async function isGzipFile(file: File): Promise<boolean> {
  if (/\.gz$/i.test(file.name)) return true;

  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return header[0] === 0x1f && header[1] === 0x8b;
}

async function readGzipFileText(file: File): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Compressed import is not supported by this browser.');
  }

  const decompressed = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressed).text();
}
