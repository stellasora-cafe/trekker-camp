<!--
SPDX-FileCopyrightText: trekker-camp contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.console, { [$style.motion]: prefer.s.animation }]">
	<aside :class="$style.rail">
		<div :class="$style.brand"><i class="ti ti-terminal-2"></i><strong>{{ t.title }}</strong></div>
		<nav :aria-label="t.workspace">
			<button v-for="item in sections" :key="item.id" type="button" :aria-current="view === item.id ? 'page' : undefined" @click="navigate(item.id)"><i :class="item.icon"></i>{{ item.label }}</button>
			<a :href="guide" :class="$style.docLink"><i class="ti ti-book"></i>{{ t.docs }}</a>
		</nav>
		<div v-if="$i" :class="$style.account"><b>{{ $i.username.slice(0, 1).toUpperCase() }}</b><span>@{{ $i.username }}<small>{{ t.workspace }}</small></span></div>
		<a href="/" :class="$style.return"><i class="ti ti-arrow-left"></i>{{ t.returnCamp }}</a>
	</aside>
	<main :class="$style.main">
		<XEmailVerificationBanner/>
		
		<div :key="view" :class="$style.content">
			<div v-if="$i" :class="$style.heading"><h1>{{ title }}</h1><div v-if="$i && (view === 'overview' || view === 'analytics')" :class="$style.segment" :data-week="range === 7"><button v-for="period in periods" :key="period.size" type="button" :aria-pressed="range === period.size" @click="range = period.size">{{ period.label }}</button></div><button v-if="$i && view === 'keys'" type="button" :class="$style.primary" @click="startCreate"><i class="ti ti-plus"></i>{{ t.create }}</button></div>
			<section v-if="!$i" :class="$style.guest">
				<i class="ti ti-terminal-2" :class="$style.guestIcon" aria-hidden="true"></i>
				<h1>{{ t.title }}</h1>
				<p>{{ t.guest }}</p>
				<button type="button" :class="[$style.primary, $style.login]" @click="pleaseLogin()">{{ t.signIn }}</button>
				<div :class="$style.registerRow">
					<span>{{ t.newAccount }}</span>
					<button type="button" @click="signup">{{ i18n.ts.signup }} <i class="ti ti-arrow-right" aria-hidden="true"></i></button>
				</div>
			</section>
			<template v-else>
				<div v-if="loadError" :class="$style.panel" role="alert">{{ i18n.ts.error }} <button @click="load">{{ i18n.ts.retry }}</button></div>
				<template v-if="view === 'overview'">
					<section :class="$style.hero"><div><h2>{{ t.apiTitle }}</h2><p>{{ t.heroText }}</p><a :href="guide" :class="$style.docLink">{{ t.docs }} ↗</a></div></section>
					<div :class="$style.cards">
						<button v-for="metric in metrics" :key="metric.field" :class="$style.stat" @click="openMetric(metric.field)">
							<span>{{ metric.label }} ›</span><strong>{{ total(metric.field) }}</strong>
							<svg :key="range + '/' + series.length" viewBox="0 0 240 44" preserveAspectRatio="none" aria-hidden="true"><polyline v-if="series.length > 1" :points="points(metric.field, 240, 44)" :stroke="metric.color"/><circle v-if="series.length" cx="237" :cy="pointY(series[series.length - 1][metric.field], metric.field, 44)" r="3" fill="white" :stroke="metric.color"/></svg>
						</button>
					</div>
					<h2>{{ t.quickstart }}</h2>
					<div :class="$style.tiles"><button @click="startCreate"><i class="ti ti-plus"></i><strong>{{ t.create }}</strong><small>{{ t.keyHint }}</small></button><a :href="guide" :class="$style.docLink"><i class="ti ti-code"></i><strong>{{ t.docs }}</strong><small>{{ t.docsHint }}</small></a></div>
				</template>
				<template v-if="view === 'analytics'">
					<section :class="$style.panel">
						<div :class="$style.panelHead"><h2>{{ t.activity }}</h2><small>UTC+8</small></div>
						<div :class="$style.filters"><button v-for="metric in metrics" :key="metric.field" :aria-pressed="field === metric.field" @click="field = metric.field">{{ metric.label }}</button></div>
						<strong :class="$style.number">{{ total(field) }}</strong>
						<div v-if="series.length" :class="$style.plotArea">
							<div :class="$style.axis"><small>{{ scale(field) }}</small><small>0</small></div>
							<svg :key="field + range" viewBox="0 0 700 160" preserveAspectRatio="none" role="img" :aria-label="currentMetric.label"><polyline :points="points(field, 700, 160)" :stroke="currentMetric.color"/><circle cx="697" :cy="pointY(series[series.length - 1][field], field, 160)" r="3" :fill="currentMetric.color"/></svg>
						</div><MkLoading v-else-if="!loadError"/>
						<div :class="$style.dates"><small v-for="day in series" :key="day.date">{{ day.date.slice(5) }}</small></div>
					</section>
					<section :class="$style.panel"><h2>{{ t.daily }}</h2><div :class="$style.tableWrap"><table><thead><tr><th>{{ t.day }}</th><th v-for="metric in metrics" :key="metric.field">{{ metric.label }}</th></tr></thead><tbody><tr v-for="day in series.slice().reverse()" :key="day.date"><td>{{ day.date }}</td><td v-for="metric in metrics" :key="metric.field">{{ day[metric.field].toLocaleString() }}</td></tr></tbody></table></div></section>
				</template>
				<section v-if="view === 'keys' && creating" :class="$style.panel">
					<h2>{{ t.create }}</h2><form :class="$style.form" @submit.prevent="createKey">
						<label>{{ t.name }}<input v-model="name" type="text" maxlength="128" required/></label>
						<label :class="$style.check"><input v-model="allowWrites" type="checkbox"/> {{ t.write }}</label>
						<div :class="$style.actions"><button :class="$style.primary" :disabled="busy || !name.trim()">{{ t.create }}</button><button type="button" @click="creating = false">{{ i18n.ts.cancel }}</button></div>
					</form>
				</section>
				<section v-if="view === 'keys' && issued" :class="$style.panel" aria-live="polite"><h2>{{ t.secret }}</h2><pre>{{ issued.key }}</pre><button @click="copyToClipboard(issued.key)">{{ i18n.ts.copy }}</button></section>
				<section v-if="view !== 'analytics'" :class="$style.panel"><div :class="$style.panelHead"><h2>{{ view === 'overview' ? t.recentKeys : t.keys }}</h2><button v-if="view === 'overview'" :class="$style.link" @click="navigate('keys')">{{ t.viewAll }} →</button></div>
					<MkLoading v-if="keys === null && !loadError"/>
					<div v-else-if="keys?.length" :class="$style.tableWrap"><table><thead><tr><th>{{ t.name }}</th><th>{{ i18n.ts.permission }}</th><th>{{ i18n.ts.lastUsedDate }}</th><th v-if="view === 'keys'"></th></tr></thead><tbody>
						<tr v-for="item in (view === 'overview' ? keys.slice(0, 4) : keys)" :key="item.id">
							<td><i class="ti ti-key"></i> {{ item.name }}</td><td><span :class="$style.tag">{{ item.permission.includes('write:notes') ? t.readWrite : t.readOnly }}</span></td>
							<td>{{ item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : t.neverUsed }}</td><td v-if="view === 'keys'"><button :disabled="busy" @click="revoke(item.id)">{{ t.revoke }}</button></td>
						</tr></tbody></table></div>
					<div v-else-if="keys" :class="$style.empty"><i class="ti ti-key"></i><strong>{{ t.empty }}</strong><small>{{ t.firstKey }}</small></div>
				</section>
			</template>
		</div>
	</main>
	<aside v-if="view === 'overview' && $i" :class="$style.resources"><h2>{{ t.connections }}</h2><button v-for="item in sections.slice(1)" :key="item.id" @click="navigate(item.id)"><i :class="item.icon"></i><span>{{ item.label }}<small>{{ item.id === 'analytics' ? t.usageHint : t.keyHint }}</small></span></button><a :href="guide" :class="$style.docLink"><i class="ti ti-book"></i><span>{{ t.docs }}<small>{{ t.docsHint }}</small></span></a><h2>{{ t.quotas }}</h2><dl :class="$style.quota"><dt>{{ t.requestQuota }}</dt><dd>60</dd><dt>{{ t.postQuota }}</dt><dd>{{ intervalSec == null ? '—' : i18n.tsx._agentPlatform.seconds({ n: intervalSec }) }}</dd></dl></aside>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { entities } from 'misskey-js';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { $i } from '@/i.js';
import { pleaseLogin } from '@/utility/please-login.js';
import XEmailVerificationBanner from '@/ui/_common_/email-verification-banner.vue';
const guide = 'https://docs.stellasora.cafe/trekker-camp/open-platform';

const name = ref('');
const allowWrites = ref(false);
const issued = ref<{ id: string; key: string } | null>(null);
const keys = ref<entities.IAppsResponse | null>(null);
const intervalSec = ref($i?.policies.agentPostIntervalSec);
const loadError = ref(false);
const busy = ref(false);
const t = i18n.ts._agentPlatform;
const sections = [
	{ id: 'overview', label: t.home, icon: 'ti ti-home' },
	{ id: 'analytics', label: t.analytics, icon: 'ti ti-chart-line' },
	{ id: 'keys', label: t.keyManager, icon: 'ti ti-key' },
] as const;
type Section = typeof sections[number]['id'];
const view = ref<Section>('overview');
const creating = ref(false);
const days = ref<entities.PlatformUsageResponse | null>(null);
const metrics = [
	{ field: 'requests', label: t.requests, color: '#6659dd' },
	{ field: 'posts', label: t.posts, color: '#009681' },
	{ field: 'limited', label: t.limited, color: '#df7136' },
] as const;
type Field = typeof metrics[number]['field'];
const periods = [{ size: 1, label: t.today }, { size: 7, label: t.week }];
const range = ref(7);
const field = ref<Field>('requests');
const currentMetric = computed(() => metrics.find(item => item.field === field.value)!);
const series = computed(() => days.value?.slice(-range.value) ?? []);
const title = computed(() => view.value === 'overview' ? t.workspace : sections.find(item => item.id === view.value)!.label);

function total(key: Field) {
	return days.value ? series.value.reduce((n, day) => n + day[key], 0).toLocaleString() : '—';
}

function scale(key: Field) {
	return Math.max(1, ...series.value.map(day => day[key]));
}

function pointY(value: number, key: Field, height: number) {
	return height - 4 - value / scale(key) * (height - 8);
}

function points(key: Field, width: number, height: number) {
	return series.value.map((day, index) => {
		const x = series.value.length === 1 ? width - 3 : 3 + index * (width - 6) / (series.value.length - 1);
		return x + ',' + pointY(day[key], key, height);
	}).join(' ');
}

function openMetric(key: Field) {
	field.value = key;
	navigate('analytics');
}

function syncView() {
	if (window.location.hash === '#docs') {
		window.location.replace(guide);
		return;
	}
	view.value = sections.find(item => '#' + item.id === window.location.hash)?.id ?? 'overview';
	issued.value = null;
	creating.value = false;
}

function navigate(section: Section) {
	if (view.value !== section) {
		window.history.pushState(null, '', '#' + section);
		syncView();
	}
}

function startCreate() {
	navigate('keys');
	creating.value = true;
}

async function load() {
	loadError.value = false;
	try {
		await Promise.all([
			misskeyApi('i/apps', { agentOnly: true, sort: '+createdAt' }).then(apps => { keys.value = apps; }),
			misskeyApi('i').then(account => { intervalSec.value = account.policies.agentPostIntervalSec; }),
			misskeyApi('platform/usage').then(usage => { days.value = usage; }),
		]);
	} catch {
		loadError.value = true;
	}
}

async function createKey() {
	if (busy.value) return;
	busy.value = true;
	try {
		issued.value = await os.apiWithDialog('platform/create-key', { name: name.value.trim(), allowWrites: allowWrites.value });
		name.value = '';
		creating.value = false;
		allowWrites.value = false;
		await load();
	} finally {
		busy.value = false;
	}
}

async function revoke(id: string) {
	if (busy.value || (await os.confirm({ type: 'warning', text: i18n.ts._agentPlatform.confirm })).canceled) return;
	busy.value = true;
	try {
		await os.apiWithDialog('i/revoke-token', { tokenId: id });
		if (issued.value?.id === id) issued.value = null;
		await load();
	} finally {
		busy.value = false;
	}
}

async function signup() {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkSignupDialog.vue').then(x => x.default), { autoSet: true }, {
		closed: () => dispose(),
	});
}

let timer: number | undefined;
onMounted(() => {
	syncView();
	window.addEventListener('popstate', syncView);
	if ($i) {
		void load();
		timer = window.setInterval(() => { if (!window.document.hidden && (view.value === 'overview' || view.value === 'analytics')) void load(); }, 60000);
	}
});
onUnmounted(() => {
	window.removeEventListener('popstate', syncView);
	window.clearInterval(timer);
});
definePage(() => ({ title: i18n.ts._agentPlatform.title, icon: 'ti ti-code' }));
</script>

<style lang="scss" module>
.console {
	--ink:  #171717; --muted: #636363; --accent: #222; --line: #e6e6e5;
	display: flex; height: 100dvh; overflow: hidden; background: white; color: var(--ink);
	font-family: "MiSans", "Segoe UI", sans-serif; font-size: 14px; color-scheme: light;
	*, *::before, *::after { box-sizing: border-box; }
	a { text-decoration: none; }
	:where(button, a.docLink) { cursor: pointer; color: inherit; background: white; border: 1px solid var(--line); border-radius: 7px; padding: 8px 12px; font: inherit; }
	:is(button, a):hover { background: #f4f4f3; }
	button:disabled { opacity: .55; cursor: default; }
	button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid #639fff; outline-offset: 3px; }
	small, p { color: var(--muted); }
	h1, h2, p, dl { margin: 0; }
	h1 { font-size: clamp(26px,3vw,36px); letter-spacing: -.04em; }
	h2 { font-size: 17px; }
	.primary { display: inline-flex; align-items: center; gap: 6px; background: var(--accent); border-color: var(--accent); color: white; font-weight: 600; }
	.primary:hover { background: #383838; }
}
.rail {
	background: #f5f5f4; border-right: 1px solid var(--line); width: clamp(182px, 15vw, 250px); flex: none; padding: 22px 10px 15px; display: flex; flex-direction: column;
	nav { display: grid; gap: 3px; margin: 34px 0; }
	nav :is(button, a) { text-align: left; background: transparent; border: 0; padding: 10px 12px; }
	nav :is(button, a):hover, nav :is(button, a)[aria-current] { background: #e8e8e7; }
	i { font-size: 17px; margin-right: 10px; }
}
.brand { display: flex; align-items: center; padding: 0 8px; font-size: 16px; white-space: nowrap; }
.account { display: flex; align-items: center; gap: 10px; margin: auto 8px 14px; b { display: grid; place-items: center; background: #222; color: white; width: 30px; height: 30px; border-radius: 50%; } small { display: block; } }
.return { margin-top: auto; padding: 12px 8px 0; border-top: 1px solid var(--line); font-size: 13px; }
.account + .return { margin-top: 0; }
.main { flex: 1; min-width: 0; overflow-y: auto; scrollbar-gutter: stable; }
.content { max-width: 1100px; margin: 0 auto; padding: clamp(30px,4vw,64px) clamp(20px,4vw,72px); display: grid; gap: 24px; }
.heading, .panelHead, .actions { display: flex; align-items: center; gap: 12px; }
.guest {
	width: min(100%, 440px);
	margin: clamp(12px, 8vh, 90px) auto;
	padding: clamp(24px, 4vw, 40px);
	border: 1px solid var(--line);
	border-radius: 16px;
	h1 { margin: 20px 0 8px; font-size: 26px; line-height: 1.35; }
	p { line-height: 1.7; }
	.guestIcon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: #f1f1ef; font-size: 22px; }
	.login { width: 100%; min-height: 44px; justify-content: center; margin-top: 24px; }
}
.registerRow {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	column-gap: 6px;
	margin-top: 16px;
	border-top: 1px solid var(--line);
	padding-top: 8px;
	color: var(--muted);
	button { min-height: 44px; padding-inline: 5px; color: var(--ink); border: 0; background: transparent; font-weight: 600; }
	button:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
}
.heading, .panelHead { justify-content: space-between; }
.segment, .filters { display: flex; flex-wrap: wrap; gap: 2px; padding: 3px; background: #f1f1f0; border-radius: 20px; width: fit-content; button { background: transparent; border: none; border-radius: inherit; padding: 5px 12px; font-size: 13px; } button[aria-pressed=true] { background: white; box-shadow: 0 1px 4px #0002; } }
.hero a { display: inline-block; }
.hero { isolation: isolate; position: relative; overflow: hidden; border-radius: 14px; color: white; background: radial-gradient(ellipse at 84% 75%, #1b3450, transparent 51%), linear-gradient(115deg,#080b11,#0c1526); padding: clamp(25px,3vw,46px); div { max-width: 62%; } h2 { font-size: clamp(20px,2vw,28px); } p { color: #d0d7e0; line-height: 1.65; margin: 8px 0 18px; } :is(button, a) { color: #171717; } }
.hero::before, .hero::after { content: ''; position: absolute; z-index: -1; pointer-events: none; }
.hero::before { width: 55%; height: 115%; right: -12%; top: -28%; transform: rotate(-25deg); border: 1px solid #d5bd8b9c; border-radius: 50%; box-shadow: 0 2px 14px #f8da9d40, 0 10px 0 -9px #95abc9, 0 24px 0 -23px #97a7cd, 0 38px 0 -37px #647a96; }
.hero::after { width: 26px; height: 26px; top: 27%; right: 14%; border-radius: 50%; background: #fff2d3; box-shadow: 0 0 18px #ffd699, 0 0 48px #eab57c, -64px 52px 0 -12px white, 82px 47px 0 -12px white, -32px -20px 0 -12px white, -102px -9px 0 -12px white; }
.cards, .tiles { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); }
.cards { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; margin: 8px 0; }
.console .stat { display: grid; gap: 8px; text-align: left; padding: 18px; border: none; border-radius: 0; border-right: 1px solid var(--line); strong { font-size: 26px; } svg { width: 100%; height: 38px; margin-top: 10px; } &:last-child { border-right: 0; } }
.stat polyline, .plotArea polyline { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; }
.tiles { grid-template-columns: 1fr 1fr; gap: 12px; :is(button, a) { display: grid; justify-items: start; gap: 6px; padding: 16px; text-align: left; border-style: dashed; } i { background: #b4eac8; border-radius: 6px; margin-bottom: 8px; } :is(button, a):nth-child(2) i { background: #dee7ff; } }
.resources { width: clamp(210px,18vw,300px); padding: 32px 20px; overflow: auto; border-left: 1px solid var(--line); h2 { margin-bottom: 14px; } h2:not(:first-child) { margin-top: 36px; } :is(button, a) { width: 100%; padding: 9px 0; border: 0; text-align: left; display: flex; gap: 10px; align-items: center; } i { border-radius: 8px; background: #eef0f9; } small { display: block; margin-top: 3px; } }
.panel { min-width: 0; padding: 22px; border: 1px solid var(--line); border-radius: 12px; p { margin: 14px 0; } pre { background: #f6f6f5; padding: 16px; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; } a { text-decoration: underline; } }
.filters { margin: 20px 0 12px; }
.number { font-size: 28px; }
.plotArea { display: flex; gap: 12px; margin: 20px 0 8px; svg { width: 100%; height: 180px; background: repeating-linear-gradient(to top,#eee 0 1px,transparent 1px 25%); } }
.axis { display: flex; flex-direction: column; justify-content: space-between; }
.dates { display: flex; justify-content: space-between; padding-left: 22px; small:only-child { margin-left: auto; } }
.quota { display: grid; gap: 4px; margin-top: 18px !important; dt { color: var(--muted); font-size: 13px; } dd { margin: 0 0 10px; font-size: 23px; font-weight: 600; } }
.tableWrap { overflow-x: auto; table { font-size: 13px; width: 100%; margin-top: 14px; border-collapse: collapse; } th,td { padding: 12px 8px; text-align: left; border-bottom: 1px solid var(--line); } th { background: #f6f8fb; color: var(--muted); } td:first-child { font-weight: 600; overflow-wrap: anywhere; } }
.tag { display: inline-block; border-radius: 5px; background: #eaf1fc; color: #295486; padding: 3px 8px; white-space: nowrap; }
.console .link { color: var(--accent); border: none; }
.empty { display: grid; justify-items: center; gap: 6px; padding: 22px 0 8px; i { font-size: 24px; color: var(--accent); } }
.form { display: grid; gap: 15px; margin-top: 16px; label { display: grid; gap: 7px; } input[type=text] { max-width: 420px; padding: 10px; border: 1px solid #adbacb; border-radius: 6px; font: inherit; background: white; color: var(--ink); } .check { display: flex; align-items: center; } }
.resources :is(button, a) i, .tiles :is(button, a) i {
	display: inline-grid;
	place-items: center;
	flex: none;
	width: 34px;
	height: 34px;
	font-size: 18px;
	line-height: 1;
}
.segment {
	position: relative;
	isolation: isolate;
	flex-wrap: nowrap;
	gap: 0;
	button { flex: 1 0 64px; white-space: nowrap; }
	button[aria-pressed=true] { background: transparent; box-shadow: none; }
	&::before { content: ''; position: absolute; z-index: -1; inset: 3px auto 3px 3px; width: calc((100% - 6px) / 2); border-radius: inherit; background: white; box-shadow: 0 1px 4px #0002; }
	&[data-week=true]::before { transform: translateX(100%); }
	width: 134px;
}
.plotArea svg { min-width: 0; }
.console .stat svg { display: block; overflow: visible; }
@keyframes enterPanel {
	from { opacity: 0; transform: translateY(8px); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes revealPlot {
	from { clip-path: inset(-4px 100% -4px -4px); }
	to { clip-path: inset(-4px); }
}
@media (prefers-reduced-motion: no-preference) {
	.motion {
		.content > *, .resources { animation: enterPanel 240ms ease-out backwards; }
		.content > :nth-child(2) { animation-delay: 30ms; }
		.content > :nth-child(n+3) { animation-delay: 60ms; }
		.stat svg, .plotArea svg { animation: revealPlot 520ms cubic-bezier(.22,.68,.15,1) backwards; }
		.segment::before { transition: transform 200ms cubic-bezier(.2,.75,.2,1); }
		button { transition: background-color 150ms ease, box-shadow 150ms ease; }
		.tiles :is(button, a) i { transition: transform 160ms ease; }
		.tiles :is(button, a):hover i, .tiles :is(button, a):focus-visible i { transform: translateY(-2px); }
	}
}
@media (max-width: 980px) {
	.console { flex-wrap: wrap; overflow-y: auto; display: grid; grid-template-columns: 180px minmax(0,1fr); align-content: start; }
	.rail { width: 100%; position: sticky; top: 0; height: 100dvh; grid-row: 1 / span 2; }
	.main { overflow: visible; scrollbar-gutter: auto; }
	.resources { width: auto; grid-column: 2; margin: 0 20px; border: 0; border-top: 1px solid var(--line); }
}
@media (max-width: 680px) {
	.console { display: block; }
	.rail { position: static; height: auto; padding: 12px; display: grid; grid-template-columns: 1fr auto; gap: 10px; nav { grid-column: 1/-1; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 2px; margin: 0; } nav :is(button, a) { display: grid; justify-items: center; gap: 5px; padding: 6px 0; font-size: 12px; white-space: nowrap; } nav :is(button, a) i { margin: 0; } i { margin-right: 5px; } }
	.account { display: none; } .return { grid-row: 1; grid-column: 2; margin: 0; padding: 0; border: 0; }
	.content { padding: 22px 14px; gap: 16px; } .panel { padding: 15px; } .console .stat { padding: 12px 8px; font-size: 12px; } .hero div { max-width: 78%; } .resources { margin: 0 14px; }
}
</style>
