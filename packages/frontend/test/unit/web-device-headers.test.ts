/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { getWebDeviceHeaders } from '@/utility/get-user-environment.js';

describe('web device session headers', () => {
	test('records a named browser and platform when client hints are available', () => {
		const headers = getWebDeviceHeaders({ platform: 'Win32', userAgent: 'Mozilla/5.0 Chrome/140.0 Safari/537.36 Edg/140.0', userAgentData: { platform: 'Windows' } });
		expect(headers['X-Camp-Device-Platform']).toBe('Windows');
		expect(decodeURIComponent(headers['X-Camp-Device-Name'])).toBe('Edge (Windows)');
	});

	test('supports Safari without Chromium client hints', () => {
		const headers = getWebDeviceHeaders({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1 Version/17.0 Safari/605.1' });
		expect(headers['X-Camp-Device-Platform']).toBe('macOS');
		expect(decodeURIComponent(headers['X-Camp-Device-Name'])).toBe('Safari (macOS)');
	});

	test('always supplies a nonempty platform with header-safe values', () => {
		const headers = getWebDeviceHeaders({ platform: '', userAgent: '' });
		expect(headers['X-Camp-Device-Platform']).toBe('Unknown');
	});
});
