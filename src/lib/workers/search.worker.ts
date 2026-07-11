// Cross-file search worker - offloads the O(N×L) loop off the main thread so it
// does not block typing on large corpora (~50 files × 50 KB = ~2.5 MB scanned
// per keystroke after debounce). The matcher setup logic (case / wholeWord /
// regex) reproduces exactly what was previously in `SearchPanel.svelte` - see
// §B3.8.
//
// Cancellation: each request carries an increasing `id`. The UI ignores
// responses whose id is no longer the latest known one. The worker may send a
// partial response if it exceeds the hits limit.

import type { Hit } from '$lib/types';

export interface SearchRequest {
	id: number;
	files: { id: string; name: string; content: string }[];
	query: string;
	caseSensitive: boolean;
	wholeWord: boolean;
	useRegex: boolean;
}

export interface SearchResponse {
	id: number;
	hits: Hit[];
	regexError: string | null;
}

const MAX_HITS = 200;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function search(req: SearchRequest): SearchResponse {
	const q = req.query.trim();
	if (q.length < 2) return { id: req.id, hits: [], regexError: null };

	let matcher: (line: string) => { idx: number; len: number } | null;
	if (req.useRegex) {
		let re: RegExp;
		try {
			re = new RegExp(q, req.caseSensitive ? '' : 'i');
		} catch (err) {
			return {
				id: req.id,
				hits: [],
				regexError: err instanceof Error ? err.message : String(err)
			};
		}
		matcher = (line) => {
			const m = re.exec(line);
			return m ? { idx: m.index, len: m[0].length || 1 } : null;
		};
	} else if (req.wholeWord) {
		const re = new RegExp(`\\b${escapeRegex(q)}\\b`, req.caseSensitive ? '' : 'i');
		matcher = (line) => {
			const m = re.exec(line);
			return m ? { idx: m.index, len: m[0].length } : null;
		};
	} else {
		const needle = req.caseSensitive ? q : q.toLowerCase();
		matcher = (line) => {
			const target = req.caseSensitive ? line : line.toLowerCase();
			const idx = target.indexOf(needle);
			return idx === -1 ? null : { idx, len: q.length };
		};
	}

	const out: Hit[] = [];
	for (const file of req.files) {
		const lines = file.content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			// invariant: i < lines.length guarantees lines[i] is defined.
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
				if (out.length >= MAX_HITS) return { id: req.id, hits: out, regexError: null };
			}
		}
	}
	return { id: req.id, hits: out, regexError: null };
}

self.addEventListener('message', (e: MessageEvent<SearchRequest>) => {
	const response = search(e.data);
	(self as unknown as Worker).postMessage(response);
});
