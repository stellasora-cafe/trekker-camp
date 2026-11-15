<!--
SPDX-FileCopyrightText: trekker-camp contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkDesktopTitlebar v-if="!offline"/>
<div v-if="!offline && desktop && (disconnected || updateReady)" :class="$style.connection" role="status">
	<span>{{ disconnected ? i18n.ts._desktop.connectionLost : i18n.ts._desktop.updateReady }}</span>
	<button class="_button" :class="$style.refresh" @click="refreshDesktop"><i class="ti ti-refresh"></i> {{ updateReady ? i18n.ts._desktop.refreshUpdate : i18n.ts.reload }}</button>
</div>
<div v-show="!offline" :class="[$style.content, { [$style.framedContent]: customChrome }]" data-camp-desktop-content :inert="offline" :aria-hidden="offline || undefined">
	<component :is="component"/>
</div>
<div v-if="customChrome" v-show="!offline" id="camp-desktop-overlays" :class="$style.overlays" data-camp-desktop-content :inert="offline" :aria-hidden="offline || undefined">
	<MkContextMenu v-if="contextMenu && !offline" :items="contextMenu.items" :ev="contextMenu.ev" @closed="closeContextMenu"/>
</div>
<dialog ref="maintenance" :class="$style.maintenance" :aria-label="i18n.ts._offline.title" @cancel.prevent @keydown.stop>
	<MkDesktopTitlebar v-if="offline"/>
	<div v-if="customChrome" class="_campWindowHeader" data-camp-window-drag></div>
	<div ref="maintenanceContent" tabindex="-1" :class="$style.maintenanceContent">
		<MkOfflineNotice v-if="offline"/>
	</div>
	<div v-if="contextMenu && offline" :class="$style.overlays">
		<MkContextMenu :items="contextMenu.items" :ev="contextMenu.ev" @closed="closeContextMenu"/>
	</div>
</dialog>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { Component } from 'vue';
import MkOfflineNotice from '@/components/MkOfflineNotice.vue';
import MkDesktopTitlebar from '@/components/MkDesktopTitlebar.vue';
import { maintenanceActive as offline, offline as disconnected, isDesktopClient } from '@/utility/offline.js';
import * as os from '@/os.js';
import { focusTrap } from '@/utility/focus-trap.js';
import { i18n } from '@/i18n.js';
import { hasDesktopWindowChrome } from '@/utility/desktop-window.js';
import { desktopContextMenu } from '@/utility/desktop-context-menu.js';
import type { DesktopContextMenu } from '@/utility/desktop-context-menu.js';

defineProps<{ component: Component }>();

const maintenance = useTemplateRef('maintenance');
const maintenanceContent = useTemplateRef('maintenanceContent');
const customChrome = hasDesktopWindowChrome();
const desktop = isDesktopClient();
const updateReady = ref(window.document.documentElement.dataset.campFrontendReady === 'true');
const onUpdateReady = () => { updateReady.value = window.document.documentElement.dataset.campFrontendReady === 'true'; };

async function refreshDesktop() {
	const editing = [...window.document.querySelectorAll('textarea,[contenteditable="true"]')].some(element => element instanceof HTMLTextAreaElement ? element.value.trim() !== '' : element.textContent?.trim());
	if (editing || window.document.querySelector('dialog[open],[role="dialog"],form')) {
		const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts._desktop.finishEditing });
		if (canceled) return;
	}
	window.location.assign('camp-desktop://frontend-apply');
}

const MkContextMenu = defineAsyncComponent(() => import('@/components/MkContextMenu.vue'));
const contextMenu = shallowRef<DesktopContextMenu | null>(null);
let trap: ReturnType<typeof focusTrap> | undefined;
let previousFocus: HTMLElement | null = null;
let revision = 0;
let lastContextEvent: PointerEvent | null = null;

function captureContextMenu(event: PointerEvent) {
	lastContextEvent = event;
}

function onNativeContextMenu() {
	if (lastContextEvent) contextMenu.value = desktopContextMenu(lastContextEvent);
	lastContextEvent = null;
}

function closeContextMenu() {
	if (window.document.activeElement?.closest('[role="menu"]')) contextMenu.value?.restore();
	contextMenu.value = null;
}

onMounted(() => {
	window.addEventListener('camp-frontend-ready', onUpdateReady);
	if (customChrome) {
		window.document.addEventListener('contextmenu', captureContextMenu, true);
		window.addEventListener('camp-native-context-menu', onNativeContextMenu);
	}
});

watch(offline, async blocked => {
	const current = ++revision;
	contextMenu.value = null;
	if (blocked && window.document.activeElement instanceof HTMLElement) previousFocus = window.document.activeElement;
	trap?.release();
	trap = undefined;
	if (!blocked) maintenance.value?.close();
	await nextTick();
	if (current !== revision) return;
	if (blocked && maintenance.value) {
		maintenance.value.showModal();
		trap = focusTrap(maintenance.value);
		maintenanceContent.value?.focus({ preventScroll: true });
	} else {
		previousFocus?.focus({ preventScroll: true });
		previousFocus = null;
	}
}, { immediate: true });

onBeforeUnmount(() => {
	window.removeEventListener('camp-frontend-ready', onUpdateReady);
	revision++;
	trap?.release();
	window.document.removeEventListener('contextmenu', captureContextMenu, true);
	window.removeEventListener('camp-native-context-menu', onNativeContextMenu);
});
</script>

<style lang="scss" module>
.connection {
	position: fixed;
	bottom: 16px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 2000001;
	display: flex;
	align-items: center;
	gap: 16px;
	max-width: calc(100% - 48px);
	padding: 12px 18px;
	border-radius: 12px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	box-shadow: 0 2px 12px var(--MI_THEME-shadow);
}
.refresh { color: var(--MI_THEME-accent); white-space: nowrap; }
.content { height: 100%; }
.framedContent {
	position: fixed;
	inset: 0;
	height: auto;
	contain: layout;
	overflow: auto;
}
.overlays {
	position: fixed;
	inset: 0;
	z-index: 2000000;
	pointer-events: none;
}
:where(.overlays > *) { pointer-events: auto; }

.maintenance {
	position: fixed;
	inset: 0;
	z-index: 2147483647;
	box-sizing: border-box;
	width: 100%;
	max-width: none;
	height: 100dvh;
	max-height: none;
	margin: 0;
	padding: 0;
	border: 0;
	color: var(--MI_THEME-fg);
	background: var(--MI_THEME-bg);
	overflow: auto;
	overscroll-behavior: contain;

	&[open] {
		display: flex;
		flex-direction: column;
	}

	&::backdrop { background: var(--MI_THEME-bg); }
}

.maintenanceContent {
	outline: none;
	display: flex;
	flex: 1;
	flex-direction: column;
	align-items: center;
	box-sizing: border-box;
	padding: var(--MI-margin) var(--MI-margin) calc(var(--MI-margin) + env(safe-area-inset-bottom, 0px));
	> section { flex-shrink: 0; margin: auto 0; }
}

</style>
