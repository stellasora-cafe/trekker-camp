/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import type { entities } from 'misskey-js';
import MkMediaList from '@/components/MkMediaList.vue';
import { i18n } from '@/i18n.js';

vi.mock('@/components/MkMediaBanner.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkMediaAudio.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkMediaImage.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkMediaVideo.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/os.js', () => ({}));
vi.mock('@/preferences.js', () => ({ prefer: { s: { animation: false } } }));

test('syncs carousel arrows with the scroll position when returning to a cached timeline', async () => {
	const mediaList = ['one', 'two'].map(id => ({ id, type: 'image/png', properties: { width: 400, height: 300 } } as entities.DriveFile));
	const Detail = defineComponent({ render: () => h('div', 'detail') });
	const inTimeline = ref(true);
	const host = defineComponent({
		setup: () => () => h(KeepAlive, null, { default: () => inTimeline.value ? h(MkMediaList, { mediaList }) : h(Detail) }),
	});
	const view = render(host);
	try {
		const prev = view.getByLabelText(i18n.ts._longNote.prevMedia);
		const next = view.getByLabelText(i18n.ts._longNote.nextMedia);
		const gallery = prev.previousElementSibling as HTMLElement;
		Object.defineProperties(gallery, {
			clientWidth: { value: 200 },
			scrollWidth: { value: 360 },
		});
		gallery.scrollBy = (options?: ScrollToOptions | number) => {
			gallery.scrollLeft += typeof options === 'number' ? options : options?.left ?? 0;
			gallery.dispatchEvent(new Event('scroll'));
		};
		await fireEvent.scroll(gallery);
		await fireEvent.click(next);
		expect(gallery.scrollLeft).toBe(160);
		expect(prev.style.display).not.toBe('none');
		expect(next.style.display).toBe('none');

		inTimeline.value = false;
		await nextTick();
		expect(view.container.contains(gallery)).toBe(false);
		// A browser can reset a detached scroller without delivering a scroll event.
		gallery.scrollLeft = 0;
		inTimeline.value = true;
		await waitFor(() => {
			expect(view.container.contains(gallery)).toBe(true);
			expect(prev.style.display).toBe('none');
			expect(next.style.display).not.toBe('none');
		});
		await fireEvent.click(next);
		expect(gallery.scrollLeft).toBe(160);
	} finally {
		cleanup();
	}
});
