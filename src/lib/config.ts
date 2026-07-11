// Centralized constants - values shared between store, components and renderers.
// Grouped here to ease tuning (and future configurability).

export const EDITOR = {
	defaultWidth: 820,
	minWidth: 480,
	margin: 96,
	widthPresets: {
		prose: 720,
		narrow: 640,
		medium: 820,
		wide: 1100
	}
} as const;

export const TIMERS = {
	saveDebounceMs: 400,
	trashUndoMs: 5000,
	printIframeLoadMs: 3000,
	printIframeCleanupMs: 60_000
} as const;

export const READING = {
	wpm: 220
} as const;
