/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

type CredentialCodec = {
	seal: (value: string) => string;
	open: (value: string) => string;
	isSealed: (value: unknown) => boolean;
};

// The native host holds the encryption key in the OS credential store. Web and
// PWA retain their existing storage; the bridge is supplied only by the host.
export function desktopCredentialCodec(key: string): CredentialCodec | undefined {
	if (!key.startsWith('pizzax::')) return undefined;
	return (window as Window & { __campCredentialStorage?: CredentialCodec }).__campCredentialStorage;
}
