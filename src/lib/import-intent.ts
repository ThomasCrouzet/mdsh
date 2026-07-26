/**
 * Decides whether handleImport should open the hidden `<input type="file">`
 * after (or instead of) a native/FSA disk open attempt.
 *
 * Pure: no DOM, no Tauri - unit-tested for browser vs desktop fallthrough.
 */
export function shouldFallThroughToFileInput(opts: {
	/** FSA and/or desktop path backend available. */
	diskLinkingAvailable: boolean;
	/** Running inside the Tauri shell. */
	isDesktop: boolean;
	/** Files successfully opened via openFromDisk (0 on cancel). */
	createdCount: number;
	/** openFromDisk threw (permission/security) - never fall through. */
	openThrew: boolean;
}): boolean {
	if (opts.openThrew) return false;
	if (!opts.diskLinkingAvailable) return true;
	if (opts.createdCount > 0) return false;
	// Desktop: native dialog is the only open path. Do not fall through to the
	// hidden file input even when the system WebView also exposes FSA pickers
	// (Windows Chromium WebView): that path uses importFiles without path links.
	if (opts.isDesktop) return false;
	// Browser: FSA cancel / empty selection → fall through to <input type="file">.
	return true;
}
