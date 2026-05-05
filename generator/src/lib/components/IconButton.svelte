<script lang="ts">
	import { createEventDispatcher } from 'svelte'

	export let ariaLabel: string
	export let title = ariaLabel
	export let variant: 'primary' | 'secondary' | 'danger' = 'secondary'
	export let active = false
	export let disabled = false
	export let size = 18
	export let className = ''
	export let stopPropagation = false

	const dispatch = createEventDispatcher<{ click: MouseEvent }>()

	function handleClick(event: MouseEvent) {
		if (stopPropagation) event.stopPropagation()
		dispatch('click', event)
	}
</script>

<button
	type="button"
	class:secondary={variant === 'secondary'}
	class:danger={variant === 'danger'}
	class:active
	class={`icon-button ${className}`.trim()}
	aria-label={ariaLabel}
	{title}
	{disabled}
	on:click={handleClick}
>
	<span style={`--icon-button-size: ${size}px`}>
		<slot />
	</span>
</button>

<style>
	span {
		display: grid;
		place-items: center;
		width: var(--icon-button-size);
		height: var(--icon-button-size);
	}
</style>
