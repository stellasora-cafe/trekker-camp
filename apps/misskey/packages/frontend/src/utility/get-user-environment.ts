/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type UserEnvironment = {
	os: string;
	browser: string;
	userAgent: string;
	screenWidth: number;
	screenHeight: number;
	viaGetHighEntropyValues: true;
} | {
	userAgent: string;
	screenWidth: number;
	screenHeight: number;
	viaGetHighEntropyValues: false;
};

type ClientNavigator = Pick<Navigator, 'userAgent' | 'platform'> & {
	userAgentData?: { platform?: string };
};

export function getWebDeviceHeaders(environment: ClientNavigator = navigator): Record<string, string> {
	const ua = environment.userAgent;
	const platform = environment.userAgentData?.platform ||
		(/Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Macintosh|Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : environment.platform || 'Unknown');
	const browser = /Edg(?:e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Web browser';
	return {
		'X-Camp-Device-Name': encodeURIComponent(`${browser} (${platform})`),
		'X-Camp-Device-Platform': platform.replace(/[^\x20-\x7e]/g, '').slice(0, 100) || 'Unknown',
	};
}

export async function getUserEnvironment(): Promise<UserEnvironment> {
	if ('userAgentData' in navigator && navigator.userAgentData != null) {
		try {
			const uaData: any = await navigator.userAgentData.getHighEntropyValues([
				'fullVersionList',
				'platformVersion',
			]);

			let osVersion = 'v' + uaData.platformVersion;

			if (uaData.platform === 'Windows' && uaData.platformVersion != null) {
				// https://learn.microsoft.com/ja-jp/microsoft-edge/web-platform/how-to-detect-win11
				const majorPlatformVersion = parseInt(uaData.platformVersion.split('.')[0]);
				if (majorPlatformVersion >= 13) {
					osVersion = '11 or later';
				} else if (majorPlatformVersion > 0) {
					osVersion = '10';
				} else {
					osVersion = '8.1 or earlier';
				}
			}

			const browserData = uaData.fullVersionList.find((item: any) => !/^\s*not.+a.+brand\s*$/i.test(item.brand));
			return {
				os: `${uaData.platform} ${osVersion}`,
				browser: browserData ? `${browserData.brand} v${browserData.version}` : 'Unknown',
				userAgent: navigator.userAgent,
				screenWidth: window.innerWidth,
				screenHeight: window.innerHeight,
				viaGetHighEntropyValues: true,
			};
		} catch {
			return getViaUa();
		}
	} else {
		return getViaUa();
	}
}

function getViaUa(): UserEnvironment {
	return {
		userAgent: navigator.userAgent,
		screenWidth: window.innerWidth,
		screenHeight: window.innerHeight,
		viaGetHighEntropyValues: false,
	};
}
