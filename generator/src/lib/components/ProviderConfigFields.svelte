<script lang="ts">
	import { createEventDispatcher } from 'svelte'
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
	}

	type TranslationConfig = {
		apiKey: string
		model: string
		baseUrl?: string
	}

	export let imageProviders: readonly ImageProvider[] = []
	export let imageProviderConfigs: Record<string, ApiKeyConfig> = {}
	export let translationProviders: readonly TranslationProvider[] = []
	export let translationProvider = ''
	export let translationProviderLabel = ''
	export let translationConfig: TranslationConfig = { apiKey: '', model: '', baseUrl: '' }
	export let showBaseUrl = false
	export let promptTemplate = ''

	const dispatch = createEventDispatcher<{
		imageConfigChange: { provider: string; field: 'apiKey'; value: string }
		translationProviderChange: string
		translationConfigChange: { field: keyof TranslationConfig; value: string }
		promptTemplateChange: string
	}>()
</script>

<div class="settings-section">
	<p class="eyebrow">{T.labels.imageSources}</p>
	{#each imageProviders as provider}
		<label class="api-key-field">
			{provider.label} {T.labels.apiKey}
			<input
				type="password"
				value={imageProviderConfigs[provider.id]?.apiKey ?? ''}
				placeholder={T.placeholders.storedLocally}
				spellcheck="false"
				autocomplete="off"
				on:input={(event) =>
					dispatch('imageConfigChange', {
						provider: provider.id,
						field: 'apiKey',
						value: event.currentTarget.value
					})}
			/>
		</label>
	{/each}
</div>

<div class="settings-section">
	<p class="eyebrow">{T.labels.translation}</p>
	<label class="api-key-field">
		{T.labels.translationProvider}
		<select
			value={translationProvider}
			on:change={(event) => dispatch('translationProviderChange', event.currentTarget.value)}
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
				dispatch('translationConfigChange', { field: 'apiKey', value: event.currentTarget.value })}
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
				dispatch('translationConfigChange', { field: 'model', value: event.currentTarget.value })}
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
					dispatch('translationConfigChange', { field: 'baseUrl', value: event.currentTarget.value })}
			/>
		</label>
	{/if}
	<label class="api-key-field">
		{T.labels.promptTemplate}
		<textarea
			value={promptTemplate}
			rows="9"
			spellcheck="false"
			on:input={(event) => dispatch('promptTemplateChange', event.currentTarget.value)}
		></textarea>
	</label>
</div>
