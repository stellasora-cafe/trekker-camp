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
				<p :class="$style.version">{{ i18n.ts._aboutCamp.basedOn }} · {{ version }}</p>
			</section>
			<section class="_panel" :class="$style.team">
				<h2>{{ i18n.ts._aboutCamp.team }}</h2>
				<a href="https://github.com/stellasora-cafe" target="_blank" rel="noopener noreferrer" :class="$style.identity">
					<img src="https://avatars.githubusercontent.com/u/356607548?v=4" :alt="i18n.ts._aboutCamp.organization" width="64" height="64"/>
					<span><strong>{{ i18n.ts._aboutCamp.organization }}</strong><br><span class="_link">@stellasora-cafe <i class="ti ti-external-link"></i></span></span>
				</a>
				<p>{{ i18n.ts._aboutCamp.maintainedBy }}</p>
				<p>{{ i18n.ts._aboutCamp.teamDescription }}</p>
			</section>
			<section class="_panel" :class="$style.team">
				<h2>{{ i18n.ts._aboutCamp.licensing }}</h2>
				<p><strong>{{ i18n.ts._aboutCamp.frontendLicense }}</strong><br>{{ i18n.ts._aboutCamp.frontendLicenseDescription }}</p>
				<p>{{ i18n.ts._aboutCamp.assetLicenseDescription }}</p>
				<div class="_gaps_s">
					<FormLink to="https://github.com/stellasora-cafe/trekker-camp/blob/master/LICENSE" external>{{ i18n.ts._aboutCamp.frontendLicense }}</FormLink>
				</div>
			</section>
			<FormLink to="https://github.com/stellasora-cafe/trekker-camp" external>
				<template #icon><i class="ti ti-code"></i></template>{{ i18n.ts.sourceCode }}
			</FormLink>
			<FormLink to="/about"><template #icon><i class="ti ti-server"></i></template>{{ i18n.ts.instanceInfo }}</FormLink>
			<FormLink to="/about-camp/misskey"><template #icon><i class="ti ti-info-circle"></i></template>{{ i18n.ts.aboutMisskey }}</FormLink>
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
.hero p, .team p { line-height: 1.8; }
.version { color: var(--MI_THEME-fgTransparentWeak); font-size: .9em; }
.team { padding: 24px; }
.team h2 { margin: 0 0 20px; font-size: 1.1em; }
.identity { display: flex; gap: 16px; align-items: center; line-height: 1.8; }
.identity img { border-radius: 16px; flex-shrink: 0; }
</style>
