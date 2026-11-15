/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { fetchInstance } from '@/instance.js';
import { fetchCustomEmojis } from '@/custom-emojis.js';
import { miLocalStorage } from '@/local-storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { invalidateSoundCache } from '@/utility/sound.js';

let revision = miLocalStorage.getItem('clientResourcesRevision');
let pending = Promise.resolve();

export function versionClientResource(value: string, version: string, paths: readonly string[], origin: string): string {
	let url: URL;
	try {
		url = new URL(value, origin);
	} catch {
		return value;
	}
	if (url.origin !== origin || !/^\/(?:client-assets|static-assets)\//.test(url.pathname)) return value;
	if (paths.length > 0 && !paths.includes(url.pathname)) return value;
	url.searchParams.set('camp-revision', version);
	return url.href;
}

export function updateClientResources(update: { revision: string; paths: string[] }): Promise<void> {
	pending = pending.catch(() => {}).then(async () => {
		if (update.revision === revision) return;
		const origin = window.location.origin;
		const revalidate = new Set<string>();
		for (const url of invalidateSoundCache(update.paths)) revalidate.add(url);
		const versionUrl = (value: string) => {
			const updated = versionClientResource(value, update.revision, update.paths, origin);
			if (updated !== value) {
				const url = new URL(value, origin);
				url.searchParams.delete('camp-revision');
				revalidate.add(url.href);
			}
			return updated;
		};
		const versionCss = (value: string) => value.replace(/url\(\s*(["']?)(.*?)\1\s*\)/g, (match, quote: string, url: string) => {
			const updated = versionUrl(url);
			return updated === url ? match : `url("${updated}")`;
		});
		const updateStyle = (style: CSSStyleDeclaration) => {
			for (const name of Array.from(style)) {
				const value = style.getPropertyValue(name);
				if (!value.includes('url(')) continue;
				const updated = versionCss(value);
				if (updated !== value) style.setProperty(name, updated, style.getPropertyPriority(name));
			}
		};
		const updateRules = (rules: CSSRuleList) => {
			for (const rule of Array.from(rules)) {
				if ('style' in rule) updateStyle((rule as CSSStyleRule).style);
				if ('cssRules' in rule) updateRules((rule as CSSGroupingRule).cssRules);
			}
		};
		for (const sheet of Array.from(window.document.styleSheets)) {
			try { updateRules(sheet.cssRules); } catch { /* Cross-origin styles remain under their own cache policy. */ }
		}
		for (const element of window.document.querySelectorAll<HTMLElement>('[style]')) updateStyle(element.style);
		for (const element of window.document.querySelectorAll('img[src], source[srcset], img[srcset], video[poster], link[rel="stylesheet"][href]')) {
			for (const attribute of ['src', 'poster', 'href']) {
				const value = element.getAttribute(attribute);
				if (value == null) continue;
				const updated = versionUrl(value);
				if (updated !== value) element.setAttribute(attribute, updated);
			}
			const srcset = element.getAttribute('srcset');
			if (srcset && !srcset.startsWith('data:')) {
				const updated = srcset.split(',').map(candidate => {
					const [url, ...descriptor] = candidate.trim().split(/\s+/);
					return [versionUrl(url), ...descriptor].join(' ');
				}).join(', ');
				if (updated !== srcset) element.setAttribute('srcset', updated);
			}
		}
		await Promise.allSettled([
			...Array.from(revalidate, url => window.fetch(url, { cache: 'reload' })),
			fetchInstance(true),
			fetchCustomEmojis(true),
		]);
		revision = update.revision;
		miLocalStorage.setItem('clientResourcesRevision', revision);
	});
	return pending;
}

export async function refreshClientResources(): Promise<void> {
	const current = await misskeyApi('client-resources');
	if (revision == null) {
		revision = current.revision;
		miLocalStorage.setItem('clientResourcesRevision', revision);
		return;
	}
	await updateClientResources({ revision: current.revision, paths: [] });
}
