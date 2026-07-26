import { describe, it, expect } from 'vitest';
import { shouldFallThroughToFileInput } from './import-intent';

describe('shouldFallThroughToFileInput', () => {
	it('browser without disk linking: always fall through to file input', () => {
		expect(
			shouldFallThroughToFileInput({
				diskLinkingAvailable: false,
				isDesktop: false,
				createdCount: 0,
				openThrew: false
			})
		).toBe(true);
	});

	it('browser FSA: fall through on cancel (createdCount 0)', () => {
		expect(
			shouldFallThroughToFileInput({
				diskLinkingAvailable: true,
				isDesktop: false,
				createdCount: 0,
				openThrew: false
			})
		).toBe(true);
	});

	it('browser FSA: no fall through when files were opened', () => {
		expect(
			shouldFallThroughToFileInput({
				diskLinkingAvailable: true,
				isDesktop: false,
				createdCount: 2,
				openThrew: false
			})
		).toBe(false);
	});

	it('desktop WebView2 (FSA present): never fall through after open attempt', () => {
		// Regression: showOpenFilePicker exists on Windows Tauri, but canceling
		// the native open must not open the hidden file input (no path links).
		expect(
			shouldFallThroughToFileInput({
				diskLinkingAvailable: true,
				isDesktop: true,
				createdCount: 0,
				openThrew: false
			})
		).toBe(false);
	});

	it('desktop: no fall through when files were opened', () => {
		expect(
			shouldFallThroughToFileInput({
				diskLinkingAvailable: true,
				isDesktop: true,
				createdCount: 1,
				openThrew: false
			})
		).toBe(false);
	});

	it('open threw: never fall through', () => {
		expect(
			shouldFallThroughToFileInput({
				diskLinkingAvailable: true,
				isDesktop: false,
				createdCount: 0,
				openThrew: true
			})
		).toBe(false);
		expect(
			shouldFallThroughToFileInput({
				diskLinkingAvailable: true,
				isDesktop: true,
				createdCount: 0,
				openThrew: true
			})
		).toBe(false);
	});
});
