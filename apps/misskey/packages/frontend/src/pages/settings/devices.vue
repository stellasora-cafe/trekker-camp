<!--
SPDX-FileCopyrightText: trekker-camp contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<MkInfo>{{ i18n.ts._clientSessions.description }}</MkInfo>
	<MkLoading v-if="loading"/>
	<MkError v-else-if="failed" @retry="load"/>
	<MkResult v-else-if="sessions.length === 0" type="empty"/>
	<MkFolder v-for="session in sessions" :key="session.id" :defaultOpen="true">
		<template #icon><i :class="session.kind === 'desktop' ? 'ti ti-device-desktop' : 'ti ti-browser'"></i></template>
		<template #label>{{ session.name }}</template>
		<template #caption>{{ session.kind === 'desktop' ? i18n.ts._clientSessions.desktop : i18n.ts._clientSessions.web }}</template>
		<template v-if="session.isCurrent" #suffix>{{ i18n.ts._clientSessions.current }}</template>
		<div class="_gaps_s">
			<MkKeyValue v-if="session.platform" oneline>
				<template #key>{{ i18n.ts._clientSessions.platform }}</template>
				<template #value>{{ session.platform }}</template>
			</MkKeyValue>
			<MkKeyValue oneline>
				<template #key>{{ i18n.ts._clientSessions.createdAt }}</template>
				<template #value><MkTime :time="session.createdAt" mode="detail"/></template>
			</MkKeyValue>
			<MkKeyValue oneline>
				<template #key>{{ i18n.ts._clientSessions.lastActiveAt }}</template>
				<template #value><MkTime :time="session.lastActiveAt" mode="detail"/></template>
			</MkKeyValue>
			<MkKeyValue v-if="session.ip" oneline>
				<template #key>{{ i18n.ts._clientSessions.address }}</template>
				<template #value>{{ session.ip }}</template>
			</MkKeyValue>
		</div>
		<template #footer>
			<MkButton danger :disabled="revoking !== null" @click="revoke(session)"><i class="ti ti-logout"></i> {{ i18n.ts._clientSessions.revoke }}</MkButton>
		</template>
	</MkFolder>
</div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useStream } from '@/stream.js';
import { signout } from '@/signout.js';
import * as os from '@/os.js';

type ClientSession = {
	id: string;
	kind: 'web' | 'desktop';
	name: string;
	platform: string;
	createdAt: string;
	lastActiveAt: string;
	ip: string;
	isCurrent: boolean;
};

const sessions = ref<ClientSession[]>([]);
const loading = ref(true);
const failed = ref(false);
const revoking = ref<string | null>(null);

async function load() {
	try {
		sessions.value = await misskeyApi<ClientSession[]>('i/client-sessions');
		failed.value = false;
	} catch {
		failed.value = sessions.value.length === 0;
	} finally {
		loading.value = false;
	}
}

async function revoke(session: ClientSession) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._clientSessions.revokeConfirm({ name: session.name }),
	});
	if (canceled) return;
	revoking.value = session.id;
	try {
		await misskeyApi('i/revoke-client-session', { sessionId: session.id });
		if (session.isCurrent) {
			await signout({ revoked: true });
		} else {
			sessions.value = sessions.value.filter(item => item.id !== session.id);
		}
	} catch {
		void os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	} finally {
		revoking.value = null;
	}
}

onMounted(() => {
	void load();
	useStream().on('_reconnected_', load);
});
onUnmounted(() => useStream().off('_reconnected_', load));

definePage(() => ({ title: i18n.ts._clientSessions.title, icon: 'ti ti-devices' }));
</script>
