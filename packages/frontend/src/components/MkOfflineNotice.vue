<!--
SPDX-FileCopyrightText: trekker-camp contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.root" :aria-labelledby="titleId" aria-live="polite">
	<div :class="$style.art" aria-hidden="true">
		<i class="ti ti-sparkles"></i>
		<picture v-if="imageAvailable">
			<source media="(prefers-reduced-motion: reduce)" :srcset="'/client-assets/camp/maintenance/apology-still-v1.webp'"/>
			<img :src="'/client-assets/camp/maintenance/apology-v1.webp'" :alt="i18n.ts._offline.imageAlt" width="960" height="540" @error="imageAvailable = false"/>
		</picture>
	</div>
	<div :class="$style.copy">
		<div :class="$style.eyebrow"><i class="ti ti-sparkles"></i> {{ i18n.ts._offline.eyebrow }}</div>
		<h1 :id="titleId">{{ i18n.ts._offline.title }}</h1>
		<p>{{ i18n.ts._offline.description }}</p>
		<p :class="$style.hint">{{ i18n.ts._offline.reconnectHint }}</p>
		<div :class="$style.actions">
			<MkButton rounded primary full :disabled="reconnectingServer" @click="reconnectServer()">{{ reconnectingServer ? i18n.ts._offline.waiting : i18n.ts._offline.retry }}</MkButton>
			<div :class="$style.toolbox">
				<MkButton rounded full disabled :aria-describedby="toolboxHintId">{{ i18n.ts._offline.toolbox }}</MkButton>
				<p :id="toolboxHintId" :class="$style.hint">{{ i18n.ts._offline.toolboxComingSoon }}</p>
			</div>
		</div>
	</div>
</section>
</template>

<script lang="ts" setup>
import { ref, useId } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { reconnectServer, reconnectingServer } from '@/utility/offline.js';

const imageAvailable = ref(true);
const titleId = useId();
const toolboxHintId = useId();
</script>

<style lang="scss" module>
.root {
	box-sizing: border-box;
	width: 100%;
	max-width: 720px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	overflow: clip;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	box-shadow: 0 12px 36px var(--MI_THEME-shadow);
}

.art {
	position: relative;
	display: grid;
	place-items: center;
	aspect-ratio: 16 / 9;
	color: var(--MI_THEME-accent);
	background: color-mix(in srgb, var(--MI_THEME-accent) 12%, var(--MI_THEME-panel));
	font-size: 52px;

	picture { position: absolute; inset: 0; }
	img { display: block; width: 100%; height: 100%; object-fit: contain; }
}

.copy {
	padding: calc(var(--MI-margin) * 1.5);
	background: radial-gradient(circle at 100% 0, var(--MI_THEME-accentedBg), transparent 65%);
	font-size: 14px;
	line-height: 1.8;
	text-align: center;

	h1 { font-size: clamp(20px, 3vw, 26px); font-weight: 600; line-height: 1.5; margin: var(--MI-marginHalf) 0 var(--MI-margin); }
	p { margin: var(--MI-marginHalf) 0; }
}

.eyebrow { color: var(--MI_THEME-accent); font-size: 12px; letter-spacing: 0.1em; }
.hint { color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }

.actions {
	display: flex;
	flex-direction: column;
	gap: var(--MI-margin);
	max-width: 320px;
	margin: calc(var(--MI-margin) * 1.5) auto 0;
}

.toolbox {
	width: 100%;
	padding-top: var(--MI-margin);
	border-top: 1px solid var(--MI_THEME-divider);
}

@media (max-width: 480px) {
	.copy { padding: var(--MI-margin); }
}
</style>
