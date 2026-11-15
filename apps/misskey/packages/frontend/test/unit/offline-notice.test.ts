/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick, ref } from 'vue';
import MkOfflineNotice from '@/components/MkOfflineNotice.vue';
import { i18n } from '@/i18n.js';
import { reconnectServer, reconnectingServer } from '@/utility/offline.js';

vi.mock('@/utility/offline.js', () => ({ reconnectServer: vi.fn(), reconnectingServer: ref(false) }));

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	(reconnectingServer as { value: boolean }).value = false;
});

describe('offline maintenance panel', () => {
	test('offers reconnection and the upcoming toolbox without cached-content navigation', async () => {
		const view = render(MkOfflineNotice, { global: { stubs: { MkButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot/></button>' } } } });
		expect(view.getByRole('heading', { name: i18n.ts._offline.title, level: 1 })).toBeTruthy();
		expect(view.getByText(i18n.ts._offline.reconnectHint)).toBeTruthy();
		const toolbox = view.getByRole('button', { name: i18n.ts._offline.toolbox });
		expect(toolbox.hasAttribute('disabled')).toBe(true);
		expect(view.getByText(i18n.ts._offline.toolboxComingSoon).id).toBe(toolbox.getAttribute('aria-describedby'));
		expect(view.queryAllByRole('link')).toHaveLength(0);
		expect(view.container.textContent).not.toMatch(/缓存|客户端设置/);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts._offline.retry }));
		expect(reconnectServer).toHaveBeenCalledOnce();
		(reconnectingServer as { value: boolean }).value = true;
		await nextTick();
		expect(view.getByRole('button', { name: i18n.ts._offline.waiting }).hasAttribute('disabled')).toBe(true);
	});

	test('has a local visual fallback when private artwork has never been downloaded', async () => {
		const view = render(MkOfflineNotice, { global: { stubs: { MkButton: true } } });
		await fireEvent.error(view.getByAltText(i18n.ts._offline.imageAlt));
		expect(view.queryByAltText(i18n.ts._offline.imageAlt)).toBeNull();
		expect(view.getByText(i18n.ts._offline.title)).toBeTruthy();
	});
});
