#!/usr/bin/env node
// Resolves CHANGELOG notes + optional GitHub release id for desktop.yml.
// Writes GitHub Actions outputs via fs (no bash). Fail-closed: empty notes throw.
// Numeric id is written only when the release exists; the id key is omitted otherwise.

import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readChangelogSection } from './changelog-section.mjs';

/**
 * @param {{ notes?: string, id?: unknown }} fields
 * @returns {string}
 */
export function formatGithubOutput(fields) {
	const chunks = [];
	if (Object.prototype.hasOwnProperty.call(fields, 'notes')) {
		const notes = String(fields.notes ?? '').trim();
		if (!notes) {
			throw new Error('desktop-release-meta: empty changelog notes');
		}
		chunks.push(`notes<<MDSH_NOTES_EOF\n${notes}\nMDSH_NOTES_EOF`);
	}
	if (fields.id !== undefined && fields.id !== null && /^\d+$/.test(String(fields.id))) {
		chunks.push(`id=${fields.id}`);
	}
	return chunks.length ? `${chunks.join('\n')}\n` : '';
}

/**
 * @typedef {{ repo: string, token?: string, fetchImpl?: typeof fetch }} FetchReleaseIdOpts
 * @typedef {{
 *   tag: string,
 *   changelogPath: string,
 *   repo?: string,
 *   token?: string,
 *   fetchImpl?: typeof fetch
 * }} DesktopReleaseMetaOpts
 * @typedef {{ notes: string, id?: number }} DesktopReleaseMeta
 */

/**
 * @param {string} tag
 * @param {FetchReleaseIdOpts} opts
 * @returns {Promise<number | undefined>}
 */
export async function fetchReleaseId(tag, opts) {
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
	if (typeof fetchImpl !== 'function') {
		return undefined;
	}
	/** @type {Record<string, string>} */
	const headers = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};
	if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
	const res = await fetchImpl(`https://api.github.com/repos/${opts.repo}/releases/tags/${tag}`, {
		headers
	});
	if (!res.ok) return undefined;
	const data = await res.json();
	return typeof data?.id === 'number' ? data.id : undefined;
}

/**
 * @param {DesktopReleaseMetaOpts} opts
 * @returns {Promise<DesktopReleaseMeta>}
 */
export async function resolveDesktopReleaseMeta(opts) {
	const notes = readChangelogSection(opts.tag, opts.changelogPath);
	if (!notes.trim()) {
		throw new Error('desktop-release-meta: empty changelog notes');
	}
	if (!opts.repo) {
		return { notes };
	}
	/** @type {FetchReleaseIdOpts} */
	const fetchOpts = { repo: opts.repo };
	if (opts.token !== undefined) fetchOpts.token = opts.token;
	if (opts.fetchImpl !== undefined) fetchOpts.fetchImpl = opts.fetchImpl;
	const id = await fetchReleaseId(opts.tag, fetchOpts);
	if (id === undefined) return { notes };
	return { notes, id };
}

function isMain() {
	const entry = process.argv[1];
	return typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
	const tag = process.env.RELEASE_TAG ?? process.argv[2] ?? '';
	if (!tag) {
		// workflow_dispatch without a tag: nothing to attach, do not fail the job.
		process.exit(0);
	}
	const outPath = process.env.GITHUB_OUTPUT;
	if (!outPath) {
		console.error('desktop-release-meta: GITHUB_OUTPUT is required');
		process.exit(2);
	}
	const changelogPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');
	/** @type {DesktopReleaseMetaOpts} */
	const resolveOpts = { tag, changelogPath };
	const repo = process.env.GITHUB_REPOSITORY;
	if (repo) resolveOpts.repo = repo;
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (token) resolveOpts.token = token;
	const meta = await resolveDesktopReleaseMeta(resolveOpts);
	appendFileSync(outPath, formatGithubOutput(meta));
}
