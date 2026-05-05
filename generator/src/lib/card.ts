import QRCode from 'qrcode';

export type LanguageEntry = {
  id: string;
  lang: string;
  text: string;
  marker?: string;
};

export type RenderableEntry = {
  lang: string;
  text: string;
  payload: string;
  marker: string;
  markerKind: 'flag' | 'code';
};

export type CardRenderInput = {
  imageDataUrl?: string;
  imageTransform?: ImageTransform;
  entries: LanguageEntry[];
  gridSize?: CardGridSize;
  reserveQrMargin?: boolean;
  showQrText?: boolean;
};

export type ImageTransform = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type LayoutRenderableCard = {
  id: string;
  imageDataUrl?: string;
  imageTransform?: ImageTransform;
  entries: LanguageEntry[];
};

export type LayoutPageRenderInput = {
  slots: Array<string | undefined>;
  cards: LayoutRenderableCard[];
  gridSize?: CardGridSize;
  reserveQrMargin?: boolean;
  showQrText?: boolean;
};

export type CardGridSize = 1 | 2 | 3 | 4;

const A4_WIDTH = 2480;
const A4_HEIGHT = 3508;
const SHEET_CUT_MARGIN = 12;
const imageCache = new Map<string, Promise<HTMLImageElement>>();

const FLAG_BY_LANGUAGE: Record<string, string> = {
  bg: '🇧🇬',
  de: '🇩🇪',
  el: '🇬🇷',
  en: '🇬🇧',
  es: '🇪🇸',
  fr: '🇫🇷',
  it: '🇮🇹',
  ja: '🇯🇵',
  nl: '🇳🇱',
  pl: '🇵🇱',
  pt: '🇵🇹',
  ro: '🇷🇴',
  ru: '🇷🇺',
  tr: '🇹🇷',
  uk: '🇺🇦'
};

const FLAG_BY_REGION: Record<string, string> = {
  br: '🇧🇷',
  ca: '🇨🇦',
  gb: '🇬🇧',
  ie: '🇮🇪',
  mx: '🇲🇽',
  pt: '🇵🇹',
  ro: '🇷🇴',
  us: '🇺🇸'
};

export const DEFAULT_CARD_GRID_SIZE: CardGridSize = 3;

export function toRenderableEntries(entries: LanguageEntry[]): RenderableEntry[] {
  return entries
    .map((entry) => ({
      lang: entry.lang.trim(),
      text: entry.text.trim(),
      marker: entry.marker?.trim()
    }))
    .filter((entry) => entry.lang.length > 0 && entry.text.length > 0)
    .slice(0, 4)
    .map((entry) => ({
      ...entry,
      payload: buildTtsPayload(entry.lang, entry.text),
      ...markerForEntry(entry.lang, entry.marker)
    }));
}

export function buildTtsPayload(lang: string, text: string): string {
  return `tts:${lang.trim()}:${text.trim()}`;
}

export function markerForLanguage(lang: string): Pick<RenderableEntry, 'marker' | 'markerKind'> {
  const normalized = lang.trim().toLowerCase();
  const parts = normalized.split('-').filter(Boolean);
  const region = parts.find((part) => part.length === 2 && FLAG_BY_REGION[part]);

  if (region) {
    return { marker: FLAG_BY_REGION[region], markerKind: 'flag' };
  }

  const language = parts[0];
  if (language && FLAG_BY_LANGUAGE[language]) {
    return { marker: FLAG_BY_LANGUAGE[language], markerKind: 'flag' };
  }

  return {
    marker: (language || normalized || '?').slice(0, 2).toUpperCase(),
    markerKind: 'code'
  };
}

function markerForEntry(lang: string, marker: string | undefined): Pick<RenderableEntry, 'marker' | 'markerKind'> {
  if (!marker) return markerForLanguage(lang);

  return {
    marker,
    markerKind: /^[A-Z0-9]{1,3}$/i.test(marker) ? 'code' : 'flag'
  };
}

export async function renderCardToCanvas(input: CardRenderInput, target: HTMLCanvasElement): Promise<void> {
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable.');

  const size = getCardSize(input.gridSize ?? DEFAULT_CARD_GRID_SIZE);
  if (target.width !== size.width) target.width = size.width;
  if (target.height !== size.height) target.height = size.height;

  const renderableEntries = toRenderableEntriesByPosition(input.entries);
  const image = input.imageDataUrl ? await loadImage(input.imageDataUrl) : null;

  drawCardBackground(ctx, size);
  drawImageArea(ctx, image, size, renderableEntries, Boolean(input.reserveQrMargin), Boolean(input.showQrText), input.imageTransform);
  await drawQrCorners(ctx, renderableEntries, size, Boolean(input.showQrText));
}

export async function renderLayoutPageToCanvas(input: LayoutPageRenderInput, target: HTMLCanvasElement): Promise<void> {
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable.');

  const gridSize = input.gridSize ?? DEFAULT_CARD_GRID_SIZE;
  const pageSize = getA4PageSize();
  const layout = getA4CutLayout(gridSize);
  const cardsById = new Map(input.cards.map((card) => [card.id, card]));
  const cardCanvas = document.createElement('canvas');

  target.width = pageSize.width;
  target.height = pageSize.height;
  ctx.clearRect(0, 0, pageSize.width, pageSize.height);
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, pageSize.width, pageSize.height);

  for (let index = 0; index < gridSize * gridSize; index += 1) {
    const cardId = input.slots[index];
    if (!cardId) continue;

    const card = cardsById.get(cardId);
    if (!card) continue;

    await renderCardToCanvas(
      {
        imageDataUrl: card.imageDataUrl,
        imageTransform: card.imageTransform,
        entries: card.entries,
        gridSize,
        reserveQrMargin: input.reserveQrMargin,
        showQrText: input.showQrText
      },
      cardCanvas
    );

    const row = Math.floor(index / gridSize);
    const col = index % gridSize;
    ctx.drawImage(
      cardCanvas,
      layout.margin + col * (layout.cardWidth + layout.gutter),
      layout.margin + row * (layout.cardHeight + layout.gutter),
      layout.cardWidth,
      layout.cardHeight
    );
  }
}

export function getCardSize(gridSize: CardGridSize) {
  return {
    width: Math.round(A4_WIDTH / gridSize),
    height: Math.round(A4_HEIGHT / gridSize)
  };
}

export function getA4PageSize() {
  return {
    width: A4_WIDTH,
    height: A4_HEIGHT
  };
}

export function getA4CutLayout(gridSize: CardGridSize) {
  const gutter = SHEET_CUT_MARGIN * 2;

  return {
    margin: SHEET_CUT_MARGIN,
    gutter,
    cardWidth: (A4_WIDTH - SHEET_CUT_MARGIN * 2 - gutter * (gridSize - 1)) / gridSize,
    cardHeight: (A4_HEIGHT - SHEET_CUT_MARGIN * 2 - gutter * (gridSize - 1)) / gridSize
  };
}

function toRenderableEntriesByPosition(entries: LanguageEntry[]): Array<RenderableEntry | undefined> {
  return entries.slice(0, 4).map((entry) => {
    const lang = entry.lang.trim();
    const text = entry.text.trim();
    const marker = entry.marker?.trim();

    if (!lang || !text) return undefined;

    return {
      lang,
      text,
      payload: buildTtsPayload(lang, text),
      ...markerForEntry(lang, marker)
    };
  });
}

function drawCardBackground(ctx: CanvasRenderingContext2D, size: ReturnType<typeof getCardSize>): void {
  const borderInset = Math.max(8, Math.round(size.width * 0.014));
  const lineWidth = Math.max(3, Math.round(size.width * 0.0045));

  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.strokeStyle = '#d8d0bf';
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(borderInset, borderInset, size.width - borderInset * 2, size.height - borderInset * 2);
}

function drawImageArea(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  size: ReturnType<typeof getCardSize>,
  entries: Array<RenderableEntry | undefined>,
  reserveQrMargin: boolean,
  showQrText: boolean,
  transform: ImageTransform | undefined
): void {
  const qrSize = getQrSize(size);
  const gap = getGap(size);
  const gutter = Math.max(18, Math.round(size.width * 0.055));
  const edgeInset = Math.max(8, Math.round(size.width * 0.014));
  const occupiedSides = getOccupiedSides(entries);
  const labelInset = showQrText ? getLabelBlockHeight(size) : 0;
  const reservedInset = gap + qrSize + gutter;
  const topInset = reserveQrMargin && occupiedSides.top ? reservedInset + labelInset : edgeInset;
  const rightInset = reserveQrMargin && occupiedSides.right ? reservedInset : edgeInset;
  const bottomInset = reserveQrMargin && occupiedSides.bottom ? reservedInset + labelInset : edgeInset;
  const leftInset = reserveQrMargin && occupiedSides.left ? reservedInset : edgeInset;
  const area = {
    x: leftInset,
    y: topInset,
    width: size.width - leftInset - rightInset,
    height: size.height - topInset - bottomInset
  };
  const radius = Math.max(10, Math.round(size.width * 0.016));

  ctx.fillStyle = '#f7f3e8';
  roundedRect(ctx, area.x, area.y, area.width, area.height, radius);
  ctx.fill();

  if (!image) return;

  const fit = transformedFit(image.width, image.height, area.width, area.height, transform);
  ctx.save();
  roundedRect(ctx, area.x, area.y, area.width, area.height, radius);
  ctx.clip();
  ctx.drawImage(image, area.x + fit.x, area.y + fit.y, fit.width, fit.height);
  ctx.restore();
}

function getOccupiedSides(entries: Array<RenderableEntry | undefined>) {
  return {
    top: Boolean(entries[0] || entries[1]),
    right: Boolean(entries[1] || entries[3]),
    bottom: Boolean(entries[2] || entries[3]),
    left: Boolean(entries[0] || entries[2])
  };
}

async function drawQrCorners(
  ctx: CanvasRenderingContext2D,
  entries: Array<RenderableEntry | undefined>,
  cardSize: ReturnType<typeof getCardSize>,
  showQrText: boolean
): Promise<void> {
  const size = getQrSize(cardSize);
  const gap = getGap(cardSize);
  const positions = [
    { x: gap, y: gap },
    { x: cardSize.width - size - gap, y: gap },
    { x: gap, y: cardSize.height - size - gap },
    { x: cardSize.width - size - gap, y: cardSize.height - size - gap }
  ];
  const qrPadding = Math.max(8, Math.round(cardSize.width * 0.01));
  const radius = Math.max(9, Math.round(cardSize.width * 0.014));
  const strokeWidth = Math.max(2, Math.round(cardSize.width * 0.0025));

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;

    const position = positions[index];
    const qr = document.createElement('canvas');

    await QRCode.toCanvas(qr, entry.payload, {
      errorCorrectionLevel: 'H',
      margin: 1,
      scale: 8,
      color: {
        dark: '#17211b',
        light: '#ffffff'
      }
    });

    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, position.x - qrPadding, position.y - qrPadding, size + qrPadding * 2, size + qrPadding * 2, radius);
    ctx.fill();
    ctx.strokeStyle = '#c9c1af';
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
    ctx.drawImage(qr, position.x, position.y, size, size);
    drawMarker(ctx, position.x + size / 2, position.y + size / 2, entry, size);
    if (showQrText) {
      drawQrText(ctx, entry, position.x + size / 2, index < 2 ? position.y + size + qrPadding : position.y - qrPadding, index, cardSize);
    }
  }
}

function drawQrText(
  ctx: CanvasRenderingContext2D,
  entry: RenderableEntry,
  centerX: number,
  anchorY: number,
  index: number,
  cardSize: ReturnType<typeof getCardSize>
): void {
  const fontSize = Math.max(12, Math.round(cardSize.width * 0.028));
  const lineHeight = Math.round(fontSize * 1.22);
  const paddingX = Math.max(6, Math.round(cardSize.width * 0.012));
  const paddingY = Math.max(4, Math.round(cardSize.width * 0.008));
  const maxWidth = getQrSize(cardSize) + paddingX * 4;
  const lines = fitTextLines(ctx, entry.text, maxWidth - paddingX * 2, fontSize, 2);
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const boxWidth = Math.min(
    maxWidth,
    Math.max(...lines.map((line) => ctx.measureText(line).width), 0) + paddingX * 2
  );
  const y = index < 2 ? anchorY + paddingY : anchorY - boxHeight - paddingY;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  roundedRect(ctx, centerX - boxWidth / 2, y, boxWidth, boxHeight, Math.max(5, Math.round(cardSize.width * 0.008)));
  ctx.fill();
  ctx.strokeStyle = '#d8d0bf';
  ctx.lineWidth = Math.max(1, Math.round(cardSize.width * 0.0015));
  ctx.stroke();

  ctx.fillStyle = '#17211b';
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, lineIndex) => {
    ctx.fillText(line, centerX, y + paddingY + lineHeight * lineIndex + lineHeight / 2);
  });
}

function fitTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number
): string[] {
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === 0) lines.push(text.trim());

  const lastIndex = Math.min(lines.length, maxLines) - 1;
  lines.length = Math.min(lines.length, maxLines);
  lines[lastIndex] = ellipsizeText(ctx, lines[lastIndex], maxWidth);

  return lines;
}

function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1).trimEnd();
  }
  return `${next}...`;
}

function getLabelBlockHeight(size: ReturnType<typeof getCardSize>): number {
  const fontSize = Math.max(12, Math.round(size.width * 0.028));
  const lineHeight = Math.round(fontSize * 1.22);
  const paddingY = Math.max(4, Math.round(size.width * 0.008));
  return lineHeight * 2 + paddingY * 4;
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  entry: RenderableEntry,
  qrSize: number
): void {
  const markerSize = Math.round(qrSize * 0.24);

  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, centerX - markerSize / 2, centerY - markerSize / 2, markerSize, markerSize, markerSize * 0.2);
  ctx.fill();
  ctx.strokeStyle = '#17211b';
  ctx.lineWidth = Math.max(2, Math.round(qrSize * 0.012));
  ctx.stroke();

  ctx.fillStyle = '#17211b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font =
    entry.markerKind === 'flag'
      ? `${Math.round(markerSize * 0.62)}px "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif`
      : `700 ${Math.round(markerSize * 0.44)}px system-ui, sans-serif`;
  ctx.fillText(entry.marker, centerX, centerY + (entry.markerKind === 'flag' ? 1 : 0));
}

function getQrSize(size: ReturnType<typeof getCardSize>): number {
  return Math.round(Math.min(size.width, size.height) * 0.22);
}

function getGap(size: ReturnType<typeof getCardSize>): number {
  return Math.round(size.width * 0.04);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function coverFit(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height
  };
}

function transformedFit(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  transform: ImageTransform | undefined
) {
  const fit = coverFit(sourceWidth, sourceHeight, targetWidth, targetHeight);
  const zoom = clampFinite(transform?.zoom, 0.5, 3, 1);
  const width = fit.width * zoom;
  const height = fit.height * zoom;
  const maxOffsetX = Math.max(0, (width - targetWidth) / 2);
  const maxOffsetY = Math.max(0, (height - targetHeight) / 2);
  const offsetX = clampFinite(transform?.offsetX, -1, 1, 0) * maxOffsetX;
  const offsetY = clampFinite(transform?.offsetY, -1, 1, 0) * maxOffsetY;

  return {
    x: (targetWidth - width) / 2 + offsetX,
    y: (targetHeight - height) / 2 + offsetY,
    width,
    height
  };
}

function clampFinite(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image.'));
    image.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}
