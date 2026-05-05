<script lang="ts">
	import { Copy } from 'lucide-svelte'
	import IconButton from './IconButton.svelte'

	export let active = false
	export let ariaLabel: string
	export let title = ariaLabel
</script>

<IconButton
	{active}
	ariaLabel={ariaLabel}
	{title}
	className="duplicate-focus-button"
	size={13}
	on:click
>
	<Copy size={13} aria-hidden="true" />
</IconButton>
