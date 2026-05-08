<script lang="ts">
	import type { ImageSearchResult } from '../image-search'
	import { T, format } from '../i18n/i18n.svelte'

	export let results: ImageSearchResult[] = []
	export let importingImageResultId = ''
	export let onSelect: (result: ImageSearchResult) => void = () => {}
</script>

{#if results.length > 0}
	<div class="image-search-results">
		{#each results as result}
			<button
				type="button"
				class="image-result-button"
				disabled={Boolean(importingImageResultId)}
				aria-label={format(T.templates.useImage, { alt: result.alt })}
				title={result.alt}
				on:click={() => onSelect(result)}
			>
				<img src={result.thumbUrl} alt="" />
				{#if result.creditText}
					<span>{result.creditText}</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}
