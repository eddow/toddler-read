export type ImageSearchProviderId = 'pexels' | 'flaticon';

export type ImageSearchProviderConfig = {
  apiKey: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

export type ImageSearchProviderConfigs = Record<ImageSearchProviderId, ImageSearchProviderConfig>;

export type ImageSearchOptions = {
  page: number;
  perPage: number;
};

export type ImageSearchResult = {
  id: string;
  providerId: ImageSearchProviderId;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  alt: string;
  author?: string;
  authorUrl?: string;
  creditText?: string;
};

export type ImageSearchResponse = {
  results: ImageSearchResult[];
  page: number;
  totalResults: number;
  hasNextPage: boolean;
};

export type ImageSearchProvider = {
  id: ImageSearchProviderId;
  label: string;
  search(
    query: string,
    options: ImageSearchOptions,
    config: ImageSearchProviderConfig
  ): Promise<ImageSearchResponse>;
  importResult(result: ImageSearchResult): Promise<string>;
};

type PexelsPhoto = {
  id: number;
  url: string;
  photographer?: string;
  photographer_url?: string;
  alt?: string;
  src?: Partial<Record<'tiny' | 'small' | 'medium' | 'large' | 'large2x' | 'original', string>>;
};

type PexelsSearchResponse = {
  page?: number;
  per_page?: number;
  total_results?: number;
  photos?: PexelsPhoto[];
  next_page?: string;
};

type FlaticonIcon = {
  id: number;
  description?: string;
  color?: string;
  shape?: string;
  team_name?: string;
  images?: Partial<Record<'16' | '24' | '32' | '64' | '128' | '256' | '512', string>>;
};

type FlaticonSearchResponse = {
  data?: FlaticonIcon[];
  metadata?: {
    page?: number;
    count?: number;
    total?: number;
  };
};

type FlaticonAuthResponse = {
  token?: string;
  expires?: number;
};

export const IMAGE_SEARCH_PROVIDERS = [
  {
    id: 'pexels',
    label: 'Pexels'
  },
  {
    id: 'flaticon',
    label: 'Flaticon'
  }
] as const;

export function defaultImageSearchProviderConfigs(): ImageSearchProviderConfigs {
  return {
    pexels: {
      apiKey: ''
    },
    flaticon: {
      apiKey: ''
    }
  };
}

export function isImageSearchProvider(value: unknown): value is ImageSearchProviderId {
  return (
    typeof value === 'string' &&
    IMAGE_SEARCH_PROVIDERS.some((provider) => provider.id === value)
  );
}

export function imageSearchProviderLabel(providerId: ImageSearchProviderId): string {
  return IMAGE_SEARCH_PROVIDERS.find((provider) => provider.id === providerId)?.label ?? providerId;
}

export function normalizeStoredImageSearchProviderConfigs(value: unknown): ImageSearchProviderConfigs {
  const configs = defaultImageSearchProviderConfigs();
  if (!value || typeof value !== 'object') return configs;

  const storedConfigs = value as Partial<Record<ImageSearchProviderId, Partial<ImageSearchProviderConfig>>>;
  for (const provider of IMAGE_SEARCH_PROVIDERS) {
    const stored = storedConfigs[provider.id];
    if (!stored || typeof stored !== 'object') continue;

    configs[provider.id] = {
      apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
      accessToken: typeof stored.accessToken === 'string' ? stored.accessToken : undefined,
      accessTokenExpiresAt:
        typeof stored.accessTokenExpiresAt === 'number' ? stored.accessTokenExpiresAt : undefined
    };
  }

  return configs;
}

export function getImageSearchProvider(providerId: ImageSearchProviderId): ImageSearchProvider {
  if (providerId === 'pexels') return pexelsImageSearchProvider;
  if (providerId === 'flaticon') return flaticonImageSearchProvider;
  return pexelsImageSearchProvider;
}

const pexelsImageSearchProvider: ImageSearchProvider = {
  id: 'pexels',
  label: 'Pexels',
  async search(query, options, config) {
    const apiKey = config.apiKey.trim();
    if (!apiKey) throw new Error('Add a Pexels API key in Settings.');

    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('Enter a search term.');

    const url = new URL('https://api.pexels.com/v1/search');
    url.searchParams.set('query', normalizedQuery);
    url.searchParams.set('page', String(Math.max(1, options.page)));
    url.searchParams.set('per_page', String(Math.max(1, Math.min(options.perPage, 80))));

    const response = await fetch(url, {
      headers: {
        Authorization: apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Pexels request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as PexelsSearchResponse;
    const page = payload.page ?? options.page;
    const perPage = payload.per_page ?? options.perPage;
    const totalResults = payload.total_results ?? 0;
    const results = (payload.photos ?? [])
      .map(mapPexelsPhoto)
      .filter((result): result is ImageSearchResult => Boolean(result));

    return {
      results,
      page,
      totalResults,
      hasNextPage: Boolean(payload.next_page) || page * perPage < totalResults
    };
  },
  async importResult(result) {
    const response = await fetch(result.imageUrl);
    if (!response.ok) {
      throw new Error(`Could not import image: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('Selected result is not an image.');
    return blobToDataUrl(blob);
  }
};

const flaticonImageSearchProvider: ImageSearchProvider = {
  id: 'flaticon',
  label: 'Flaticon',
  async search(query, options, config) {
    const apiKey = config.apiKey.trim();
    if (!apiKey) throw new Error('Add a Flaticon API key in Settings.');

    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('Enter a search term.');

    const token = await getFlaticonAccessToken(config);
    const url = new URL('https://api.flaticon.com/v3/search/icons/priority');
    url.searchParams.set('q', normalizedQuery);
    url.searchParams.set('page', String(Math.max(1, options.page)));
    url.searchParams.set('limit', String(Math.max(10, Math.min(options.perPage, 100))));
    url.searchParams.set('iconType', 'standard');

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) clearFlaticonAccessToken(config);
      throw new Error(`Flaticon request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as FlaticonSearchResponse;
    const page = payload.metadata?.page ?? options.page;
    const totalResults = payload.metadata?.total ?? 0;
    const count = payload.metadata?.count ?? options.perPage;
    const results = (payload.data ?? [])
      .map(mapFlaticonIcon)
      .filter((result): result is ImageSearchResult => Boolean(result));

    return {
      results,
      page,
      totalResults,
      hasNextPage: page * count < totalResults
    };
  },
  async importResult(result) {
    const response = await fetch(result.imageUrl);
    if (!response.ok) {
      throw new Error(`Could not import icon: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('Selected result is not an image.');
    return blobToDataUrl(blob);
  }
};

function mapPexelsPhoto(photo: PexelsPhoto): ImageSearchResult | undefined {
  const src = photo.src ?? {};
  const thumbUrl = src.tiny ?? src.small ?? src.medium;
  const imageUrl = src.large2x ?? src.large ?? src.original ?? src.medium;
  if (!thumbUrl || !imageUrl) return undefined;

  const author = photo.photographer?.trim() || undefined;

  return {
    id: String(photo.id),
    providerId: 'pexels',
    thumbUrl,
    imageUrl,
    pageUrl: photo.url,
    alt: photo.alt?.trim() || `Pexels photo ${photo.id}`,
    author,
    authorUrl: photo.photographer_url,
    creditText: author ? `Photo by ${author} on Pexels` : 'Photo from Pexels'
  };
}

async function getFlaticonAccessToken(config: ImageSearchProviderConfig): Promise<string> {
  const token = config.accessToken?.trim();
  const expiresAt = config.accessTokenExpiresAt ?? 0;
  if (token && expiresAt > Date.now() + 60_000) return token;

  const formData = new FormData();
  formData.set('apikey', config.apiKey.trim());

  const response = await fetch('https://api.flaticon.com/v3/app/authentication', {
    method: 'POST',
    headers: {
      Accept: 'application/json'
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Flaticon authentication failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as FlaticonAuthResponse;
  if (!payload.token) throw new Error('Flaticon did not return an access token.');

  config.accessToken = payload.token;
  config.accessTokenExpiresAt = payload.expires ? payload.expires * 1000 : Date.now() + 23 * 60 * 60 * 1000;
  return payload.token;
}

function clearFlaticonAccessToken(config: ImageSearchProviderConfig): void {
  config.accessToken = undefined;
  config.accessTokenExpiresAt = undefined;
}

function mapFlaticonIcon(icon: FlaticonIcon): ImageSearchResult | undefined {
  const images = icon.images ?? {};
  const imageUrl = images['512'] ?? images['256'] ?? images['128'] ?? images['64'];
  const thumbUrl = images['128'] ?? images['256'] ?? images['64'] ?? imageUrl;
  if (!thumbUrl || !imageUrl) return undefined;

  const description = icon.description?.trim() || `Flaticon icon ${icon.id}`;
  const author = icon.team_name?.trim() || undefined;

  return {
    id: String(icon.id),
    providerId: 'flaticon',
    thumbUrl,
    imageUrl,
    pageUrl: `https://www.flaticon.com/free-icon/${slugifyFlaticonDescription(description)}_${icon.id}`,
    alt: description,
    author,
    authorUrl: author ? `https://www.flaticon.com/authors/${author.toLowerCase().replace(/\s+/g, '-')}` : undefined,
    creditText: author ? `Icon by ${author} on Flaticon` : 'Icon from Flaticon'
  };
}

function slugifyFlaticonDescription(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'icon';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read imported image.'));
    reader.readAsDataURL(blob);
  });
}
