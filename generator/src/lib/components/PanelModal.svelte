<script lang="ts">
	import { X } from 'lucide-svelte'
	import { createEventDispatcher } from 'svelte'
	import IconButton from './IconButton.svelte'

	export let title: string
	export let titleId: string
	export let eyebrow = ''
	export let closeLabel = `Close ${title}`
	export let modalClass = 'settings-modal'
	export let backdropClass = ''
	export let scrimClass = ''
	export let showCloseButton = true

	const dispatch = createEventDispatcher<{ close: void }>()
</script>

<div class={`modal-backdrop ${backdropClass}`.trim()}>
	<button
		type="button"
		class={`modal-scrim ${scrimClass}`.trim()}
		aria-label={closeLabel}
		on:click={() => dispatch('close')}
	></button>
	<div class={modalClass} role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1">
		{#if $$slots.header}
			<slot name="header" />
		{:else}
			<div class="settings-header">
				<div>
					{#if eyebrow}
						<p class="eyebrow">{eyebrow}</p>
					{/if}
					<h2 id={titleId}>{title}</h2>
				</div>
				{#if showCloseButton}
					<IconButton ariaLabel={closeLabel} title={closeLabel} on:click={() => dispatch('close')}>
						<X size={18} aria-hidden="true" />
					</IconButton>
				{/if}
			</div>
		{/if}
		<slot />
	</div>
</div>
