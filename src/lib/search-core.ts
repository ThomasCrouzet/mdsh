// Pure cross-file search matcher (case / whole-word / regex).
// Used by `workers/search.worker.ts` and unit-tested without a Worker host.

import type { Hit } from './types';

export interface SearchFile {
	id: string;
	name: string;
	content: string;
}

export interface SearchMatchOptions {
	query: string;
	caseSensitive: boolean;
	wholeWord: boolean;
	useRegex: boolean;
}

export interface SearchMatchResult {
	hits: Hit[];
	regexError: string | null;
}

export const SEARCH_MAX_HITS = 200;

/**
 * Hard cap on user-supplied regex length (search + replace). Longer patterns
 * are almost never useful in an editor and increase ReDoS risk.
 */
export const MAX_USER_REGEX_LENGTH = 200;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rejects user regexes that are known to be catastrophic on long haystacks
 * (nested quantifiers). Valid syntax alone is not enough - `(a+)+$` compiles.
 * Returns an English error string for i18n/UI, or null when the pattern is
 * accepted for compilation.
 */
export function userRegexSafetyError(query: string): string | null {
	if (query.length > MAX_USER_REGEX_LENGTH) {
		return `regex too long (max ${MAX_USER_REGEX_LENGTH} characters)`;
	}
	// Nested quantifiers: (…+…)+  (…*…)* ; alternation bombs (a|aa)+ ;
	// or three+ consecutive quantifiers.
	if (
		/\([^)]*[+*][^)]*\)[+*?]/.test(query) ||
		/\([^)]*\|[^)]*\)[+*]/.test(query) ||
		/([+*]\??){3,}/.test(query)
	) {
		return 'regex rejected: nested quantifiers are not allowed';
	}
	return null;
}

/**
 * Scans `corpus` for `opts.query` (min length 2). Returns up to
 * `SEARCH_MAX_HITS` hits with line snippets.
 */
export function matchInCorpus(
	corpus: readonly SearchFile[],
	opts: SearchMatchOptions,
	maxHits = SEARCH_MAX_HITS
): SearchMatchResult {
	const q = opts.query.trim();
	if (q.length < 2) return { hits: [], regexError: null };

	let matcher: (line: string) => { idx: number; len: number } | null;
	if (opts.useRegex) {
		const safety = userRegexSafetyError(q);
		if (safety) return { hits: [], regexError: safety };
		let re: RegExp;
		try {
			re = new RegExp(q, opts.caseSensitive ? '' : 'i');
		} catch (err) {
			return {
				hits: [],
				regexError: err instanceof Error ? err.message : String(err)
			};
		}
		matcher = (line) => {
			const m = re.exec(line);
			return m ? { idx: m.index, len: m[0].length || 1 } : null;
		};
	} else if (opts.wholeWord) {
		const re = new RegExp(`\\b${escapeRegex(q)}\\b`, opts.caseSensitive ? '' : 'i');
		matcher = (line) => {
			const m = re.exec(line);
			return m ? { idx: m.index, len: m[0].length } : null;
		};
	} else {
		const needle = opts.caseSensitive ? q : q.toLowerCase();
		matcher = (line) => {
			const target = opts.caseSensitive ? line : line.toLowerCase();
			const idx = target.indexOf(needle);
			return idx === -1 ? null : { idx, len: q.length };
		};
	}

	const out: Hit[] = [];
	for (const file of corpus) {
		const lines = file.content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const m = matcher(lines[i]!);
			if (m) {
				const line = lines[i]!;
				const start = Math.max(0, m.idx - 30);
				const end = Math.min(line.length, m.idx + m.len + 40);
				out.push({
					fileId: file.id,
					name: file.name,
					line: i + 1,
					snippet: (start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : ''),
					matchStart: (start > 0 ? 1 : 0) + (m.idx - start),
					matchEnd: (start > 0 ? 1 : 0) + (m.idx - start) + m.len
				});
				if (out.length >= maxHits) return { hits: out, regexError: null };
			}
		}
	}
	return { hits: out, regexError: null };
}

/**
 * Corpus fingerprint used by SearchPanel to skip re-posting unchanged files
 * to the worker (id + updatedAt per file).
 */
export function corpusFingerprint(files: readonly { id: string; updatedAt: number }[]): string {
	return files.map((f) => `${f.id}:${f.updatedAt}`).join('|');
}
