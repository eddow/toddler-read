<script lang="ts">
	import { GoogleGenAI } from '@google/genai'
	import {
		BookOpenText,
		Columns2,
		Copy,
		Download,
		ExternalLink,
		FileText,
		Grid3X3,
		Image as ImageIcon,
		ImagePlus,
		Languages,
		Link2,
		Link2Off,
		List,
		Pencil,
		Plus,
		Printer,
		Settings,
		Trash2,
		Upload,
		WandSparkles,
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
		type LanguageEntry,
		type LayoutRenderableCard
	} from './lib/card'
	import {
		addCards,
		createCardId,
		deleteCard,
		getAllCards,
		putCard,
		type StoredCard
	} from './lib/cards-db'
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
	const VISIBLE_MANAGER_LANGUAGES_STORAGE_KEY = 'toddler-read-generator-visible-manager-languages'
	const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
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
	let idCounter = 0

	type LegacyTranslationMode = 'nothing' | 'use' | 'produce'
	type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]['value']
	type WorkspaceView = 'manager' | 'editor' | 'split' | 'press'
	type ImagePresenceFilter = 'all' | 'missing' | 'present'

	type TranslationOptions = {
		use: boolean
		produce: boolean
	}

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

	let languageSetups: CornerLanguageSetup[] = defaultLanguageSetups()
	let cards: StoredCard[] = []
	let selectedCardId = ''
	let workspaceView: WorkspaceView = 'split'
	let visibleManagerLanguages: string[] = []
	let mainLanguage = 'en'
	let languageFilters: Record<string, string> = {}
	let imagePresenceFilter: ImagePresenceFilter = 'all'
	let selectedPrintCardIds: string[] = []
	let pairingCardId = ''
	let duplicateFocus = ''
	let cardTexts = defaultCardTexts()
	let translationOptions = defaultTranslationOptions()
	let translationProvider: TranslationProvider = 'gemini'
	let translationProviderConfigs = defaultTranslationProviderConfigs()
	let translationPromptTemplate = DEFAULT_TRANSLATION_PROMPT_TEMPLATE
	let isTranslating = false
	let gridSize: CardGridSize = DEFAULT_CARD_GRID_SIZE
	let reserveQrMargin = false
	let showQrText = false
	let showSettingsPanel = false
	let imageDataUrl: string | undefined
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

	$: selectedCard = cards.find((card) => card.id === selectedCardId)
	$: cardTexts = buildCardTexts(languageSetups, selectedCard)
	$: imageDataUrl = selectedCard?.imageDataUrl
	$: managerLanguages = buildManagerLanguages(cards, languageSetups)
	$: if (libraryReady)
		visibleManagerLanguages = normalizeVisibleManagerLanguages(
			visibleManagerLanguages,
			managerLanguages
		)
	$: if (libraryReady && !managerLanguages.includes(mainLanguage)) mainLanguage = managerLanguages[0] ?? ''
	$: selectedPrintCardIds = selectedPrintCardIds.filter((id) => cards.some((card) => card.id === id))
	$: selectedRectoCardIds = dedupeSelectedRectoIds(cards, selectedPrintCardIds)
	$: allDisplayedSelected =
		displayedManagerCards.length > 0 &&
		displayedManagerCards.every((card) => selectedPrintCardIds.includes(card.id))
	$: someDisplayedSelected = displayedManagerCards.some((card) => selectedPrintCardIds.includes(card.id))
	$: duplicateColumnKeys = buildDuplicateColumnKeys(cards, visibleManagerLanguages)
	$: if (duplicateFocus && !duplicateColumnKeys.has(duplicateFocus)) duplicateFocus = ''
	$: displayedManagerCards = buildDisplayedManagerCards(
		cards,
		duplicateFocus,
		visibleManagerLanguages,
		languageFilters,
		imagePresenceFilter
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
	$: translationSources = buildTranslationSources(entries, translationOptions)
	$: translationTargets = buildTranslationTargets(entries, translationOptions)
	$: currentTranslationProviderConfig = translationProviderConfigs[translationProvider]
	$: translationDisabledReasons = getTranslationDisabledReasons(
		translationProvider,
		currentTranslationProviderConfig,
		translationSources,
		translationTargets
	)
	$: canTranslate = translationDisabledReasons.length === 0 && !isTranslating
	$: translateButtonTitle = isTranslating ? 'Translating...' : translationDisabledReasons.join(', ')
	$: void schedulePreviewRender(imageDataUrl, entries, gridSize, reserveQrMargin, showQrText)
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
			VISIBLE_MANAGER_LANGUAGES_STORAGE_KEY,
			JSON.stringify(visibleManagerLanguages)
		)
		localStorage.setItem(
			SETTINGS_STORAGE_KEY,
			JSON.stringify({
				gridSize,
				reserveQrMargin,
				showQrText,
				mainLanguage,
				languageSetups,
				translationOptions,
				translationProvider,
				translationProviderConfigs,
				translationPromptTemplate
			})
		)
	}

	onMount(() => {
		loadStoredSettings()
		loadLibraryPreferences()
		storageReady = true
		void initializeCardLibrary()
		apkUrl = new URL('tr.apk', document.baseURI).href
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
			if (event.key === 'Escape') showSettingsPanel = false
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
		marker = markerForLanguage(lang).marker
	): CornerLanguageSetup {
		return { id: createEntryId(), lang, marker }
	}

	function defaultLanguageSetups(): CornerLanguageSetup[] {
		return [
			createLanguageSetup('en'),
			createLanguageSetup('fr'),
			createLanguageSetup('ro'),
			createLanguageSetup('')
		]
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

	function defaultTranslationOptions(): TranslationOptions[] {
		return Array.from({ length: MAX_ENTRIES }, () => ({ use: false, produce: false }))
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

	function normalizeVisibleManagerLanguages(visible: string[], available: string[]): string[] {
		const filtered = visible.filter((language) => available.includes(language))
		return filtered.length > 0 ? filtered : available.slice(0, 4)
	}

	function loadLibraryPreferences() {
		const storedView = localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY)
		if (isWorkspaceView(storedView)) {
			workspaceView = storedView
		}

		const storedSelectedCardId = localStorage.getItem(LIBRARY_SELECTION_STORAGE_KEY)
		if (storedSelectedCardId) selectedCardId = storedSelectedCardId

		try {
			const parsed = JSON.parse(localStorage.getItem(VISIBLE_MANAGER_LANGUAGES_STORAGE_KEY) ?? '[]')
			if (Array.isArray(parsed)) {
				visibleManagerLanguages = parsed.filter(
					(language): language is string => typeof language === 'string'
				)
			}
		} catch {
			visibleManagerLanguages = []
		}
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
			visibleManagerLanguages = normalizeVisibleManagerLanguages(
				visibleManagerLanguages,
				buildManagerLanguages(cards, languageSetups)
			)
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

	function normalizeTranslationOptionCount(
		nextOptions: TranslationOptions[]
	): TranslationOptions[] {
		const normalized = nextOptions.slice(0, MAX_ENTRIES)
		while (normalized.length < MAX_ENTRIES) normalized.push({ use: false, produce: false })
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
			if (typeof parsed.geminiApiKey === 'string' || typeof parsed.geminiModel === 'string') {
				translationProviderConfigs = migrateLegacyGeminiConfig(
					translationProviderConfigs,
					typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
					typeof parsed.geminiModel === 'string' ? parsed.geminiModel : ''
				)
			}
			if (Array.isArray(parsed.translationOptions)) {
				translationOptions = normalizeStoredTranslationOptions(parsed.translationOptions)
			} else if (Array.isArray(parsed.translationModes)) {
				translationOptions = normalizeStoredTranslationModes(parsed.translationModes)
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
						: markerForLanguage(lang).marker

				return {
					id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createEntryId(),
					lang,
					marker
				}
			})
			.filter((entry): entry is CornerLanguageSetup => Boolean(entry))
	}

	function normalizeStoredTranslationOptions(value: unknown[]): TranslationOptions[] {
		return normalizeTranslationOptionCount(
			value.map((entry) => {
				if (!entry || typeof entry !== 'object') return { use: false, produce: false }
				const candidate = entry as Partial<TranslationOptions>
				return {
					use: Boolean(candidate.use),
					produce: Boolean(candidate.produce)
				}
			})
		)
	}

	function normalizeStoredTranslationModes(value: unknown[]): TranslationOptions[] {
		return normalizeTranslationOptionCount(
			value.map((mode) => {
				if (!isLegacyTranslationMode(mode)) return { use: false, produce: false }
				return {
					use: mode === 'use',
					produce: mode === 'produce'
				}
			})
		)
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

	function isLegacyTranslationMode(value: unknown): value is LegacyTranslationMode {
		return value === 'nothing' || value === 'use' || value === 'produce'
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
				next.marker = markerForLanguage(patch.lang).marker
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

	function updateTranslationOption(index: number, key: keyof TranslationOptions, checked: boolean) {
		const nextOptions = normalizeTranslationOptionCount(translationOptions)
		nextOptions[index] = { ...nextOptions[index], [key]: checked }
		translationOptions = nextOptions
		translationStatus = ''
		translationError = ''
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

	function buildTranslationSources(
		nextEntries: LanguageEntry[],
		nextOptions: TranslationOptions[]
	): TranslationSource[] {
		return nextEntries
			.map((entry, index) => ({
				index,
				lang: entry.lang.trim(),
				text: entry.text.trim(),
				use: Boolean(nextOptions[index]?.use)
			}))
			.filter((entry) => entry.use && entry.text.length > 0)
			.map(({ index, lang, text }) => ({ index, lang, text }))
	}

	function buildTranslationTargets(
		nextEntries: LanguageEntry[],
		nextOptions: TranslationOptions[]
	): TranslationTarget[] {
		return nextEntries
			.map((entry, index) => ({
				index,
				lang: entry.lang.trim(),
				text: entry.text.trim(),
				use: Boolean(nextOptions[index]?.use),
				produce: Boolean(nextOptions[index]?.produce)
			}))
			.filter(
				(entry) => entry.produce && entry.lang.length > 0 && (!entry.use || entry.text.length === 0)
			)
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

	function buildDuplicateColumnKeys(nextCards: StoredCard[], languages: string[]): Set<string> {
		const keys = new Set<string>()
		if (hasDuplicateValues(nextCards, 'image')) keys.add('image')

		for (const language of languages) {
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
		languages: string[],
		filters: Record<string, string>,
		imageFilter: ImagePresenceFilter
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

					return managerSortLabel(left, languages).localeCompare(managerSortLabel(right, languages))
				})
		}

		const imageFilteredCards = duplicateFilteredCards.filter((card) => {
			if (imageFilter === 'missing') return !card.imageDataUrl
			if (imageFilter === 'present') return Boolean(card.imageDataUrl)
			return true
		})

		const activeFilters = Object.entries(filters)
			.map(([language, filter]) => [language, filter.trim().toLocaleLowerCase()] as const)
			.filter(([, filter]) => filter.length > 0)

		if (activeFilters.length === 0) return imageFilteredCards

		return imageFilteredCards.filter((card) =>
			activeFilters.every(([language, filter]) =>
				(card.texts[language] ?? '').toLocaleLowerCase().includes(filter)
			)
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

	function managerSortLabel(card: StoredCard, languages: string[]): string {
		for (const language of languages) {
			const text = card.texts[language]?.trim()
			if (text) return text
		}

		return card.id
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

	function clearImage() {
		updateSelectedCard({ imageDataUrl: undefined })
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
		updateSelectedCard({ imageDataUrl: nextImageDataUrl })
		pngStatus = ''
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
		if (value === 'missing' || value === 'present') {
			imagePresenceFilter = value
			return
		}
		imagePresenceFilter = 'all'
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
		const nextCards = versoCardId ? linkVersoCards(cards, cardId, versoCardId) : unlinkVersoCard(cards, cardId)
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
		return card.texts[mainLanguage]?.trim() || managerSortLabel(card, visibleManagerLanguages) || card.id
	}

	function linkedCardLabel(card: StoredCard): string {
		return card.versoCardId ? cardLabel(cards.find((entry) => entry.id === card.versoCardId)) : 'No verso'
	}

	function candidateCardsFor(card: StoredCard): StoredCard[] {
		return cards
			.filter((candidate) => candidate.id !== card.id)
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

	function toggleManagerLanguage(language: string) {
		if (visibleManagerLanguages.includes(language)) {
			visibleManagerLanguages = visibleManagerLanguages.filter((entry) => entry !== language)
			return
		}

		visibleManagerLanguages = [...visibleManagerLanguages, language].sort((left, right) =>
			left.localeCompare(right)
		)
	}

	function chooseImportFile() {
		importInput.click()
	}

	async function onImportFileSelected(event: Event) {
		const target = event.currentTarget as HTMLInputElement
		const file = target.files?.[0]
		if (file) await importCardsFile(file)
		target.value = ''
	}

	async function importCardsFile(file: File) {
		libraryStatus = ''
		libraryError = ''

		try {
			const payload = JSON.parse(await file.text())
			const importCards = parseImportCards(payload)
			if (importCards.length === 0) throw new Error('Import file has no cards.')

			const importPlan = planCardImport(cards, importCards)
			const addedCards = importPlan.cardsToAdd.length > 0 ? await addCards(importPlan.cardsToAdd) : []
			for (const card of importPlan.cardsToMerge) {
				await putCard(card)
			}

			cards = cards
				.map((card) => importPlan.cardsToMerge.find((mergedCard) => mergedCard.id === card.id) ?? card)
				.concat(addedCards)
			cards = await applyImportedVersoLinks(cards, importPlan)
			if (addedCards[0]) selectedCardId = addedCards[0].id
			else if (importPlan.cardsToMerge[0]) selectedCardId = importPlan.cardsToMerge[0].id
			visibleManagerLanguages = normalizeVisibleManagerLanguages(
				visibleManagerLanguages,
				buildManagerLanguages([...cards], languageSetups)
			)
			libraryStatus = buildImportSummary({
				importedCount: addedCards.length,
				mergedCount: importPlan.cardsToMerge.length,
				skippedCount: importPlan.skippedCount,
				conflictSeparateCount: importPlan.conflictSeparateCount
			})
		} catch (error) {
			libraryError = error instanceof Error ? error.message : 'Could not import cards.'
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
				const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : undefined
				const texts = normalizeImportTexts(candidate.texts)
				const imageDataUrl =
					normalizeCardImage(candidate.imageDataUrl).length > 0
						? normalizeCardImage(candidate.imageDataUrl)
						: undefined
				const versoCardId =
					typeof candidate.versoCardId === 'string' && candidate.versoCardId.trim()
						? candidate.versoCardId.trim()
						: undefined
				if (!imageDataUrl && Object.keys(texts).length === 0) return undefined
				return { id, imageDataUrl, texts, versoCardId }
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
				if (normalizedImportCard.id && exactCard) importIdMap.set(normalizedImportCard.id, exactCard.id)
				skippedCount += 1
				continue
			}

			const sameImageCard = workingCards.find(
				(card) => normalizeCardImage(card.imageDataUrl) === normalizeCardImage(normalizedImportCard.imageDataUrl)
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
				([language, text]) => sameImageCard.texts[language] !== undefined && sameImageCard.texts[language] !== text
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

			const missingEntries = importedEntries.filter(([language]) => sameImageCard.texts[language] === undefined)
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

	async function applyImportedVersoLinks(nextCards: StoredCard[], importPlan: ImportPlan): Promise<StoredCard[]> {
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
		return {
			id: card.id,
			imageDataUrl: normalizeCardImage(card.imageDataUrl) || undefined,
			texts: normalizeTextRecord(card.texts),
			versoCardId: normalizeImportCardId(card.versoCardId)
		}
	}

	function normalizeImportCardInput(card: ImportCardInput): ImportCardInput {
		return {
			id: normalizeImportCardId(card.id),
			imageDataUrl: normalizeCardImage(card.imageDataUrl) || undefined,
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
				{ imageDataUrl, entries, gridSize, reserveQrMargin, showQrText },
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

	async function openLayoutPdf() {
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
					pdf.addImage(pdfCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageSize.width, pageSize.height)
					isFirstPage = false
				}
			}

			const url = URL.createObjectURL(pdf.output('blob'))
			const opened = window.open(url, '_blank', 'noopener,noreferrer')
			if (!opened) {
				URL.revokeObjectURL(url)
				throw new Error('Could not open PDF. Please allow pop-ups for this page.')
			}
			window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
			pressStatus = `PDF opened with ${printLayout.pages.length * 2} pages.`
		} catch (error) {
			pressError = error instanceof Error ? error.message : 'Could not open PDF.'
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
</svelte:head>

<main class="app-shell">
	<header class="app-header library-header">
		<div class="title-block">
			<p class="eyebrow">Toddler Read</p>
			<h1>Toddler Read QR Card Generator</h1>
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
			<button type="button" class="secondary" on:click={chooseImportFile}>
				<Upload size={18} aria-hidden="true" />
				Import
			</button>
			<button type="button" class="secondary" disabled={cards.length === 0} on:click={exportCards}>
				<Download size={18} aria-hidden="true" />
				Export
			</button>
			{#if apkQrDataUrl}
				<a class="apk-qr" href={apkUrl} aria-label="Download Android APK">
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
				</a>
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
				<div class="pane-header">
					<div class="language-filter" aria-label="Visible language columns">
						{#each managerLanguages as language}
							<label class:active={visibleManagerLanguages.includes(language)}>
								<input
									type="checkbox"
									checked={visibleManagerLanguages.includes(language)}
									on:change={() => toggleManagerLanguage(language)}
								/>
								{language}
							</label>
						{/each}
					</div>
					<div class="manager-press-actions">
						<label class="main-language-control">
							<select
								value={mainLanguage}
								aria-label="Main language"
								title={`Main language: ${mainLanguage}`}
								on:change={(event) => updateMainLanguage(event.currentTarget.value)}
							>
								{#each managerLanguages as language}
									<option value={language}>{configuredMarkerForLanguage(language)}</option>
								{/each}
							</select>
						</label>
						<button
							type="button"
							disabled={selectedPrintCardIds.length === 0}
							on:click={() => (workspaceView = 'press')}
						>
							<Printer size={16} aria-hidden="true" />
							Press {selectedRectoCardIds.length}
						</button>
					</div>
				</div>

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
								{#each visibleManagerLanguages as language}
									<th title={language}>
										<div class="language-column-header">
											<span class="column-title">
												<span>{markerLabelForLanguage(language)}</span>
												{#if duplicateColumnKeys.has(duplicateColumnKeyForLanguage(language))}
													<button
														type="button"
														class:active={duplicateFocus === duplicateColumnKeyForLanguage(language)}
														class="duplicate-focus-button"
														aria-label={`Show duplicate ${language} values`}
														title={`Show duplicate ${language} values`}
														on:click={() => toggleDuplicateFocus(duplicateColumnKeyForLanguage(language))}
													>
														<Copy size={13} aria-hidden="true" />
													</button>
												{/if}
											</span>
											<input
												class="language-column-filter"
												value={languageFilters[language] ?? ''}
												placeholder={language}
												aria-label={`Filter ${language}`}
												on:click|stopPropagation
												on:input={(event) => updateLanguageFilter(language, event.currentTarget.value)}
											/>
										</div>
									</th>
								{/each}
								<th>Verso</th>
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
									{#each visibleManagerLanguages as language}
										<td>{card.texts[language] || ''}</td>
									{/each}
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
														{cardLabel(candidate)}{candidate.versoCardId
															? ` - linked to ${cardLabel(cards.find((entry) => entry.id === candidate.versoCardId))}`
															: ''}
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
						<label class="main-language-control">
							<select
								value={mainLanguage}
								aria-label="Main language"
								title={`Main language: ${mainLanguage}`}
								on:change={(event) => updateMainLanguage(event.currentTarget.value)}
							>
								{#each managerLanguages as language}
									<option value={language}>{configuredMarkerForLanguage(language)}</option>
								{/each}
							</select>
						</label>
						<button type="button" class="secondary" on:click={() => (workspaceView = 'manager')}>
							<List size={18} aria-hidden="true" />
							Manage
						</button>
						<button
							type="button"
							disabled={printLayout.pages.length === 0}
							on:click={openLayoutPdf}
						>
							<FileText size={18} aria-hidden="true" />
							Open PDF
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
										<canvas bind:this={rectoPreviewCanvases[index]} aria-label={`Recto page ${index + 1}`}></canvas>
									</div>
									<div class="press-preview">
										<span>Verso</span>
										<canvas bind:this={versoPreviewCanvases[index]} aria-label={`Verso page ${index + 1}`}></canvas>
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
						{#each entries as entry, index (entry.id)}
							<article class="language-row">
								<div class="language-tools">
									<div
										class="readonly-marker"
										aria-label={entry.lang ? `${entry.lang} flag` : 'No language flag'}
									>
										{entry.marker || markerForLanguage(entry.lang).marker}
									</div>
									<fieldset
										class="translation-option-control"
										aria-label={`Translation options for ${entry.lang || `language ${index + 1}`}`}
									>
										<label class:active={translationOptions[index]?.use} title="Use as source">
											<input
												type="checkbox"
												checked={translationOptions[index]?.use}
												on:change={(event) =>
													updateTranslationOption(index, 'use', event.currentTarget.checked)}
											/>
											<BookOpenText size={15} aria-hidden="true" />
											<span class="visually-hidden">Use as source</span>
										</label>
										<label
											class:active={translationOptions[index]?.produce}
											title="Produce translation"
										>
											<input
												type="checkbox"
												checked={translationOptions[index]?.produce}
												on:change={(event) =>
													updateTranslationOption(index, 'produce', event.currentTarget.checked)}
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
										disabled={!entry.lang.trim()}
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
							<button type="button" class="secondary" on:click={chooseImage}>Choose image</button>
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
	{/if}
</main>
