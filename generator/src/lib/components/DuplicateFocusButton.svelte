<script lang="ts">
	import { Copy } from 'lucide-svelte'
	import IconButton from './IconButton.svelte'

	export let active = false
	export let ariaLabel: string
	export let title = ariaLabel
	export let onclick: ((event: MouseEvent) => void) | undefined = undefined
</script>

<IconButton
	{active}
	ariaLabel={ariaLabel}
	{title}
	className="duplicate-focus-button"
	size={13}
	{onclick}
>
	<Copy size={13} aria-hidden="true" />
</IconButton>
