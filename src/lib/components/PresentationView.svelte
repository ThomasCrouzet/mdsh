<script lang="ts">
	import SlideEditor from '$lib/presentation/SlideEditor.svelte';
	import { filesStore } from '$lib/files.svelte';
	let {
		open,
		onClose,
		initialPresenting = false
	}: { open: boolean; onClose: () => void; initialPresenting?: boolean } = $props();
</script>

{#if open && filesStore.active}
	{#key filesStore.active.id}<SlideEditor {onClose} {initialPresenting} />{/key}
{/if}
