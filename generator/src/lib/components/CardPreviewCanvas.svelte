<script lang="ts">
	import { T } from '../i18n/i18n.svelte'

	export let canvas: HTMLCanvasElement | undefined
	export let canPan = false
	export let dragging = false
	export let onDragenter: (event: DragEvent) => void = () => {}
	export let onDragover: (event: DragEvent) => void = () => {}
	export let onDragleave: (event: DragEvent) => void = () => {}
	export let onDrop: (event: DragEvent) => void = () => {}
	export let onPointerdown: (event: PointerEvent) => void = () => {}
	export let onPointermove: (event: PointerEvent) => void = () => {}
	export let onPointerup: (event: PointerEvent) => void = () => {}
	export let onPointercancel: (event: PointerEvent) => void = () => {}

	function preventAndHandle(handler: (event: DragEvent) => void, event: DragEvent) {
		event.preventDefault()
		handler(event)
	}
</script>

<div
	class:dragging
	class="card-preview"
	role="group"
	aria-label={T.aria.cardImageManager}
	on:dragenter={(event) => preventAndHandle(onDragenter, event)}
	on:dragover={(event) => preventAndHandle(onDragover, event)}
	on:dragleave={onDragleave}
	on:drop={onDrop}
>
	<canvas
		bind:this={canvas}
		class:can-pan={canPan}
		aria-label={T.aria.generatedCardPreview}
		on:pointerdown={onPointerdown}
		on:pointermove={onPointermove}
		on:pointerup={onPointerup}
		on:pointercancel={onPointercancel}
	></canvas>
</div>
