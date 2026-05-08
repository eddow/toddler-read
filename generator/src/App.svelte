<script lang="ts">
	import { GoogleGenAI } from '@google/genai'
	import {
		ArrowDownLeft,
		ArrowDownRight,
		ArrowUpLeft,
		ArrowUpRight,
		Columns2,
		Download,
		ExternalLink,
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
		Search,
		Settings,
		Smartphone,
		Trash2,
		Upload,
		X
	} from 'lucide-svelte'
	import { jsPDF } from 'jspdf'
	import QRCode from 'qrcode'
	import { onMount, tick } from 'svelte'
	import {
		DEFAULT_CARD_GRID_SIZE,
		DEFAULT_PDF_LAYOUT_CONFIG,
		PDF_PAGE_FORMAT_OPTIONS,
		PDF_PAGE_ORIENTATION_OPTIONS,
		getPdfLayoutLabel,
		getPdfPageSize,
		markerForLanguage,
		renderCardToCanvas,
		renderLayoutPageToCanvas,
		toRenderableEntries,
		type CardGridSize,
		type ImageTransform,
		type LanguageEntry,
		type LayoutRenderableCard,
		type PdfLayoutConfig,
		type PdfPageFormat,
		type PdfPageOrientation
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
		arraysEqual,
		compressCardsExportPayload,
		createCardsExportPayload,
		normalizeCardImage,
		normalizeTag,
		normalizeTags,
		parseImportCards,
		planCardImport,
		readCardsImportPayload,
		type ImportPlan
	} from './lib/cards-transfer'
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
	import PresenceFilterGroup, {
		type PresenceFilter
	} from './lib/components/PresenceFilterGroup.svelte'
	import DuplicateFocusButton from './lib/components/DuplicateFocusButton.svelte'
	import IconButton from './lib/components/IconButton.svelte'
	import PanelModal from './lib/components/PanelModal.svelte'
	import QRInstallPanel from './lib/components/QRInstallPanel.svelte'
	import TagInput from './lib/components/TagInput.svelte'
	import CardPreviewCanvas from './lib/components/CardPreviewCanvas.svelte'
	import ProviderConfigFields from './lib/components/ProviderConfigFields.svelte'
	import {
		T,
		direction,
		format,
		hasLocale,
		loadPreferredLocale,
		setPreferredLocale,
		type LocaleDirection
	} from './lib/i18n/i18n.svelte'

	const MAX_ENTRIES = 4
	const CORNER_SPECS = [
		{ labelKey: 'topLeft', icon: ArrowUpLeft },
		{ labelKey: 'topRight', icon: ArrowUpRight },
		{ labelKey: 'bottomLeft', icon: ArrowDownLeft },
		{ labelKey: 'bottomRight', icon: ArrowDownRight }
	] as const
	const GRID_SIZE_OPTIONS: CardGridSize[] = [1, 2, 3, 4]
	const CARD_TEXT_STORAGE_KEY = 'toddler-read-generator-card-text'
	const LEGACY_LANGUAGE_STORAGE_KEY = 'toddler-read-generator-languages'
	const SETTINGS_STORAGE_KEY = 'toddler-read-generator-settings'
	const LIBRARY_SELECTION_STORAGE_KEY = 'toddler-read-generator-selected-card-id'
	const LIBRARY_VIEW_STORAGE_KEY = 'toddler-read-generator-library-view'
	const SHOW_HELP_AT_STARTUP_STORAGE_KEY = 'toddler-read-generator-show-help-at-startup'
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
		translations: [{ index: 2, text: 'corrected or translated text' }]
	}
	const DEFAULT_TRANSLATION_PROMPT_TEMPLATE = [
		'Translate and proofread these toddler reading card texts.',
		'Use every source text as context for ambiguity and meaning.',
		'Sources JSON: {{sourcesJson}}',
		'Targets JSON: {{targetsJson}}',
		'Return only JSON matching this schema: {{responseSchemaJson}}',
		'For each target with existing text, return corrected text only if spelling, accents, diacritics, or capitalization need fixing in the target language.',
		'For each target with empty text, return a short natural translation suitable for a young child.',
		'Do not return unchanged existing text.'
	].join('\n')
	const REPOSITORY_URL = 'https://github.com/eddow/toddler-read'
	const KO_FI_URL = 'https://ko-fi.com/emedware'
	let idCounter = 0

	type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]['value']
	type WorkspaceView = 'manager' | 'editor' | 'split' | 'press'
	type ImportMode = 'merge' | 'replace'
	type TagSelectionState = 'none' | 'some' | 'all'
	type ManagerTagFilter = { tag: string; presenceFilter: PresenceFilter }
	type ManagerTagFilterRow = { id: string; tagInput: string; presenceFilter: PresenceFilter }

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
		text: string
	}

	const initialLanguageSetups = defaultLanguageSetups()

	let languageSetups: CornerLanguageSetup[] = initialLanguageSetups
	let cards: StoredCard[] = []
	let selectedCardId = ''
	let workspaceView: WorkspaceView = 'split'
	let isMobileWorkspace = false
	let mainLanguage = firstConfiguredLanguage(initialLanguageSetups)
	let languageFilters: Record<string, string> = {}
	let imagePresenceFilter: PresenceFilter = 'all'
	let versoPresenceFilter: PresenceFilter = 'all'
	let managerTagRows: ManagerTagFilterRow[] = [createManagerTagFilterRow()]
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
	let pageFormat: PdfPageFormat = DEFAULT_PDF_LAYOUT_CONFIG.pageFormat
	let pageOrientation: PdfPageOrientation = DEFAULT_PDF_LAYOUT_CONFIG.pageOrientation
	let reserveQrMargin = false
	let showQrText = false
	let showPdfConfigPanel = false
	let showSettingsPanel = false
	let showFileMenu = false
	let showHelpPanel = false
	let showApkPanel = false
	let i18nReady = false
	let usageDirection: LocaleDirection = 'ltr'
	let showHelpAtStartup = true
	let imageDataUrl: string | undefined
	let imageTransform: ImageTransform | undefined
	let previewImageTransform: ImageTransform | undefined
	let imageTransformDraft: ImageTransform | undefined
	let tagInput = ''
	let tagInputCardId = ''
	let previewCanvas: HTMLCanvasElement | undefined
	let exportCanvas: HTMLCanvasElement | undefined
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
	let deletingCheckedCardsArmed = false
	let editorDeleteArmed = false
	let importMode: ImportMode = 'merge'
	let apkUrl = ''
	let apkQrDataUrl = ''
	let readerUrl = ''
	let readerQrDataUrl = ''
	let showReaderInstallPanel = false
	let renderToken = 0
	let pressRenderToken = 0
	let storageReady = false
	let libraryReady = false
	let saveToken = 0
	let rectoPreviewCanvases: HTMLCanvasElement[] = []
	let versoPreviewCanvases: HTMLCanvasElement[] = []
	let pdfCanvas: HTMLCanvasElement
	let activeImagePointers = new Map<number, { clientX: number; clientY: number }>()
	let imageGesture:
		| {
				mode: 'pan'
				pointerId: number
				startClientX: number
				startClientY: number
				startOffsetX: number
				startOffsetY: number
		  }
		| {
				mode: 'pinch'
				startDistance: number
				startCenterX: number
				startCenterY: number
				startZoom: number
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
	$: selectedCardTags = selectedCard?.tags ?? []
	$: usedTags = buildUsedTags(cards)
	$: tagSuggestions = usedTags.filter((tag) => !selectedCardTags.includes(tag))
	$: managerSelectedCards = cards.filter((card) => selectedPrintCardIds.includes(card.id))
	$: selectedDeleteCardIds = managerSelectedCards.map((card) => card.id)
	$: managerTagFilters = buildManagerTagFilters(managerTagRows)
	$: if (selectedCardId !== tagInputCardId) {
		tagInputCardId = selectedCardId
		tagInput = ''
	}
	$: managerLanguages = buildManagerLanguages(cards, languageSetups)
	$: if (libraryReady && !managerLanguages.includes(mainLanguage))
		mainLanguage = managerLanguages[0] ?? ''
	$: selectedPrintCardIds = selectedPrintCardIds.filter((id) =>
		cards.some((card) => card.id === id)
	)
	$: if (selectedDeleteCardIds.length === 0) deletingCheckedCardsArmed = false
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
		versoPresenceFilter,
		managerTagFilters
	)
	$: entries = buildEntries(languageSetups, cardTexts)
	$: layoutCards = buildLayoutRenderableCards(cards, languageSetups)
	$: pdfConfig = buildPdfConfig(pageFormat, pageOrientation, gridSize)
	$: pdfPageSize = getPdfPageSize(pdfConfig)
	$: pdfLayoutLabel = getPdfLayoutLabel(pdfConfig)
	$: printLayout = buildPrintLayout(cards, selectedRectoCardIds, pdfConfig)
	$: printWarnings = i18nReady ? buildPrintWarnings(cards, selectedRectoCardIds) : []
	$: renderableEntries = toRenderableEntries(entries)
	$: canExport = renderableEntries.length > 0
	$: if (isMobileWorkspace && workspaceView === 'split') workspaceView = 'manager'
	$: if (isMobileWorkspace && versoPresenceFilter !== 'all') versoPresenceFilter = 'all'
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
	$: translationDisabledReasons = i18nReady
		? getTranslationDisabledReasons(
				translationProvider,
				currentTranslationProviderConfig,
				translationSources,
				translationTargets
			)
		: []
	$: canTranslate = i18nReady && translationDisabledReasons.length === 0 && !isTranslating
	$: translateButtonTitle = i18nReady
		? isTranslating
			? T.actions.translating
			: translationDisabledReasons.join(', ')
		: ''
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
		pdfConfig,
		reserveQrMargin,
		showQrText,
		i18nReady && showEditor
	)
	$: void schedulePressPreviewRender(
		printLayout,
		layoutCards,
		pdfConfig,
		reserveQrMargin,
		showQrText,
		i18nReady && showPress
	)
	$: void scheduleSelectedCardSave(selectedCard)
	$: if (storageReady) {
		localStorage.setItem(LIBRARY_SELECTION_STORAGE_KEY, selectedCardId)
		localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, workspaceView)
		localStorage.setItem(
			SETTINGS_STORAGE_KEY,
			JSON.stringify({
				gridSize,
				pageFormat,
				pageOrientation,
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
		loadShowHelpAtStartup()
		storageReady = true
		void initializeStartup()
		apkUrl = import.meta.env.VITE_ANDROID_APK_URL || new URL('tr.apk', document.baseURI).href
		readerUrl = import.meta.env.VITE_READER_URL || new URL('reader/', document.baseURI).href
		const qrOptions = {
			errorCorrectionLevel: 'H',
			margin: 1,
			scale: 5,
			color: {
				dark: '#17211b',
				light: '#ffffff'
			}
		} as const
		void QRCode.toDataURL(apkUrl, qrOptions).then((url) => {
			apkQrDataUrl = url
		})
		void QRCode.toDataURL(readerUrl, qrOptions).then((url) => {
			readerQrDataUrl = url
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

		const workspaceQuery = window.matchMedia('(max-width: 720px)')
		const updateWorkspaceSize = () => {
			isMobileWorkspace = workspaceQuery.matches
		}
		window.addEventListener('paste', onPaste)
		window.addEventListener('keydown', onKeyDown)
		updateWorkspaceSize()
		workspaceQuery.addEventListener('change', updateWorkspaceSize)
		return () => {
			window.removeEventListener('paste', onPaste)
			window.removeEventListener('keydown', onKeyDown)
			workspaceQuery.removeEventListener('change', updateWorkspaceSize)
		}
	})

	async function initializeStartup() {
		try {
			syncDocumentLanguage(await loadPreferredLocale())
		} finally {
			i18nReady = true
			if (showHelpAtStartup) showHelpPanel = true
		}

		await initializeCardLibrary()
	}

	async function schedulePreviewRender(
		nextImageDataUrl: string | undefined,
		nextImageTransform: ImageTransform | undefined,
		nextEntries: LanguageEntry[],
		nextPdfConfig: PdfLayoutConfig,
		nextReserveQrMargin: boolean,
		nextShowQrText: boolean,
		isVisible: boolean
	) {
		const token = ++renderToken
		if (!isVisible) return

		await tick()
		if (token !== renderToken) return
		const target = previewCanvas
		if (!target) return

		try {
			renderError = ''
			await renderCardToCanvas(
				{
					imageDataUrl: nextImageDataUrl,
					imageTransform: nextImageTransform,
					entries: nextEntries,
					pdfConfig: nextPdfConfig,
					reserveQrMargin: nextReserveQrMargin,
					showQrText: nextShowQrText
				},
				target
			)
		} catch (error) {
			renderError = error instanceof Error ? error.message : T.errors.couldNotRenderCard
		}
	}

	async function schedulePressPreviewRender(
		nextLayout: PrintLayout,
		nextCards: LayoutRenderableCard[],
		nextPdfConfig: PdfLayoutConfig,
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
							pdfConfig: nextPdfConfig,
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
							pdfConfig: nextPdfConfig,
							reserveQrMargin: nextReserveQrMargin,
							showQrText: nextShowQrText
						},
						versoCanvas
					)
				}
			}
		} catch (error) {
			pressError = error instanceof Error ? error.message : T.errors.couldNotRenderLayoutPreview
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

	function cornerSpecForIndex(index: number): (typeof CORNER_SPECS)[number] {
		return CORNER_SPECS[index] ?? CORNER_SPECS[0]
	}

	function cornerLabelForIndex(index: number): string {
		return T.corners[cornerSpecForIndex(index).labelKey]
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

	function buildUsedTags(nextCards: StoredCard[]): string[] {
		return normalizeTags(nextCards.flatMap((card) => card.tags ?? [])) ?? []
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
			libraryError = error instanceof Error ? error.message : T.errors.couldNotLoadCardLibrary
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
			libraryError = error instanceof Error ? error.message : T.errors.couldNotSaveCard
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
			if (isPdfPageFormat(parsed.pageFormat)) {
				pageFormat = parsed.pageFormat
			}
			if (isPdfPageOrientation(parsed.pageOrientation)) {
				pageOrientation = parsed.pageOrientation
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

	function loadShowHelpAtStartup() {
		const stored = localStorage.getItem(SHOW_HELP_AT_STARTUP_STORAGE_KEY)
		showHelpAtStartup = stored === null ? true : stored === 'true'
	}

	function updateShowHelpAtStartup(event: Event) {
		showHelpAtStartup = (event.currentTarget as HTMLInputElement).checked
		localStorage.setItem(SHOW_HELP_AT_STARTUP_STORAGE_KEY, String(showHelpAtStartup))
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

	function isPdfPageFormat(value: unknown): value is PdfPageFormat {
		return typeof value === 'string' && PDF_PAGE_FORMAT_OPTIONS.includes(value as PdfPageFormat)
	}

	function isPdfPageOrientation(value: unknown): value is PdfPageOrientation {
		return (
			typeof value === 'string' &&
			PDF_PAGE_ORIENTATION_OPTIONS.includes(value as PdfPageOrientation)
		)
	}

	function buildPdfConfig(
		nextPageFormat: PdfPageFormat,
		nextPageOrientation: PdfPageOrientation,
		nextGridSize: CardGridSize
	): PdfLayoutConfig {
		return {
			pageFormat: nextPageFormat,
			pageOrientation: nextPageOrientation,
			gridSize: nextGridSize
		}
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

	function addSelectedTag() {
		if (!selectedCard) return
		const nextTags = normalizeTags([...selectedCardTags, tagInput])
		if (!nextTags || arraysEqual(nextTags, selectedCardTags)) {
			tagInput = ''
			return
		}

		updateSelectedCard({ tags: nextTags })
		tagInput = ''
	}

	function removeSelectedTag(tag: string) {
		if (!selectedCard) return
		updateSelectedCard({ tags: normalizeTags(selectedCardTags.filter((entry) => entry !== tag)) })
	}

	function createManagerTagFilterRow(
		patch: Partial<Omit<ManagerTagFilterRow, 'id'>> = {}
	): ManagerTagFilterRow {
		return {
			id: createEntryId(),
			tagInput: '',
			presenceFilter: 'all',
			...patch
		}
	}

	function buildManagerTagFilters(rows: ManagerTagFilterRow[]): ManagerTagFilter[] {
		return rows
			.map((row) => ({
				tag: normalizeTag(row.tagInput),
				presenceFilter: row.presenceFilter
			}))
			.filter((row) => row.tag.length > 0 && row.presenceFilter !== 'all')
	}

	function updateManagerTagRowInput(id: string, tagInput: string) {
		managerTagRows = managerTagRows.map((row) => (row.id === id ? { ...row, tagInput } : row))
	}

	function updateManagerTagRowPresence(id: string, presenceFilter: PresenceFilter) {
		managerTagRows = managerTagRows.map((row) => (row.id === id ? { ...row, presenceFilter } : row))
	}

	function normalizeManagerTagRows() {
		const filledRows = managerTagRows
			.map((row) => ({ ...row, tagInput: normalizeTag(row.tagInput) }))
			.filter((row) => row.tagInput.length > 0)

		managerTagRows = [...filledRows, createManagerTagFilterRow()]
	}

	function buildTagSelectionState(selectedCards: StoredCard[], tag: string): TagSelectionState {
		if (selectedCards.length === 0 || !tag) return 'none'
		const taggedCount = selectedCards.filter((card) => cardHasTag(card, tag)).length
		if (taggedCount === 0) return 'none'
		return taggedCount === selectedCards.length ? 'all' : 'some'
	}

	function canAddManagerTag(row: ManagerTagFilterRow, selectedCards: StoredCard[]): boolean {
		const tag = normalizeTag(row.tagInput)
		return (
			Boolean(tag) &&
			selectedCards.length > 0 &&
			buildTagSelectionState(selectedCards, tag) !== 'all'
		)
	}

	function canRemoveManagerTag(row: ManagerTagFilterRow, selectedCards: StoredCard[]): boolean {
		const tag = normalizeTag(row.tagInput)
		return (
			Boolean(tag) &&
			selectedCards.length > 0 &&
			buildTagSelectionState(selectedCards, tag) !== 'none'
		)
	}

	async function addManagerTagToSelection(row: ManagerTagFilterRow) {
		const tag = normalizeTag(row.tagInput)
		if (managerSelectedCards.length === 0 || !tag) return

		const nextCards = cards.map((card) => {
			if (!selectedPrintCardIds.includes(card.id)) return card
			const currentTags = card.tags ?? []
			return { ...card, tags: normalizeTags([...currentTags, tag]) }
		})
		await persistCardsPatch(nextCards)
		libraryStatus = format(T.templates.addedTag, { tag })
	}

	async function removeManagerTagFromSelection(row: ManagerTagFilterRow) {
		const tag = normalizeTag(row.tagInput)
		if (managerSelectedCards.length === 0 || !tag) return

		const nextCards = cards.map((card) => {
			if (!selectedPrintCardIds.includes(card.id)) return card
			return { ...card, tags: normalizeTags((card.tags ?? []).filter((entry) => entry !== tag)) }
		})
		await persistCardsPatch(nextCards)
		libraryStatus = format(T.templates.removedTag, { tag })
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
			.filter((entry) => entry.lang.length > 0)
			.map(({ index, lang, text }) => ({ index, lang, text }))
	}

	function getTranslationDisabledReasons(
		provider: TranslationProvider,
		config: TranslationProviderConfig,
		sources: TranslationSource[],
		targets: TranslationTarget[]
	): string[] {
		const reasons: string[] = []
		if (!config.apiKey.trim()) reasons.push(T.disabledReasons.noKey)
		if (!config.model.trim()) reasons.push(T.disabledReasons.noModel)
		if (isOpenAiCompatibleProvider(provider) && !config.baseUrl?.trim())
			reasons.push(T.disabledReasons.noBaseUrl)
		if (sources.length === 0) reasons.push(T.disabledReasons.noSource)
		if (targets.length === 0) reasons.push(T.disabledReasons.noTarget)
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
			const requiredTargetIndexes = translationTargets
				.filter((target) => target.text.length === 0)
				.map((target) => target.index)
			let appliedCount = 0
			let changedCount = 0

			for (const translation of translations) {
				if (!Number.isInteger(translation.index)) continue
				if (translation.index < 0 || translation.index >= MAX_ENTRIES) continue
				if (!translationTargets.some((target) => target.index === translation.index)) continue
				if (typeof translation.text !== 'string' || !translation.text.trim()) continue

				const nextText = translation.text.trim()
				if (nextTexts[translation.index] !== nextText) changedCount += 1
				nextTexts[translation.index] = nextText
				appliedCount += 1
			}

			const missingRequiredTranslation = requiredTargetIndexes.some(
				(index) => !nextTexts[index].trim()
			)
			if (missingRequiredTranslation) {
				throw new Error(
					format(T.templates.missingProviderTranslations, {
						provider: providerLabel(translationProvider)
					})
				)
			}

			updateSelectedCard({ texts: buildTextsByLanguage(languageSetups, nextTexts) })
			translationStatus =
				changedCount === 0
					? format(T.templates.checkedNoChanges, {
							count: translationTargets.length,
							unit: plural(T.units.text, translationTargets.length)
						})
					: format(T.templates.updatedCount, {
							count: changedCount,
							unit: plural(T.units.text, changedCount)
						})
		} catch (error) {
			translationError = error instanceof Error ? error.message : T.errors.couldNotTranslate
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

		if (!response.text) throw new Error(T.errors.geminiEmptyResponse)
		return response.text
	}

	async function requestOpenAiCompatibleTranslation(
		provider: TranslationProvider,
		config: TranslationProviderConfig,
		prompt: string
	): Promise<string> {
		const baseUrl = config.baseUrl?.trim()
		if (!baseUrl) throw new Error(T.errors.missingBaseUrl)

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
				format(T.templates.requestFailed, {
					provider: providerLabel(provider),
					status: response.status,
					statusText: response.statusText
				})
			)
		}

		const json = await response.json()
		const content = extractOpenAiCompatibleContent(json)
		if (!content) {
			throw new Error(format(T.templates.emptyProviderResponse, { provider: providerLabel(provider) }))
		}
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

	function plural(unit: { one: string; other: string }, count: number): string {
		return count === 1 ? unit.one : unit.other
	}

	function configuredMarkerForLanguage(language: string): string {
		const normalized = language.trim()
		const setup = languageSetups.find((entry) => entry.lang.trim() === normalized)
		return setup?.marker?.trim() || normalized
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
		versoFilter: PresenceFilter,
		tagFilters: ManagerTagFilter[]
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
		const tagFilteredCards = presenceFilteredCards.filter((card) =>
			tagFilters.every((filter) => {
				const hasTag = cardHasTag(card, filter.tag)
				if (filter.presenceFilter === 'missing') return !hasTag
				if (filter.presenceFilter === 'present') return hasTag
				return true
			})
		)

		const activeFilter = language ? (filters[language] ?? '').trim().toLocaleLowerCase() : ''
		if (!activeFilter) return tagFilteredCards

		return tagFilteredCards.filter((card) =>
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
			throw new Error(T.errors.parseTranslationResponse)
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
				: format(T.templates.missingProviderKey, { provider: T.providers.pexelsOrFlaticon })
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
			imageSearchError = format(T.templates.missingProviderKey, {
				provider: imageSearchProviderInstance.label
			})
			imageSearchStatus = ''
			imageSearchResults = []
			return
		}
		if (!query) {
			imageSearchError = T.errors.enterSearchTerm
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
					? T.status.noImagesFound
					: format(T.templates.imageCountFound, {
							count: visibleTotal.toLocaleString(),
							unit: plural(T.units.image, visibleTotal)
						})
		} catch (error) {
			if (token !== imageSearchRequestToken) return

			imageSearchResults = []
			imageSearchHasNextPage = false
			imageSearchStatus = ''
			imageSearchError = error instanceof Error ? error.message : T.errors.couldNotSearchImages
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
			imageSearchStatus = T.status.imageAdded
			closeImageSearch()
		} catch (error) {
			imageSearchError = error instanceof Error ? error.message : T.errors.couldNotImportImage
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
			renderError = T.errors.pleaseChooseImage
			return
		}

		const nextImageDataUrl = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => resolve(String(reader.result))
			reader.onerror = () => reject(new Error(T.errors.couldNotReadImage))
			reader.readAsDataURL(file)
		})
		imageTransformDraft = undefined
		updateSelectedCard({ imageDataUrl: nextImageDataUrl, imageTransform: undefined })
		pngStatus = ''
	}

	function startImageGesture(event: PointerEvent) {
		if (!imageDataUrl || !previewCanvas) return
		const target = event.currentTarget as HTMLCanvasElement
		event.preventDefault()
		target.setPointerCapture(event.pointerId)
		activeImagePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
		startCurrentImageGesture()
	}

	function moveImageGesture(event: PointerEvent) {
		if (!imageGesture || !activeImagePointers.has(event.pointerId) || !previewCanvas) return
		event.preventDefault()
		activeImagePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
		const rect = previewCanvas.getBoundingClientRect()
		if (rect.width <= 0 || rect.height <= 0) return

		if (imageGesture.mode === 'pan') {
			const pointer = activeImagePointers.get(imageGesture.pointerId)
			if (!pointer) return
			queueImagePanDraft({
				zoom: currentPreviewTransform()?.zoom ?? 1,
				offsetX:
					imageGesture.startOffsetX +
					((pointer.clientX - imageGesture.startClientX) / rect.width) * 2,
				offsetY:
					imageGesture.startOffsetY +
					((pointer.clientY - imageGesture.startClientY) / rect.height) * 2
			})
			return
		}

		const [first, second] = [...activeImagePointers.values()]
		if (!first || !second) return
		const distance = distanceBetweenPointers(first, second)
		if (distance <= 0 || imageGesture.startDistance <= 0) return
		const center = centerBetweenPointers(first, second)
		queueImagePanDraft({
			zoom: imageGesture.startZoom * (distance / imageGesture.startDistance),
			offsetX:
				imageGesture.startOffsetX + ((center.clientX - imageGesture.startCenterX) / rect.width) * 2,
			offsetY:
				imageGesture.startOffsetY + ((center.clientY - imageGesture.startCenterY) / rect.height) * 2
		})
	}

	function stopImageGesture(event: PointerEvent) {
		if (!activeImagePointers.has(event.pointerId)) return
		activeImagePointers.delete(event.pointerId)
		if (activeImagePointers.size > 0) {
			startCurrentImageGesture()
			return
		}

		imageGesture = undefined
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

	function startCurrentImageGesture() {
		const transform = currentPreviewTransform()
		const pointers = [...activeImagePointers.entries()]
		if (pointers.length >= 2) {
			const first = pointers[0][1]
			const second = pointers[1][1]
			const center = centerBetweenPointers(first, second)
			imageGesture = {
				mode: 'pinch',
				startDistance: distanceBetweenPointers(first, second),
				startCenterX: center.clientX,
				startCenterY: center.clientY,
				startZoom: transform?.zoom ?? 1,
				startOffsetX: transform?.offsetX ?? 0,
				startOffsetY: transform?.offsetY ?? 0
			}
			return
		}

		const [pointerId, pointer] = pointers[0] ?? []
		if (pointerId === undefined || !pointer) {
			imageGesture = undefined
			return
		}

		imageGesture = {
			mode: 'pan',
			pointerId,
			startClientX: pointer.clientX,
			startClientY: pointer.clientY,
			startOffsetX: transform?.offsetX ?? 0,
			startOffsetY: transform?.offsetY ?? 0
		}
	}

	function currentPreviewTransform(): ImageTransform | undefined {
		return queuedPanTransform ?? imageTransformDraft ?? imageTransform
	}

	function distanceBetweenPointers(
		first: { clientX: number; clientY: number },
		second: { clientX: number; clientY: number }
	) {
		return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
	}

	function centerBetweenPointers(
		first: { clientX: number; clientY: number },
		second: { clientX: number; clientY: number }
	) {
		return {
			clientX: (first.clientX + second.clientX) / 2,
			clientY: (first.clientY + second.clientY) / 2
		}
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
		deletingCheckedCardsArmed = false
		editorDeleteArmed = false
		libraryStatus = ''
		libraryError = ''
	}

	function openManagerCard(id: string) {
		selectCard(id)
		if (isMobileWorkspace) workspaceView = 'editor'
	}

	function togglePrintCard(id: string) {
		selectedPrintCardIds = selectedPrintCardIds.includes(id)
			? selectedPrintCardIds.filter((cardId) => cardId !== id)
			: [...selectedPrintCardIds, id]
		deletingCheckedCardsArmed = false
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
		deletingCheckedCardsArmed = false
		pressStatus = ''
		pressError = ''
	}

	function updateMainLanguage(value: string) {
		mainLanguage = value
		pairingCardId = ''
		void setPreferredLocale(hasLocale(value) ? value : 'en').then(syncDocumentLanguage)
	}

	function syncDocumentLanguage(nextLocale: string) {
		usageDirection = direction()
		if (typeof document === 'undefined') return
		document.documentElement.lang = nextLocale
		document.documentElement.dir = usageDirection
	}

	function updateLanguageFilter(language: string, value: string) {
		languageFilters = {
			...languageFilters,
			[language]: value
		}
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
			libraryError = error instanceof Error ? error.message : T.errors.couldNotSaveCardLinks
		}
	}

	function cardLabel(card: StoredCard | undefined): string {
		if (!card) return T.manager.missingCard
		return card.texts[mainLanguage]?.trim() || card.id
	}

	function linkedCardLabel(card: StoredCard): string {
		return card.versoCardId
			? cardLabel(cards.find((entry) => entry.id === card.versoCardId))
			: T.manager.noVerso
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
				format(T.templates.selectedBlankVerso, {
					count: missingVersoCount,
					unit: plural(T.units.card, missingVersoCount),
					verb: missingVersoCount === 1 ? T.verbs.has : T.verbs.have
				})
			)
		}

		return warnings
	}

	async function createNewCard() {
		const card: StoredCard = { id: createCardId(), texts: {} }
		cards = [...cards, card]
		selectedCardId = card.id
		workspaceView = workspaceView === 'manager' ? 'editor' : workspaceView
		libraryStatus = T.status.newCardCreated
		libraryError = ''
		try {
			await putCard(card)
		} catch (error) {
			libraryError = error instanceof Error ? error.message : T.errors.couldNotCreateCard
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
		libraryStatus = T.status.cardDeleted
		libraryError = ''

		try {
			await deleteCard(id)
			await Promise.all(changedCards.map((card) => putCard(card)))
			if (remainingCards.length === 0) await putCard(fallbackCard)
		} catch (error) {
			libraryError = error instanceof Error ? error.message : T.errors.couldNotDeleteCard
			cards = await getAllCards()
			if (!cards.some((card) => card.id === selectedCardId) && cards[0])
				selectedCardId = cards[0].id
		}
	}

	async function confirmDeleteCheckedCards() {
		const deleteIds = new Set(selectedDeleteCardIds)
		if (deleteIds.size === 0) return

		const remainingCards = cards
			.filter((card) => !deleteIds.has(card.id))
			.map((card) => {
				if (!deleteIds.has(card.versoCardId ?? '')) return card
				const { versoCardId: _removed, ...nextCard } = card
				return nextCard
			})
		const changedCards = remainingCards.filter((card) => {
			const current = cards.find((entry) => entry.id === card.id)
			return JSON.stringify(current) !== JSON.stringify(card)
		})
		const fallbackCard = remainingCards[0] ?? { id: createCardId(), texts: {} }
		const deletedCount = deleteIds.size

		cards = remainingCards.length > 0 ? remainingCards : [fallbackCard]
		selectedPrintCardIds = selectedPrintCardIds.filter((cardId) => !deleteIds.has(cardId))
		if (!cards.some((card) => card.id === selectedCardId)) {
			selectedCardId = fallbackCard.id
		}
		deletingCardId = ''
		deletingCheckedCardsArmed = false
		editorDeleteArmed = false
		libraryStatus = format(T.templates.deletedCards, {
			count: deletedCount,
			unit: plural(T.units.card, deletedCount)
		})
		libraryError = ''

		try {
			await Promise.all([...deleteIds].map((id) => deleteCard(id)))
			await Promise.all(changedCards.map((card) => putCard(card)))
			if (remainingCards.length === 0) await putCard(fallbackCard)
		} catch (error) {
			libraryError =
				error instanceof Error ? error.message : T.errors.couldNotDeleteSelectedCards
			cards = await getAllCards()
			selectedPrintCardIds = selectedPrintCardIds.filter((id) =>
				cards.some((card) => card.id === id)
			)
			if (!cards.some((card) => card.id === selectedCardId) && cards[0])
				selectedCardId = cards[0].id
		}
	}

	function chooseImportFile(mode: ImportMode = 'merge') {
		if (
			mode === 'replace' &&
			!window.confirm(T.errors.replaceConfirm)
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
			const payload = await readCardsImportPayload(file)
			const importCards = parseImportCards(payload)
			if (importCards.length === 0) throw new Error(T.errors.importFileHasNoCards)

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
				libraryStatus = format(T.templates.replacedLibrary, {
					count: cards.length,
					unit: plural(T.units.card, cards.length)
				})
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
						? T.errors.couldNotReplaceCards
						: T.errors.couldNotImportCards
			cards = await getAllCards()
			if (!cards.some((card) => card.id === selectedCardId)) selectedCardId = cards[0]?.id ?? ''
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

	function cardHasTag(card: StoredCard, tag: string): boolean {
		return Boolean(tag) && (card.tags ?? []).includes(tag)
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
				format(T.templates.importedCards, {
					count: result.importedCount,
					unit: plural(T.units.card, result.importedCount)
				})
			)
		}
		if (result.mergedCount > 0) {
			parts.push(format(T.templates.mergedCount, { count: result.mergedCount }))
		}
		if (result.skippedCount > 0) {
			parts.push(
				format(T.templates.skippedDuplicates, {
					count: result.skippedCount,
					unit: plural(T.units.duplicate, result.skippedCount)
				})
			)
		}
		if (result.conflictSeparateCount > 0) {
			parts.push(
				format(T.templates.keptConflicts, {
					count: result.conflictSeparateCount,
					unit: plural(T.units.conflict, result.conflictSeparateCount)
				})
			)
		}

		return parts.length > 0 ? `${parts.join('. ')}.` : T.status.nothingToImport
	}

	async function exportCompressedCards() {
		libraryStatus = ''
		libraryError = ''

		try {
			const payload = createCardsExportPayload(cards, { includeImages: true })
			const blob = await compressCardsExportPayload(payload)
			downloadBlob(blob, 'toddler-read-cards.json.gz')
			libraryStatus = format(T.templates.exportedCompressed, {
				count: cards.length,
				unit: plural(T.units.card, cards.length)
			})
		} catch (error) {
			libraryError = error instanceof Error ? error.message : T.errors.couldNotExportCompressed
		}
	}

	function exportImageLessCards() {
		const payload = createCardsExportPayload(cards, { includeImages: false })
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
		downloadBlob(blob, 'toddler-read-cards-image-less.json')
		libraryStatus = format(T.templates.exportedImageLess, {
			count: cards.length,
			unit: plural(T.units.card, cards.length)
		})
		libraryError = ''
	}

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = filename
		anchor.click()
		URL.revokeObjectURL(url)
	}

	function updateGridSize(event: Event) {
		gridSize = Number((event.currentTarget as HTMLSelectElement).value) as CardGridSize
		pngStatus = ''
	}

	function updatePageFormat(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value
		if (isPdfPageFormat(value)) pageFormat = value
		pngStatus = ''
		pressStatus = ''
	}

	function updatePageOrientation(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value
		if (isPdfPageOrientation(value)) pageOrientation = value
		pngStatus = ''
		pressStatus = ''
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
		if (!canExport || !exportCanvas) return

		pngStatus = ''
		try {
			await renderCardToCanvas(
				{ imageDataUrl, imageTransform, entries, pdfConfig, reserveQrMargin, showQrText },
				exportCanvas
			)
			const blob = await canvasToBlob(exportCanvas)
			const url = URL.createObjectURL(blob)
			const opened = window.open(url, '_blank')

			if (!opened) {
				URL.revokeObjectURL(url)
				throw new Error(T.errors.couldNotOpenPngPopup)
			}

			opened.opener = null
			window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
			pngStatus = T.status.pngOpened
		} catch (error) {
			pngStatus = error instanceof Error ? error.message : T.errors.couldNotOpenPng
		}
	}

	async function downloadLayoutPdf() {
		if (printLayout.pages.length === 0 || !pdfCanvas) return

		pressStatus = ''
		pressError = ''
		try {
			const pageSize = getPdfPageSize(pdfConfig)
			const pdf = new jsPDF({
				orientation: pageOrientation,
				unit: 'mm',
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
							pdfConfig,
							reserveQrMargin,
							showQrText
						},
						pdfCanvas
					)
					if (!isFirstPage) pdf.addPage([pageSize.width, pageSize.height], pageOrientation)
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
			pressStatus = format(T.templates.pdfDownloaded, { count: printLayout.pages.length * 2 })
		} catch (error) {
			pressError = error instanceof Error ? error.message : T.errors.couldNotDownloadPdf
		}
	}

	function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
		return new Promise((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) resolve(blob)
			else reject(new Error(T.errors.couldNotCreatePng))
			}, 'image/png')
		})
	}
</script>

<svelte:head>
	<title>{i18nReady ? T.app.documentTitle : 'Toddler Read'}</title>
	<link rel="icon" type="image/png" href="/favicon.png" />
	<link rel="apple-touch-icon" href="/app-icon.png" />
</svelte:head>

{#if !i18nReady}
	<main class="app-loading" aria-label="Toddler Read">
		<img src="/app-icon.png" alt="" />
	</main>
{:else}
<main class="app-shell" dir={usageDirection}>
	<header class="app-header library-header">
		<div class="brand-block">
			<button
				type="button"
				class="app-logo-button"
				aria-label={T.aria.openHelp}
				title={T.labels.help}
				on:click={() => (showHelpPanel = true)}
			>
				<img src="/app-icon.png" alt="" />
				<Info size={15} aria-hidden="true" />
			</button>
			<div class="title-block">
				<p class="eyebrow">{T.app.brand}</p>
				<h1>{T.app.title}</h1>
			</div>
		</div>
		<div class="library-top-actions">
			<div
				class="segmented-control"
				class:mobile-workspace={isMobileWorkspace}
				aria-label={T.aria.workspaceView}
			>
				<button
					type="button"
					class:active={workspaceView === 'manager'}
					aria-label={T.aria.manager}
					title={T.aria.manager}
					on:click={() => (workspaceView = 'manager')}
				>
					<List size={18} aria-hidden="true" />
				</button>
				{#if !isMobileWorkspace}
					<button
						type="button"
						class:active={workspaceView === 'split'}
						aria-label={T.aria.split}
						title={T.aria.split}
						on:click={() => (workspaceView = 'split')}
					>
						<Columns2 size={18} aria-hidden="true" />
					</button>
				{/if}
				<button
					type="button"
					class:active={workspaceView === 'editor'}
					aria-label={T.labels.editor}
					title={T.labels.editor}
					on:click={() => (workspaceView = 'editor')}
				>
					<Pencil size={18} aria-hidden="true" />
				</button>
				<button
					type="button"
					class:active={workspaceView === 'press'}
					aria-label={T.aria.press}
					title={T.aria.press}
					on:click={() => (workspaceView = 'press')}
				>
					<Printer size={18} aria-hidden="true" />
				</button>
			</div>
			<div class="pdf-config-control" title={format(T.templates.pdfLayout, { layout: pdfLayoutLabel })}>
				<span>{pdfLayoutLabel}</span>
				<button
					type="button"
					aria-label={T.aria.pdfConfiguration}
					title={T.aria.pdfConfiguration}
					on:click={() => (showPdfConfigPanel = true)}
				>
					<span aria-hidden="true">📄</span>
				</button>
			</div>
			{#if managerLanguages.length > 0}
				<label class="main-language-control toolbar-language-control">
					<Languages size={18} aria-hidden="true" />
					<select
						value={mainLanguage}
						aria-label={T.aria.referenceLanguage}
						title={format(T.templates.referenceLanguage, { language: mainLanguage })}
						on:change={(event) => updateMainLanguage(event.currentTarget.value)}
					>
						{#each managerLanguages as language}
							<option value={language}>{configuredMarkerForLanguage(language)}</option>
						{/each}
					</select>
				</label>
			{/if}
			<IconButton ariaLabel={T.labels.settings} onclick={() => (showSettingsPanel = !showSettingsPanel)}>
				<Settings size={18} aria-hidden="true" />
			</IconButton>
			<button type="button" on:click={createNewCard}>
				<Plus size={18} aria-hidden="true" />
				{T.actions.newCard}
			</button>
			<details class="file-menu" bind:open={showFileMenu}>
				<summary class="secondary" aria-label={T.aria.fileActions}>{T.actions.file}</summary>
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
						{T.actions.import}
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
						{T.actions.replace}
					</button>
					<button
						type="button"
						class="secondary"
						disabled={cards.length === 0}
						on:click={async () => {
							showFileMenu = false
							await exportCompressedCards()
						}}
					>
						<Download size={18} aria-hidden="true" />
						{T.actions.exportCompressed}
					</button>
					<button
						type="button"
						class="secondary"
						disabled={cards.length === 0}
						on:click={() => {
							showFileMenu = false
							exportImageLessCards()
						}}
					>
						<Download size={18} aria-hidden="true" />
						{T.actions.exportImageLessJson}
					</button>
				</div>
			</details>
			{#if readerQrDataUrl}
				<button
					type="button"
					class="apk-qr"
					aria-label={T.aria.showPwaReaderQr}
					title={T.aria.showPwaReaderQr}
					on:click={() => (showReaderInstallPanel = true)}
				>
					<span class="apk-qr-icon" aria-hidden="true">
						<Smartphone size={15} aria-hidden="true" />
					</span>
					<img src={readerQrDataUrl} alt="" />
				</button>
			{/if}
			{#if apkQrDataUrl}
				<button
					type="button"
					class="apk-qr"
					aria-label={T.aria.showAndroidApkQr}
					title={T.aria.showAndroidApkQr}
					on:click={() => (showApkPanel = true)}
				>
					<span class="apk-qr-icon apk-qr-icon-android" aria-hidden="true">
						<svg viewBox="0 0 24 24" role="img" aria-hidden="true">
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
		accept="application/json,.json,.json.gz,application/gzip"
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
		aria-label={T.aria.cardGenerator}
	>
		{#if showManager}
			<section class="manager-pane" aria-label={T.aria.cardsManager}>
				<div class="manager-tag-toolbar" aria-label={T.aria.managerTags}>
					<table class="manager-tag-table">
						<tbody>
							{#each managerTagRows as row (row.id)}
								{@const rowTag = normalizeTag(row.tagInput)}
								<tr>
									<td>
										<label class="tag-combobox manager-tag-picker">
											<input
												value={row.tagInput}
												list="manager-tag-options"
												placeholder={T.labels.chooseTag}
												aria-label={T.labels.chooseTag}
												on:input={(event) =>
													updateManagerTagRowInput(row.id, event.currentTarget.value)}
												on:blur={normalizeManagerTagRows}
											/>
										</label>
									</td>
									<td>
										<div class="manager-tag-actions" aria-label={T.aria.selectedCardsTagActions}>
											<button
												type="button"
												class="secondary"
												disabled={!canAddManagerTag(row, managerSelectedCards)}
												on:click={() => addManagerTagToSelection(row)}
											>
												<Plus size={16} aria-hidden="true" />
												{T.actions.add}
											</button>
											<button
												type="button"
												class="secondary"
												disabled={!canRemoveManagerTag(row, managerSelectedCards)}
												on:click={() => removeManagerTagFromSelection(row)}
											>
												<X size={16} aria-hidden="true" />
												{T.actions.remove}
											</button>
										</div>
									</td>
									<td>
										<PresenceFilterGroup
											value={row.presenceFilter}
											disabled={!rowTag}
											ariaLabel={format(T.templates.filterTableByTag, { tag: rowTag || 'tag' })}
											name={`manager-tag-presence-filter-${row.id}`}
											onValueChange={(value) => updateManagerTagRowPresence(row.id, value)}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<datalist id="manager-tag-options">
						{#each usedTags as tag}
							<option value={tag}></option>
						{/each}
					</datalist>
				</div>
				<div class="card-table-wrap">
					<table class="card-table">
						<thead>
							<tr>
								<th aria-label={T.aria.printSelection}>
									<input
										class="header-checkbox"
										type="checkbox"
										checked={allDisplayedSelected}
										disabled={displayedManagerCards.length === 0}
										use:setIndeterminate={someDisplayedSelected && !allDisplayedSelected}
										aria-label={T.aria.selectDisplayedCards}
										on:change={toggleDisplayedPrintSelection}
									/>
								</th>
								<th title={T.manager.image}>
									<div class="image-column-header">
										<span class="column-title">
											<ImageIcon size={17} aria-hidden="true" />
											{#if duplicateColumnKeys.has('image')}
												<DuplicateFocusButton
													active={duplicateFocus === 'image'}
													ariaLabel={T.aria.showDuplicateImages}
													onclick={() => toggleDuplicateFocus('image')}
												/>
											{/if}
										</span>
										<PresenceFilterGroup
											bind:value={imagePresenceFilter}
											ariaLabel={T.aria.filterImages}
											name="image-presence-filter"
										/>
									</div>
								</th>
								<th title={mainLanguage}>
									<div class="language-column-header">
										<span class="column-title">
											<span>{configuredMarkerForLanguage(mainLanguage)}</span>
											{#if duplicateColumnKeys.has(duplicateColumnKeyForLanguage(mainLanguage))}
												<DuplicateFocusButton
													active={duplicateFocus === duplicateColumnKeyForLanguage(mainLanguage)}
													ariaLabel={format(T.templates.showDuplicateLanguageValues, {
														language: mainLanguage
													})}
													onclick={() =>
														toggleDuplicateFocus(duplicateColumnKeyForLanguage(mainLanguage))}
												/>
											{/if}
										</span>
										<input
											class="language-column-filter"
											value={languageFilters[mainLanguage] ?? ''}
											aria-label={format(T.templates.filterLanguage, { language: mainLanguage })}
											on:click|stopPropagation
											on:input={(event) =>
												updateLanguageFilter(mainLanguage, event.currentTarget.value)}
										/>
									</div>
								</th>
								{#if !isMobileWorkspace}
									<th>
										<div class="verso-column-header">
											<span class="column-title" title={T.labels.verso}>
												<Link2 size={17} aria-hidden="true" />
											</span>
											<PresenceFilterGroup
												bind:value={versoPresenceFilter}
												ariaLabel={T.aria.filterVersoLinks}
												name="verso-presence-filter"
											/>
										</div>
									</th>
								{/if}
								{#if workspaceView === 'manager'}
									<th class="manager-tags-column">{T.labels.tags}</th>
								{/if}
								<th aria-label={T.aria.deleteCheckedCards}>
									{#if deletingCheckedCardsArmed}
										<div class="delete-checked-confirm" aria-live="assertive">
											<button type="button" class="danger" on:click={confirmDeleteCheckedCards}>
												{T.actions.yes}
											</button>
											<strong>{format(T.templates.deleteCount, { count: selectedDeleteCardIds.length })}</strong>
											<button
												type="button"
												class="secondary"
												on:click={() => (deletingCheckedCardsArmed = false)}
											>
												{T.actions.no}
											</button>
										</div>
									{:else}
										<IconButton
											ariaLabel={T.aria.deleteCheckedCards}
											title={T.aria.deleteCheckedCards}
											className="delete-checked-button"
											variant="danger"
											size={16}
											disabled={selectedDeleteCardIds.length === 0}
											onclick={() => (deletingCheckedCardsArmed = true)}
										>
											<Trash2 size={16} aria-hidden="true" />
										</IconButton>
									{/if}
								</th>
							</tr>
						</thead>
						<tbody>
							{#each displayedManagerCards as card (card.id)}
								<tr
									class:selected={card.id === selectedCardId}
									on:click={() => openManagerCard(card.id)}
								>
									<td class="select-cell">
										<label class="row-checkbox" title={T.manager.selectForPress}>
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
											<div class="manager-thumb empty-thumb" aria-label={T.aria.noImage}></div>
										{/if}
									</td>
									<td>{card.texts[mainLanguage] || ''}</td>
									{#if !isMobileWorkspace}
										<td class="verso-cell">
											{#if pairingCardId === card.id}
												<select
													aria-label={T.aria.chooseVersoCard}
													value={card.versoCardId ?? ''}
													on:click|stopPropagation
													on:change={(event) => updateVersoLink(card.id, event.currentTarget.value)}
												>
													<option value="">{T.manager.noVerso}</option>
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
													title={T.manager.chooseVerso}
													on:click|stopPropagation={() => (pairingCardId = card.id)}
												>
													<Link2 size={15} aria-hidden="true" />
													<span>{linkedCardLabel(card)}</span>
												</button>
												{#if card.versoCardId}
													<IconButton
														ariaLabel={T.manager.unlinkVerso}
														title={T.manager.unlinkVerso}
														className="delete-icon-button"
														size={15}
														stopPropagation
														onclick={() => clearVersoLink(card.id)}
													>
														<Link2Off size={15} aria-hidden="true" />
													</IconButton>
												{/if}
											{/if}
										</td>
									{/if}
									{#if workspaceView === 'manager'}
										<td class="manager-tags-cell">
											{#if card.tags?.length}
												<div class="manager-table-tags" aria-label={T.aria.tags}>
													{#each card.tags as tag}
														<span>{tag}</span>
													{/each}
												</div>
											{/if}
										</td>
									{/if}
									<td class="delete-cell">
										{#if deletingCardId === card.id}
											<span>{T.manager.deleteQuestion}</span>
											<button
												type="button"
												class="danger-text"
												on:click|stopPropagation={() => confirmDeleteCard(card.id)}>{T.actions.yesLower}</button
											>
											<button
												type="button"
												class="plain-text"
												on:click|stopPropagation={() => (deletingCardId = '')}>{T.actions.noLower}</button
											>
										{:else}
											<IconButton
												ariaLabel={T.aria.deleteCard}
												title={T.aria.deleteCard}
												className="delete-icon-button"
												size={16}
												stopPropagation
												onclick={() => (deletingCardId = card.id)}
											>
												<Trash2 size={16} aria-hidden="true" />
											</IconButton>
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
			<section class="press-pane" aria-label={T.aria.press}>
				<div class="pane-header">
					<div class="press-actions">
						<button type="button" class="secondary" on:click={() => (workspaceView = 'manager')}>
							<List size={18} aria-hidden="true" />
							{T.actions.manage}
						</button>
						<button
							type="button"
							disabled={printLayout.pages.length === 0}
							on:click={downloadLayoutPdf}
						>
							<Download size={18} aria-hidden="true" />
							{T.actions.downloadPdf}
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
							{T.actions.selectCards}
						</button>
					</div>
				{:else}
					<div class="press-pages">
						{#each printLayout.pages as page, index}
							<article class="press-page-pair">
								<div class="press-page-header">
									<strong>{format(T.templates.page, { page: index + 1 })}</strong>
									<span>{pdfLayoutLabel}</span>
								</div>
								<div class="press-preview-grid">
									<div class="press-preview">
										<span>{T.labels.recto}</span>
										<canvas
											bind:this={rectoPreviewCanvases[index]}
											style={`aspect-ratio: ${pdfPageSize.width} / ${pdfPageSize.height}`}
											aria-label={format(T.templates.rectoPage, { page: index + 1 })}
										></canvas>
									</div>
									<div class="press-preview">
										<span>{T.labels.verso}</span>
										<canvas
											bind:this={versoPreviewCanvases[index]}
											style={`aspect-ratio: ${pdfPageSize.width} / ${pdfPageSize.height}`}
											aria-label={format(T.templates.versoPage, { page: index + 1 })}
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
			<section class="editor-workspace" aria-label={T.aria.cardEditor}>
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
									{isTranslating ? T.actions.translating : T.actions.translate}
								</button>
							</span>
							{#if editorDeleteArmed}
								<button type="button" class="secondary" on:click={() => (editorDeleteArmed = false)}
									>{T.actions.cancel}</button
								>
								<button
									type="button"
									class="danger"
									on:click={() => selectedCard && confirmDeleteCard(selectedCard.id)}
								>
									{T.actions.delete}
								</button>
							{:else}
								<IconButton ariaLabel={T.aria.deleteCard} onclick={() => (editorDeleteArmed = true)}>
									<Trash2 size={18} aria-hidden="true" />
								</IconButton>
							{/if}
						</div>
					</div>

					<div class="language-list">
						{#each editorEntries(entries) as { entry, index } (entry.id)}
							<article class="language-row">
								<div class="language-tools">
									<div
										class="readonly-marker"
										aria-label={entry.lang ? format(T.templates.flag, { language: entry.lang }) : T.aria.noLanguageFlag}
									>
										{entry.marker}
									</div>
								</div>
								<label
									class="text-field"
									aria-label={format(T.templates.languageText, { language: entry.lang })}
								>
									<input
										value={entry.text}
										placeholder={T.placeholders.cardText}
										disabled={!entry.lang.trim()}
										on:input={(event) => updateCardText(index, event.currentTarget.value)}
									/>
								</label>
							</article>
						{/each}
					</div>

					<div class="image-panel">
						<div class="image-panel-header">
							<p class="eyebrow">{T.labels.image}</p>
							{#if imageDataUrl}
								<IconButton ariaLabel={T.aria.clearImage} onclick={clearImage}>
									<X size={18} aria-hidden="true" />
								</IconButton>
							{/if}
						</div>
						<div class="image-actions">
							<input
								class="paste-target"
								readonly
								aria-label={T.aria.pasteImageHere}
								placeholder={T.placeholders.pasteHere}
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
								{T.actions.choose}
							</button>
							<button type="button" class="secondary" on:click={openImageSearch}>
								<Search size={18} aria-hidden="true" />
								{T.actions.search}
							</button>
						</div>
						{#if imageDataUrl && !isMobileWorkspace}
							<div class="image-adjustments">
								<label>
									<span><Maximize2 size={16} aria-hidden="true" /> {T.labels.size}</span>
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
							</div>
						{/if}
					</div>

					{#if selectedCard}
						<div class="verso-panel">
							<div class="verso-panel-header">
								<p class="eyebrow">{T.labels.verso}</p>
								{#if selectedCard.versoCardId}
									<IconButton
										ariaLabel={T.manager.unlinkVerso}
										title={T.manager.unlinkVerso}
										onclick={() => clearVersoLink(selectedCard.id)}
									>
										<Link2Off size={18} aria-hidden="true" />
									</IconButton>
								{/if}
							</div>
							<label class="verso-select-field">
								<Link2 size={18} aria-hidden="true" />
								<select
									aria-label={T.aria.chooseVersoCard}
									value={selectedCard.versoCardId ?? ''}
									on:change={(event) => updateVersoLink(selectedCard.id, event.currentTarget.value)}
								>
									<option value="">{T.manager.noVerso}</option>
									{#each candidateCardsFor(selectedCard) as candidate}
										<option value={candidate.id}>{cardLabel(candidate)}</option>
									{/each}
								</select>
							</label>
						</div>
					{/if}

					<TagInput
						bind:value={tagInput}
						tags={selectedCardTags}
						suggestions={tagSuggestions}
						listId="card-tag-options"
						onAdd={addSelectedTag}
						onRemove={removeSelectedTag}
					/>

					{#if translationError}
						<p class="status error">{translationError}</p>
					{:else if translationStatus}
						<p class="status">{translationStatus}</p>
					{/if}
				</div>

				<div class="preview-pane">
					<div class="preview-toolbar">
						<div class="preview-actions">
							<button type="button" disabled={!canExport} on:click={openPngPreview}>
								<ExternalLink size={18} aria-hidden="true" />
								{T.actions.openPng}
							</button>
						</div>
					</div>

					<CardPreviewCanvas
						bind:canvas={previewCanvas}
						dragging={isDragging}
						canPan={Boolean(imageDataUrl)}
						onDragenter={() => (isDragging = true)}
						onDragover={() => (isDragging = true)}
						onDragleave={() => (isDragging = false)}
						onDrop={onDrop}
						onPointerdown={startImageGesture}
						onPointermove={moveImageGesture}
						onPointerup={stopImageGesture}
						onPointercancel={stopImageGesture}
					/>

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
		<PanelModal
			title={T.modal.imageSearch.title}
			titleId="image-search-title"
			eyebrow={T.labels.imageSource}
			closeLabel={T.modal.imageSearch.close}
			modalClass="image-search-modal"
			onClose={closeImageSearch}
		>
			{#if availableImageSearchProviders.length > 0}
				<div class="image-provider-tabs" aria-label={T.labels.imageSource}>
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
					placeholder={T.placeholders.imageSearch}
					aria-label={T.aria.imageSearchQuery}
					spellcheck="false"
					on:input={(event) => (imageSearchQuery = event.currentTarget.value)}
				/>
				<button
					type="submit"
					disabled={isSearchingImages || availableImageSearchProviders.length === 0}
				>
					<Search size={18} aria-hidden="true" />
					{isSearchingImages ? T.actions.searching : T.actions.search}
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
							aria-label={format(T.templates.useImage, { alt: result.alt })}
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
					{format(T.templates.resultsFrom, { provider: imageSearchProviderInstance.label })}
				</a>
				<div class="image-search-pages">
					<button
						type="button"
						class="secondary"
						disabled={imageSearchPage <= 1 || isSearchingImages}
						on:click={() => searchImages(imageSearchPage - 1)}
					>
						{T.actions.previous}
					</button>
					<span>{format(T.templates.pageOf, { page: imageSearchPage, total: imageSearchTotalPages })}</span>
					<button
						type="button"
						class="secondary"
						disabled={!imageSearchHasNextPage || isSearchingImages}
						on:click={() => searchImages(imageSearchPage + 1)}
					>
						{T.actions.next}
					</button>
				</div>
			</div>
		</PanelModal>
	{/if}

	{#if showReaderInstallPanel}
		<QRInstallPanel
			title={T.modal.reader.title}
			titleId="reader-install-title"
			eyebrow={T.modal.reader.eyebrow}
			closeLabel={T.modal.reader.close}
			qrDataUrl={readerQrDataUrl}
			qrAlt={T.modal.reader.qrAlt}
			href={readerUrl}
			linkLabel={T.actions.openReader}
			linkTarget="_blank"
			note={T.modal.reader.note}
			onClose={() => (showReaderInstallPanel = false)}
		/>
	{/if}

	{#if showApkPanel}
		<QRInstallPanel
			title={T.modal.apk.title}
			titleId="apk-install-title"
			eyebrow={T.modal.apk.eyebrow}
			closeLabel={T.modal.apk.close}
			qrDataUrl={apkQrDataUrl}
			qrAlt={T.modal.apk.qrAlt}
			href={apkUrl}
			linkLabel={T.actions.downloadApk}
			action="download"
			onClose={() => (showApkPanel = false)}
		/>
	{/if}

	{#if showHelpPanel}
		<PanelModal
			title={T.modal.help.title}
			titleId="help-title"
			closeLabel={T.modal.help.close}
			modalClass="help-modal"
			showCloseButton={false}
			onClose={() => (showHelpPanel = false)}
		>
			<div slot="header" class="settings-header">
				<div class="help-title-row">
					<img src="/app-icon.png" alt="" />
					<div>
						<p class="eyebrow">{T.app.brand}</p>
						<h2 id="help-title">{T.labels.help}</h2>
					</div>
				</div>
			</div>

			<div class="help-content">
				<section>
					<h3>{T.help.localDataTitle}</h3>
					<p>{T.help.localDataText1}</p>
					<p>{T.help.localDataText2}</p>
				</section>

				<section>
					<h3>{T.help.editingCards}</h3>
					<p>
						{T.help.editingCardsIntro} <strong>{T.help.editingCardsIntroAction}</strong>
						{T.help.editingCardsIntroRest}
					</p>
					<ul>
						{#each T.help.editingCardsItems.slice(0, 3) as item}
							<li>{item}</li>
						{/each}
						<li>
							{T.help.enableQrMarginIntro} <strong>{T.help.enableQrMarginLabel}</strong>
							{T.help.enableQrMarginRest}
						</li>
						<li>
							{T.help.enableQrTextIntro} <strong>{T.help.enableQrTextLabel}</strong>
							{T.help.enableQrTextRest}
						</li>
						<li>{T.help.editingCardsItems[3]}</li>
					</ul>
				</section>

				<section>
					<h3>{T.labels.settings}</h3>
					<p>{T.help.settingsIntro}</p>
					<ul>
						<li>
							<strong>{T.help.cornerLanguagesLabel}</strong> {T.help.cornerLanguagesRest}
							<code>en</code>, <code>fr</code>, {T.help.cornerLanguagesExamplesRest}
							<code>ro</code>, {T.help.cornerLanguagesRestAfter}
						</li>
						<li>
							<strong>{T.help.imageSourcesLabel}</strong> {T.help.imageSourcesRest}
						</li>
						<li>
							<strong>{T.help.translationLabel}</strong> {T.help.translationRest}
						</li>
						<li>
							<strong>{T.help.modelBaseUrlLabel}</strong> {T.help.modelBaseUrlRest}
						</li>
						<li>
							<strong>{T.help.promptTemplateLabel}</strong> {T.help.promptTemplateRest}
						</li>
					</ul>
				</section>

				<section>
					<h3>{T.help.apiKeysTitle}</h3>
					<p>{T.help.apiKeysText}</p>
				</section>

				<section>
					<h3>{T.labels.fileMenu}</h3>
					<ul>
						<li>
							<strong>{T.help.importLabel}</strong> {T.help.importRest}
						</li>
						<li>
							<strong>{T.help.replaceLabel}</strong> {T.help.replaceRest}
						</li>
						<li>
							<strong>{T.help.exportCompressedLabel}</strong> {T.help.exportCompressedRest}
						</li>
						<li>
							<strong>{T.help.exportImageLessLabel}</strong> {T.help.exportImageLessRest}
						</li>
					</ul>
				</section>

				<section>
					<h3>{T.labels.managerAndPress}</h3>
					<p>{T.help.managerPressText1}</p>
					<p>{T.help.managerPressText2}</p>
				</section>

				<section>
					<h3>{T.help.links}</h3>
					<div class="help-links">
						<a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
							<ExternalLink size={16} aria-hidden="true" />
							{T.help.repository}
						</a>
						<a href={KO_FI_URL} target="_blank" rel="noreferrer">
							<ExternalLink size={16} aria-hidden="true" />
							{T.help.kofi}
						</a>
					</div>
				</section>
			</div>

			<div class="help-footer">
				<label class="startup-help-toggle">
					<input
						type="checkbox"
						checked={showHelpAtStartup}
						on:change={updateShowHelpAtStartup}
					/>
					<span>{T.help.showHelpAtStartup}</span>
				</label>
				<button type="button" on:click={() => (showHelpPanel = false)}>{T.actions.ok}</button>
			</div>
		</PanelModal>
	{/if}

	{#if showPdfConfigPanel}
		<PanelModal
			title={T.labels.pdfLayout}
			titleId="pdf-config-title"
			eyebrow={T.labels.print}
			closeLabel={T.modal.pdf.close}
			onClose={() => (showPdfConfigPanel = false)}
		>
			<div class="pdf-config-summary">
				<span>{pdfLayoutLabel}</span>
			</div>
			<div class="pdf-config-fields">
				<label>
					{T.labels.format}
					<select value={pageFormat} aria-label={T.aria.pdfPageFormat} on:change={updatePageFormat}>
						{#each PDF_PAGE_FORMAT_OPTIONS as option}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</label>
				<label>
					{T.labels.orientation}
					<select
						value={pageOrientation}
						aria-label={T.aria.pdfPageOrientation}
						on:change={updatePageOrientation}
					>
						{#each PDF_PAGE_ORIENTATION_OPTIONS as option}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</label>
				<label>
					{T.labels.size}
					<select value={gridSize} aria-label={T.aria.pdfGridSize} on:change={updateGridSize}>
						{#each GRID_SIZE_OPTIONS as option}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</label>
			</div>
			<p class="pdf-config-note">
				{T.modal.pdf.note}
			</p>
		</PanelModal>
	{/if}

	{#if showSettingsPanel}
		<PanelModal
			title={T.labels.cornerLanguages}
			titleId="settings-title"
			eyebrow={T.labels.settings}
			closeLabel={T.modal.settings.close}
			onClose={() => (showSettingsPanel = false)}
		>
			<div class="settings-language-list">
				{#each languageSetups as setup, index (setup.id)}
					{@const corner = cornerSpecForIndex(index)}
					<article class="settings-language-row">
						<div class="corner-field">
							<div
								class="readonly-corner-icon"
								role="img"
								aria-label={cornerLabelForIndex(index)}
								title={cornerLabelForIndex(index)}
							>
								<svelte:component this={corner.icon} size={18} aria-hidden="true" />
							</div>
						</div>
						<label>
							{T.labels.code}
							<input
								value={setup.lang}
								maxlength="16"
								placeholder={T.placeholders.languageCode}
								spellcheck="false"
								on:input={(event) =>
									updateLanguageSetup(setup.id, { lang: event.currentTarget.value })}
							/>
						</label>
						<label class="marker-field">
							{T.labels.flag}
							<input
								value={setup.marker}
								maxlength="4"
								placeholder={T.placeholders.flag}
								spellcheck="false"
								on:input={(event) =>
									updateLanguageSetup(setup.id, { marker: event.currentTarget.value })}
							/>
						</label>
					</article>
				{/each}
			</div>
			<section class="settings-section">
				<h3>{T.labels.rendering}</h3>
				<div class="settings-toggle-list">
					<label class="settings-toggle">
						<input type="checkbox" checked={reserveQrMargin} on:change={updateReserveQrMargin} />
						<span>{T.help.enableQrMarginLabel}</span>
					</label>
					<label class="settings-toggle">
						<input type="checkbox" checked={showQrText} on:change={updateShowQrText} />
						<span>{T.help.enableQrTextLabel}</span>
					</label>
				</div>
			</section>
			<ProviderConfigFields
				imageProviders={IMAGE_SEARCH_PROVIDERS}
				imageProviderConfigs={imageSearchProviderConfigs}
				translationProviders={TRANSLATION_PROVIDERS}
				{translationProvider}
				translationProviderLabel={providerLabel(translationProvider)}
				translationConfig={currentTranslationProviderConfig}
				showBaseUrl={isOpenAiCompatibleProvider(translationProvider)}
				promptTemplate={translationPromptTemplate}
				onImageConfigChange={(change) =>
					updateImageSearchProviderConfig(
						change.provider as ImageSearchProviderId,
						change.field,
						change.value
					)}
				onTranslationProviderChange={(value) => updateTranslationProvider(value)}
				onTranslationConfigChange={(change) =>
					updateTranslationProviderConfig(change.field, change.value)}
				onPromptTemplateChange={(value) => (translationPromptTemplate = value)}
			/>
		</PanelModal>
	{/if}
</main>
{/if}
