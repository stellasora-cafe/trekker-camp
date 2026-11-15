/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { updateClientResources, versionClientResource } from '@/utility/client-resources.js';
import { invalidateSoundCache } from '@/utility/sound.js';

vi.mock('@/instance.js', () => ({ fetchInstance: vi.fn(async () => ({})) }));
vi.mock('@/custom-emojis.js', () => ({ fetchCustomEmojis: vi.fn(async () => {}) }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/utility/sound.js', () => ({ invalidateSoundCache: vi.fn(() => []) }));

const origin = 'http://localhost:3000';

describe('client resource hot updates', () => {
	test('only revisions changed same-origin resources and preserves other query parameters', () => {
		const path = '/client-assets/camp/logo.png';
		expect(versionClientResource(path + '?size=small', 'next', [path], origin)).toBe(origin + path + '?size=small&camp-revision=next');
		expect(versionClientResource(path, 'next', ['/client-assets/other.png'], origin)).toBe(path);
		expect(versionClientResource('https://example.test' + path, 'next', [], origin)).toBe('https://example.test' + path);
		expect(versionClientResource('/api/i', 'next', [], origin)).toBe('/api/i');
	});

	test('updates mounted images and font rules while keeping the page and input nodes', async () => {
		document.body.innerHTML = '<textarea>unsent draft</textarea><img src="/client-assets/camp/logo.png"><style>@font-face {font-family: MiSans; src:url("/client-assets/camp/font.woff2")}</style>';
		const draft = document.querySelector('textarea');
		const image = document.querySelector('img');
		await updateClientResources({ revision: 'local-test-2', paths: [] });
		expect(document.querySelector('textarea')).toBe(draft);
		expect(draft?.value).toBe('unsent draft');
		expect(document.querySelector('img')).toBe(image);
		expect(image?.src).toContain('camp-revision=local-test-2');
		expect(document.styleSheets[0].cssRules[0].cssText).toContain('camp-revision=local-test-2');
	});

	test('a failed update does not prevent the next resource update', async () => {
		vi.mocked(invalidateSoundCache).mockImplementationOnce(() => { throw new Error('interrupted resource update'); });
		await expect(updateClientResources({ revision: 'local-failed', paths: [] })).rejects.toThrow('interrupted resource update');
		await expect(updateClientResources({ revision: 'local-recovered', paths: [] })).resolves.toBeUndefined();
		expect(window.localStorage.getItem('clientResourcesRevision')).toBe('local-recovered');
	});
});
