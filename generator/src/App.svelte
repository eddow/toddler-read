<script lang="ts">
  import { GoogleGenAI } from '@google/genai';
  import { BookOpenText, ExternalLink, ImagePlus, Languages, Settings, WandSparkles, X } from 'lucide-svelte';
  import QRCode from 'qrcode';
  import { onMount, tick } from 'svelte';
  import {
    DEFAULT_CARD_GRID_SIZE,
    markerForLanguage,
    renderCardToCanvas,
    toRenderableEntries,
    type CardGridSize,
    type LanguageEntry
  } from './lib/card';

  const MAX_ENTRIES = 4;
  const GRID_SIZE_OPTIONS: CardGridSize[] = [1, 2, 3, 4];
  const CARD_TEXT_STORAGE_KEY = 'toddler-read-generator-card-text';
  const LEGACY_LANGUAGE_STORAGE_KEY = 'toddler-read-generator-languages';
  const SETTINGS_STORAGE_KEY = 'toddler-read-generator-settings';
  const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
  const TRANSLATION_PROVIDERS = [
    { value: 'gemini', label: 'Gemini', model: DEFAULT_GEMINI_MODEL, baseUrl: '' },
    { value: 'openai', label: 'OpenAI', model: 'gpt-5-mini', baseUrl: 'https://api.openai.com/v1' },
    { value: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' },
    { value: 'zai', label: 'Z.AI', model: 'glm-4.7-flashx', baseUrl: 'https://api.z.ai/api/paas/v4' },
    { value: 'groq', label: 'Groq', model: 'openai/gpt-oss-120b', baseUrl: 'https://api.groq.com/openai/v1' },
    { value: 'custom', label: 'Custom', model: '', baseUrl: '' }
  ] as const;
  const TRANSLATION_RESPONSE_SCHEMA = {
    translations: [{ index: 2, text: 'translated text' }]
  };
  const DEFAULT_TRANSLATION_PROMPT_TEMPLATE = [
    'Translate these toddler reading card texts.',
    'Use every source text as context for ambiguity and meaning.',
    'Sources JSON: {{sourcesJson}}',
    'Targets JSON: {{targetsJson}}',
    'Return only JSON matching this schema: {{responseSchemaJson}}',
    'For each target, return a short natural translation suitable for a young child.'
  ].join('\n');
  let idCounter = 0;

  type LegacyTranslationMode = 'nothing' | 'use' | 'produce';
  type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]['value'];

  type TranslationOptions = {
    use: boolean;
    produce: boolean;
  };

  type TranslationProviderConfig = {
    apiKey: string;
    model: string;
    baseUrl?: string;
  };

  type TranslationProviderConfigs = Record<TranslationProvider, TranslationProviderConfig>;

  type CornerLanguageSetup = {
    id: string;
    lang: string;
    marker: string;
  };

  type TranslationSource = {
    index: number;
    lang: string;
    text: string;
  };

  type TranslationTarget = {
    index: number;
    lang: string;
  };

  let languageSetups: CornerLanguageSetup[] = defaultLanguageSetups();
  let cardTexts = defaultCardTexts();
  let translationOptions = defaultTranslationOptions();
  let translationProvider: TranslationProvider = 'gemini';
  let translationProviderConfigs = defaultTranslationProviderConfigs();
  let translationPromptTemplate = DEFAULT_TRANSLATION_PROMPT_TEMPLATE;
  let isTranslating = false;
  let gridSize: CardGridSize = DEFAULT_CARD_GRID_SIZE;
  let reserveQrMargin = false;
  let showQrText = false;
  let showSettingsPanel = false;
  let imageDataUrl: string | undefined;
  let previewCanvas: HTMLCanvasElement;
  let exportCanvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let isDragging = false;
  let renderError = '';
  let translationStatus = '';
  let translationError = '';
  let pngStatus = '';
  let apkUrl = '';
  let apkQrDataUrl = '';
  let renderToken = 0;
  let storageReady = false;

  $: entries = buildEntries(languageSetups, cardTexts);
  $: renderableEntries = toRenderableEntries(entries);
  $: canExport = renderableEntries.length > 0;
  $: translationSources = buildTranslationSources(entries, translationOptions);
  $: translationTargets = buildTranslationTargets(entries, translationOptions);
  $: currentTranslationProviderConfig = translationProviderConfigs[translationProvider];
  $: translationDisabledReasons = getTranslationDisabledReasons(
    translationProvider,
    currentTranslationProviderConfig,
    translationSources,
    translationTargets
  );
  $: canTranslate = translationDisabledReasons.length === 0 && !isTranslating;
  $: translateButtonTitle = isTranslating ? 'Translating...' : translationDisabledReasons.join(', ');
  $: void schedulePreviewRender(imageDataUrl, entries, gridSize, reserveQrMargin, showQrText);
  $: if (storageReady) {
    localStorage.setItem(CARD_TEXT_STORAGE_KEY, JSON.stringify(cardTexts));
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        gridSize,
        reserveQrMargin,
        showQrText,
        languageSetups,
        translationOptions,
        translationProvider,
        translationProviderConfigs,
        translationPromptTemplate
      })
    );
  }

  onMount(() => {
    loadStoredSettings();
    cardTexts = loadStoredCardTexts();
    storageReady = true;
    apkUrl = new URL('tr.apk', document.baseURI).href;
    void QRCode.toDataURL(apkUrl, {
      errorCorrectionLevel: 'H',
      margin: 1,
      scale: 5,
      color: {
        dark: '#17211b',
        light: '#ffffff'
      }
    }).then((url) => {
      apkQrDataUrl = url;
    });

    const onPaste = (event: ClipboardEvent) => handleImagePaste(event);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') showSettingsPanel = false;
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  async function schedulePreviewRender(
    nextImageDataUrl: string | undefined,
    nextEntries: LanguageEntry[],
    nextGridSize: CardGridSize,
    nextReserveQrMargin: boolean,
    nextShowQrText: boolean
  ) {
    if (!previewCanvas) return;

    const token = ++renderToken;
    await tick();
    if (token !== renderToken) return;

    try {
      renderError = '';
      await renderCardToCanvas(
        {
          imageDataUrl: nextImageDataUrl,
          entries: nextEntries,
          gridSize: nextGridSize,
          reserveQrMargin: nextReserveQrMargin,
          showQrText: nextShowQrText
        },
        previewCanvas
      );
    } catch (error) {
      renderError = error instanceof Error ? error.message : 'Could not render card.';
    }
  }

  function createEntryId() {
    idCounter += 1;
    return `entry-${Date.now()}-${idCounter}`;
  }

  function createLanguageSetup(lang: string, marker = markerForLanguage(lang).marker): CornerLanguageSetup {
    return { id: createEntryId(), lang, marker };
  }

  function defaultLanguageSetups(): CornerLanguageSetup[] {
    return [
      createLanguageSetup('en'),
      createLanguageSetup('fr'),
      createLanguageSetup('ro'),
      createLanguageSetup('')
    ];
  }

  function defaultCardTexts(): string[] {
    return Array.from({ length: MAX_ENTRIES }, () => '');
  }

  function defaultTranslationOptions(): TranslationOptions[] {
    return Array.from({ length: MAX_ENTRIES }, () => ({ use: false, produce: false }));
  }

  function defaultTranslationProviderConfigs(): TranslationProviderConfigs {
    return Object.fromEntries(
      TRANSLATION_PROVIDERS.map((provider) => [
        provider.value,
        {
          apiKey: '',
          model: provider.model,
          baseUrl: provider.baseUrl
        }
      ])
    ) as TranslationProviderConfigs;
  }

  function buildEntries(setups: CornerLanguageSetup[], texts: string[]): LanguageEntry[] {
    return normalizeLanguageSetupCount(setups).map((setup, index) => ({
      id: setup.id,
      lang: setup.lang,
      marker: setup.marker,
      text: texts[index] ?? ''
    }));
  }

  function loadStoredCardTexts(): string[] {
    try {
      const stored = localStorage.getItem(CARD_TEXT_STORAGE_KEY) ?? localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
      if (!stored) return cardTexts;

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return cardTexts;

      const normalized = parsed
        .slice(0, MAX_ENTRIES)
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry && typeof entry === 'object' && typeof entry.text === 'string') return entry.text;
          return '';
        });

      return normalizeCardTextCount(normalized.length > 0 ? normalized : cardTexts);
    } catch {
      return cardTexts;
    }
  }

  function normalizeCardTextCount(nextTexts: string[]): string[] {
    const normalized = nextTexts.slice(0, MAX_ENTRIES);
    while (normalized.length < MAX_ENTRIES) normalized.push('');
    return normalized;
  }

  function normalizeTranslationOptionCount(nextOptions: TranslationOptions[]): TranslationOptions[] {
    const normalized = nextOptions.slice(0, MAX_ENTRIES);
    while (normalized.length < MAX_ENTRIES) normalized.push({ use: false, produce: false });
    return normalized;
  }

  function normalizeLanguageSetupCount(nextSetups: CornerLanguageSetup[]): CornerLanguageSetup[] {
    const normalized = nextSetups.slice(0, MAX_ENTRIES);
    while (normalized.length < MAX_ENTRIES) normalized.push(createLanguageSetup(''));
    return normalized;
  }

  function loadStoredSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return;

      if (isCardGridSize(parsed.gridSize)) {
        gridSize = parsed.gridSize;
      }
      if (typeof parsed.reserveQrMargin === 'boolean') {
        reserveQrMargin = parsed.reserveQrMargin;
      }
      if (typeof parsed.showQrText === 'boolean') {
        showQrText = parsed.showQrText;
      }
      if (typeof parsed.translationPromptTemplate === 'string' && parsed.translationPromptTemplate.trim()) {
        translationPromptTemplate = parsed.translationPromptTemplate;
      }
      if (isTranslationProvider(parsed.translationProvider)) {
        translationProvider = parsed.translationProvider;
      }
      if (parsed.translationProviderConfigs && typeof parsed.translationProviderConfigs === 'object') {
        translationProviderConfigs = normalizeStoredTranslationProviderConfigs(parsed.translationProviderConfigs);
      }
      if (typeof parsed.geminiApiKey === 'string' || typeof parsed.geminiModel === 'string') {
        translationProviderConfigs = migrateLegacyGeminiConfig(
          translationProviderConfigs,
          typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
          typeof parsed.geminiModel === 'string' ? parsed.geminiModel : ''
        );
      }
      if (Array.isArray(parsed.translationOptions)) {
        translationOptions = normalizeStoredTranslationOptions(parsed.translationOptions);
      } else if (Array.isArray(parsed.translationModes)) {
        translationOptions = normalizeStoredTranslationModes(parsed.translationModes);
      }
      if (Array.isArray(parsed.languageSetups)) {
        const normalized = normalizeStoredLanguageSetups(parsed.languageSetups);
        if (normalized.length > 0) {
          languageSetups = normalizeLanguageSetupCount(normalized);
        }
      } else {
        const migrated = loadLegacyLanguageSetups();
        if (migrated.length > 0) {
          languageSetups = normalizeLanguageSetupCount(migrated);
        }
      }
    } catch {
      // Keep defaults when stored settings are unreadable.
    }
  }

  function normalizeStoredLanguageSetups(value: unknown[]): CornerLanguageSetup[] {
    return value
      .slice(0, MAX_ENTRIES)
      .map((entry): CornerLanguageSetup | undefined => {
        if (!entry || typeof entry !== 'object') return undefined;

        const candidate = entry as Partial<CornerLanguageSetup>;
        const lang = typeof candidate.lang === 'string' ? candidate.lang : '';
        const marker =
          typeof candidate.marker === 'string' && candidate.marker.trim()
            ? candidate.marker
            : markerForLanguage(lang).marker;

        return {
          id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createEntryId(),
          lang,
          marker
        };
      })
      .filter((entry): entry is CornerLanguageSetup => Boolean(entry));
  }

  function normalizeStoredTranslationOptions(value: unknown[]): TranslationOptions[] {
    return normalizeTranslationOptionCount(
      value.map((entry) => {
        if (!entry || typeof entry !== 'object') return { use: false, produce: false };
        const candidate = entry as Partial<TranslationOptions>;
        return {
          use: Boolean(candidate.use),
          produce: Boolean(candidate.produce)
        };
      })
    );
  }

  function normalizeStoredTranslationModes(value: unknown[]): TranslationOptions[] {
    return normalizeTranslationOptionCount(
      value.map((mode) => {
        if (!isLegacyTranslationMode(mode)) return { use: false, produce: false };
        return {
          use: mode === 'use',
          produce: mode === 'produce'
        };
      })
    );
  }

  function normalizeStoredTranslationProviderConfigs(value: object): TranslationProviderConfigs {
    const configs = defaultTranslationProviderConfigs();
    const storedConfigs = value as Partial<Record<TranslationProvider, Partial<TranslationProviderConfig>>>;

    for (const provider of TRANSLATION_PROVIDERS) {
      const stored = storedConfigs[provider.value];
      if (!stored || typeof stored !== 'object') continue;

      configs[provider.value] = {
        apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
        model: typeof stored.model === 'string' && stored.model.trim() ? stored.model : configs[provider.value].model,
        baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : configs[provider.value].baseUrl
      };
    }

    return configs;
  }

  function migrateLegacyGeminiConfig(
    configs: TranslationProviderConfigs,
    apiKey: string,
    model: string
  ): TranslationProviderConfigs {
    return {
      ...configs,
      gemini: {
        ...configs.gemini,
        apiKey: apiKey || configs.gemini.apiKey,
        model: model.trim() || configs.gemini.model
      }
    };
  }

  function loadLegacyLanguageSetups(): CornerLanguageSetup[] {
    try {
      const stored = localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
      if (!stored) return [];

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];

      return normalizeStoredLanguageSetups(parsed);
    } catch {
      return [];
    }
  }

  function isCardGridSize(value: unknown): value is CardGridSize {
    return typeof value === 'number' && GRID_SIZE_OPTIONS.includes(value as CardGridSize);
  }

  function isLegacyTranslationMode(value: unknown): value is LegacyTranslationMode {
    return value === 'nothing' || value === 'use' || value === 'produce';
  }

  function isTranslationProvider(value: unknown): value is TranslationProvider {
    return typeof value === 'string' && TRANSLATION_PROVIDERS.some((provider) => provider.value === value);
  }

  function updateLanguageSetup(id: string, patch: Partial<CornerLanguageSetup>) {
    languageSetups = languageSetups.map((setup) => {
      if (setup.id !== id) return setup;

      const next = { ...setup, ...patch };
      if (typeof patch.lang === 'string' && patch.marker === undefined) {
        next.marker = markerForLanguage(patch.lang).marker;
      }

      return next;
    });
  }

  function updateCardText(index: number, text: string) {
    const nextTexts = normalizeCardTextCount(cardTexts);
    nextTexts[index] = text;
    cardTexts = nextTexts;
    translationStatus = '';
    translationError = '';
  }

  function updateTranslationOption(index: number, key: keyof TranslationOptions, checked: boolean) {
    const nextOptions = normalizeTranslationOptionCount(translationOptions);
    nextOptions[index] = { ...nextOptions[index], [key]: checked };
    translationOptions = nextOptions;
    translationStatus = '';
    translationError = '';
  }

  function updateTranslationProvider(value: string) {
    if (!isTranslationProvider(value)) return;
    translationProvider = value;
    translationStatus = '';
    translationError = '';
  }

  function updateTranslationProviderConfig(key: keyof TranslationProviderConfig, value: string) {
    translationProviderConfigs = {
      ...translationProviderConfigs,
      [translationProvider]: {
        ...translationProviderConfigs[translationProvider],
        [key]: value
      }
    };
    translationStatus = '';
    translationError = '';
  }

  function buildTranslationSources(nextEntries: LanguageEntry[], nextOptions: TranslationOptions[]): TranslationSource[] {
    return nextEntries
      .map((entry, index) => ({
        index,
        lang: entry.lang.trim(),
        text: entry.text.trim(),
        use: Boolean(nextOptions[index]?.use)
      }))
      .filter((entry) => entry.use && entry.text.length > 0)
      .map(({ index, lang, text }) => ({ index, lang, text }));
  }

  function buildTranslationTargets(nextEntries: LanguageEntry[], nextOptions: TranslationOptions[]): TranslationTarget[] {
    return nextEntries
      .map((entry, index) => ({
        index,
        lang: entry.lang.trim(),
        text: entry.text.trim(),
        use: Boolean(nextOptions[index]?.use),
        produce: Boolean(nextOptions[index]?.produce)
      }))
      .filter((entry) => entry.produce && entry.lang.length > 0 && (!entry.use || entry.text.length === 0))
      .map(({ index, lang }) => ({ index, lang }));
  }

  function getTranslationDisabledReasons(
    provider: TranslationProvider,
    config: TranslationProviderConfig,
    sources: TranslationSource[],
    targets: TranslationTarget[]
  ): string[] {
    const reasons: string[] = [];
    if (!config.apiKey.trim()) reasons.push('no key');
    if (!config.model.trim()) reasons.push('no model');
    if (isOpenAiCompatibleProvider(provider) && !config.baseUrl?.trim()) reasons.push('no base URL');
    if (sources.length === 0) reasons.push('no source');
    if (targets.length === 0) reasons.push('no target');
    return reasons;
  }

  async function translateProducedTexts() {
    if (!canTranslate) return;

    isTranslating = true;
    translationStatus = '';
    translationError = '';
    try {
      const prompt = buildTranslationPrompt(translationPromptTemplate, translationSources, translationTargets);
      const responseText = await requestTranslation(translationProvider, currentTranslationProviderConfig, prompt);

      const translations = parseTranslationResponse(responseText);
      const nextTexts = normalizeCardTextCount(cardTexts);
      let appliedCount = 0;

      for (const translation of translations) {
        if (!Number.isInteger(translation.index)) continue;
        if (translation.index < 0 || translation.index >= MAX_ENTRIES) continue;
        if (!translationTargets.some((target) => target.index === translation.index)) continue;
        if (typeof translation.text !== 'string' || !translation.text.trim()) continue;

        nextTexts[translation.index] = translation.text.trim();
        appliedCount += 1;
      }

      if (appliedCount === 0) {
        throw new Error('Gemini returned no usable translations.');
      }

      cardTexts = nextTexts;
      translationStatus = `Translated ${appliedCount} ${appliedCount === 1 ? 'text' : 'texts'}.`;
    } catch (error) {
      translationError = error instanceof Error ? error.message : 'Could not translate.';
    } finally {
      isTranslating = false;
    }
  }

  async function requestTranslation(
    provider: TranslationProvider,
    config: TranslationProviderConfig,
    prompt: string
  ): Promise<string> {
    if (provider === 'gemini') {
      return requestGeminiTranslation(config, prompt);
    }

    return requestOpenAiCompatibleTranslation(provider, config, prompt);
  }

  async function requestGeminiTranslation(config: TranslationProviderConfig, prompt: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: config.apiKey.trim() });
    const response = await ai.models.generateContent({
      model: config.model.trim() || DEFAULT_GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    if (!response.text) throw new Error('Gemini returned an empty response.');
    return response.text;
  }

  async function requestOpenAiCompatibleTranslation(
    provider: TranslationProvider,
    config: TranslationProviderConfig,
    prompt: string
  ): Promise<string> {
    const baseUrl = config.baseUrl?.trim();
    if (!baseUrl) throw new Error('Missing base URL.');

    const body: Record<string, unknown> = {
      model: config.model.trim(),
      messages: [{ role: 'user', content: prompt }]
    };
    if (provider !== 'custom') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`${providerLabel(provider)} request failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const content = extractOpenAiCompatibleContent(json);
    if (!content) throw new Error(`${providerLabel(provider)} returned an empty response.`);
    return content;
  }

  function extractOpenAiCompatibleContent(response: unknown): string {
    if (!response || typeof response !== 'object') return '';
    const choices = (response as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) return '';

    const first = choices[0];
    if (!first || typeof first !== 'object') return '';

    const message = (first as { message?: unknown }).message;
    if (!message || typeof message !== 'object') return '';

    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
            return (part as { text: string }).text;
          }
          return '';
        })
        .join('');
    }

    return '';
  }

  function isOpenAiCompatibleProvider(provider: TranslationProvider): boolean {
    return provider !== 'gemini';
  }

  function providerLabel(provider: TranslationProvider): string {
    return TRANSLATION_PROVIDERS.find((entry) => entry.value === provider)?.label ?? provider;
  }

  function buildTranslationPrompt(
    template: string,
    sources: TranslationSource[],
    targets: TranslationTarget[]
  ): string {
    return replaceTemplatePlaceholder(
      replaceTemplatePlaceholder(
        replaceTemplatePlaceholder(template, '{{sourcesJson}}', JSON.stringify(sources, null, 2)),
        '{{targetsJson}}',
        JSON.stringify(targets, null, 2)
      ),
      '{{responseSchemaJson}}',
      JSON.stringify(TRANSLATION_RESPONSE_SCHEMA, null, 2)
    );
  }

  function replaceTemplatePlaceholder(template: string, placeholder: string, value: string): string {
    return template.split(placeholder).join(value);
  }

  function parseTranslationResponse(text: string): Array<{ index: number; text: string }> {
    const parsed = JSON.parse(extractJsonText(text));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.translations)) {
      throw new Error('Gemini response did not include a translations array.');
    }

    return parsed.translations;
  }

  function extractJsonText(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) return fenced[1].trim();

    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return trimmed.slice(objectStart, objectEnd + 1);
    }

    return trimmed;
  }

  function chooseImage() {
    fileInput.click();
  }

  function clearImage() {
    imageDataUrl = undefined;
    pngStatus = '';
  }

  async function onFileSelected(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (file) await readImageFile(file);
    target.value = '';
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    const file = [...(event.dataTransfer?.files ?? [])].find((item) => item.type.startsWith('image/'));
    if (file) await readImageFile(file);
  }

  function handleImagePaste(event: ClipboardEvent) {
    const file = getClipboardImageFile(event.clipboardData);
    if (!file) return;

    event.preventDefault();
    void readImageFile(file);
  }

  function getClipboardImageFile(data: DataTransfer | null): File | undefined {
    const file = [...(data?.files ?? [])].find((item) => item.type.startsWith('image/'));
    if (file) return file;

    return [...(data?.items ?? [])]
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile() ?? undefined;
  }

  async function readImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      renderError = 'Please choose an image file.';
      return;
    }

    imageDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read image.'));
      reader.readAsDataURL(file);
    });
    pngStatus = '';
  }

  function updateGridSize(event: Event) {
    gridSize = Number((event.currentTarget as HTMLSelectElement).value) as CardGridSize;
    pngStatus = '';
  }

  function updateReserveQrMargin(event: Event) {
    reserveQrMargin = (event.currentTarget as HTMLInputElement).checked;
    pngStatus = '';
  }

  function updateShowQrText(event: Event) {
    showQrText = (event.currentTarget as HTMLInputElement).checked;
    pngStatus = '';
  }

  async function openPngPreview() {
    if (!canExport) return;

    pngStatus = '';
    try {
      await renderCardToCanvas({ imageDataUrl, entries, gridSize, reserveQrMargin, showQrText }, exportCanvas);
      const blob = await canvasToBlob(exportCanvas);
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');

      if (!opened) {
        URL.revokeObjectURL(url);
        throw new Error('Could not open PNG preview. Please allow pop-ups for this page.');
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      pngStatus = 'PNG opened in a new tab.';
    } catch (error) {
      pngStatus = error instanceof Error ? error.message : 'Could not open PNG.';
    }
  }

  function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not create PNG.'));
      }, 'image/png');
    });
  }
</script>

<svelte:head>
  <title>Toddler QR Card Generator</title>
</svelte:head>

<main class="app-shell">
  <section class="workspace" aria-label="Card generator">
    <div class="editor-pane">
      <header class="app-header">
        <div class="title-block">
          <p class="eyebrow">Toddler Read</p>
          <h1>Toddler Read QR Card Generator</h1>
        </div>
        {#if apkQrDataUrl}
          <a class="apk-qr" href={apkUrl} aria-label="Download Android APK">
            <span class="apk-qr-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img">
                <path d="M7.1 4.3 5.5 2.7 4.6 3.6 6.2 5.2a6.9 6.9 0 0 0-2.1 5h15.8a6.9 6.9 0 0 0-2.1-5l1.6-1.6-.9-.9-1.6 1.6A7.6 7.6 0 0 0 12 2.6a7.6 7.6 0 0 0-4.9 1.7Z" />
                <path d="M4.1 11.6h15.8v6.2c0 1.2-1 2.2-2.2 2.2H6.3c-1.2 0-2.2-1-2.2-2.2v-6.2Z" />
                <path d="M1.8 12.1h1.4v6.4H1.8c-.8 0-1.4-.6-1.4-1.4v-3.6c0-.8.6-1.4 1.4-1.4ZM20.8 12.1h1.4c.8 0 1.4.6 1.4 1.4v3.6c0 .8-.6 1.4-1.4 1.4h-1.4v-6.4ZM7.1 20.9h2.1v2.4H7.1v-2.4ZM14.8 20.9h2.1v2.4h-2.1v-2.4Z" />
                <circle cx="8.8" cy="7.8" r="0.8" fill="#ffffff" />
                <circle cx="15.2" cy="7.8" r="0.8" fill="#ffffff" />
              </svg>
            </span>
            <img src={apkQrDataUrl} alt="" />
          </a>
        {/if}
      </header>

      <input
        bind:this={fileInput}
        class="visually-hidden"
        type="file"
        accept="image/*"
        on:change={onFileSelected}
      />

      <div class="language-header">
        <h2>Card text</h2>
        <div class="language-actions">
          <span title={translateButtonTitle}>
            <button
              type="button"
              disabled={!canTranslate}
              title={translateButtonTitle}
              on:click={translateProducedTexts}
            >
              <Languages size={18} aria-hidden="true" />
              {isTranslating ? 'Translating...' : 'Translate'}
            </button>
          </span>
          <button
            type="button"
            class="secondary icon-button"
            aria-label="Settings"
            title="Settings"
            on:click={() => (showSettingsPanel = !showSettingsPanel)}
          >
            <Settings size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="language-list">
        {#each entries as entry, index (entry.id)}
          <article class="language-row">
            <div class="language-tools">
              <div class="readonly-marker" aria-label={entry.lang ? `${entry.lang} flag` : 'No language flag'}>
                {entry.marker || markerForLanguage(entry.lang).marker}
              </div>
              <fieldset class="translation-option-control" aria-label={`Translation options for ${entry.lang || `language ${index + 1}`}`}>
                <label class:active={translationOptions[index]?.use} title="Use as source">
                  <input
                    type="checkbox"
                    checked={translationOptions[index]?.use}
                    on:change={(event) => updateTranslationOption(index, 'use', event.currentTarget.checked)}
                  />
                  <BookOpenText size={15} aria-hidden="true" />
                  <span class="visually-hidden">Use as source</span>
                </label>
                <label class:active={translationOptions[index]?.produce} title="Produce translation">
                  <input
                    type="checkbox"
                    checked={translationOptions[index]?.produce}
                    on:change={(event) => updateTranslationOption(index, 'produce', event.currentTarget.checked)}
                  />
                  <WandSparkles size={15} aria-hidden="true" />
                  <span class="visually-hidden">Produce translation</span>
                </label>
              </fieldset>
            </div>
            <label class="text-field">
              Text
              <input
                value={entry.text}
                placeholder="Hello"
                on:input={(event) => updateCardText(index, event.currentTarget.value)}
              />
            </label>
          </article>
        {/each}
      </div>

      {#if translationError}
        <p class="status error">{translationError}</p>
      {:else if translationStatus}
        <p class="status">{translationStatus}</p>
      {/if}
    </div>

    <div class="preview-pane">
      <div class="preview-toolbar">
        <div>
          <p class="eyebrow">PNG preview</p>
          <strong>{renderableEntries.length} / {MAX_ENTRIES} QR</strong>
        </div>
        <div class="preview-actions">
          <label class="grid-size-control">
            A4 grid
            <select value={gridSize} on:change={updateGridSize}>
              {#each GRID_SIZE_OPTIONS as option}
                <option value={option}>{option}x{option}</option>
              {/each}
            </select>
          </label>
          <label class="margin-control">
            <input type="checkbox" checked={reserveQrMargin} on:change={updateReserveQrMargin} />
            QR margin
          </label>
          <label class="margin-control">
            <input type="checkbox" checked={showQrText} on:change={updateShowQrText} />
            QR text
          </label>
          <button type="button" disabled={!canExport} on:click={openPngPreview}>
            <ExternalLink size={18} aria-hidden="true" />
            Open PNG
          </button>
        </div>
      </div>

      <div
        class:dragging={isDragging}
        class="card-preview"
        role="group"
        aria-label="Card image manager"
        on:dragenter|preventDefault={() => (isDragging = true)}
        on:dragover|preventDefault={() => (isDragging = true)}
        on:dragleave={() => (isDragging = false)}
        on:drop={onDrop}
      >
        <canvas bind:this={previewCanvas} aria-label="Generated card preview"></canvas>
        <div class:image-prompt-empty={!imageDataUrl} class="image-prompt">
          <ImagePlus size={34} aria-hidden="true" />
          <input
            class="paste-target"
            readonly
            aria-label="Paste image here"
            placeholder="Click here, then paste"
            on:paste={handleImagePaste}
            on:keydown={(event) => {
              if (event.ctrlKey || event.metaKey) return;
              if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
                event.preventDefault();
              }
            }}
          />
          <button type="button" class="secondary" on:click={chooseImage}>Choose image</button>
          {#if imageDataUrl}
            <button type="button" class="secondary icon-button" aria-label="Clear image" title="Clear image" on:click={clearImage}>
              <X size={18} aria-hidden="true" />
            </button>
          {/if}
        </div>
      </div>

      {#if renderError}
        <p class="status error">{renderError}</p>
      {:else if pngStatus}
        <p class="status">{pngStatus}</p>
      {/if}
    </div>
  </section>

  <canvas bind:this={exportCanvas} class="export-canvas" aria-hidden="true"></canvas>

  {#if showSettingsPanel}
    <div class="modal-backdrop">
      <button
        type="button"
        class="modal-scrim"
        aria-label="Close settings"
        on:click={() => (showSettingsPanel = false)}
      ></button>
      <div
        class="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabindex="-1"
      >
        <div class="settings-header">
          <div>
            <p class="eyebrow">Settings</p>
            <h2 id="settings-title">Corner languages</h2>
          </div>
          <button
            type="button"
            class="secondary icon-button"
            aria-label="Close settings"
            title="Close settings"
            on:click={() => (showSettingsPanel = false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div class="settings-language-list">
          {#each languageSetups as setup, index (setup.id)}
            <article class="settings-language-row">
              <label>
                Code
                <input
                  value={setup.lang}
                  maxlength="16"
                  placeholder="en"
                  spellcheck="false"
                  on:input={(event) => updateLanguageSetup(setup.id, { lang: event.currentTarget.value })}
                />
              </label>
              <label class="marker-field">
                Flag
                <input
                  value={setup.marker}
                  maxlength="4"
                  placeholder="🇬🇧"
                  spellcheck="false"
                  on:input={(event) => updateLanguageSetup(setup.id, { marker: event.currentTarget.value })}
                />
              </label>
            </article>
          {/each}
        </div>
        <label class="api-key-field">
          Translation provider
          <select value={translationProvider} on:change={(event) => updateTranslationProvider(event.currentTarget.value)}>
            {#each TRANSLATION_PROVIDERS as provider}
              <option value={provider.value}>{provider.label}</option>
            {/each}
          </select>
        </label>
        <label class="api-key-field">
          {providerLabel(translationProvider)} API key
          <input
            type="password"
            value={currentTranslationProviderConfig.apiKey}
            placeholder="Stored locally"
            spellcheck="false"
            autocomplete="off"
            on:input={(event) => updateTranslationProviderConfig('apiKey', event.currentTarget.value)}
          />
        </label>
        <label class="api-key-field">
          {providerLabel(translationProvider)} model
          <input
            value={currentTranslationProviderConfig.model}
            placeholder={translationProviderConfigs[translationProvider].model}
            spellcheck="false"
            autocomplete="off"
            on:input={(event) => updateTranslationProviderConfig('model', event.currentTarget.value)}
          />
        </label>
        {#if isOpenAiCompatibleProvider(translationProvider)}
          <label class="api-key-field">
            Base URL
            <input
              value={currentTranslationProviderConfig.baseUrl ?? ''}
              placeholder="https://api.example.com/v1"
              spellcheck="false"
              autocomplete="off"
              on:input={(event) => updateTranslationProviderConfig('baseUrl', event.currentTarget.value)}
            />
          </label>
        {/if}
        <label class="api-key-field">
          Translation prompt template
          <textarea
            value={translationPromptTemplate}
            rows="9"
            spellcheck="false"
            on:input={(event) => (translationPromptTemplate = event.currentTarget.value)}
          ></textarea>
        </label>
      </div>
    </div>
  {/if}
</main>
