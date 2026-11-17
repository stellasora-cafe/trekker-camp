<!--
SPDX-FileCopyrightText: trekker-camp contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 600px; --MI_SPACER-min: 20px;">
		<div class="_gaps_m">
			<section class="_panel" :class="$style.hero">
				<img src="/client-assets/trekker-camp/branding/apple-touch-icon-v1.png" alt="" :class="$style.logo"/>
				<h1>{{ i18n.ts._aboutCamp.name }}</h1>
				<p>{{ i18n.ts._aboutCamp.description }}</p>
				<p :class="$style.version">{{ i18n.ts.version }} {{ version }}</p>
			</section>
			<a href="https://github.com/stellasora-cafe" target="_blank" rel="noopener noreferrer" class="_panel" :class="$style.identity">
				<img src="https://avatars.githubusercontent.com/u/356607548?v=4" alt="" width="48" height="48"/>
				<span><small>{{ i18n.ts._aboutCamp.team }}</small><strong>{{ i18n.ts._aboutCamp.organization }}</strong></span>
				<i class="ti ti-external-link" :class="$style.externalIcon" aria-hidden="true"></i>
			</a>
			<FormLink to="https://github.com/stellasora-cafe/trekker-camp" external>
				<template #icon><i class="ti ti-code"></i></template>{{ i18n.ts.sourceCode }}
			</FormLink>
			<FormLink to="/about"><template #icon><i class="ti ti-server"></i></template>{{ i18n.ts.instanceInfo }}</FormLink>
			<FormLink to="/about-camp/misskey"><template #icon><i class="ti ti-info-circle"></i></template>{{ i18n.ts.aboutMisskey }}</FormLink>
			<FormLink to="https://github.com/stellasora-cafe/trekker-camp/blob/master/LICENSE" external>
				<template #icon><i class="ti ti-license"></i></template>{{ i18n.ts._aboutCamp.licensing }}
			</FormLink>
			<FormLink to="https://hyperos.mi.com/font/zh/" external><template #icon><i class="ti ti-typography"></i></template>{{ i18n.ts.misansFontCredit }}</FormLink>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { version } from '@@/js/config.js';
import FormLink from '@/components/form/link.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

definePage(() => ({ title: i18n.ts.aboutCamp, icon: 'ti ti-info-circle' }));
</script>

<style lang="scss" module>
.hero { padding: 36px 24px; text-align: center; }
.logo { width: 96px; height: 96px; border-radius: 24px; }
.hero h1 { margin: 20px 0 12px; font-size: 1.6em; }
.hero p { line-height: 1.8; }
.version { font-size: .9em; opacity: .7; }
.identity { display: flex; padding: 16px 20px; gap: 12px; align-items: center; }
.identity img { border-radius: 12px; flex-shrink: 0; }
.identity small, .identity strong { display: block; }
.identity small { margin-bottom: 3px; opacity: .7; }
.externalIcon { margin-inline-start: auto; opacity: .7; }
</style>
