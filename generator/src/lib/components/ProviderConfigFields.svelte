<script lang="ts">
	import { onMount } from 'svelte'
	import { T } from '../i18n/i18n.svelte'

	type ImageProvider = {
		id: string
		label: string
	}

	type TranslationProvider = {
		value: string
		label: string
	}

	type ApiKeyConfig = {
		apiKey: string
		model?: string
	}

	type TranslationConfig = {
		apiKey: string
		model: string
		baseUrl?: string
	}

	type ImageConfigChange = { provider: string; field: 'apiKey' | 'model'; value: string }
	type TranslationConfigChange = { field: keyof TranslationConfig; value: string }
	type PollinationsImageModel = {
		name: string
		description?: string
		output_modalities?: string[]
		paid_only?: boolean
		pricing?: Record<string, string | number>
	}
	type LeonardoPlatformModel = {
		id: string
		name?: string
		description?: string
	}

	const DEFAULT_POLLINATIONS_MODEL = 'flux'
	const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2'
	const LEONARDO_DEFAULT_MODEL = ''

	export let imageProviders: readonly ImageProvider[] = []
	export let imageProviderConfigs: Record<string, ApiKeyConfig> = {}
	export let translationProviders: readonly TranslationProvider[] = []
	export let translationProvider = ''
	export let translationProviderLabel = ''
	export let translationConfig: TranslationConfig = { apiKey: '', model: '', baseUrl: '' }
	export let showBaseUrl = false
	export let imageGenerationPromptTemplate = ''
	export let translationPromptTemplate = ''
	export let onImageConfigChange: (change: ImageConfigChange) => void = () => {}
	export let onImageGenerationPromptTemplateChange: (value: string) => void = () => {}
	export let onTranslationProviderChange: (value: string) => void = () => {}
	export let onTranslationConfigChange: (change: TranslationConfigChange) => void = () => {}
	export let onTranslationPromptTemplateChange: (value: string) => void = () => {}

	let loadedLeonardoApiKey = ''
	let leonardoPlatformModels: LeonardoPlatformModel[] = []
	let pollinationsImageModels: PollinationsImageModel[] = []

	$: imageSearchProviders = imageProviders.filter((provider) =>
		provider.id === 'pexels' ||
		provider.id === 'flaticon' ||
		provider.id === 'pixabay' ||
		provider.id === 'unsplash'
	)
	$: imageGenerationProviders = imageProviders.filter((provider) =>
		provider.id === 'leonardo' || provider.id === 'pollinations' || provider.id === 'openai'
	)
	$: leonardoModelOptions = buildLeonardoModelOptions(
		leonardoPlatformModels,
		imageProviderConfigs.leonardo?.model
	)
	$: pollinationsModelOptions = buildPollinationsModelOptions(
		pollinationsImageModels,
		imageProviderConfigs.pollinations?.model
	)
	$: {
		const leonardoApiKey = imageProviderConfigs.leonardo?.apiKey?.trim() ?? ''
		if (leonardoApiKey && leonardoApiKey !== loadedLeonardoApiKey) {
			loadedLeonardoApiKey = leonardoApiKey
			void loadLeonardoPlatformModels(leonardoApiKey)
		} else if (!leonardoApiKey && loadedLeonardoApiKey) {
			loadedLeonardoApiKey = ''
			leonardoPlatformModels = []
		}
	}

	onMount(() => {
		void loadPollinationsImageModels()
	})

	async function loadLeonardoPlatformModels(apiKey: string) {
		try {
			const response = await fetch('https://cloud.leonardo.ai/api/rest/v1/platformModels', {
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${apiKey}`
				}
			})
			if (!response.ok) return

			const payload = await response.json()
			const models: unknown[] = Array.isArray(payload)
				? payload
				: Array.isArray(payload?.custom_models)
					? payload.custom_models
					: Array.isArray(payload?.models)
						? payload.models
						: []
			leonardoPlatformModels = models
				.map(normalizeLeonardoPlatformModel)
				.filter((model): model is LeonardoPlatformModel => Boolean(model))
				.sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id))
		} catch {
			leonardoPlatformModels = []
		}
	}

	async function loadPollinationsImageModels() {
		try {
			const response = await fetch('https://gen.pollinations.ai/image/models')
			if (!response.ok) return

			const models = (await response.json()) as PollinationsImageModel[]
			pollinationsImageModels = models
				.filter((model) => model.output_modalities?.includes('image'))
				.sort((left, right) => left.name.localeCompare(right.name))
		} catch {
			pollinationsImageModels = []
		}
	}

	function normalizeLeonardoPlatformModel(model: unknown): LeonardoPlatformModel | undefined {
		if (!model || typeof model !== 'object') return undefined
		const candidate = model as Record<string, unknown>
		const id = typeof candidate.id === 'string' ? candidate.id : ''
		if (!id) return undefined
		return {
			id,
			name: typeof candidate.name === 'string' ? candidate.name : undefined,
			description: typeof candidate.description === 'string' ? candidate.description : undefined
		}
	}

	function buildLeonardoModelOptions(
		models: LeonardoPlatformModel[],
		selectedModel: string | undefined
	): LeonardoPlatformModel[] {
		const selected = selectedModel?.trim() ?? LEONARDO_DEFAULT_MODEL
		const options = [{ id: LEONARDO_DEFAULT_MODEL, name: 'Default model' }, ...models]
		if (!selected || options.some((model) => model.id === selected)) return options
		return [{ id: selected, name: selected }, ...options]
	}

	function buildPollinationsModelOptions(
		models: PollinationsImageModel[],
		selectedModel: string | undefined
	): PollinationsImageModel[] {
		const selected = selectedModel?.trim() || DEFAULT_POLLINATIONS_MODEL
		if (models.some((model) => model.name === selected)) return models
		return [{ name: selected }, ...models]
	}

	function pollinationsModelLabel(model: PollinationsImageModel): string {
		const parts = [model.name]
		const price = pollinationsModelPrice(model)
		if (price) parts.push(price)
		if (model.paid_only) parts.push('paid')
		if (model.description) parts.push(model.description)
		return parts.join(' - ')
	}

	function pollinationsModelPrice(model: PollinationsImageModel): string {
		const pricing = model.pricing ?? {}
		const currency = String(pricing.currency ?? 'pollen')
		const imagePrice = pricing.completionImageTokens
		if (imagePrice === undefined) return ''
		return `${imagePrice} ${currency}/image`
	}

	function leonardoModelLabel(model: LeonardoPlatformModel): string {
		if (!model.id) return model.name ?? 'Default model'
		const parts = [model.name ?? model.id]
		if (model.name && model.id) parts.push(model.id)
		if (model.description) parts.push(model.description)
		return parts.join(' - ')
	}
</script>

<div class="settings-section">
	<p class="eyebrow">{T.labels.imageSearchSources}</p>
	{#each imageSearchProviders as provider}
		<label class="api-key-field">
			{provider.label} {T.labels.apiKey}
			<input
				type="password"
				value={imageProviderConfigs[provider.id]?.apiKey ?? ''}
				placeholder={T.placeholders.storedLocally}
				spellcheck="false"
				autocomplete="off"
				on:input={(event) =>
					onImageConfigChange({
						provider: provider.id,
						field: 'apiKey',
						value: event.currentTarget.value
					})}
			/>
		</label>
	{/each}
</div>

<div class="settings-section">
	<p class="eyebrow">{T.labels.imageGenerationSources}</p>
	{#each imageGenerationProviders as provider}
		<label class="api-key-field">
			{provider.label} {T.labels.apiKey}
			<input
				type="password"
				value={imageProviderConfigs[provider.id]?.apiKey ?? ''}
				placeholder={T.placeholders.storedLocally}
				spellcheck="false"
				autocomplete="off"
				on:input={(event) =>
					onImageConfigChange({
						provider: provider.id,
						field: 'apiKey',
						value: event.currentTarget.value
					})}
			/>
		</label>
		{#if provider.id === 'leonardo'}
			<label class="api-key-field">
				{provider.label} {T.labels.model}
				<select
					value={imageProviderConfigs[provider.id]?.model ?? ''}
					on:change={(event) =>
						onImageConfigChange({
							provider: provider.id,
							field: 'model',
							value: event.currentTarget.value
						})}
				>
					{#each leonardoModelOptions as model}
						<option value={model.id}>{leonardoModelLabel(model)}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if provider.id === 'pollinations'}
			<label class="api-key-field">
				{provider.label} {T.labels.model}
				<select
					value={imageProviderConfigs[provider.id]?.model ?? ''}
					on:change={(event) =>
						onImageConfigChange({
							provider: provider.id,
							field: 'model',
							value: event.currentTarget.value
						})}
				>
					{#each pollinationsModelOptions as model}
						<option value={model.name}>{pollinationsModelLabel(model)}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if provider.id === 'openai'}
			<label class="api-key-field">
				{provider.label} {T.labels.model}
				<input
					value={imageProviderConfigs[provider.id]?.model ?? DEFAULT_OPENAI_IMAGE_MODEL}
					placeholder={DEFAULT_OPENAI_IMAGE_MODEL}
					spellcheck="false"
					autocomplete="off"
					on:input={(event) =>
						onImageConfigChange({
							provider: provider.id,
							field: 'model',
							value: event.currentTarget.value
						})}
				/>
			</label>
		{/if}
	{/each}
</div>

<div class="settings-section">
	<p class="eyebrow">{T.labels.imageGeneration}</p>
	<label class="api-key-field">
		{T.labels.imageGenerationPromptTemplate}
		<textarea
			value={imageGenerationPromptTemplate}
			rows="7"
			spellcheck="false"
			on:input={(event) => onImageGenerationPromptTemplateChange(event.currentTarget.value)}
		></textarea>
	</label>
</div>

<div class="settings-section">
	<p class="eyebrow">{T.labels.translation}</p>
	<label class="api-key-field">
		{T.labels.translationProvider}
		<select
			value={translationProvider}
			on:change={(event) => onTranslationProviderChange(event.currentTarget.value)}
		>
			{#each translationProviders as provider}
				<option value={provider.value}>{provider.label}</option>
			{/each}
		</select>
	</label>
	<label class="api-key-field">
		{translationProviderLabel} {T.labels.apiKey}
		<input
			type="password"
			value={translationConfig.apiKey}
			placeholder={T.placeholders.storedLocally}
			spellcheck="false"
			autocomplete="off"
			on:input={(event) =>
				onTranslationConfigChange({ field: 'apiKey', value: event.currentTarget.value })}
		/>
	</label>
	<label class="api-key-field">
		{translationProviderLabel} {T.labels.model}
		<input
			value={translationConfig.model}
			placeholder={translationConfig.model}
			spellcheck="false"
			autocomplete="off"
			on:input={(event) =>
				onTranslationConfigChange({ field: 'model', value: event.currentTarget.value })}
		/>
	</label>
	{#if showBaseUrl}
		<label class="api-key-field">
			{T.labels.baseUrl}
			<input
				value={translationConfig.baseUrl ?? ''}
				placeholder={T.placeholders.baseUrl}
				spellcheck="false"
				autocomplete="off"
				on:input={(event) =>
					onTranslationConfigChange({ field: 'baseUrl', value: event.currentTarget.value })}
			/>
		</label>
	{/if}
	<label class="api-key-field">
		{T.labels.translationPromptTemplate}
		<textarea
			value={translationPromptTemplate}
			rows="9"
			spellcheck="false"
			on:input={(event) => onTranslationPromptTemplateChange(event.currentTarget.value)}
		></textarea>
	</label>
</div>
