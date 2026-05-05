<script lang="ts">
	import { Download, ExternalLink } from 'lucide-svelte'
	import PanelModal from './PanelModal.svelte'

	export let title: string
	export let titleId: string
	export let eyebrow: string
	export let closeLabel: string
	export let qrDataUrl = ''
	export let qrAlt: string
	export let href: string
	export let linkLabel: string
	export let linkTarget = ''
	export let note = ''
	export let action: 'download' | 'external' = 'external'
</script>

<PanelModal
	{title}
	{titleId}
	{eyebrow}
	{closeLabel}
	modalClass="apk-modal"
	backdropClass="qr-backdrop"
	scrimClass="qr-scrim"
	on:close
>
	{#if qrDataUrl}
		<img class="apk-modal-qr" src={qrDataUrl} alt={qrAlt} />
	{/if}
	<a
		class="apk-modal-link"
		href={href}
		target={linkTarget || undefined}
		rel={linkTarget ? 'noreferrer' : undefined}
	>
		{#if action === 'download'}
			<Download size={18} aria-hidden="true" />
		{:else}
			<ExternalLink size={18} aria-hidden="true" />
		{/if}
		{linkLabel}
	</a>
	{#if note}
		<p class="install-note">{note}</p>
	{/if}
</PanelModal>
