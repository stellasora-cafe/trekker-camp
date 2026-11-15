/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { common } from './common.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import UiMinimum from '@/ui/minimum.vue';

export async function subBoot() {
	await common(async () => UiMinimum);

	emojiPicker.init();
}
