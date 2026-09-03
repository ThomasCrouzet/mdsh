<script lang="ts">
	// §2.2 - Centralized settings panel.
	//
	// Groups in a single discoverable place the previously scattered preferences
	// (theme, editor width, focus/typewriter/TOC modes) + backup
	// management (§1.1). Lazy-loaded modal (cf. ui/modals), focus-trap, dark/light.
	//
	// The preference stores (theme/editorWidth/prefs) are injected as props
	// (runes factories from the parent). Backup directly calls the `backup`
	// service + reloads the stores - pattern identical to the other panels.

	import { tick } from 'svelte';
	import { browser } from '$app/environment';
	import { t, i18n, LOCALES, LOCALE_LABELS } from '$lib/i18n';
	import { focusTrap } from '$lib/a11y/focusTrap';
	import { coreCommands } from '$lib/ui/commands';
	import { keyboardStore, type ShortcutError } from '$lib/ui/keyboard.svelte';
	import { isDesktop } from '$lib/desktop';
	import { EDITOR, IMPORT_LIMITS } from '$lib/config';
	import { readUtf8File } from '$lib/import-limits';
	import { notify } from '$lib/notify.svelte';
	import { promptStore } from '$lib/prompt.svelte';
	import { filesStore } from '$lib/files.svelte';
	import { workspaceStore } from '$lib/workspaces.svelte';
	import { templatesStore } from '$lib/templates.svelte';
	import { downloadBackup, restoreFromText, isEncryptedBackup } from '$lib/services/backup';
	import { reportError } from '$lib/report';
	import { spinnerStore } from '$lib/spinner.svelte';
	import { themeStore } from '$lib/ui/theme.svelte';
	import {
		formatStorageBytes,
		getStorageHealth,
		recordBackupReminderShown,
		recordExternalBackupFailure,
		recordExternalBackupSuccess,
		type StorageHealth
	} from '$lib/storage';
	import type { createEditorWidth } from '$lib/ui/editor-width.svelte';
	import type { createUiPrefs } from '$lib/ui/prefs.svelte';
	import type { ThemePref } from '$lib/theme';
	import { Settings, X, Download, Upload, Check, Lock } from '@lucide/svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		editorWidth: ReturnType<typeof createEditorWidth>;
		prefs: ReturnType<typeof createUiPrefs>;
	}

	let { open, onClose, editorWidth, prefs }: Props = $props();

	let closeButton: HTMLButtonElement | null = $state(null);
	let importInput: HTMLInputElement | null = $state(null);
	let shortcutFeedback = $state('');
	function showShortcutResult(error: ShortcutError | null): void {
		shortcutFeedback = t(
			error === 'invalid'
				? 'settings.shortcutInvalid'
				: error === 'reserved'
					? 'settings.shortcutReserved'
					: error === 'duplicate'
						? 'settings.shortcutDuplicate'
						: error === 'storage'
							? 'settings.shortcutStorage'
							: 'settings.shortcutSaved'
		);
	}
	function captureShortcut(event: KeyboardEvent, id: string): void {
		if (event.key === 'Tab' || event.key === 'Escape' || event.isComposing) return;
		if (['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		if (
			!(event.ctrlKey || event.metaKey) ||
			(event.ctrlKey && event.metaKey) ||
			event.altKey ||
			event.repeat
		) {
			showShortcutResult('invalid');
			return;
		}
		showShortcutResult(
			keyboardStore.set(id, { key: event.key.toLowerCase(), shift: event.shiftKey })
		);
	}
	let storageHealth: StorageHealth | null = $state(null);

	async function refreshStorageHealth(): Promise<void> {
		storageHealth = await getStorageHealth();
		if (storageHealth.backupReminderDue) recordBackupReminderShown();
	}

	function formatBackupDate(value: number): string {
		return new Intl.DateTimeFormat(i18n.locale, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(value);
	}

	$effect(() => {
		if (!open || !browser) return;
		tick().then(() => closeButton?.focus());
		void refreshStorageHealth();
	});

	const themeOptions: { value: ThemePref; label: string }[] = $derived([
		{ value: 'system', label: t('settings.themeSystem') },
		{ value: 'light', label: t('settings.themeLight') },
		{ value: 'dark', label: t('settings.themeDark') }
	]);

	const widthPresets: { key: string; label: string; value: number }[] = $derived([
		{ key: 'prose', label: t('settings.widthProse'), value: EDITOR.widthPresets.prose },
		{ key: 'narrow', label: t('settings.widthNarrow'), value: EDITOR.widthPresets.narrow },
		{ key: 'medium', label: t('settings.widthMedium'), value: EDITOR.widthPresets.medium },
		{ key: 'wide', label: t('settings.widthWide'), value: EDITOR.widthPresets.wide },
		{ key: 'full', label: t('settings.widthFull'), value: 9999 }
	]);

	function isActiveWidth(px: number): boolean {
		return editorWidth.clampEditorWidth(px) === editorWidth.editorMaxWidth;
	}

	async function handleExportBackup(): Promise<void> {
		try {
			// Flush unflushed keystrokes before reading Dexie - backup is
			// IDB-sourced and would otherwise omit the last debounce window.
			await filesStore.flushPendingAwait();
			const ok = await downloadBackup();
			// Desktop dialog cancel returns false - do not claim success.
			if (ok) {
				recordExternalBackupSuccess();
				await refreshStorageHealth();
				notify.success(t('settings.backupExported'));
			}
		} catch (err) {
			recordExternalBackupFailure();
			await refreshStorageHealth();
			reportError('backup export', err, { notifyUser: t('settings.backupExportFailed') });
		}
	}

	// §2.8 - Encrypted export: asks for a passphrase, the file is unreadable
	// without it (AES-GCM). Forgotten passphrase = unrecoverable backup.
	async function handleExportEncrypted(): Promise<void> {
		const passphrase = await promptStore.prompt({
			title: t('settings.encryptBackupTitle'),
			message: t('settings.encryptBackupMessage'),
			placeholder: t('settings.passphrase'),
			inputType: 'password'
		});
		if (passphrase === null) return;
		if (!passphrase) {
			notify.error(t('settings.passphraseEmpty'));
			return;
		}
		const confirmation = await promptStore.prompt({
			title: t('settings.confirmPassphrase'),
			placeholder: t('settings.passphrase'),
			inputType: 'password'
		});
		if (confirmation === null) return;
		if (confirmation !== passphrase) {
			notify.error(t('settings.passphraseMismatch'));
			return;
		}
		try {
			await filesStore.flushPendingAwait();
			const ok = await downloadBackup(passphrase);
			if (ok) {
				recordExternalBackupSuccess();
				await refreshStorageHealth();
				notify.success(t('settings.encryptedBackupExported'));
			}
		} catch (err) {
			recordExternalBackupFailure();
			await refreshStorageHealth();
			reportError('encrypted backup export', err, {
				notifyUser: t('settings.encryptedExportFailed')
			});
		}
	}

	async function handleImportFile(e: Event): Promise<void> {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allows re-importing the same file afterward
		if (!file) return;
		if (file.size > IMPORT_LIMITS.maxBatchBytes) {
			notify.error(t('backup.tooLarge'));
			return;
		}

		// Reading the file can also fail (file became unreadable
		// between selection and reading): we route it to notify instead of
		// letting a silent rejection slip through.
		let text: string;
		try {
			text = await readUtf8File(file, IMPORT_LIMITS.maxBatchBytes);
		} catch (err) {
			reportError('backup read', err, {
				notifyUser: t('settings.backupReadFailed')
			});
			return;
		}

		// §2.8 - Encrypted backup: ask for the passphrase first.
		let passphrase: string | undefined;
		if (isEncryptedBackup(text)) {
			const pass = await promptStore.prompt({
				title: t('settings.encryptedBackupTitle'),
				message: t('settings.encryptedBackupPrompt'),
				placeholder: t('settings.passphrase'),
				inputType: 'password'
			});
			if (pass === null) return;
			passphrase = pass;
		}

		// The file picker precedes the mode choice: we ask afterward.
		// Le remplacement, la fusion et l’annulation sont trois décisions distinctes.
		const restoreChoice = await promptStore.choose({
			title: t('settings.restoreBackupTitle'),
			message: t('settings.restoreBackupMessage'),
			confirmLabel: t('settings.replace'),
			alternateLabel: t('settings.merge'),
			cancelLabel: t('prompt.cancel'),
			danger: true
		});
		if (restoreChoice === null) return;
		const replace = restoreChoice === 'primary';

		const dismiss = spinnerStore.show(t('settings.restoringBackup'));
		try {
			// Flush local keystrokes first so merge restore does not cancelAll
			// and drop unflushed edits on drafts that stay after the merge.
			await filesStore.flushPendingAwait();
			const counts = await restoreFromText(text, replace ? 'replace' : 'merge', passphrase);
			await Promise.all([filesStore.reload(), workspaceStore.reload(), templatesStore.reload()]);
			// Partial restore: warn if corrupted entries were
			// skipped, so as not to imply a complete recovery.
			const skippedSuffix =
				counts.skipped > 0 ? t('settings.restoreSkippedSuffix', { n: counts.skipped }) : '';
			notify.success(
				t('settings.backupRestored', {
					drafts: counts.drafts,
					workspaces: counts.workspaces
				}) + skippedSuffix
			);
		} catch (err) {
			reportError('backup restore', err, {
				notifyUser:
					err instanceof Error && (err.name === 'BackupParseError' || err.name === 'DecryptError')
						? err.message
						: t('settings.restoreFailed')
			});
		} finally {
			dismiss();
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pb-4 backdrop-blur-sm
		       pt-[max(env(safe-area-inset-top),10vh)]"
		style:padding-left="max(env(safe-area-inset-left), 1rem)"
		style:padding-right="max(env(safe-area-inset-right), 1rem)"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') onClose();
		}}
		role="dialog"
		aria-modal="true"
		aria-labelledby="settings-title"
		inert={promptStore.open}
		aria-hidden={promptStore.open ? 'true' : undefined}
		tabindex="-1"
		use:focusTrap
	>
		<div
			class="mdsh-dialog-panel flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border
			       bg-bg-1 shadow-2xl animate-fade-in"
		>
			<header class="flex items-center gap-2 border-b border-border px-4 py-2.5">
				<Settings size={16} class="text-fg-dim" aria-hidden="true" />
				<h2 id="settings-title" class="flex-1 text-sm font-medium text-fg">
					{t('settings.title')}
				</h2>
				<button
					bind:this={closeButton}
					class="rounded p-1 text-fg-dim transition hover:bg-bg-2 hover:text-fg"
					onclick={onClose}
					aria-label={t('settings.close')}
				>
					<X size={14} />
				</button>
			</header>

			<div class="flex-1 overflow-y-auto px-4 py-3">
				<!-- Appearance: theme -->
				<section class="mb-5">
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-dim">
						{t('settings.appearance')}
					</h3>
					<div class="flex items-center justify-between gap-3">
						<span class="text-sm text-fg-muted">{t('settings.theme')}</span>
						<div
							class="flex gap-1 rounded-md border border-border p-0.5"
							role="group"
							aria-label={t('settings.themeChoice')}
						>
							{#each themeOptions as opt (opt.value)}
								<button
									class="rounded px-2.5 py-1 text-xs transition"
									class:bg-bg-3={themeStore.pref === opt.value}
									class:text-fg={themeStore.pref === opt.value}
									class:text-fg-dim={themeStore.pref !== opt.value}
									aria-pressed={themeStore.pref === opt.value}
									onclick={() => themeStore.set(opt.value)}
								>
									{opt.label}
								</button>
							{/each}
						</div>
					</div>
					<div class="mt-3 flex items-center justify-between gap-3">
						<span class="text-sm text-fg-muted">{t('settings.language')}</span>
						<div
							class="flex gap-1 rounded-md border border-border p-0.5"
							role="group"
							aria-label={t('settings.language')}
						>
							{#each LOCALES as loc (loc)}
								<button
									class="rounded px-2.5 py-1 text-xs transition"
									class:bg-bg-3={i18n.locale === loc}
									class:text-fg={i18n.locale === loc}
									class:text-fg-dim={i18n.locale !== loc}
									aria-pressed={i18n.locale === loc}
									onclick={() => i18n.set(loc)}
								>
									{LOCALE_LABELS[loc]}
								</button>
							{/each}
						</div>
					</div>
				</section>

				<!-- Editor: width -->
				<section class="mb-5">
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-dim">
						{t('settings.editor')}
					</h3>
					<div class="flex items-center justify-between gap-3">
						<span class="text-sm text-fg-muted">{t('settings.width')}</span>
						<div
							class="flex flex-wrap justify-end gap-1 rounded-md border border-border p-0.5"
							role="group"
							aria-label={t('settings.editorWidth')}
						>
							{#each widthPresets as preset (preset.key)}
								<button
									class="rounded px-2.5 py-1 text-xs transition"
									class:bg-bg-3={isActiveWidth(preset.value)}
									class:text-fg={isActiveWidth(preset.value)}
									class:text-fg-dim={!isActiveWidth(preset.value)}
									aria-pressed={isActiveWidth(preset.value)}
									onclick={() => editorWidth.setEditorWidth(preset.value)}
								>
									{preset.label}
								</button>
							{/each}
						</div>
					</div>
				</section>

				<details class="mb-5 rounded border border-border p-3 text-sm">
					<summary class="cursor-pointer">{t('settings.shortcuts')}</summary>
					<p class="my-2 text-xs text-fg-muted">
						{t(isDesktop() ? 'settings.shortcutsDesktop' : 'settings.shortcutsWeb')}
					</p>
					<p class="my-2 text-xs text-fg-muted">{t('settings.shortcutInstructions')}</p>
					<p class="my-2 text-xs text-accent" role="status">{shortcutFeedback}</p>
					<button
						class="mb-2 rounded border border-border px-2 py-1 text-xs"
						onclick={() => showShortcutResult(keyboardStore.reset())}
						>{t('settings.shortcutReset')}</button
					>
					<dl class="space-y-2 text-xs">
						{#each coreCommands as command (command.id)}
							<div class="flex flex-wrap items-center justify-between gap-2">
								<dt>{t(command.label)}</dt>
								<dd class="flex items-center gap-1">
									<input
										class="w-28 rounded border border-border bg-bg px-2 py-1"
										readonly
										value={keyboardStore.label(command.id) ?? t('settings.shortcutDisabled')}
										aria-label={t('settings.shortcutFor', { command: t(command.label) })}
										onkeydown={(event) => captureShortcut(event, command.id)}
									/><button
										class="p-1 underline"
										onclick={() => showShortcutResult(keyboardStore.set(command.id, null))}
										aria-label={t('settings.disableShortcutFor', { command: t(command.label) })}
										>{t('settings.shortcutDisable')}</button
									>
								</dd>
							</div>
						{/each}
					</dl>
				</details>

				<!-- Display: toggles -->
				<section class="mb-5">
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-dim">
						{t('settings.display')}
					</h3>
					<div class="flex flex-col gap-1.5">
						{@render toggleRow(t('settings.focusMode'), prefs.focusMode, prefs.toggleFocusMode)}
						{@render toggleRow(
							t('settings.typewriterMode'),
							prefs.typewriterMode,
							prefs.toggleTypewriterMode
						)}
						{@render toggleRow(t('settings.tableOfContents'), prefs.tocVisible, prefs.toggleToc)}
					</div>
				</section>

				<!-- Data: backup / restore -->
				<section>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-dim">
						{t('settings.data')}
					</h3>
					<p class="mb-2 text-xs text-fg-dim">
						{t('settings.dataDescription')}
					</p>
					<div class="mb-3 rounded-md border border-border bg-bg px-3 py-2" aria-live="polite">
						<h4 class="mb-1 text-xs font-medium text-fg">{t('settings.storageHealth')}</h4>
						{#if storageHealth}
							<ul class="space-y-0.5 text-xs text-fg-dim">
								<li>
									{storageHealth.persistence === 'persistent'
										? t('settings.storagePersistent')
										: storageHealth.persistence === 'best-effort'
											? t('settings.storageBestEffort')
											: t('settings.storageUnavailable')}
								</li>
								<li>
									{storageHealth.usage !== null && storageHealth.quota !== null
										? t('settings.storageUsage', {
												usage: formatStorageBytes(storageHealth.usage),
												quota: formatStorageBytes(storageHealth.quota)
											})
										: t('settings.storageUsageUnavailable')}
								</li>
								<li>
									{storageHealth.lastExternalBackupAt
										? t('settings.lastBackup', {
												date: formatBackupDate(storageHealth.lastExternalBackupAt)
											})
										: t('settings.noBackup')}
								</li>
							</ul>
							{#if storageHealth.lastBackupErrorAt}
								<p class="mt-1 text-xs text-danger" role="alert">
									{t('settings.backupHealthError')}
								</p>
							{/if}
							{#if storageHealth.backupReminderDue}
								<p class="mt-1 text-xs text-fg-muted">{t('settings.backupReminder')}</p>
							{/if}
						{:else}
							<p class="text-xs text-fg-dim">{t('settings.storageUnavailable')}</p>
						{/if}
					</div>
					<div class="flex flex-wrap gap-2">
						<button
							class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-bg-2 hover:text-fg"
							onclick={() => void handleExportBackup()}
						>
							<Download size={13} aria-hidden="true" />
							<span>{t('settings.exportBackup')}</span>
						</button>
						<button
							class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-bg-2 hover:text-fg"
							onclick={() => void handleExportEncrypted()}
						>
							<Lock size={13} aria-hidden="true" />
							<span>{t('settings.exportEncrypted')}</span>
						</button>
						<button
							class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-bg-2 hover:text-fg"
							onclick={() => importInput?.click()}
						>
							<Upload size={13} aria-hidden="true" />
							<span>{t('settings.importBackup')}</span>
						</button>
					</div>
				</section>
			</div>
		</div>
	</div>

	<input
		bind:this={importInput}
		type="file"
		accept="application/json,.json"
		class="hidden"
		onchange={handleImportFile}
	/>
{/if}

{#snippet toggleRow(label: string, active: boolean, onToggle: () => void)}
	<button
		class="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-bg-2"
		aria-pressed={active}
		onclick={onToggle}
	>
		<span>{label}</span>
		<span
			class="flex h-5 w-9 items-center rounded-full border px-0.5 transition"
			class:border-accent={active}
			class:bg-accent={active}
			class:border-border={!active}
			aria-hidden="true"
		>
			<span
				class="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bg transition"
				class:translate-x-4={active}
			>
				{#if active}<Check size={9} class="text-accent" />{/if}
			</span>
		</span>
	</button>
{/snippet}
