/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { getDesktopWindowState } from '@/utility/desktop-window.js';

export function desktopControlsInset(rect: Pick<DOMRect, 'top' | 'bottom' | 'right' | 'width'>, viewportWidth: number, existingPadding = 0): number {
	const state = getDesktopWindowState();
	if (!state.enabled || state.fullscreen || rect.top >= 50 || rect.bottom <= 0 || rect.right <= 0 || rect.right - rect.width >= viewportWidth) return 0;
	return Math.min(Math.max(0, rect.width - existingPadding), Math.max(0, rect.right - (viewportWidth - 132)));
}

/** Reserve only the part of a header intersecting the window buttons. */
export function useDesktopControlsInset(element: Readonly<Ref<HTMLElement | null>>, existingPadding = 0) {
	const inset = ref(0);
	let frame = 0;
	let observer: ResizeObserver | undefined;
	const measure = () => { inset.value = element.value ? desktopControlsInset(element.value.getBoundingClientRect(), window.innerWidth, existingPadding) : 0; };
	const update = () => {
		if (frame) return;
		frame = window.requestAnimationFrame(() => {
			frame = 0;
			measure();
		});
	};
	onMounted(() => {
		if (!getDesktopWindowState().enabled) return;
		observer = new ResizeObserver(update);
		watch(element, (current, previous) => {
			if (previous) observer?.unobserve(previous);
			if (current) observer?.observe(current);
			measure();
		}, { immediate: true, flush: 'post' });
		window.addEventListener('resize', update);
		window.addEventListener('pointerup', update);
		window.addEventListener('camp-window-state-change', update);
		window.document.addEventListener('scroll', update, { capture: true, passive: true });
	});
	onBeforeUnmount(() => {
		observer?.disconnect();
		window.cancelAnimationFrame(frame);
		window.removeEventListener('resize', update);
		window.removeEventListener('pointerup', update);
		window.removeEventListener('camp-window-state-change', update);
		window.document.removeEventListener('scroll', update, true);
	});
	return inset;
}
