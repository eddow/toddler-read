<script lang="ts">
	import { Plus, X } from 'lucide-svelte'
	import IconButton from './IconButton.svelte'
	import { T, format } from '../i18n/i18n.svelte'

	export let value = ''
	export let tags: string[] = []
	export let suggestions: string[] = []
	export let listId = 'tag-options'
	export let onAdd: () => void = () => {}
	export let onRemove: (tag: string) => void = () => {}

	function addTag() {
		if (!value.trim()) return
		onAdd()
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return
		event.preventDefault()
		addTag()
	}
</script>

<div class="tag-panel">
	<label class="tag-combobox">
		<span>{T.labels.tags}</span>
		<div class="tag-input-row">
			<input
				bind:value
				list={listId}
				placeholder={T.placeholders.addTag}
				aria-label={T.placeholders.addTag}
				on:keydown={handleKeydown}
			/>
			<datalist id={listId}>
				{#each suggestions as tag}
					<option value={tag}></option>
				{/each}
			</datalist>
			<IconButton
				ariaLabel={T.placeholders.addTag}
				title={T.placeholders.addTag}
				disabled={!value.trim()}
				onclick={addTag}
			>
				<Plus size={18} aria-hidden="true" />
			</IconButton>
		</div>
	</label>
	{#if tags.length > 0}
		<div class="tag-chip-list" aria-label={T.aria.selectedTags}>
			{#each tags as tag}
				{@const removeLabel = format(T.templates.removeTag, { tag })}
				<span class="tag-chip">
					<span>{tag}</span>
					<button
						type="button"
						aria-label={removeLabel}
						title={removeLabel}
						on:click={() => onRemove(tag)}
					>
						<X size={14} aria-hidden="true" />
					</button>
				</span>
			{/each}
		</div>
	{/if}
</div>
