export type ImageSearchProviderId = 'pexels' | 'flaticon' | 'leonardo' | 'pollinations';

export type ImageSearchProviderConfig = {
  apiKey: string;
  model?: string;
  promptTemplate?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

export type ImageSearchProviderConfigs = Record<ImageSearchProviderId, ImageSearchProviderConfig>;

export type ImageSearchOptions = {
  page: number;
  perPage: number;
  generationContext?: ImageGenerationPromptContext;
};

export type ImageGenerationPromptContext = {
  textsByLanguage: Record<string, string>;
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

type LeonardoGenerationCreateResponse = {
  sdGenerationJob?: {
    generationId?: string;
  };
  generationId?: string;
};

type LeonardoGeneratedImage = {
  id?: string;
  url?: string;
  nsfw?: boolean;
};

type LeonardoGenerationResponse = {
  generations_by_pk?: {
    id?: string;
    status?: string;
    prompt?: string;
    generated_images?: LeonardoGeneratedImage[];
  };
};

type PollinationsImageGenerationResponse = {
  data?: {
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }[];
};

const DEFAULT_POLLINATIONS_IMAGE_MODEL = 'flux';

export const DEFAULT_IMAGE_GENERATION_PROMPT_TEMPLATE = `A friendly picture-card illustration for a toddler reading card.
The card texts are translations of the same concept. Use this JSON to infer the subject: {{textsJson}}
Extra user hint: {{query}}
Portrait orientation, simple centered composition, clear silhouette, warm colors, no text, no letters, no watermark.`;

export const IMAGE_SEARCH_PROVIDERS = [
  {
    id: 'pexels',
    label: 'Pexels'
  },
  {
    id: 'flaticon',
    label: 'Flaticon'
  },
  {
    id: 'leonardo',
    label: 'Leonardo.Ai'
  },
  {
    id: 'pollinations',
    label: 'Pollinations.ai'
  }
] as const;

export function defaultImageSearchProviderConfigs(): ImageSearchProviderConfigs {
  return {
    pexels: {
      apiKey: ''
    },
    flaticon: {
      apiKey: ''
    },
    leonardo: {
      apiKey: '',
      model: ''
    },
    pollinations: {
      apiKey: '',
      model: DEFAULT_POLLINATIONS_IMAGE_MODEL
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
      model:
        provider.id === 'pollinations'
          ? normalizePollinationsImageModel(stored.model)
          : provider.id === 'leonardo'
          ? normalizeOptionalModel(stored.model)
          : undefined,
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
  if (providerId === 'leonardo') return leonardoImageSearchProvider;
  if (providerId === 'pollinations') return pollinationsImageSearchProvider;
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

const leonardoImageSearchProvider: ImageSearchProvider = {
  id: 'leonardo',
  label: 'Leonardo.Ai',
  async search(query, options, config) {
    const apiKey = config.apiKey.trim();
    if (!apiKey) throw new Error('Add a Leonardo.Ai API key in Settings.');

    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('Enter a prompt.');

    const prompt = buildImageGenerationPrompt(
      config.promptTemplate,
      normalizedQuery,
      options.generationContext
    );
    const generationId = await createLeonardoGeneration(
      apiKey,
      prompt,
      options.perPage,
      config.model
    );
    const generation = await pollLeonardoGeneration(apiKey, generationId);
    const images = generation.generated_images ?? [];
    const results = images
      .map((image, index) => mapLeonardoImage(image, generationId, prompt, index))
      .filter((result): result is ImageSearchResult => Boolean(result));

    return {
      results,
      page: 1,
      totalResults: results.length,
      hasNextPage: false
    };
  },
  async importResult(result) {
    const response = await fetch(result.imageUrl);
    if (!response.ok) {
      throw new Error(`Could not import generated image: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('Selected result is not an image.');
    return blobToDataUrl(blob);
  }
};

const pollinationsImageSearchProvider: ImageSearchProvider = {
  id: 'pollinations',
  label: 'Pollinations.ai',
  async search(query, options, config) {
    const apiKey = config.apiKey.trim();
    if (!apiKey) throw new Error('Add a Pollinations.ai API key in Settings.');

    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('Enter a prompt.');

    const prompt = buildImageGenerationPrompt(
      config.promptTemplate,
      normalizedQuery,
      options.generationContext
    );
    const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: normalizePollinationsImageModel(config.model),
        n: 1,
        prompt,
        quality: 'medium',
        response_format: 'b64_json',
        safe: true,
        size: '1024x1536'
      })
    });

    if (!response.ok) {
      throw new Error(await pollinationsErrorMessage(response));
    }

    const payload = (await response.json()) as PollinationsImageGenerationResponse;
    const results = (payload.data ?? [])
      .map((image, index) => mapPollinationsImage(image, prompt, index))
      .filter((result): result is ImageSearchResult => Boolean(result));

    return {
      results,
      page: 1,
      totalResults: results.length,
      hasNextPage: false
    };
  },
  async importResult(result) {
    return importGeneratedImageResult(result);
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

function buildImageGenerationPrompt(
  promptTemplate: string | undefined,
  query: string,
  context: ImageGenerationPromptContext | undefined
): string {
  const template = normalizeImageGenerationPromptTemplate(promptTemplate);
  const textsJson = JSON.stringify(context?.textsByLanguage ?? {}, null, 2);
  const prompt = template
    .replace(/\{\{\s*(query|cardText|subject)\s*\}\}/g, query)
    .replace(/\{\{\s*textsJson\s*\}\}/g, textsJson)
    .trim();

  if (/\{\{\s*textsJson\s*\}\}/.test(template)) return prompt;
  return `${prompt}
Card texts JSON. These language-code values are translations of the same concept:
${textsJson}`;
}

async function createLeonardoGeneration(
  apiKey: string,
  prompt: string,
  perPage: number,
  model: string | undefined
): Promise<string> {
  const modelId = normalizeOptionalModel(model);
  const response = await fetch('https://cloud.leonardo.ai/api/rest/v1/generations', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      alchemy: false,
      height: 1024,
      width: 768,
      ...(modelId ? { modelId } : {}),
      num_images: Math.max(1, Math.min(perPage, 4)),
      prompt,
      public: false
    })
  });

  if (!response.ok) {
    throw new Error(await providerErrorMessage(response, 'Leonardo.Ai'));
  }

  const payload = (await response.json()) as LeonardoGenerationCreateResponse;
  const generationId = payload.sdGenerationJob?.generationId ?? payload.generationId;
  if (!generationId) throw new Error('Leonardo.Ai did not return a generation ID.');
  return generationId;
}

async function pollLeonardoGeneration(
  apiKey: string,
  generationId: string
): Promise<NonNullable<LeonardoGenerationResponse['generations_by_pk']>> {
  const timeoutAt = Date.now() + 75_000;

  while (Date.now() < timeoutAt) {
    const generation = await getLeonardoGeneration(apiKey, generationId);
    const status = generation.status?.toUpperCase();

    if (status === 'COMPLETE') return generation;
    if (status === 'FAILED') throw new Error('Leonardo.Ai generation failed.');

    await delay(2_500);
  }

  throw new Error('Leonardo.Ai generation timed out. Try again in a moment.');
}

async function getLeonardoGeneration(
  apiKey: string,
  generationId: string
): Promise<NonNullable<LeonardoGenerationResponse['generations_by_pk']>> {
  const response = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(await providerErrorMessage(response, 'Leonardo.Ai generation lookup'));
  }

  const payload = (await response.json()) as LeonardoGenerationResponse;
  const generation = payload.generations_by_pk;
  if (!generation) throw new Error('Leonardo.Ai returned an empty generation response.');
  return generation;
}

function mapLeonardoImage(
  image: LeonardoGeneratedImage,
  generationId: string,
  prompt: string,
  index: number
): ImageSearchResult | undefined {
  if (!image.url || image.nsfw) return undefined;

  return {
    id: image.id ?? `${generationId}-${index}`,
    providerId: 'leonardo',
    thumbUrl: image.url,
    imageUrl: image.url,
    pageUrl: `https://app.leonardo.ai/image-generation`,
    alt: prompt,
    creditText: 'Generated with Leonardo.Ai'
  };
}

function mapPollinationsImage(
  image: NonNullable<PollinationsImageGenerationResponse['data']>[number],
  prompt: string,
  index: number
): ImageSearchResult | undefined {
  const imageUrl = image.b64_json ? `data:image/png;base64,${image.b64_json}` : image.url;
  if (!imageUrl) return undefined;

  return {
    id: `pollinations-${Date.now()}-${index}`,
    providerId: 'pollinations',
    thumbUrl: imageUrl,
    imageUrl,
    pageUrl: 'https://pollinations.ai',
    alt: image.revised_prompt?.trim() || prompt,
    creditText: 'Generated with Pollinations.ai'
  };
}

function normalizeImageGenerationPromptTemplate(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : DEFAULT_IMAGE_GENERATION_PROMPT_TEMPLATE;
}

function normalizePollinationsImageModel(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_POLLINATIONS_IMAGE_MODEL;
}

function normalizeOptionalModel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function pollinationsErrorMessage(response: Response): Promise<string> {
  return providerErrorMessage(response, 'Pollinations.ai');
}

async function providerErrorMessage(response: Response, provider: string): Promise<string> {
  const fallback = `${provider} request failed: ${response.status} ${response.statusText}`;
  try {
    const payload = await response.clone().json();
    const message = payload?.error?.message ?? payload?.error;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    return fallback;
  }
  return fallback;
}

async function importGeneratedImageResult(result: ImageSearchResult): Promise<string> {
  if (result.imageUrl.startsWith('data:image/')) return result.imageUrl;

  const response = await fetch(result.imageUrl);
  if (!response.ok) {
    throw new Error(`Could not import generated image: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Selected result is not an image.');
  return blobToDataUrl(blob);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
