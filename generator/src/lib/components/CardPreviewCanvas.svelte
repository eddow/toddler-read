<script lang="ts">
	import { createEventDispatcher } from 'svelte'

	export let canvas: HTMLCanvasElement | undefined
	export let canPan = false
	export let dragging = false

	const dispatch = createEventDispatcher<{
		dragenter: DragEvent
		dragover: DragEvent
		dragleave: DragEvent
		drop: DragEvent
		pointerdown: PointerEvent
		pointermove: PointerEvent
		pointerup: PointerEvent
		pointercancel: PointerEvent
	}>()

	function preventAndDispatch(type: 'dragenter' | 'dragover', event: DragEvent) {
		event.preventDefault()
		dispatch(type, event)
	}
</script>

<div
	class:dragging
	class="card-preview"
	role="group"
	aria-label="Card image manager"
	on:dragenter={(event) => preventAndDispatch('dragenter', event)}
	on:dragover={(event) => preventAndDispatch('dragover', event)}
	on:dragleave={(event) => dispatch('dragleave', event)}
	on:drop={(event) => dispatch('drop', event)}
>
	<canvas
		bind:this={canvas}
		class:can-pan={canPan}
		aria-label="Generated card preview"
		on:pointerdown={(event) => dispatch('pointerdown', event)}
		on:pointermove={(event) => dispatch('pointermove', event)}
		on:pointerup={(event) => dispatch('pointerup', event)}
		on:pointercancel={(event) => dispatch('pointercancel', event)}
	></canvas>
</div>
