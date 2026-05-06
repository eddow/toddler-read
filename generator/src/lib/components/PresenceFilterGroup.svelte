<script lang="ts" context="module">
	export type PresenceFilter = 'all' | 'missing' | 'present'
</script>

<script lang="ts">
	import { CircleCheckBig, CircleSlash, ListFilter } from 'lucide-svelte'

	type PresenceFilterOption = {
		value: PresenceFilter
		label: string
		title: string
		icon: typeof ListFilter
	}

	export let value: PresenceFilter = 'all'
	export let disabled = false
	export let ariaLabel = 'Filter by presence'
	export let name = `presence-filter-${Math.random().toString(36).slice(2)}`
	export let onValueChange: (value: PresenceFilter) => void = () => {}

	const options: PresenceFilterOption[] = [
		{ value: 'all', label: 'All', title: 'Show all', icon: ListFilter },
		{ value: 'missing', label: 'Missing', title: 'Show missing', icon: CircleSlash },
		{ value: 'present', label: 'Present', title: 'Show present', icon: CircleCheckBig }
	]
</script>

<div class="presence-filter-group" role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled}>
	{#each options as option}
		<label class="presence-option" class:checked={value === option.value} data-value={option.value}>
			<input
				type="radio"
				{name}
				bind:group={value}
				value={option.value}
				disabled={disabled}
				aria-label={option.label}
				on:change={() => onValueChange(option.value)}
			/>
			<span class="presence-option-face" title={option.title}>
				<svelte:component this={option.icon} size={15} aria-hidden="true" />
			</span>
		</label>
	{/each}
</div>

<style>
	.presence-filter-group {
		display: inline-grid;
		grid-template-columns: repeat(3, 30px);
		width: max-content;
		padding: 3px;
		background: var(--field-bg);
		border: 1px solid var(--line);
		border-radius: 7px;
	}

	.presence-option {
		position: relative;
		display: grid;
		width: 30px;
		height: 24px;
		margin: 0;
		color: var(--muted);
		cursor: pointer;
	}

	.presence-option[data-value='all'] {
		--presence-active: var(--accent);
		--presence-ink: var(--accent-on);
	}

	.presence-option[data-value='missing'] {
		--presence-active: #b42318;
		--presence-ink: #ffffff;
	}

	.presence-option[data-value='present'] {
		--presence-active: #17815f;
		--presence-ink: #ffffff;
	}

	input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
	}

	.presence-option-face {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		border-radius: 5px;
	}

	.checked .presence-option-face {
		color: var(--presence-ink);
		background: var(--presence-active);
	}

	.presence-option:has(input:focus-visible) .presence-option-face {
		outline: 2px solid var(--accent-strong);
		outline-offset: 2px;
	}

	.presence-filter-group[aria-disabled='true'] {
		opacity: 0.55;
	}

	.presence-filter-group[aria-disabled='true'] .presence-option {
		cursor: not-allowed;
	}
</style>
