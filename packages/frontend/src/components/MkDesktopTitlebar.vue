<!--
SPDX-FileCopyrightText: trekker-camp contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="state.enabled && !state.fullscreen" class="_campWindowHeader" :class="[$style.root, { [$style.inactive]: !state.active }]" data-camp-window-titlebar @keydown.stop @contextmenu.prevent.stop>
	<button type="button" class="_button" :class="$style.control" :aria-label="i18n.ts._desktop.minimize" :title="i18n.ts._desktop.minimize" @click="desktopWindowCommand('minimize')"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5H10"/></svg></button>
	<button type="button" class="_button" :class="$style.control" :aria-label="state.maximized ? i18n.ts._desktop.restore : i18n.ts._desktop.maximize" :title="state.maximized ? i18n.ts._desktop.restore : i18n.ts._desktop.maximize" @click="desktopWindowCommand('maximize')"><svg viewBox="0 0 10 10" aria-hidden="true"><path v-if="state.maximized" d="M2.5.5H9.5V7.5M.5 2.5H7.5V9.5H.5Z"/><rect v-else x=".5" y=".5" width="9" height="9"/></svg></button>
	<button type="button" class="_button" :class="[$style.control, $style.close]" :aria-label="i18n.ts._desktop.closeWindow" :title="i18n.ts._desktop.closeWindow" @click="desktopWindowCommand('close')"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5L9.5 9.5M9.5.5L.5 9.5"/></svg></button>
</div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, shallowRef } from 'vue';
import { i18n } from '@/i18n.js';
import { desktopWindowCommand, getDesktopWindowState, handleDesktopWindowMouseDown } from '@/utility/desktop-window.js';

const state = shallowRef(getDesktopWindowState());
const updateState = () => { state.value = getDesktopWindowState(); };
const onMouseDown = (event: MouseEvent) => { handleDesktopWindowMouseDown(event); };
window.addEventListener('camp-window-state-change', updateState);
window.document.addEventListener('mousedown', onMouseDown);
onBeforeUnmount(() => {
	window.removeEventListener('camp-window-state-change', updateState);
	window.document.removeEventListener('mousedown', onMouseDown);
});
</script>

<style lang="scss" module>
.root {
	position: fixed;
	top: 0;
	right: 0;
	z-index: 2147483646;
	display: flex;
	height: 50px;
	box-sizing: border-box;
	flex-shrink: 0;
	user-select: none;
	font-weight: 400;
}

.control {
	display: grid;
	place-items: center;
	width: 42px;
	height: 100%;
	color: inherit;
	border-radius: 0;
	transition: background-color 100ms, color 100ms;

	&:hover { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
	&:active { background: var(--MI_THEME-buttonBg); }
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -4px; border-radius: 5px; }
	svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1px; pointer-events: none; }
}

.close:hover, .close:active { color: var(--MI_THEME-fgOnAccent); background: var(--MI_THEME-error); }
.inactive .control:not(:hover) { color: var(--MI_THEME-fgTransparentWeak); }

@media (prefers-reduced-motion: reduce) {
	.control { transition: none; }
}
</style>
