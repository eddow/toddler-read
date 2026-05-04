export type StoredCard = {
  id: string;
  imageDataUrl?: string;
  texts: Record<string, string>;
  versoCardId?: string;
};

const DB_NAME = 'toddler-read-generator';
const DB_VERSION = 1;
const CARD_STORE = 'cards';

let dbPromise: Promise<IDBDatabase> | undefined;

export function createCardId(): string {
  return `card-${Date.now()}-${createRandomIdPart()}`;
}

function createRandomIdPart(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    return [...values].map((value) => value.toString(36)).join('-');
  }

  return `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function getAllCards(): Promise<StoredCard[]> {
  const db = await openCardsDb();

  return new Promise((resolve, reject) => {
    const request = db.transaction(CARD_STORE, 'readonly').objectStore(CARD_STORE).getAll();
    request.onsuccess = () => resolve(normalizeCards(request.result));
    request.onerror = () => reject(request.error ?? new Error('Could not load cards.'));
  });
}

export async function putCard(card: StoredCard): Promise<void> {
  const db = await openCardsDb();
  const normalized = normalizeCard(card);

  return new Promise((resolve, reject) => {
    const request = db.transaction(CARD_STORE, 'readwrite').objectStore(CARD_STORE).put(normalized);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not save card.'));
  });
}

export async function addCards(cards: Array<Omit<StoredCard, 'id'> & { id?: string }>): Promise<StoredCard[]> {
  const db = await openCardsDb();
  const nextCards = cards.map((card) =>
    normalizeCard({
      id: card.id || createCardId(),
      imageDataUrl: card.imageDataUrl,
      texts: card.texts,
      versoCardId: card.versoCardId
    })
  );

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(CARD_STORE, 'readwrite');
    const store = transaction.objectStore(CARD_STORE);
    for (const card of nextCards) {
      store.add(card);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not import cards.'));
  });

  return nextCards;
}

export async function deleteCard(id: string): Promise<void> {
  const db = await openCardsDb();

  return new Promise((resolve, reject) => {
    const request = db.transaction(CARD_STORE, 'readwrite').objectStore(CARD_STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete card.'));
  });
}

function openCardsDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CARD_STORE)) {
        db.createObjectStore(CARD_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open card database.'));
  });

  return dbPromise;
}

function normalizeCards(cards: unknown): StoredCard[] {
  if (!Array.isArray(cards)) return [];
  return cards.map(normalizeCard).filter((card): card is StoredCard => Boolean(card));
}

function normalizeCard(card: unknown): StoredCard {
  const candidate = card && typeof card === 'object' ? (card as Partial<StoredCard>) : {};
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : createCardId();
  const imageDataUrl =
    typeof candidate.imageDataUrl === 'string' && candidate.imageDataUrl.trim() ? candidate.imageDataUrl : undefined;
  const texts = normalizeTexts(candidate.texts);
  const versoCardId =
    typeof candidate.versoCardId === 'string' && candidate.versoCardId.trim() && candidate.versoCardId !== id
      ? candidate.versoCardId
      : undefined;

  return { id, imageDataUrl, texts, versoCardId };
}

function normalizeTexts(texts: unknown): Record<string, string> {
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return {};

  return Object.fromEntries(
    Object.entries(texts)
      .map(([language, text]) => [language.trim(), typeof text === 'string' ? text : ''])
      .filter(([language]) => language.length > 0)
  );
}
