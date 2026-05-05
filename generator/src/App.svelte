<script lang="ts">
	import { GoogleGenAI } from '@google/genai'
	import {
		Columns2,
		Copy,
		Download,
		ExternalLink,
		Grid3X3,
		Info,
		Image as ImageIcon,
		ImagePlus,
		Languages,
		Link2,
		Link2Off,
		List,
		Maximize2,
		Pencil,
		Plus,
		Printer,
		RotateCcw,
		Search,
		Settings,
		Trash2,
		Upload,
		X
	} from 'lucide-svelte'
	import { jsPDF } from 'jspdf'
	import QRCode from 'qrcode'
	import { onMount, tick } from 'svelte'
	import {
		DEFAULT_CARD_GRID_SIZE,
		getA4PageSize,
		markerForLanguage,
		renderCardToCanvas,
		renderLayoutPageToCanvas,
		toRenderableEntries,
		type CardGridSize,
		type ImageTransform,
		type LanguageEntry,
		type LayoutRenderableCard
	} from './lib/card'
	import {
		addCards,
		clearCards,
		createCardId,
		deleteCard,
		getAllCards,
		putCard,
		type StoredCard
	} from './lib/cards-db'
	import {
		IMAGE_SEARCH_PROVIDERS,
		defaultImageSearchProviderConfigs,
		getImageSearchProvider,
		isImageSearchProvider,
		normalizeStoredImageSearchProviderConfigs,
		type ImageSearchProviderConfig,
		type ImageSearchProviderConfigs,
		type ImageSearchProviderId,
		type ImageSearchResult
	} from './lib/image-search'
	import {
		buildPrintLayout,
		dedupeSelectedRectoIds,
		linkVersoCards,
		normalizeVersoLinks,
		removeCardAndVersoLinks,
		unlinkVersoCard,
		type PrintLayout
	} from './lib/printing-press'

	const MAX_ENTRIES = 4
	const GRID_SIZE_OPTIONS: CardGridSize[] = [1, 2, 3, 4]
	const CARD_TEXT_STORAGE_KEY = 'toddler-read-generator-card-text'
	const LEGACY_LANGUAGE_STORAGE_KEY = 'toddler-read-generator-languages'
	const SETTINGS_STORAGE_KEY = 'toddler-read-generator-settings'
	const LIBRARY_SELECTION_STORAGE_KEY = 'toddler-read-generator-selected-card-id'
	const LIBRARY_VIEW_STORAGE_KEY = 'toddler-read-generator-library-view'
	const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
	const IMAGE_SEARCH_RESULTS_PER_PAGE = 12
	const TRANSLATION_PROVIDERS = [
		{ value: 'gemini', label: 'Gemini', model: DEFAULT_GEMINI_MODEL, baseUrl: '' },
		{ value: 'openai', label: 'OpenAI', model: 'gpt-5-mini', baseUrl: 'https://api.openai.com/v1' },
		{
			value: 'deepseek',
			label: 'DeepSeek',
			model: 'deepseek-v4-flash',
			baseUrl: 'https://api.deepseek.com'
		},
		{
			value: 'zai',
			label: 'Z.AI',
			model: 'glm-4.7-flashx',
			baseUrl: 'https://api.z.ai/api/paas/v4'
		},
		{
			value: 'groq',
			label: 'Groq',
			model: 'openai/gpt-oss-120b',
			baseUrl: 'https://api.groq.com/openai/v1'
		},
		{ value: 'custom', label: 'Custom', model: '', baseUrl: '' }
	] as const
	const TRANSLATION_RESPONSE_SCHEMA = {
		translations: [{ index: 2, text: 'translated text' }]
	}
	const DEFAULT_TRANSLATION_PROMPT_TEMPLATE = [
		'Translate these toddler reading card texts.',
		'Use every source text as context for ambiguity and meaning.',
		'Sources JSON: {{sourcesJson}}',
		'Targets JSON: {{targetsJson}}',
		'Return only JSON matching this schema: {{responseSchemaJson}}',
		'For each target, return a short natural translation suitable for a young child.'
	].join('\n')
	const REPOSITORY_URL = 'https://github.com/eddow/toddler-read'
	const KO_FI_URL = 'https://ko-fi.com/emedware'
	let idCounter = 0

	type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]['value']
	type WorkspaceView = 'manager' | 'editor' | 'split' | 'press'
	type ImportMode = 'merge' | 'replace'
	type PresenceFilter = 'all' | 'missing' | 'present'

	type TranslationProviderConfig = {
		apiKey: string
		model: string
		baseUrl?: string
	}

	type TranslationProviderConfigs = Record<TranslationProvider, TranslationProviderConfig>

	type CornerLanguageSetup = {
		id: string
		lang: string
		marker: string
	}

	type TranslationSource = {
		index: number
		lang: string
		text: string
	}

	type TranslationTarget = {
		index: number
		lang: string
	}

	type ImportCardInput = Omit<StoredCard, 'id'> & { id?: string }

	type ImportPlan = {
		cardsToAdd: StoredCard[]
		cardsToMerge: StoredCard[]
		importIdMap: Map<string, string>
		versoLinks: Array<{ sourceId: string; targetId: string }>
		skippedCount: number
		conflictSeparateCount: number
	}

	const initialLanguageSetups = defaultLanguageSetups()

	let languageSetups: CornerLanguageSetup[] = initialLanguageSetups
	let cards: StoredCard[] = []
	let selectedCardId = ''
	let workspaceView: WorkspaceView = 'split'
	let mainLanguage = firstConfiguredLanguage(initialLanguageSetups)
	let languageFilters: Record<string, string> = {}
	let imagePresenceFilter: PresenceFilter = 'all'
	let versoPresenceFilter: PresenceFilter = 'all'
	let selectedPrintCardIds: string[] = []
	let pairingCardId = ''
	let duplicateFocus = ''
	let cardTexts = defaultCardTexts()
	let translationProvider: TranslationProvider = 'gemini'
	let translationProviderConfigs = defaultTranslationProviderConfigs()
	let translationPromptTemplate = DEFAULT_TRANSLATION_PROMPT_TEMPLATE
	let imageSearchProvider: ImageSearchProviderId = 'pexels'
	let imageSearchProviderConfigs: ImageSearchProviderConfigs = defaultImageSearchProviderConfigs()
	let showImageSearchPanel = false
	let imageSearchQuery = ''
	let imageSearchResults: ImageSearchResult[] = []
	let imageSearchPage = 1
	let imageSearchTotalResults = 0
	let imageSearchHasNextPage = false
	let imageSearchStatus = ''
	let imageSearchError = ''
	let imageSearchCardKey = ''
	let imageSearchRequestToken = 0
	let isSearchingImages = false
	let importingImageResultId = ''
	let isTranslating = false
	let gridSize: CardGridSize = DEFAULT_CARD_GRID_SIZE
	let reserveQrMargin = false
	let showQrText = false
	let showSettingsPanel = false
	let showFileMenu = false
	let showHelpPanel = false
	let showApkPanel = false
	let imageDataUrl: string | undefined
	let imageTransform: ImageTransform | undefined
	let previewImageTransform: ImageTransform | undefined
	let imageTransformDraft: ImageTransform | undefined
	let previewCanvas: HTMLCanvasElement
	let exportCanvas: HTMLCanvasElement
	let fileInput: HTMLInputElement
	let importInput: HTMLInputElement
	let isDragging = false
	let renderError = ''
	let translationStatus = ''
	let translationError = ''
	let pngStatus = ''
	let pressStatus = ''
	let pressError = ''
	let libraryStatus = ''
	let libraryError = ''
	let deletingCardId = ''
	let editorDeleteArmed = false
	let importMode: ImportMode = 'merge'
	let apkUrl = ''
	let apkQrDataUrl = ''
	let renderToken = 0
	let pressRenderToken = 0
	let storageReady = false
	let libraryReady = false
	let saveToken = 0
	let rectoPreviewCanvases: HTMLCanvasElement[] = []
	let versoPreviewCanvases: HTMLCanvasElement[] = []
	let pdfCanvas: HTMLCanvasElement
	let panDrag:
		| {
				pointerId: number
				startClientX: number
				startClientY: number
				startOffsetX: number
				startOffsetY: number
		  }
		| undefined
	let panFrame = 0
	let queuedPanTransform: ImageTransform | undefined

	$: selectedCard = cards.find((card) => card.id === selectedCardId)
	$: cardTexts = buildCardTexts(languageSetups, selectedCard)
	$: imageDataUrl = selectedCard?.imageDataUrl
	$: imageTransform = selectedCard?.imageTransform
	$: previewImageTransform = imageTransformDraft ?? imageTransform
	$: managerLanguages = buildManagerLanguages(cards, languageSetups)
	$: if (libraryReady && !managerLanguages.includes(mainLanguage))
		mainLanguage = managerLanguages[0] ?? ''
	$: selectedPrintCardIds = selectedPrintCardIds.filter((id) =>
		cards.some((card) => card.id === id)
	)
	$: selectedRectoCardIds = dedupeSelectedRectoIds(cards, selectedPrintCardIds)
	$: allDisplayedSelected =
		displayedManagerCards.length > 0 &&
		displayedManagerCards.every((card) => selectedPrintCardIds.includes(card.id))
	$: someDisplayedSelected = displayedManagerCards.some((card) =>
		selectedPrintCardIds.includes(card.id)
	)
	$: duplicateColumnKeys = buildDuplicateColumnKeys(cards, mainLanguage)
	$: if (duplicateFocus && !duplicateColumnKeys.has(duplicateFocus)) duplicateFocus = ''
	$: displayedManagerCards = buildDisplayedManagerCards(
		cards,
		duplicateFocus,
		mainLanguage,
		languageFilters,
		imagePresenceFilter,
		versoPresenceFilter
	)
	$: entries = buildEntries(languageSetups, cardTexts)
	$: layoutCards = buildLayoutRenderableCards(cards, languageSetups)
	$: printLayout = buildPrintLayout(cards, selectedRectoCardIds, gridSize)
	$: printWarnings = buildPrintWarnings(cards, selectedRectoCardIds)
	$: renderableEntries = toRenderableEntries(entries)
	$: canExport = renderableEntries.length > 0
	$: showManager = workspaceView === 'manager' || workspaceView === 'split'
	$: showEditor = workspaceView === 'editor' || workspaceView === 'split'
	$: showPress = workspaceView === 'press'
	$: translationSources = buildTranslationSources(entries)
	$: translationTargets = buildTranslationTargets(entries)
	$: currentTranslationProviderConfig = translationProviderConfigs[translationProvider]
	$: currentImageSearchProviderConfig = imageSearchProviderConfigs[imageSearchProvider]
	$: availableImageSearchProviders = IMAGE_SEARCH_PROVIDERS.filter((provider) =>
		imageSearchProviderConfigs[provider.id].apiKey.trim()
	)
	$: translationDisabledReasons = getTranslationDisabledReasons(
		translationProvider,
		currentTranslationProviderConfig,
		translationSources,
		translationTargets
	)
	$: canTranslate = translationDisabledReasons.length === 0 && !isTranslating
	$: translateButtonTitle = isTranslating ? 'Translating...' : translationDisabledReasons.join(', ')
	$: imageSearchProviderInstance = getImageSearchProvider(imageSearchProvider)
	$: imageSearchTotalPages = Math.max(
		1,
		Math.ceil(imageSearchTotalResults / IMAGE_SEARCH_RESULTS_PER_PAGE)
	)
	$: if (
		availableImageSearchProviders.length > 0 &&
		!availableImageSearchProviders.some((provider) => provider.id === imageSearchProvider)
	) {
		imageSearchProvider = availableImageSearchProviders[0].id
		resetImageSearchResults()
	}
	$: currentImageSearchCardKey = selectedCard ? buildImageSearchCardKey(selectedCard) : ''
	$: if (libraryReady && currentImageSearchCardKey !== imageSearchCardKey) {
		imageSearchCardKey = currentImageSearchCardKey
		resetImageSearchForCard(selectedCard)
	}
	$: void schedulePreviewRender(
		imageDataUrl,
		previewImageTransform,
		entries,
		gridSize,
		reserveQrMargin,
		showQrText
	)
	$: void schedulePressPreviewRender(
		printLayout,
		layoutCards,
		gridSize,
		reserveQrMargin,
		showQrText,
		showPress
	)
	$: void scheduleSelectedCardSave(selectedCard)
	$: if (storageReady) {
		localStorage.setItem(LIBRARY_SELECTION_STORAGE_KEY, selectedCardId)
		localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, workspaceView)
		localStorage.setItem(
			SETTINGS_STORAGE_KEY,
			JSON.stringify({
				gridSize,
				reserveQrMargin,
				showQrText,
				mainLanguage,
				languageSetups,
				translationProvider,
				translationProviderConfigs,
				translationPromptTemplate,
				imageSearchProvider,
				imageSearchProviderConfigs
			})
		)
	}

	onMount(() => {
		loadStoredSettings()
		loadLibraryPreferences()
		storageReady = true
		void initializeCardLibrary()
		apkUrl = import.meta.env.VITE_ANDROID_APK_URL || new URL('tr.apk', document.baseURI).href
		void QRCode.toDataURL(apkUrl, {
			errorCorrectionLevel: 'H',
			margin: 1,
			scale: 5,
			color: {
				dark: '#17211b',
				light: '#ffffff'
			}
		}).then((url) => {
			apkQrDataUrl = url
		})

		const onPaste = (event: ClipboardEvent) => handleImagePaste(event)
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				showSettingsPanel = false
				showImageSearchPanel = false
				showFileMenu = false
				showHelpPanel = false
				showApkPanel = false
			}
		}

		window.addEventListener('paste', onPaste)
		window.addEventListener('keydown', onKeyDown)
		return () => {
			window.removeEventListener('paste', onPaste)
			window.removeEventListener('keydown', onKeyDown)
		}
	})

	async function schedulePreviewRender(
		nextImageDataUrl: string | undefined,
		nextImageTransform: ImageTransform | undefined,
		nextEntries: LanguageEntry[],
		nextGridSize: CardGridSize,
		nextReserveQrMargin: boolean,
		nextShowQrText: boolean
	) {
		if (!previewCanvas) return

		const token = ++renderToken
		await tick()
		if (token !== renderToken) return

		try {
			renderError = ''
			await renderCardToCanvas(
				{
					imageDataUrl: nextImageDataUrl,
					imageTransform: nextImageTransform,
					entries: nextEntries,
					gridSize: nextGridSize,
					reserveQrMargin: nextReserveQrMargin,
					showQrText: nextShowQrText
				},
				previewCanvas
			)
		} catch (error) {
			renderError = error instanceof Error ? error.message : 'Could not render card.'
		}
	}

	async function schedulePressPreviewRender(
		nextLayout: PrintLayout,
		nextCards: LayoutRenderableCard[],
		nextGridSize: CardGridSize,
		nextReserveQrMargin: boolean,
		nextShowQrText: boolean,
		isVisible: boolean
	) {
		if (!isVisible || nextLayout.pages.length === 0) return

		const token = ++pressRenderToken
		await tick()
		if (token !== pressRenderToken) return

		try {
			pressError = ''
			for (let index = 0; index < nextLayout.pages.length; index += 1) {
				const page = nextLayout.pages[index]
				const rectoCanvas = rectoPreviewCanvases[index]
				const versoCanvas = versoPreviewCanvases[index]
				if (rectoCanvas) {
					await renderLayoutPageToCanvas(
						{
							slots: page.rectoSlots,
							cards: nextCards,
							gridSize: nextGridSize,
							reserveQrMargin: nextReserveQrMargin,
							showQrText: nextShowQrText
						},
						rectoCanvas
					)
				}
				if (versoCanvas) {
					await renderLayoutPageToCanvas(
						{
							slots: page.versoSlots,
							cards: nextCards,
							gridSize: nextGridSize,
							reserveQrMargin: nextReserveQrMargin,
							showQrText: nextShowQrText
						},
						versoCanvas
					)
				}
			}
		} catch (error) {
			pressError = error instanceof Error ? error.message : 'Could not render layout preview.'
		}
	}

	function createEntryId() {
		idCounter += 1
		return `entry-${Date.now()}-${idCounter}`
	}

	function createLanguageSetup(
		lang: string,
		marker = lang.trim() ? markerForLanguage(lang).marker : ''
	): CornerLanguageSetup {
		return { id: createEntryId(), lang, marker }
	}

	function defaultLanguageSetups(): CornerLanguageSetup[] {
		const setups = browserLanguageDefaults().map((language) => createLanguageSetup(language))
		return normalizeLanguageSetupCount(setups)
	}

	function browserLanguageDefaults(): string[] {
		const configuredLanguages: string[] =
			typeof navigator === 'undefined'
				? []
				: [...(navigator.languages ?? []), navigator.language].filter(
						(language): language is string => typeof language === 'string' && language.length > 0
					)
		const languages: string[] = []
		for (const language of configuredLanguages) {
			const normalized = language.trim().replace(/_/g, '-')
			if (normalized && !languages.includes(normalized)) languages.push(normalized)
			if (languages.length === MAX_ENTRIES) break
		}
		return languages
	}

	function firstConfiguredLanguage(setups: CornerLanguageSetup[]): string {
		return setups.find((setup) => setup.lang.trim())?.lang.trim() ?? ''
	}

	function defaultCardTexts(): string[] {
		return Array.from({ length: MAX_ENTRIES }, () => '')
	}

	function defaultCard(): StoredCard {
		return {
			id: createCardId(),
			texts: buildTextsByLanguage(languageSetups, loadStoredCardTexts())
		}
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
		) as TranslationProviderConfigs
	}

	function buildEntries(setups: CornerLanguageSetup[], texts: string[]): LanguageEntry[] {
		return normalizeLanguageSetupCount(setups).map((setup, index) => ({
			id: setup.id,
			lang: setup.lang,
			marker: setup.marker,
			text: texts[index] ?? ''
		}))
	}

	function editorEntries(
		nextEntries: LanguageEntry[]
	): Array<{ entry: LanguageEntry; index: number }> {
		return nextEntries
			.map((entry, index) => ({ entry, index }))
			.filter(({ entry }) => entry.lang.trim().length > 0)
	}

	function buildCardEntries(setups: CornerLanguageSetup[], card: StoredCard): LanguageEntry[] {
		return buildEntries(setups, buildCardTexts(setups, card))
	}

	function buildLayoutRenderableCards(
		nextCards: StoredCard[],
		setups: CornerLanguageSetup[]
	): LayoutRenderableCard[] {
		return nextCards.map((card) => ({
			id: card.id,
			imageDataUrl: card.imageDataUrl,
			imageTransform: card.imageTransform,
			entries: buildCardEntries(setups, card)
		}))
	}

	function buildCardTexts(setups: CornerLanguageSetup[], card: StoredCard | undefined): string[] {
		const texts = card?.texts ?? {}
		return normalizeLanguageSetupCount(setups).map((setup) => {
			const language = setup.lang.trim()
			return language ? (texts[language] ?? '') : ''
		})
	}

	function buildTextsByLanguage(
		setups: CornerLanguageSetup[],
		texts: string[]
	): Record<string, string> {
		const nextTexts: Record<string, string> = {}
		normalizeLanguageSetupCount(setups).forEach((setup, index) => {
			const language = setup.lang.trim()
			if (!language) return

			const text = texts[index] ?? ''
			if (text) nextTexts[language] = text
		})
		return nextTexts
	}

	function buildManagerLanguages(nextCards: StoredCard[], setups: CornerLanguageSetup[]): string[] {
		const languages = new Set<string>()
		for (const setup of setups) {
			const language = setup.lang.trim()
			if (language) languages.add(language)
		}
		for (const card of nextCards) {
			for (const language of Object.keys(card.texts)) {
				if (language.trim()) languages.add(language)
			}
		}

		return [...languages].sort((left, right) => left.localeCompare(right))
	}

	function loadLibraryPreferences() {
		const storedView = localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY)
		if (isWorkspaceView(storedView)) {
			workspaceView = storedView
		}

		const storedSelectedCardId = localStorage.getItem(LIBRARY_SELECTION_STORAGE_KEY)
		if (storedSelectedCardId) selectedCardId = storedSelectedCardId
	}

	async function initializeCardLibrary() {
		libraryError = ''
		try {
			const storedCards = await getAllCards()
			if (storedCards.length === 0) {
				const firstCard = defaultCard()
				await putCard(firstCard)
				cards = [firstCard]
				selectedCardId = firstCard.id
			} else {
				cards = storedCards
				if (!storedCards.some((card) => card.id === selectedCardId)) {
					selectedCardId = storedCards[0].id
				}
			}
		} catch (error) {
			libraryError = error instanceof Error ? error.message : 'Could not load card library.'
		} finally {
			libraryReady = true
		}
	}

	async function scheduleSelectedCardSave(card: StoredCard | undefined) {
		if (!libraryReady || !card) return

		const token = ++saveToken
		await tick()
		if (token !== saveToken) return

		try {
			await putCard(card)
			libraryError = ''
		} catch (error) {
			libraryError = error instanceof Error ? error.message : 'Could not save card.'
		}
	}

	function loadStoredCardTexts(): string[] {
		try {
			const stored =
				localStorage.getItem(CARD_TEXT_STORAGE_KEY) ??
				localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY)
			if (!stored) return cardTexts

			const parsed = JSON.parse(stored)
			if (!Array.isArray(parsed)) return cardTexts

			const normalized = parsed.slice(0, MAX_ENTRIES).map((entry) => {
				if (typeof entry === 'string') return entry
				if (entry && typeof entry === 'object' && typeof entry.text === 'string') return entry.text
				return ''
			})

			return normalizeCardTextCount(normalized.length > 0 ? normalized : cardTexts)
		} catch {
			return cardTexts
		}
	}

	function normalizeCardTextCount(nextTexts: string[]): string[] {
		const normalized = nextTexts.slice(0, MAX_ENTRIES)
		while (normalized.length < MAX_ENTRIES) normalized.push('')
		return normalized
	}

	function normalizeLanguageSetupCount(nextSetups: CornerLanguageSetup[]): CornerLanguageSetup[] {
		const normalized = nextSetups.slice(0, MAX_ENTRIES)
		while (normalized.length < MAX_ENTRIES) normalized.push(createLanguageSetup(''))
		return normalized
	}

	function loadStoredSettings() {
		try {
			const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
			if (!stored) return

			const parsed = JSON.parse(stored)
			if (!parsed || typeof parsed !== 'object') return

			if (isCardGridSize(parsed.gridSize)) {
				gridSize = parsed.gridSize
			}
			if (typeof parsed.reserveQrMargin === 'boolean') {
				reserveQrMargin = parsed.reserveQrMargin
			}
			if (typeof parsed.showQrText === 'boolean') {
				showQrText = parsed.showQrText
			}
			if (typeof parsed.mainLanguage === 'string') {
				mainLanguage = parsed.mainLanguage
			}
			if (
				typeof parsed.translationPromptTemplate === 'string' &&
				parsed.translationPromptTemplate.trim()
			) {
				translationPromptTemplate = parsed.translationPromptTemplate
			}
			if (isTranslationProvider(parsed.translationProvider)) {
				translationProvider = parsed.translationProvider
			}
			if (
				parsed.translationProviderConfigs &&
				typeof parsed.translationProviderConfigs === 'object'
			) {
				translationProviderConfigs = normalizeStoredTranslationProviderConfigs(
					parsed.translationProviderConfigs
				)
			}
			if (isImageSearchProvider(parsed.imageSearchProvider)) {
				imageSearchProvider = parsed.imageSearchProvider
			}
			if (
				parsed.imageSearchProviderConfigs &&
				typeof parsed.imageSearchProviderConfigs === 'object'
			) {
				imageSearchProviderConfigs = normalizeStoredImageSearchProviderConfigs(
					parsed.imageSearchProviderConfigs
				)
			}
			if (typeof parsed.geminiApiKey === 'string' || typeof parsed.geminiModel === 'string') {
				translationProviderConfigs = migrateLegacyGeminiConfig(
					translationProviderConfigs,
					typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
					typeof parsed.geminiModel === 'string' ? parsed.geminiModel : ''
				)
			}
			if (Array.isArray(parsed.languageSetups)) {
				const normalized = normalizeStoredLanguageSetups(parsed.languageSetups)
				if (normalized.length > 0) {
					languageSetups = normalizeLanguageSetupCount(normalized)
				}
			} else {
				const migrated = loadLegacyLanguageSetups()
				if (migrated.length > 0) {
					languageSetups = normalizeLanguageSetupCount(migrated)
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
				if (!entry || typeof entry !== 'object') return undefined

				const candidate = entry as Partial<CornerLanguageSetup>
				const lang = typeof candidate.lang === 'string' ? candidate.lang : ''
				const marker =
					typeof candidate.marker === 'string' && candidate.marker.trim()
						? candidate.marker
						: lang.trim()
							? markerForLanguage(lang).marker
							: ''

				return {
					id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createEntryId(),
					lang,
					marker
				}
			})
			.filter((entry): entry is CornerLanguageSetup => Boolean(entry))
	}

	function normalizeStoredTranslationProviderConfigs(value: object): TranslationProviderConfigs {
		const configs = defaultTranslationProviderConfigs()
		const storedConfigs = value as Partial<
			Record<TranslationProvider, Partial<TranslationProviderConfig>>
		>

		for (const provider of TRANSLATION_PROVIDERS) {
			const stored = storedConfigs[provider.value]
			if (!stored || typeof stored !== 'object') continue

			configs[provider.value] = {
				apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
				model:
					typeof stored.model === 'string' && stored.model.trim()
						? stored.model
						: configs[provider.value].model,
				baseUrl:
					typeof stored.baseUrl === 'string' ? stored.baseUrl : configs[provider.value].baseUrl
			}
		}

		return configs
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
		}
	}

	function loadLegacyLanguageSetups(): CornerLanguageSetup[] {
		try {
			const stored = localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY)
			if (!stored) return []

			const parsed = JSON.parse(stored)
			if (!Array.isArray(parsed)) return []

			return normalizeStoredLanguageSetups(parsed)
		} catch {
			return []
		}
	}

	function isCardGridSize(value: unknown): value is CardGridSize {
		return typeof value === 'number' && GRID_SIZE_OPTIONS.includes(value as CardGridSize)
	}

	function isTranslationProvider(value: unknown): value is TranslationProvider {
		return (
			typeof value === 'string' &&
			TRANSLATION_PROVIDERS.some((provider) => provider.value === value)
		)
	}

	function isWorkspaceView(value: unknown): value is WorkspaceView {
		return value === 'manager' || value === 'editor' || value === 'split' || value === 'press'
	}

	function updateLanguageSetup(id: string, patch: Partial<CornerLanguageSetup>) {
		languageSetups = languageSetups.map((setup) => {
			if (setup.id !== id) return setup

			const next = { ...setup, ...patch }
			if (typeof patch.lang === 'string' && patch.marker === undefined) {
				next.marker = patch.lang.trim() ? markerForLanguage(patch.lang).marker : ''
			}

			return next
		})
	}

	function updateCardText(index: number, text: string) {
		const setup = normalizeLanguageSetupCount(languageSetups)[index]
		const language = setup?.lang.trim()
		if (!selectedCard || !language) return

		const nextTexts = { ...selectedCard.texts }
		if (text) nextTexts[language] = text
		else delete nextTexts[language]
		updateSelectedCard({ texts: nextTexts })
		translationStatus = ''
		translationError = ''
	}

	function updateSelectedCard(patch: Partial<Omit<StoredCard, 'id'>>) {
		if (!selectedCard) return
		const nextCard = { ...selectedCard, ...patch }
		cards = cards.map((card) => (card.id === selectedCard.id ? nextCard : card))
		editorDeleteArmed = false
	}

	function updateImageTransform(patch: Partial<ImageTransform>) {
		imageTransformDraft = undefined
		const nextTransform = normalizeImageTransform({
			zoom: imageTransform?.zoom ?? 1,
			offsetX: imageTransform?.offsetX ?? 0,
			offsetY: imageTransform?.offsetY ?? 0,
			...patch
		})
		updateSelectedCard({ imageTransform: nextTransform })
		pngStatus = ''
	}

	function resetImageTransform() {
		imageTransformDraft = undefined
		updateSelectedCard({ imageTransform: undefined })
		pngStatus = ''
	}

	function normalizeImageTransform(transform: Partial<ImageTransform>): ImageTransform | undefined {
		const zoom = clampNumber(transform.zoom, 0.5, 3, 1)
		const offsetX = clampNumber(transform.offsetX, -1, 1, 0)
		const offsetY = clampNumber(transform.offsetY, -1, 1, 0)
		if (zoom === 1 && offsetX === 0 && offsetY === 0) return undefined
		return { zoom, offsetX, offsetY }
	}

	function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
		if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
		return Math.min(max, Math.max(min, value))
	}

	function updateTranslationProvider(value: string) {
		if (!isTranslationProvider(value)) return
		translationProvider = value
		translationStatus = ''
		translationError = ''
	}

	function updateTranslationProviderConfig(key: keyof TranslationProviderConfig, value: string) {
		translationProviderConfigs = {
			...translationProviderConfigs,
			[translationProvider]: {
				...translationProviderConfigs[translationProvider],
				[key]: value
			}
		}
		translationStatus = ''
		translationError = ''
	}

	function updateImageSearchProvider(value: string) {
		if (!isImageSearchProvider(value)) return
		imageSearchProvider = value
		resetImageSearchResults()
	}

	function updateImageSearchProviderConfig(
		provider: ImageSearchProviderId,
		key: keyof ImageSearchProviderConfig,
		value: string
	) {
		const nextConfig = {
			...imageSearchProviderConfigs[provider],
			[key]: value
		}
		if (key === 'apiKey') {
			nextConfig.accessToken = undefined
			nextConfig.accessTokenExpiresAt = undefined
		}
		imageSearchProviderConfigs = {
			...imageSearchProviderConfigs,
			[provider]: nextConfig
		}
		resetImageSearchResults()
	}

	function buildTranslationSources(nextEntries: LanguageEntry[]): TranslationSource[] {
		return nextEntries
			.map((entry, index) => ({
				index,
				lang: entry.lang.trim(),
				text: entry.text.trim()
			}))
			.filter((entry) => entry.lang.length > 0 && entry.text.length > 0)
			.map(({ index, lang, text }) => ({ index, lang, text }))
	}

	function buildTranslationTargets(nextEntries: LanguageEntry[]): TranslationTarget[] {
		return nextEntries
			.map((entry, index) => ({
				index,
				lang: entry.lang.trim(),
				text: entry.text.trim()
			}))
			.filter((entry) => entry.lang.length > 0 && entry.text.length === 0)
			.map(({ index, lang }) => ({ index, lang }))
	}

	function getTranslationDisabledReasons(
		provider: TranslationProvider,
		config: TranslationProviderConfig,
		sources: TranslationSource[],
		targets: TranslationTarget[]
	): string[] {
		const reasons: string[] = []
		if (!config.apiKey.trim()) reasons.push('no key')
		if (!config.model.trim()) reasons.push('no model')
		if (isOpenAiCompatibleProvider(provider) && !config.baseUrl?.trim()) reasons.push('no base URL')
		if (sources.length === 0) reasons.push('no source')
		if (targets.length === 0) reasons.push('no target')
		return reasons
	}

	async function translateProducedTexts() {
		if (!canTranslate) return

		isTranslating = true
		translationStatus = ''
		translationError = ''
		try {
			const prompt = buildTranslationPrompt(
				translationPromptTemplate,
				translationSources,
				translationTargets
			)
			const responseText = await requestTranslation(
				translationProvider,
				currentTranslationProviderConfig,
				prompt
			)

			const translations = parseTranslationResponse(responseText)
			const nextTexts = normalizeCardTextCount(cardTexts)
			let appliedCount = 0

			for (const translation of translations) {
				if (!Number.isInteger(translation.index)) continue
				if (translation.index < 0 || translation.index >= MAX_ENTRIES) continue
				if (!translationTargets.some((target) => target.index === translation.index)) continue
				if (typeof translation.text !== 'string' || !translation.text.trim()) continue

				nextTexts[translation.index] = translation.text.trim()
				appliedCount += 1
			}

			if (appliedCount === 0) {
				throw new Error('Gemini returned no usable translations.')
			}

			updateSelectedCard({ texts: buildTextsByLanguage(languageSetups, nextTexts) })
			translationStatus = `Translated ${appliedCount} ${appliedCount === 1 ? 'text' : 'texts'}.`
		} catch (error) {
			translationError = error instanceof Error ? error.message : 'Could not translate.'
		} finally {
			isTranslating = false
		}
	}

	async function requestTranslation(
		provider: TranslationProvider,
		config: TranslationProviderConfig,
		prompt: string
	): Promise<string> {
		if (provider === 'gemini') {
			return requestGeminiTranslation(config, prompt)
		}

		return requestOpenAiCompatibleTranslation(provider, config, prompt)
	}

	async function requestGeminiTranslation(
		config: TranslationProviderConfig,
		prompt: string
	): Promise<string> {
		const ai = new GoogleGenAI({ apiKey: config.apiKey.trim() })
		const response = await ai.models.generateContent({
			model: config.model.trim() || DEFAULT_GEMINI_MODEL,
			contents: prompt,
			config: {
				responseMimeType: 'application/json'
			}
		})

		if (!response.text) throw new Error('Gemini returned an empty response.')
		return response.text
	}

	async function requestOpenAiCompatibleTranslation(
		provider: TranslationProvider,
		config: TranslationProviderConfig,
		prompt: string
	): Promise<string> {
		const baseUrl = config.baseUrl?.trim()
		if (!baseUrl) throw new Error('Missing base URL.')

		const body: Record<string, unknown> = {
			model: config.model.trim(),
			messages: [{ role: 'user', content: prompt }]
		}
		if (provider !== 'custom') {
			body.response_format = { type: 'json_object' }
		}

		const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.apiKey.trim()}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		})

		if (!response.ok) {
			throw new Error(
				`${providerLabel(provider)} request failed: ${response.status} ${response.statusText}`
			)
		}

		const json = await response.json()
		const content = extractOpenAiCompatibleContent(json)
		if (!content) throw new Error(`${providerLabel(provider)} returned an empty response.`)
		return content
	}

	function extractOpenAiCompatibleContent(response: unknown): string {
		if (!response || typeof response !== 'object') return ''
		const choices = (response as { choices?: unknown }).choices
		if (!Array.isArray(choices)) return ''

		const first = choices[0]
		if (!first || typeof first !== 'object') return ''

		const message = (first as { message?: unknown }).message
		if (!message || typeof message !== 'object') return ''

		const content = (message as { content?: unknown }).content
		if (typeof content === 'string') return content
		if (Array.isArray(content)) {
			return content
				.map((part) => {
					if (typeof part === 'string') return part
					if (
						part &&
						typeof part === 'object' &&
						typeof (part as { text?: unknown }).text === 'string'
					) {
						return (part as { text: string }).text
					}
					return ''
				})
				.join('')
		}

		return ''
	}

	function isOpenAiCompatibleProvider(provider: TranslationProvider): boolean {
		return provider !== 'gemini'
	}

	function providerLabel(provider: TranslationProvider): string {
		return TRANSLATION_PROVIDERS.find((entry) => entry.value === provider)?.label ?? provider
	}

	function markerLabelForLanguage(language: string): string {
		return markerForLanguage(language).marker
	}

	function configuredMarkerForLanguage(language: string): string {
		const normalized = language.trim()
		const setup = languageSetups.find((entry) => entry.lang.trim() === normalized)
		return setup?.marker?.trim() || markerLabelForLanguage(normalized)
	}

	function duplicateColumnKeyForLanguage(language: string): string {
		return `language:${language}`
	}

	function buildDuplicateColumnKeys(nextCards: StoredCard[], language: string): Set<string> {
		const keys = new Set<string>()
		if (hasDuplicateValues(nextCards, 'image')) keys.add('image')

		if (language) {
			const key = duplicateColumnKeyForLanguage(language)
			if (hasDuplicateValues(nextCards, key)) keys.add(key)
		}

		return keys
	}

	function hasDuplicateValues(nextCards: StoredCard[], focus: string): boolean {
		for (const count of buildDuplicateValueCounts(nextCards, focus).values()) {
			if (count > 1) return true
		}

		return false
	}

	function buildDisplayedManagerCards(
		nextCards: StoredCard[],
		focus: string,
		language: string,
		filters: Record<string, string>,
		imageFilter: PresenceFilter,
		versoFilter: PresenceFilter
	): StoredCard[] {
		let duplicateFilteredCards = nextCards
		if (focus) {
			const duplicateCounts = buildDuplicateValueCounts(nextCards, focus)
			duplicateFilteredCards = nextCards
				.filter((card) => {
					const value = duplicateValueForCard(card, focus)
					return value.length > 0 && (duplicateCounts.get(value) ?? 0) > 1
				})
				.sort((left, right) => {
					const valueComparison = duplicateValueForCard(left, focus).localeCompare(
						duplicateValueForCard(right, focus)
					)
					if (valueComparison !== 0) return valueComparison

					return managerSortLabel(left, language).localeCompare(managerSortLabel(right, language))
				})
		}

		const imageFilteredCards = duplicateFilteredCards.filter((card) => {
			if (imageFilter === 'missing') return !card.imageDataUrl
			if (imageFilter === 'present') return Boolean(card.imageDataUrl)
			return true
		})
		const presenceFilteredCards = imageFilteredCards.filter((card) => {
			if (versoFilter === 'missing') return !card.versoCardId
			if (versoFilter === 'present') return Boolean(card.versoCardId)
			return true
		})

		const activeFilter = language ? (filters[language] ?? '').trim().toLocaleLowerCase() : ''
		if (!activeFilter) return presenceFilteredCards

		return presenceFilteredCards.filter((card) =>
			(card.texts[language] ?? '').toLocaleLowerCase().includes(activeFilter)
		)
	}

	function buildDuplicateValueCounts(nextCards: StoredCard[], focus: string): Map<string, number> {
		const counts = new Map<string, number>()
		for (const card of nextCards) {
			const value = duplicateValueForCard(card, focus)
			if (!value) continue
			counts.set(value, (counts.get(value) ?? 0) + 1)
		}

		return counts
	}

	function duplicateValueForCard(card: StoredCard, focus: string): string {
		if (focus === 'image') return normalizeCardImage(card.imageDataUrl)
		if (focus.startsWith('language:')) {
			const language = focus.slice('language:'.length)
			return card.texts[language]?.trim() ?? ''
		}

		return ''
	}

	function managerSortLabel(card: StoredCard, language: string): string {
		return card.texts[language]?.trim() || card.id
	}

	function toggleDuplicateFocus(focus: string) {
		duplicateFocus = duplicateFocus === focus ? '' : focus
		deletingCardId = ''
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
		)
	}

	function replaceTemplatePlaceholder(
		template: string,
		placeholder: string,
		value: string
	): string {
		return template.split(placeholder).join(value)
	}

	function parseTranslationResponse(text: string): Array<{ index: number; text: string }> {
		const parsed = JSON.parse(extractJsonText(text))
		if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.translations)) {
			throw new Error('Gemini response did not include a translations array.')
		}

		return parsed.translations
	}

	function extractJsonText(text: string): string {
		const trimmed = text.trim()
		const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
		if (fenced) return fenced[1].trim()

		const objectStart = trimmed.indexOf('{')
		const objectEnd = trimmed.lastIndexOf('}')
		if (objectStart >= 0 && objectEnd > objectStart) {
			return trimmed.slice(objectStart, objectEnd + 1)
		}

		return trimmed
	}

	function chooseImage() {
		fileInput.click()
	}

	function openImageSearch() {
		if (
			availableImageSearchProviders.length > 0 &&
			!availableImageSearchProviders.some((provider) => provider.id === imageSearchProvider)
		) {
			imageSearchProvider = availableImageSearchProviders[0].id
		}
		imageSearchQuery = imageSearchQuery.trim() || defaultImageSearchQuery()
		showImageSearchPanel = true
		imageSearchStatus = ''
		imageSearchError =
			availableImageSearchProviders.length > 0
				? ''
				: 'Add a Pexels or Flaticon API key in Settings.'
		if (imageSearchError) imageSearchResults = []
		if (imageSearchQuery && availableImageSearchProviders.length > 0) {
			void searchImages(1)
		}
	}

	function closeImageSearch() {
		showImageSearchPanel = false
		importingImageResultId = ''
	}

	function buildImageSearchCardKey(card: StoredCard): string {
		return `${card.id}:${JSON.stringify(card.texts)}`
	}

	function resetImageSearchForCard(card: StoredCard | undefined) {
		imageSearchQuery = defaultImageSearchQueryForCard(card)
		resetImageSearchResults()
	}

	function resetImageSearchResults() {
		imageSearchRequestToken += 1
		imageSearchResults = []
		imageSearchPage = 1
		imageSearchTotalResults = 0
		imageSearchHasNextPage = false
		imageSearchStatus = ''
		imageSearchError = ''
		isSearchingImages = false
		importingImageResultId = ''
	}

	function defaultImageSearchQuery(): string {
		return defaultImageSearchQueryForCard(selectedCard)
	}

	function defaultImageSearchQueryForCard(card: StoredCard | undefined): string {
		const englishText = card?.texts.en?.trim()
		if (englishText) return englishText

		return (
			normalizeLanguageSetupCount(languageSetups)
				.map((setup) => setup.lang.trim())
				.map((language) => (language ? card?.texts[language]?.trim() : ''))
				.find((text) => text && text.length > 0) ?? ''
		)
	}

	function imageSearchProviderSourceUrl(provider: ImageSearchProviderId): string {
		if (provider === 'flaticon') return 'https://www.flaticon.com'
		return 'https://www.pexels.com'
	}

	async function searchImages(page = 1) {
		if (isSearchingImages) return

		const query = imageSearchQuery.trim()
		if (!currentImageSearchProviderConfig.apiKey.trim()) {
			imageSearchError = `Add a ${imageSearchProviderInstance.label} API key in Settings.`
			imageSearchStatus = ''
			imageSearchResults = []
			return
		}
		if (!query) {
			imageSearchError = 'Enter a search term.'
			imageSearchStatus = ''
			imageSearchResults = []
			return
		}

		const token = ++imageSearchRequestToken
		isSearchingImages = true
		imageSearchStatus = ''
		imageSearchError = ''
		try {
			const response = await imageSearchProviderInstance.search(
				query,
				{ page, perPage: IMAGE_SEARCH_RESULTS_PER_PAGE },
				currentImageSearchProviderConfig
			)
			if (token !== imageSearchRequestToken) return

			imageSearchResults = response.results
			imageSearchPage = response.page
			imageSearchTotalResults = response.totalResults
			imageSearchHasNextPage = response.hasNextPage
			const visibleTotal = response.totalResults || response.results.length
			imageSearchStatus =
				response.results.length === 0
					? 'No images found.'
					: `${visibleTotal.toLocaleString()} image${visibleTotal === 1 ? '' : 's'} found.`
		} catch (error) {
			if (token !== imageSearchRequestToken) return

			imageSearchResults = []
			imageSearchHasNextPage = false
			imageSearchStatus = ''
			imageSearchError = error instanceof Error ? error.message : 'Could not search images.'
		} finally {
			if (token === imageSearchRequestToken) isSearchingImages = false
		}
	}

	async function importImageSearchResult(result: ImageSearchResult) {
		if (importingImageResultId) return

		importingImageResultId = result.id
		imageSearchStatus = ''
		imageSearchError = ''
		try {
			const nextImageDataUrl = await imageSearchProviderInstance.importResult(result)
			updateSelectedCard({ imageDataUrl: nextImageDataUrl, imageTransform: undefined })
			pngStatus = ''
			imageSearchStatus = 'Image added.'
			closeImageSearch()
		} catch (error) {
			imageSearchError = error instanceof Error ? error.message : 'Could not import image.'
		} finally {
			importingImageResultId = ''
		}
	}

	function clearImage() {
		imageTransformDraft = undefined
		updateSelectedCard({ imageDataUrl: undefined, imageTransform: undefined })
		pngStatus = ''
	}

	async function onFileSelected(event: Event) {
		const target = event.currentTarget as HTMLInputElement
		const file = target.files?.[0]
		if (file) await readImageFile(file)
		target.value = ''
	}

	async function onDrop(event: DragEvent) {
		event.preventDefault()
		isDragging = false
		const file = [...(event.dataTransfer?.files ?? [])].find((item) =>
			item.type.startsWith('image/')
		)
		if (file) await readImageFile(file)
	}

	function handleImagePaste(event: ClipboardEvent) {
		const file = getClipboardImageFile(event.clipboardData)
		if (!file) return

		event.preventDefault()
		void readImageFile(file)
	}

	function getClipboardImageFile(data: DataTransfer | null): File | undefined {
		const file = [...(data?.files ?? [])].find((item) => item.type.startsWith('image/'))
		if (file) return file

		return (
			[...(data?.items ?? [])]
				.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
				?.getAsFile() ?? undefined
		)
	}

	async function readImageFile(file: File) {
		if (!file.type.startsWith('image/')) {
			renderError = 'Please choose an image file.'
			return
		}

		const nextImageDataUrl = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => resolve(String(reader.result))
			reader.onerror = () => reject(new Error('Could not read image.'))
			reader.readAsDataURL(file)
		})
		imageTransformDraft = undefined
		updateSelectedCard({ imageDataUrl: nextImageDataUrl, imageTransform: undefined })
		pngStatus = ''
	}

	function startImagePan(event: PointerEvent) {
		if (!imageDataUrl || !previewCanvas) return
		const target = event.currentTarget as HTMLCanvasElement
		target.setPointerCapture(event.pointerId)
		panDrag = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startOffsetX: previewImageTransform?.offsetX ?? 0,
			startOffsetY: previewImageTransform?.offsetY ?? 0
		}
	}

	function moveImagePan(event: PointerEvent) {
		if (!panDrag || panDrag.pointerId !== event.pointerId || !previewCanvas) return
		const rect = previewCanvas.getBoundingClientRect()
		if (rect.width <= 0 || rect.height <= 0) return
		queueImagePanDraft({
			zoom: previewImageTransform?.zoom ?? 1,
			offsetX: panDrag.startOffsetX + ((event.clientX - panDrag.startClientX) / rect.width) * 2,
			offsetY: panDrag.startOffsetY + ((event.clientY - panDrag.startClientY) / rect.height) * 2
		})
	}

	function stopImagePan(event: PointerEvent) {
		if (!panDrag || panDrag.pointerId !== event.pointerId) return
		panDrag = undefined
		const nextTransform = queuedPanTransform ?? imageTransformDraft ?? imageTransform
		queuedPanTransform = undefined
		if (panFrame) {
			cancelAnimationFrame(panFrame)
			panFrame = 0
		}
		updateSelectedCard({ imageTransform: nextTransform })
		imageTransformDraft = undefined
		pngStatus = ''
	}

	function queueImagePanDraft(transform: Partial<ImageTransform>) {
		queuedPanTransform = normalizeImageTransform(transform)
		if (panFrame) return
		panFrame = requestAnimationFrame(() => {
			panFrame = 0
			imageTransformDraft = queuedPanTransform
		})
	}

	function selectCard(id: string) {
		selectedCardId = id
		deletingCardId = ''
		editorDeleteArmed = false
		libraryStatus = ''
		libraryError = ''
	}

	function togglePrintCard(id: string) {
		selectedPrintCardIds = selectedPrintCardIds.includes(id)
			? selectedPrintCardIds.filter((cardId) => cardId !== id)
			: [...selectedPrintCardIds, id]
		pressStatus = ''
		pressError = ''
	}

	function toggleDisplayedPrintSelection() {
		const displayedIds = displayedManagerCards.map((card) => card.id)
		if (displayedIds.length === 0) return
		if (displayedIds.every((id) => selectedPrintCardIds.includes(id))) {
			selectedPrintCardIds = selectedPrintCardIds.filter((id) => !displayedIds.includes(id))
		} else {
			selectedPrintCardIds = [...new Set([...selectedPrintCardIds, ...displayedIds])]
		}
		pressStatus = ''
		pressError = ''
	}

	function updateMainLanguage(value: string) {
		mainLanguage = value
		pairingCardId = ''
	}

	function updateLanguageFilter(language: string, value: string) {
		languageFilters = {
			...languageFilters,
			[language]: value
		}
	}

	function updateImagePresenceFilter(value: string) {
		imagePresenceFilter = normalizePresenceFilter(value)
	}

	function updateVersoPresenceFilter(value: string) {
		versoPresenceFilter = normalizePresenceFilter(value)
	}

	function normalizePresenceFilter(value: string): PresenceFilter {
		if (value === 'missing' || value === 'present') return value
		return 'all'
	}

	function setIndeterminate(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value
		return {
			update(nextValue: boolean) {
				node.indeterminate = nextValue
			}
		}
	}

	async function updateVersoLink(cardId: string, versoCardId: string) {
		const nextCards = versoCardId
			? linkVersoCards(cards, cardId, versoCardId)
			: unlinkVersoCard(cards, cardId)
		await persistCardsPatch(nextCards)
		pairingCardId = ''
	}

	async function clearVersoLink(cardId: string) {
		await persistCardsPatch(unlinkVersoCard(cards, cardId))
		pairingCardId = ''
	}

	async function persistCardsPatch(nextCards: StoredCard[]) {
		const changedCards = nextCards.filter((card) => {
			const current = cards.find((entry) => entry.id === card.id)
			return JSON.stringify(current) !== JSON.stringify(card)
		})
		cards = nextCards
		libraryStatus = ''
		libraryError = ''
		try {
			await Promise.all(changedCards.map((card) => putCard(card)))
		} catch (error) {
			libraryError = error instanceof Error ? error.message : 'Could not save card links.'
		}
	}

	function cardLabel(card: StoredCard | undefined): string {
		if (!card) return 'Missing card'
		return card.texts[mainLanguage]?.trim() || card.id
	}

	function linkedCardLabel(card: StoredCard): string {
		return card.versoCardId
			? cardLabel(cards.find((entry) => entry.id === card.versoCardId))
			: 'No verso'
	}

	function candidateCardsFor(card: StoredCard): StoredCard[] {
		return cards
			.filter(
				(candidate) =>
					candidate.id !== card.id && (!candidate.versoCardId || candidate.id === card.versoCardId)
			)
			.sort((left, right) => cardLabel(left).localeCompare(cardLabel(right)))
	}

	function buildPrintWarnings(nextCards: StoredCard[], rectoIds: string[]): string[] {
		const warnings: string[] = []
		const cardById = new Map(nextCards.map((card) => [card.id, card]))
		const missingVersoCount = rectoIds.filter((id) => !cardById.get(id)?.versoCardId).length

		if (missingVersoCount > 0) {
			warnings.push(
				`${missingVersoCount} selected ${missingVersoCount === 1 ? 'card has' : 'cards have'} blank verso slots.`
			)
		}

		return warnings
	}

	async function createNewCard() {
		const card: StoredCard = { id: createCardId(), texts: {} }
		cards = [...cards, card]
		selectedCardId = card.id
		workspaceView = workspaceView === 'manager' ? 'editor' : workspaceView
		libraryStatus = 'New card created.'
		libraryError = ''
		try {
			await putCard(card)
		} catch (error) {
			libraryError = error instanceof Error ? error.message : 'Could not create card.'
		}
	}

	async function confirmDeleteCard(id: string) {
		const remainingCards = removeCardAndVersoLinks(cards, id)
		const changedCards = remainingCards.filter((card) => {
			const current = cards.find((entry) => entry.id === card.id)
			return JSON.stringify(current) !== JSON.stringify(card)
		})
		const fallbackCard = remainingCards[0] ?? { id: createCardId(), texts: {} }
		cards = remainingCards.length > 0 ? remainingCards : [fallbackCard]
		selectedPrintCardIds = selectedPrintCardIds.filter((cardId) => cardId !== id)
		if (selectedCardId === id) {
			selectedCardId = fallbackCard.id
		}
		deletingCardId = ''
		editorDeleteArmed = false
		libraryStatus = 'Card deleted.'
		libraryError = ''

		try {
			await deleteCard(id)
			await Promise.all(changedCards.map((card) => putCard(card)))
			if (remainingCards.length === 0) await putCard(fallbackCard)
		} catch (error) {
			libraryError = error instanceof Error ? error.message : 'Could not delete card.'
			cards = await getAllCards()
			if (!cards.some((card) => card.id === selectedCardId) && cards[0])
				selectedCardId = cards[0].id
		}
	}

	function chooseImportFile(mode: ImportMode = 'merge') {
		if (
			mode === 'replace' &&
			!window.confirm('Replace all cards with the selected import file? This cannot be undone.')
		) {
			return
		}

		importMode = mode
		importInput.click()
	}

	async function onImportFileSelected(event: Event) {
		const target = event.currentTarget as HTMLInputElement
		const file = target.files?.[0]
		const mode = importMode
		importMode = 'merge'
		if (file) await importCardsFile(file, mode)
		target.value = ''
	}

	async function importCardsFile(file: File, mode: ImportMode = 'merge') {
		libraryStatus = ''
		libraryError = ''

		try {
			const payload = JSON.parse(await file.text())
			const importCards = parseImportCards(payload)
			if (importCards.length === 0) throw new Error('Import file has no cards.')

			const importPlan = planCardImport(mode === 'replace' ? [] : cards, importCards)
			if (mode === 'replace') {
				await clearCards()
				const addedCards =
					importPlan.cardsToAdd.length > 0 ? await addCards(importPlan.cardsToAdd) : []
				cards = await applyImportedVersoLinks(addedCards, importPlan)
				selectedPrintCardIds = []
				pairingCardId = ''
				deletingCardId = ''
				selectedCardId = cards[0]?.id ?? ''
				libraryStatus = `Replaced library with ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}.`
				return
			}

			const addedCards =
				importPlan.cardsToAdd.length > 0 ? await addCards(importPlan.cardsToAdd) : []
			for (const card of importPlan.cardsToMerge) {
				await putCard(card)
			}

			cards = cards
				.map(
					(card) => importPlan.cardsToMerge.find((mergedCard) => mergedCard.id === card.id) ?? card
				)
				.concat(addedCards)
			cards = await applyImportedVersoLinks(cards, importPlan)
			if (addedCards[0]) selectedCardId = addedCards[0].id
			else if (importPlan.cardsToMerge[0]) selectedCardId = importPlan.cardsToMerge[0].id
			libraryStatus = buildImportSummary({
				importedCount: addedCards.length,
				mergedCount: importPlan.cardsToMerge.length,
				skippedCount: importPlan.skippedCount,
				conflictSeparateCount: importPlan.conflictSeparateCount
			})
		} catch (error) {
			libraryError =
				error instanceof Error
					? error.message
					: mode === 'replace'
						? 'Could not replace cards.'
						: 'Could not import cards.'
			cards = await getAllCards()
			if (!cards.some((card) => card.id === selectedCardId)) selectedCardId = cards[0]?.id ?? ''
		}
	}

	function parseImportCards(payload: unknown): ImportCardInput[] {
		if (!payload || typeof payload !== 'object') return []
		const cardsPayload = (payload as { cards?: unknown }).cards
		if (!Array.isArray(cardsPayload)) return []

		return cardsPayload
			.map((card): ImportCardInput | undefined => {
				if (!card || typeof card !== 'object') return undefined
				const candidate = card as Partial<StoredCard>
				const id =
					typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : undefined
				const texts = normalizeImportTexts(candidate.texts)
				const imageDataUrl =
					normalizeCardImage(candidate.imageDataUrl).length > 0
						? normalizeCardImage(candidate.imageDataUrl)
						: undefined
				const imageTransform = imageDataUrl
					? normalizeImageTransformForImport(candidate.imageTransform)
					: undefined
				const versoCardId =
					typeof candidate.versoCardId === 'string' && candidate.versoCardId.trim()
						? candidate.versoCardId.trim()
						: undefined
				if (!imageDataUrl && Object.keys(texts).length === 0) return undefined
				return { id, imageDataUrl, imageTransform, texts, versoCardId }
			})
			.filter((card): card is ImportCardInput => Boolean(card))
	}

	function normalizeImportTexts(texts: unknown): Record<string, string> {
		if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return {}

		return Object.fromEntries(
			Object.entries(texts)
				.map(([language, text]) => [language.trim(), typeof text === 'string' ? text.trim() : ''])
				.filter(([language, text]) => language.length > 0 && text.length > 0)
		)
	}

	function planCardImport(existingCards: StoredCard[], importCards: ImportCardInput[]): ImportPlan {
		const existingCardIds = new Set(existingCards.map((card) => card.id))
		const workingCards = existingCards.map((card) => normalizeStoredCardForImport(card))
		const cardsToAdd: StoredCard[] = []
		const cardsToMerge = new Map<string, StoredCard>()
		const importIdMap = new Map<string, string>()
		const versoLinks: Array<{ sourceId: string; targetId: string }> = []
		let skippedCount = 0
		let conflictSeparateCount = 0

		for (const importCard of importCards) {
			const normalizedImportCard = normalizeImportCardInput(importCard)
			if (normalizedImportCard.id && normalizedImportCard.versoCardId) {
				versoLinks.push({
					sourceId: normalizedImportCard.id,
					targetId: normalizedImportCard.versoCardId
				})
			}
			const exactDuplicate = workingCards.some(
				(card) => cardFingerprint(card) === cardFingerprint(normalizedImportCard)
			)

			if (exactDuplicate) {
				const exactCard = workingCards.find(
					(card) => cardFingerprint(card) === cardFingerprint(normalizedImportCard)
				)
				if (normalizedImportCard.id && exactCard)
					importIdMap.set(normalizedImportCard.id, exactCard.id)
				skippedCount += 1
				continue
			}

			const sameImageCard = workingCards.find(
				(card) =>
					normalizeCardImage(card.imageDataUrl) ===
					normalizeCardImage(normalizedImportCard.imageDataUrl)
			)

			if (!sameImageCard) {
				const cardToAdd = {
					...withoutVersoLink(normalizedImportCard),
					id: reusableImportCardId(normalizedImportCard.id, workingCards)
				}
				if (normalizedImportCard.id) importIdMap.set(normalizedImportCard.id, cardToAdd.id)
				cardsToAdd.push(cardToAdd)
				workingCards.push(cardToAdd)
				continue
			}
			if (normalizedImportCard.id) importIdMap.set(normalizedImportCard.id, sameImageCard.id)

			const importedEntries = Object.entries(normalizedImportCard.texts)
			const hasConflict = importedEntries.some(
				([language, text]) =>
					sameImageCard.texts[language] !== undefined && sameImageCard.texts[language] !== text
			)

			if (hasConflict) {
				const cardToAdd = {
					...withoutVersoLink(normalizedImportCard),
					id: reusableImportCardId(normalizedImportCard.id, workingCards)
				}
				if (normalizedImportCard.id) importIdMap.set(normalizedImportCard.id, cardToAdd.id)
				cardsToAdd.push(cardToAdd)
				workingCards.push(cardToAdd)
				conflictSeparateCount += 1
				continue
			}

			const missingEntries = importedEntries.filter(
				([language]) => sameImageCard.texts[language] === undefined
			)
			if (missingEntries.length === 0) {
				skippedCount += 1
				continue
			}

			const mergedCard = {
				...sameImageCard,
				texts: normalizeTextRecord({
					...sameImageCard.texts,
					...Object.fromEntries(missingEntries)
				})
			}
			const workingIndex = workingCards.findIndex((card) => card.id === sameImageCard.id)
			if (workingIndex >= 0) workingCards[workingIndex] = mergedCard
			if (existingCardIds.has(mergedCard.id)) {
				cardsToMerge.set(mergedCard.id, mergedCard)
			} else {
				const addIndex = cardsToAdd.findIndex((card) => card.id === mergedCard.id)
				if (addIndex >= 0) cardsToAdd[addIndex] = mergedCard
			}
		}

		return {
			cardsToAdd,
			cardsToMerge: [...cardsToMerge.values()],
			importIdMap,
			versoLinks,
			skippedCount,
			conflictSeparateCount
		}
	}

	async function applyImportedVersoLinks(
		nextCards: StoredCard[],
		importPlan: ImportPlan
	): Promise<StoredCard[]> {
		let linkedCards = nextCards
		for (const link of importPlan.versoLinks) {
			const sourceId = importPlan.importIdMap.get(link.sourceId)
			const targetId = importPlan.importIdMap.get(link.targetId)
			if (!sourceId || !targetId || sourceId === targetId) continue
			linkedCards = linkVersoCards(linkedCards, sourceId, targetId)
		}

		linkedCards = normalizeVersoLinks(linkedCards)
		const changedCards = linkedCards.filter((card) => {
			const current = nextCards.find((entry) => entry.id === card.id)
			return JSON.stringify(current) !== JSON.stringify(card)
		})
		await Promise.all(changedCards.map((card) => putCard(card)))
		return linkedCards
	}

	function withoutVersoLink(card: ImportCardInput): Omit<ImportCardInput, 'versoCardId'> {
		const { versoCardId: _removed, ...nextCard } = card
		return nextCard
	}

	function normalizeStoredCardForImport(card: StoredCard): StoredCard {
		const imageDataUrl = normalizeCardImage(card.imageDataUrl) || undefined
		return {
			id: card.id,
			imageDataUrl,
			imageTransform: imageDataUrl
				? normalizeImageTransformForImport(card.imageTransform)
				: undefined,
			texts: normalizeTextRecord(card.texts),
			versoCardId: normalizeImportCardId(card.versoCardId)
		}
	}

	function normalizeImportCardInput(card: ImportCardInput): ImportCardInput {
		const imageDataUrl = normalizeCardImage(card.imageDataUrl) || undefined
		return {
			id: normalizeImportCardId(card.id),
			imageDataUrl,
			imageTransform: imageDataUrl
				? normalizeImageTransformForImport(card.imageTransform)
				: undefined,
			texts: normalizeTextRecord(card.texts),
			versoCardId: normalizeImportCardId(card.versoCardId)
		}
	}

	function normalizeImportCardId(id: unknown): string | undefined {
		return typeof id === 'string' && id.trim() ? id.trim() : undefined
	}

	function reusableImportCardId(id: string | undefined, existingCards: StoredCard[]): string {
		return id && !existingCards.some((card) => card.id === id) ? id : createCardId()
	}

	function normalizeCardImage(imageDataUrl: unknown): string {
		return typeof imageDataUrl === 'string' ? imageDataUrl.trim() : ''
	}

	function normalizeImageTransformForImport(transform: unknown): ImageTransform | undefined {
		if (!transform || typeof transform !== 'object') return undefined
		return normalizeImageTransform(transform as Partial<ImageTransform>)
	}

	function normalizeTextRecord(texts: unknown): Record<string, string> {
		if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return {}

		return Object.fromEntries(
			Object.entries(texts)
				.map(([language, text]) => [language.trim(), typeof text === 'string' ? text.trim() : ''])
				.filter(([language, text]) => language.length > 0 && text.length > 0)
				.sort(([left], [right]) => left.localeCompare(right))
		)
	}

	function cardFingerprint(card: ImportCardInput | StoredCard): string {
		return JSON.stringify({
			imageDataUrl: normalizeCardImage(card.imageDataUrl),
			imageTransform: normalizeImageTransformForImport(card.imageTransform),
			texts: normalizeTextRecord(card.texts)
		})
	}

	function buildImportSummary(result: {
		importedCount: number
		mergedCount: number
		skippedCount: number
		conflictSeparateCount: number
	}): string {
		const parts: string[] = []
		if (result.importedCount > 0) {
			parts.push(
				`Imported ${result.importedCount} ${result.importedCount === 1 ? 'card' : 'cards'}`
			)
		}
		if (result.mergedCount > 0) {
			parts.push(`Merged ${result.mergedCount}`)
		}
		if (result.skippedCount > 0) {
			parts.push(
				`Skipped ${result.skippedCount} ${result.skippedCount === 1 ? 'duplicate' : 'duplicates'}`
			)
		}
		if (result.conflictSeparateCount > 0) {
			parts.push(
				`Kept ${result.conflictSeparateCount} ${
					result.conflictSeparateCount === 1 ? 'conflict' : 'conflicts'
				} separate`
			)
		}

		return parts.length > 0 ? `${parts.join('. ')}.` : 'Nothing to import.'
	}

	function exportCards() {
		const payload = {
			version: 1,
			cards: cards.map((card) => ({
				id: card.id,
				imageDataUrl: card.imageDataUrl,
				imageTransform: card.imageTransform,
				texts: card.texts,
				versoCardId: card.versoCardId
			}))
		}
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = 'toddler-read-cards.json'
		anchor.click()
		URL.revokeObjectURL(url)
		libraryStatus = `Exported ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}.`
		libraryError = ''
	}

	function updateGridSize(event: Event) {
		gridSize = Number((event.currentTarget as HTMLSelectElement).value) as CardGridSize
		pngStatus = ''
	}

	function updateReserveQrMargin(event: Event) {
		reserveQrMargin = (event.currentTarget as HTMLInputElement).checked
		pngStatus = ''
	}

	function updateShowQrText(event: Event) {
		showQrText = (event.currentTarget as HTMLInputElement).checked
		pngStatus = ''
	}

	async function openPngPreview() {
		if (!canExport) return

		pngStatus = ''
		try {
			await renderCardToCanvas(
				{ imageDataUrl, imageTransform, entries, gridSize, reserveQrMargin, showQrText },
				exportCanvas
			)
			const blob = await canvasToBlob(exportCanvas)
			const url = URL.createObjectURL(blob)
			const opened = window.open(url, '_blank', 'noopener,noreferrer')

			if (!opened) {
				URL.revokeObjectURL(url)
				throw new Error('Could not open PNG preview. Please allow pop-ups for this page.')
			}

			window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
			pngStatus = 'PNG opened in a new tab.'
		} catch (error) {
			pngStatus = error instanceof Error ? error.message : 'Could not open PNG.'
		}
	}

	async function downloadLayoutPdf() {
		if (printLayout.pages.length === 0 || !pdfCanvas) return

		pressStatus = ''
		pressError = ''
		try {
			const pageSize = getA4PageSize()
			const pdf = new jsPDF({
				orientation: 'portrait',
				unit: 'px',
				format: [pageSize.width, pageSize.height],
				compress: true
			})
			let isFirstPage = true

			for (const page of printLayout.pages) {
				for (const slots of [page.rectoSlots, page.versoSlots]) {
					await renderLayoutPageToCanvas(
						{
							slots,
							cards: layoutCards,
							gridSize,
							reserveQrMargin,
							showQrText
						},
						pdfCanvas
					)
					if (!isFirstPage) pdf.addPage([pageSize.width, pageSize.height], 'portrait')
					pdf.addImage(
						pdfCanvas.toDataURL('image/png'),
						'PNG',
						0,
						0,
						pageSize.width,
						pageSize.height
					)
					isFirstPage = false
				}
			}

			const pdfBlob = pdf.output('blob')
			const anchor = document.createElement('a')
			const url = URL.createObjectURL(pdfBlob)
			anchor.href = url
			anchor.download = 'toddler-read-print-layout.pdf'
			anchor.click()
			URL.revokeObjectURL(url)
			pressStatus = `PDF downloaded with ${printLayout.pages.length * 2} pages.`
		} catch (error) {
			pressError = error instanceof Error ? error.message : 'Could not download PDF.'
		}
	}

	function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
		return new Promise((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) resolve(blob)
				else reject(new Error('Could not create PNG.'))
			}, 'image/png')
		})
	}
</script>

<svelte:head>
	<title>Toddler QR Card Generator</title>
	<link rel="icon" type="image/png" href="/favicon.png" />
	<link rel="apple-touch-icon" href="/app-icon.png" />
</svelte:head>

<main class="app-shell">
	<header class="app-header library-header">
		<div class="brand-block">
			<button
				type="button"
				class="app-logo-button"
				aria-label="Open help"
				title="Help"
				on:click={() => (showHelpPanel = true)}
			>
				<img src="/app-icon.png" alt="" />
				<Info size={15} aria-hidden="true" />
			</button>
			<div class="title-block">
				<p class="eyebrow">Toddler Read</p>
				<h1>Toddler Read QR Card Generator</h1>
			</div>
		</div>
		<div class="library-top-actions">
			<div class="segmented-control" aria-label="Workspace view">
				<button
					type="button"
					class:active={workspaceView === 'manager'}
					aria-label="Manager"
					title="Manager"
					on:click={() => (workspaceView = 'manager')}
				>
					<List size={18} aria-hidden="true" />
				</button>
				<button
					type="button"
					class:active={workspaceView === 'split'}
					aria-label="Split"
					title="Split"
					on:click={() => (workspaceView = 'split')}
				>
					<Columns2 size={18} aria-hidden="true" />
				</button>
				<button
					type="button"
					class:active={workspaceView === 'editor'}
					aria-label="Editor"
					title="Editor"
					on:click={() => (workspaceView = 'editor')}
				>
					<Pencil size={18} aria-hidden="true" />
				</button>
				<button
					type="button"
					class:active={workspaceView === 'press'}
					aria-label="Printing press"
					title="Printing press"
					on:click={() => (workspaceView = 'press')}
				>
					<Printer size={18} aria-hidden="true" />
				</button>
			</div>
			<label class="grid-size-control toolbar-grid-control" title="A4 grid">
				<Grid3X3 size={18} aria-hidden="true" />
				<select value={gridSize} aria-label="A4 grid" on:change={updateGridSize}>
					{#each GRID_SIZE_OPTIONS as option}
						<option value={option}>{option}x{option}</option>
					{/each}
				</select>
			</label>
			{#if managerLanguages.length > 0}
				<label class="main-language-control toolbar-language-control">
					<Languages size={18} aria-hidden="true" />
					<select
						value={mainLanguage}
						aria-label="Reference language"
						title={`Reference language: ${mainLanguage}`}
						on:change={(event) => updateMainLanguage(event.currentTarget.value)}
					>
						{#each managerLanguages as language}
							<option value={language}>{configuredMarkerForLanguage(language)}</option>
						{/each}
					</select>
				</label>
			{/if}
			<button
				type="button"
				class="secondary icon-button"
				aria-label="Settings"
				title="Settings"
				on:click={() => (showSettingsPanel = !showSettingsPanel)}
			>
				<Settings size={18} aria-hidden="true" />
			</button>
			<button type="button" on:click={createNewCard}>
				<Plus size={18} aria-hidden="true" />
				New card
			</button>
			<details class="file-menu" bind:open={showFileMenu}>
				<summary class="secondary" aria-label="File actions">File</summary>
				<div class="file-menu-panel">
					<button
						type="button"
						class="secondary"
						on:click={() => {
							showFileMenu = false
							chooseImportFile('merge')
						}}
					>
						<Upload size={18} aria-hidden="true" />
						Import
					</button>
					<button
						type="button"
						class="secondary"
						on:click={() => {
							showFileMenu = false
							chooseImportFile('replace')
						}}
					>
						<Upload size={18} aria-hidden="true" />
						Replace
					</button>
					<button
						type="button"
						class="secondary"
						disabled={cards.length === 0}
						on:click={() => {
							showFileMenu = false
							exportCards()
						}}
					>
						<Download size={18} aria-hidden="true" />
						Export
					</button>
				</div>
			</details>
			{#if apkQrDataUrl}
				<button
					type="button"
					class="apk-qr"
					aria-label="Show Android APK QR code"
					title="Show Android APK QR code"
					on:click={() => (showApkPanel = true)}
				>
					<span class="apk-qr-icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" role="img">
							<path
								d="M7.1 4.3 5.5 2.7 4.6 3.6 6.2 5.2a6.9 6.9 0 0 0-2.1 5h15.8a6.9 6.9 0 0 0-2.1-5l1.6-1.6-.9-.9-1.6 1.6A7.6 7.6 0 0 0 12 2.6a7.6 7.6 0 0 0-4.9 1.7Z"
							/>
							<path d="M4.1 11.6h15.8v6.2c0 1.2-1 2.2-2.2 2.2H6.3c-1.2 0-2.2-1-2.2-2.2v-6.2Z" />
							<path
								d="M1.8 12.1h1.4v6.4H1.8c-.8 0-1.4-.6-1.4-1.4v-3.6c0-.8.6-1.4 1.4-1.4ZM20.8 12.1h1.4c.8 0 1.4.6 1.4 1.4v3.6c0 .8-.6 1.4-1.4 1.4h-1.4v-6.4ZM7.1 20.9h2.1v2.4H7.1v-2.4ZM14.8 20.9h2.1v2.4h-2.1v-2.4Z"
							/>
							<circle cx="8.8" cy="7.8" r="0.8" fill="#ffffff" />
							<circle cx="15.2" cy="7.8" r="0.8" fill="#ffffff" />
						</svg>
					</span>
					<img src={apkQrDataUrl} alt="" />
				</button>
			{/if}
		</div>
	</header>

	<input
		bind:this={fileInput}
		class="visually-hidden"
		type="file"
		accept="image/*"
		on:change={onFileSelected}
	/>
	<input
		bind:this={importInput}
		class="visually-hidden"
		type="file"
		accept="application/json,.json"
		on:change={onImportFileSelected}
	/>

	{#if libraryError}
		<p class="status error">{libraryError}</p>
	{:else if libraryStatus}
		<p class="status">{libraryStatus}</p>
	{/if}

	<section
		class:workspace-manager={workspaceView === 'manager'}
		class:workspace-editor={workspaceView === 'editor'}
		class:workspace-press={workspaceView === 'press'}
		class:workspace-split={workspaceView === 'split'}
		class="workspace library-workspace"
		aria-label="Card generator"
	>
		{#if showManager}
			<section class="manager-pane" aria-label="Cards manager">
				<div class="card-table-wrap">
					<table class="card-table">
						<thead>
							<tr>
								<th aria-label="Print selection">
									<input
										class="header-checkbox"
										type="checkbox"
										checked={allDisplayedSelected}
										disabled={displayedManagerCards.length === 0}
										use:setIndeterminate={someDisplayedSelected && !allDisplayedSelected}
										aria-label="Select displayed cards"
										on:change={toggleDisplayedPrintSelection}
									/>
								</th>
								<th title="Image">
									<div class="image-column-header">
										<span class="column-title">
											<ImageIcon size={17} aria-hidden="true" />
											{#if duplicateColumnKeys.has('image')}
												<button
													type="button"
													class:active={duplicateFocus === 'image'}
													class="duplicate-focus-button"
													aria-label="Show duplicate images"
													title="Show duplicate images"
													on:click={() => toggleDuplicateFocus('image')}
												>
													<Copy size={13} aria-hidden="true" />
												</button>
											{/if}
										</span>
										<select
											class="image-presence-filter"
											value={imagePresenceFilter}
											aria-label="Filter images"
											on:change={(event) => updateImagePresenceFilter(event.currentTarget.value)}
										>
											<option value="all">All</option>
											<option value="missing">Missing</option>
											<option value="present">Present</option>
										</select>
									</div>
								</th>
								<th title={mainLanguage}>
									<div class="language-column-header">
										<span class="column-title">
											<span>{markerLabelForLanguage(mainLanguage)}</span>
											{#if duplicateColumnKeys.has(duplicateColumnKeyForLanguage(mainLanguage))}
												<button
													type="button"
													class:active={duplicateFocus ===
														duplicateColumnKeyForLanguage(mainLanguage)}
													class="duplicate-focus-button"
													aria-label={`Show duplicate ${mainLanguage} values`}
													title={`Show duplicate ${mainLanguage} values`}
													on:click={() =>
														toggleDuplicateFocus(duplicateColumnKeyForLanguage(mainLanguage))}
												>
													<Copy size={13} aria-hidden="true" />
												</button>
											{/if}
										</span>
										<input
											class="language-column-filter"
											value={languageFilters[mainLanguage] ?? ''}
											placeholder={mainLanguage}
											aria-label={`Filter ${mainLanguage}`}
											on:click|stopPropagation
											on:input={(event) =>
												updateLanguageFilter(mainLanguage, event.currentTarget.value)}
										/>
									</div>
								</th>
								<th>
									<div class="verso-column-header">
										<span class="column-title">Verso</span>
										<select
											class="presence-filter"
											value={versoPresenceFilter}
											aria-label="Filter verso links"
											on:change={(event) => updateVersoPresenceFilter(event.currentTarget.value)}
										>
											<option value="all">All</option>
											<option value="missing">Missing</option>
											<option value="present">Present</option>
										</select>
									</div>
								</th>
								<th aria-label="Delete"></th>
							</tr>
						</thead>
						<tbody>
							{#each displayedManagerCards as card (card.id)}
								<tr
									class:selected={card.id === selectedCardId}
									on:click={() => selectCard(card.id)}
								>
									<td class="select-cell">
										<label class="row-checkbox" title="Select for press">
											<input
												type="checkbox"
												checked={selectedPrintCardIds.includes(card.id)}
												on:click|stopPropagation
												on:change={() => togglePrintCard(card.id)}
											/>
										</label>
									</td>
									<td>
										{#if card.imageDataUrl}
											<img class="manager-thumb" src={card.imageDataUrl} alt="" />
										{:else}
											<div class="manager-thumb empty-thumb" aria-label="No image"></div>
										{/if}
									</td>
									<td>{card.texts[mainLanguage] || ''}</td>
									<td class="verso-cell">
										{#if pairingCardId === card.id}
											<select
												aria-label="Choose verso card"
												value={card.versoCardId ?? ''}
												on:click|stopPropagation
												on:change={(event) => updateVersoLink(card.id, event.currentTarget.value)}
											>
												<option value="">No verso</option>
												{#each candidateCardsFor(card) as candidate}
													<option value={candidate.id}>
														{cardLabel(candidate)}
													</option>
												{/each}
											</select>
										{:else}
											<button
												type="button"
												class="secondary verso-link-button"
												title="Choose verso"
												on:click|stopPropagation={() => (pairingCardId = card.id)}
											>
												<Link2 size={15} aria-hidden="true" />
												<span>{linkedCardLabel(card)}</span>
											</button>
											{#if card.versoCardId}
												<button
													type="button"
													class="delete-icon-button"
													aria-label="Unlink verso"
													title="Unlink verso"
													on:click|stopPropagation={() => clearVersoLink(card.id)}
												>
													<Link2Off size={15} aria-hidden="true" />
												</button>
											{/if}
										{/if}
									</td>
									<td class="delete-cell">
										{#if deletingCardId === card.id}
											<span>Delete?</span>
											<button
												type="button"
												class="danger-text"
												on:click|stopPropagation={() => confirmDeleteCard(card.id)}>yes</button
											>
											<button
												type="button"
												class="plain-text"
												on:click|stopPropagation={() => (deletingCardId = '')}>no</button
											>
										{:else}
											<button
												type="button"
												class="delete-icon-button"
												aria-label="Delete card"
												title="Delete card"
												on:click|stopPropagation={() => (deletingCardId = card.id)}
											>
												<Trash2 size={16} aria-hidden="true" />
											</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		{#if showPress}
			<section class="press-pane" aria-label="Printing press">
				<div class="pane-header">
					<div class="press-actions">
						<button type="button" class="secondary" on:click={() => (workspaceView = 'manager')}>
							<List size={18} aria-hidden="true" />
							Manage
						</button>
						<button
							type="button"
							disabled={printLayout.pages.length === 0}
							on:click={downloadLayoutPdf}
						>
							<Download size={18} aria-hidden="true" />
							Download PDF
						</button>
					</div>
				</div>

				{#if printWarnings.length > 0}
					<div class="press-warnings">
						{#each printWarnings as warning}
							<p>{warning}</p>
						{/each}
					</div>
				{/if}

				{#if selectedPrintCardIds.length === 0}
					<div class="empty-press">
						<button type="button" on:click={() => (workspaceView = 'manager')}>
							<List size={18} aria-hidden="true" />
							Select cards
						</button>
					</div>
				{:else}
					<div class="press-pages">
						{#each printLayout.pages as page, index}
							<article class="press-page-pair">
								<div class="press-page-header">
									<strong>Page {index + 1}</strong>
									<span>{gridSize}x{gridSize}</span>
								</div>
								<div class="press-preview-grid">
									<div class="press-preview">
										<span>Recto</span>
										<canvas
											bind:this={rectoPreviewCanvases[index]}
											aria-label={`Recto page ${index + 1}`}
										></canvas>
									</div>
									<div class="press-preview">
										<span>Verso</span>
										<canvas
											bind:this={versoPreviewCanvases[index]}
											aria-label={`Verso page ${index + 1}`}
										></canvas>
									</div>
								</div>
							</article>
						{/each}
					</div>
				{/if}

				{#if pressError}
					<p class="status error">{pressError}</p>
				{:else if pressStatus}
					<p class="status">{pressStatus}</p>
				{/if}
			</section>
		{/if}

		{#if showEditor}
			<section class="editor-workspace" aria-label="Card editor">
				<div class="editor-pane">
					<div class="language-header">
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
							{#if editorDeleteArmed}
								<button type="button" class="secondary" on:click={() => (editorDeleteArmed = false)}
									>Cancel</button
								>
								<button
									type="button"
									class="danger"
									on:click={() => selectedCard && confirmDeleteCard(selectedCard.id)}
								>
									Delete
								</button>
							{:else}
								<button
									type="button"
									class="secondary icon-button"
									aria-label="Delete card"
									title="Delete card"
									on:click={() => (editorDeleteArmed = true)}
								>
									<Trash2 size={18} aria-hidden="true" />
								</button>
							{/if}
						</div>
					</div>

					<div class="language-list">
						{#each editorEntries(entries) as { entry, index } (entry.id)}
							<article class="language-row">
								<div class="language-tools">
									<div
										class="readonly-marker"
										aria-label={entry.lang ? `${entry.lang} flag` : 'No language flag'}
									>
										{entry.marker || markerForLanguage(entry.lang).marker}
									</div>
								</div>
								<label class="text-field" aria-label={`${entry.lang} text`}>
									<input
										value={entry.text}
										placeholder="Hello"
										disabled={!entry.lang.trim()}
										on:input={(event) => updateCardText(index, event.currentTarget.value)}
									/>
								</label>
							</article>
						{/each}
					</div>

					<div class="image-panel">
						<div class="image-panel-header">
							<p class="eyebrow">Image</p>
							{#if imageDataUrl}
								<button
									type="button"
									class="secondary icon-button"
									aria-label="Clear image"
									title="Clear image"
									on:click={clearImage}
								>
									<X size={18} aria-hidden="true" />
								</button>
							{/if}
						</div>
						<div class="image-actions">
							<input
								class="paste-target"
								readonly
								aria-label="Paste image here"
								placeholder="Paste here"
								on:paste={handleImagePaste}
								on:keydown={(event) => {
									if (event.ctrlKey || event.metaKey) return
									if (
										event.key.length === 1 ||
										event.key === 'Backspace' ||
										event.key === 'Delete'
									) {
										event.preventDefault()
									}
								}}
							/>
							<button type="button" class="secondary" on:click={chooseImage}>
								<ImagePlus size={18} aria-hidden="true" />
								Choose
							</button>
							<button type="button" class="secondary" on:click={openImageSearch}>
								<Search size={18} aria-hidden="true" />
								Search
							</button>
						</div>
						{#if imageDataUrl}
							<div class="image-adjustments">
								<label>
									<span>Pan X</span>
									<input
										type="range"
										min="-1"
										max="1"
										step="0.01"
										value={imageTransform?.offsetX ?? 0}
										on:input={(event) =>
											updateImageTransform({ offsetX: Number(event.currentTarget.value) })}
									/>
								</label>
								<label>
									<span>Pan Y</span>
									<input
										type="range"
										min="-1"
										max="1"
										step="0.01"
										value={imageTransform?.offsetY ?? 0}
										on:input={(event) =>
											updateImageTransform({ offsetY: Number(event.currentTarget.value) })}
									/>
								</label>
								<label>
									<span><Maximize2 size={16} aria-hidden="true" /> Size</span>
									<input
										type="range"
										min="0.5"
										max="3"
										step="0.01"
										value={imageTransform?.zoom ?? 1}
										on:input={(event) =>
											updateImageTransform({ zoom: Number(event.currentTarget.value) })}
									/>
								</label>
								<button
									type="button"
									class="secondary"
									disabled={!imageTransform}
									on:click={resetImageTransform}
								>
									<RotateCcw size={16} aria-hidden="true" />
									Reset
								</button>
							</div>
						{/if}
					</div>

					{#if translationError}
						<p class="status error">{translationError}</p>
					{:else if translationStatus}
						<p class="status">{translationStatus}</p>
					{/if}
				</div>

				<div class="preview-pane">
					<div class="preview-toolbar">
						<div class="preview-actions">
							<label class="margin-control">
								<input
									type="checkbox"
									checked={reserveQrMargin}
									on:change={updateReserveQrMargin}
								/>
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
						<canvas
							bind:this={previewCanvas}
							class:can-pan={Boolean(imageDataUrl)}
							aria-label="Generated card preview"
							on:pointerdown={startImagePan}
							on:pointermove={moveImagePan}
							on:pointerup={stopImagePan}
							on:pointercancel={stopImagePan}
						></canvas>
					</div>

					{#if renderError}
						<p class="status error">{renderError}</p>
					{:else if pngStatus}
						<p class="status">{pngStatus}</p>
					{/if}
				</div>
			</section>
		{/if}
	</section>

	<canvas bind:this={exportCanvas} class="export-canvas" aria-hidden="true"></canvas>
	<canvas bind:this={pdfCanvas} class="export-canvas" aria-hidden="true"></canvas>

	{#if showImageSearchPanel}
		<div class="modal-backdrop">
			<button
				type="button"
				class="modal-scrim"
				aria-label="Close image search"
				on:click={closeImageSearch}
			></button>
			<div
				class="image-search-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="image-search-title"
				tabindex="-1"
			>
				<div class="settings-header">
					<div>
						<p class="eyebrow">Image source</p>
						<h2 id="image-search-title">Search image</h2>
					</div>
					<button
						type="button"
						class="secondary icon-button"
						aria-label="Close image search"
						title="Close image search"
						on:click={closeImageSearch}
					>
						<X size={18} aria-hidden="true" />
					</button>
				</div>

				{#if availableImageSearchProviders.length > 0}
					<div class="image-provider-tabs" aria-label="Image source">
						{#each availableImageSearchProviders as provider}
							<button
								type="button"
								class:active={provider.id === imageSearchProvider}
								class="secondary"
								on:click={() => updateImageSearchProvider(provider.id)}
							>
								{provider.label}
							</button>
						{/each}
					</div>
				{/if}

				<form class="image-search-form" on:submit|preventDefault={() => searchImages(1)}>
					<input
						value={imageSearchQuery}
						placeholder="apple"
						aria-label="Image search query"
						spellcheck="false"
						on:input={(event) => (imageSearchQuery = event.currentTarget.value)}
					/>
					<button
						type="submit"
						disabled={isSearchingImages || availableImageSearchProviders.length === 0}
					>
						<Search size={18} aria-hidden="true" />
						{isSearchingImages ? 'Searching...' : 'Search'}
					</button>
				</form>

				{#if imageSearchError}
					<p class="status error">{imageSearchError}</p>
				{:else if imageSearchStatus}
					<p class="status">{imageSearchStatus}</p>
				{/if}

				{#if imageSearchResults.length > 0}
					<div class="image-search-results">
						{#each imageSearchResults as result}
							<button
								type="button"
								class="image-result-button"
								disabled={Boolean(importingImageResultId)}
								aria-label={`Use ${result.alt}`}
								title={result.alt}
								on:click={() => importImageSearchResult(result)}
							>
								<img src={result.thumbUrl} alt="" />
							</button>
						{/each}
					</div>
				{/if}

				<div class="image-search-footer">
					<a
						href={imageSearchProviderSourceUrl(imageSearchProvider)}
						target="_blank"
						rel="noreferrer"
					>
						Results from {imageSearchProviderInstance.label}
					</a>
					<div class="image-search-pages">
						<button
							type="button"
							class="secondary"
							disabled={imageSearchPage <= 1 || isSearchingImages}
							on:click={() => searchImages(imageSearchPage - 1)}
						>
							Previous
						</button>
						<span>Page {imageSearchPage} of {imageSearchTotalPages}</span>
						<button
							type="button"
							class="secondary"
							disabled={!imageSearchHasNextPage || isSearchingImages}
							on:click={() => searchImages(imageSearchPage + 1)}
						>
							Next
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if showApkPanel}
		<div class="modal-backdrop qr-backdrop">
			<button
				type="button"
				class="modal-scrim qr-scrim"
				aria-label="Close Android APK QR code"
				on:click={() => (showApkPanel = false)}
			></button>
			<div
				class="apk-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="apk-title"
				tabindex="-1"
			>
				<div class="settings-header">
					<div>
						<p class="eyebrow">Android</p>
						<h2 id="apk-title">Install app</h2>
					</div>
					<button
						type="button"
						class="secondary icon-button"
						aria-label="Close Android APK QR code"
						title="Close Android APK QR code"
						on:click={() => (showApkPanel = false)}
					>
						<X size={18} aria-hidden="true" />
					</button>
				</div>

				<img class="apk-modal-qr" src={apkQrDataUrl} alt="Android APK QR code" />
				<a class="apk-modal-link" href={apkUrl}>
					<ExternalLink size={18} aria-hidden="true" />
					Download Android APK
				</a>
			</div>
		</div>
	{/if}

	{#if showHelpPanel}
		<div class="modal-backdrop">
			<button
				type="button"
				class="modal-scrim"
				aria-label="Close help"
				on:click={() => (showHelpPanel = false)}
			></button>
			<div
				class="help-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="help-title"
				tabindex="-1"
			>
				<div class="settings-header">
					<div class="help-title-row">
						<img src="/app-icon.png" alt="" />
						<div>
							<p class="eyebrow">Toddler Read</p>
							<h2 id="help-title">Help</h2>
						</div>
					</div>
				</div>

				<div class="help-content">
					<section>
						<h3>Editing Cards</h3>
						<p>
							Use <strong>New card</strong> to create a card, then fill the text fields for the configured
							corner languages. Each filled text becomes a QR payload that the reader can speak.
						</p>
						<ul>
							<li>Choose or paste an image, or drag an image onto the preview.</li>
							<li>Use image search when a provider API key is configured.</li>
							<li>Adjust pan and size until the card preview looks right.</li>
							<li>
								Enable <strong>QR margin</strong> when images need extra room around QR codes.
							</li>
							<li>
								Enable <strong>QR text</strong> when you want the QR payload printed under each code.
							</li>
							<li>Use the manager table to select, delete, filter, and link verso cards.</li>
						</ul>
					</section>

					<section>
						<h3>Settings</h3>
						<p>
							Open settings with the gear button. Settings are stored locally in this browser,
							including API keys, language setup, grid size, QR margin, QR text, and provider
							choices.
						</p>
						<ul>
							<li>
								<strong>Corner languages:</strong> set up to four language codes, such as
								<code>en</code>, <code>fr</code>, or <code>ro</code>, and adjust the displayed
								marker.
							</li>
							<li>
								<strong>Image sources:</strong> add Pexels or Flaticon API keys to enable in-app image
								search.
							</li>
							<li>
								<strong>Translation:</strong> choose Gemini, OpenAI, DeepSeek, Z.AI, Groq, or a custom
								OpenAI-compatible provider.
							</li>
							<li>
								<strong>Model and base URL:</strong> keep the defaults unless your provider or account
								requires a different model or endpoint.
							</li>
							<li>
								<strong>Prompt template:</strong> controls how card texts are translated. The placeholders
								are filled by the app before the request is sent.
							</li>
						</ul>
					</section>

					<section>
						<h3>API Keys</h3>
						<p>
							API keys are only needed for optional helpers. Translation keys let the app fill
							missing language text from existing text on the card. Image search keys let the app
							search image providers from the editor. Keys stay in local browser storage and are
							sent directly to the selected provider when you use that feature.
						</p>
					</section>

					<section>
						<h3>Local Data</h3>
						<p>
							Card data is stored in this browser. Nothing is sent to Toddler Read servers, and
							there is no account or cloud sync. Export your library from the file menu before
							clearing browser data, switching browsers, or moving to another device.
						</p>
						<p>
							The only network transmissions are the requests you trigger for translation or image
							search, which go directly to the configured provider APIs.
						</p>
					</section>

					<section>
						<h3>File Menu</h3>
						<ul>
							<li>
								<strong>Import:</strong> adds cards from a JSON export and merges with your current library.
							</li>
							<li>
								<strong>Replace:</strong> imports a JSON export after clearing the current library.
							</li>
							<li>
								<strong>Export:</strong> downloads the full card library as JSON for backup or sharing.
							</li>
						</ul>
					</section>

					<section>
						<h3>Manager And Printing Press</h3>
						<p>
							The manager is the card library. Select cards with the checkboxes, use filters to find
							missing images or text, and link a card to its verso when you need two-sided printing.
						</p>
						<p>
							Open the printer view to preview selected cards as A4 recto and verso pages. Choose
							the grid size in the toolbar, review any warnings, then download the PDF and print it.
						</p>
					</section>

					<section>
						<h3>Links</h3>
						<div class="help-links">
							<a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
								<ExternalLink size={16} aria-hidden="true" />
								Repository
							</a>
							<a href={KO_FI_URL} target="_blank" rel="noreferrer">
								<ExternalLink size={16} aria-hidden="true" />
								Ko-fi
							</a>
						</div>
					</section>
				</div>

				<div class="help-footer">
					<button type="button" on:click={() => (showHelpPanel = false)}>OK</button>
				</div>
			</div>
		</div>
	{/if}

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
									on:input={(event) =>
										updateLanguageSetup(setup.id, { lang: event.currentTarget.value })}
								/>
							</label>
							<label class="marker-field">
								Flag
								<input
									value={setup.marker}
									maxlength="4"
									placeholder="🇬🇧"
									spellcheck="false"
									on:input={(event) =>
										updateLanguageSetup(setup.id, { marker: event.currentTarget.value })}
								/>
							</label>
						</article>
					{/each}
				</div>
				<div class="settings-section">
					<p class="eyebrow">Image sources</p>
					{#each IMAGE_SEARCH_PROVIDERS as provider}
						<label class="api-key-field">
							{provider.label} API key
							<input
								type="password"
								value={imageSearchProviderConfigs[provider.id].apiKey}
								placeholder="Stored locally"
								spellcheck="false"
								autocomplete="off"
								on:input={(event) =>
									updateImageSearchProviderConfig(provider.id, 'apiKey', event.currentTarget.value)}
							/>
						</label>
					{/each}
				</div>
				<div class="settings-section">
					<p class="eyebrow">Translation</p>
					<label class="api-key-field">
						Translation provider
						<select
							value={translationProvider}
							on:change={(event) => updateTranslationProvider(event.currentTarget.value)}
						>
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
							on:input={(event) =>
								updateTranslationProviderConfig('apiKey', event.currentTarget.value)}
						/>
					</label>
					<label class="api-key-field">
						{providerLabel(translationProvider)} model
						<input
							value={currentTranslationProviderConfig.model}
							placeholder={translationProviderConfigs[translationProvider].model}
							spellcheck="false"
							autocomplete="off"
							on:input={(event) =>
								updateTranslationProviderConfig('model', event.currentTarget.value)}
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
								on:input={(event) =>
									updateTranslationProviderConfig('baseUrl', event.currentTarget.value)}
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
		</div>
	{/if}
</main>
