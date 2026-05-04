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

  type TranslationOptions = {
    use: boolean;
    produce: boolean;
  };

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
  let geminiApiKey = '';
  let geminiModel = DEFAULT_GEMINI_MODEL;
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
  $: translationDisabledReasons = getTranslationDisabledReasons(
    geminiApiKey,
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
        geminiApiKey,
        geminiModel,
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
      errorCorrectionLevel: 'M',
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
      if (typeof parsed.geminiApiKey === 'string') {
        geminiApiKey = parsed.geminiApiKey;
      }
      if (typeof parsed.geminiModel === 'string' && parsed.geminiModel.trim()) {
        geminiModel = parsed.geminiModel;
      }
      if (typeof parsed.translationPromptTemplate === 'string' && parsed.translationPromptTemplate.trim()) {
        translationPromptTemplate = parsed.translationPromptTemplate;
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
    key: string,
    sources: TranslationSource[],
    targets: TranslationTarget[]
  ): string[] {
    const reasons: string[] = [];
    if (!key.trim()) reasons.push('no key');
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
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.trim() });
      const response = await ai.models.generateContent({
        model: geminiModel.trim() || DEFAULT_GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });
      const responseText = response.text;
      if (!responseText) throw new Error('Gemini returned an empty response.');

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
          {#if apkUrl}
            <a class="apk-url" href={apkUrl}>{apkUrl}</a>
          {/if}
        </div>
        {#if apkQrDataUrl}
          <a class="apk-qr" href={apkUrl} aria-label="Download Android APK">
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
          Gemini API key
          <input
            type="password"
            value={geminiApiKey}
            placeholder="Stored locally"
            spellcheck="false"
            autocomplete="off"
            on:input={(event) => (geminiApiKey = event.currentTarget.value)}
          />
        </label>
        <label class="api-key-field">
          Gemini model
          <input
            value={geminiModel}
            placeholder={DEFAULT_GEMINI_MODEL}
            spellcheck="false"
            autocomplete="off"
            on:input={(event) => (geminiModel = event.currentTarget.value)}
          />
        </label>
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
