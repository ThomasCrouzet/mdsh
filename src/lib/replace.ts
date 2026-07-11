// §2.6 - Cross-file replacement (pure, testable logic).
//
// Builds the matcher with the same options as search (case, whole word, regex)
// and applies a replacement over a corpus. No runes, no store access: the store
// wraps `replaceInFiles` to persist.
//
// Replacement semantics:
//   - regex mode: the `replacement` allows backrefs (`$1`, `$&`);
//   - literal / whole-word mode: `$` is escaped → literal replacement.

export interface ReplaceOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
	useRegex: boolean;
}

export interface FileSlice {
	id: string;
	name: string;
	content: string;
}

export interface FileReplaceResult {
	id: string;
	name: string;
	count: number;
	content: string;
}

export interface ReplaceOutcome {
	results: FileReplaceResult[];
	/** Total occurrences replaced across the whole corpus. */
	total: number;
	/** Error message if the user regex is invalid. */
	regexError: string | null;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds the global search/replace regex (or an error). */
export function buildReplaceRegex(
	query: string,
	opts: ReplaceOptions
): { re: RegExp | null; error: string | null } {
	const flags = 'g' + (opts.caseSensitive ? '' : 'i');
	try {
		if (opts.useRegex) return { re: new RegExp(query, flags), error: null };
		const esc = escapeRegex(query);
		const pattern = opts.wholeWord ? `\\b${esc}\\b` : esc;
		return { re: new RegExp(pattern, flags), error: null };
	} catch (e) {
		return { re: null, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Applies the replacement over the whole corpus. Returns ONLY the files
 * actually modified (count > 0). The caller persists the `content`.
 * No-op (empty result) if `query` is shorter than 2 characters - a guard
 * consistent with search, avoids an accidental mass replacement.
 */
export function replaceInFiles(
	files: readonly FileSlice[],
	query: string,
	replacement: string,
	opts: ReplaceOptions
): ReplaceOutcome {
	if (query.trim().length < 2) return { results: [], total: 0, regexError: null };
	const { re, error } = buildReplaceRegex(query, opts);
	if (!re) return { results: [], total: 0, regexError: error };

	// In literal mode, escape `$` for a truly literal replacement (otherwise
	// `$&`, `$1`… would be interpreted by String.replace).
	const safeReplacement = opts.useRegex ? replacement : replacement.replace(/\$/g, '$$$$');

	const results: FileReplaceResult[] = [];
	let total = 0;
	for (const f of files) {
		const matches = f.content.match(re);
		const count = matches ? matches.length : 0;
		if (count === 0) continue;
		const content = f.content.replace(re, safeReplacement);
		// If the replacement changes nothing (e.g. replacing "a" with "a"), no
		// need to mark the file as modified.
		if (content === f.content) continue;
		total += count;
		results.push({ id: f.id, name: f.name, count, content });
	}
	return { results, total, regexError: null };
}
