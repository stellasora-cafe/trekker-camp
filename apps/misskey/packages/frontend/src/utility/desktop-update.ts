/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

type RestartEditor = { root: HTMLElement; key: () => string; save: () => boolean };
const editors = new Set<RestartEditor>();

declare global {
	interface Window {
		__campPreparePackageRestart?: () => Promise<boolean>;
	}
}

export function registerDesktopRestartEditor(editor: RestartEditor): () => void {
	editors.add(editor);
	return () => editors.delete(editor);
}

/** Flush recoverable local drafts; unfamiliar editors keep the app open. */
export async function prepareDesktopPackageRestart(): Promise<boolean> {
	if (window.document.documentElement.dataset.campDesktop !== 'true' || !window.document.getElementById('misskey_app')?.childElementCount) return false;
	const active = [...editors].filter(editor => editor.root.isConnected);
	const owned = (element: Element) => active.some(editor => editor.root.contains(element));
	if ([...window.document.querySelectorAll('dialog[open], [role="dialog"]')].some(dialog => !active.some(editor => dialog.contains(editor.root)))) return false;
	for (const element of window.document.querySelectorAll('input, textarea, select, [contenteditable="true"], [data-camp-pending-edit="true"]')) {
		if (owned(element)) continue;
		if (element.hasAttribute('data-camp-pending-edit')) return false;
		if (element instanceof HTMLInputElement) {
			if (element.files?.length || element.value !== element.defaultValue || element.checked !== element.defaultChecked) return false;
		} else if (element instanceof HTMLTextAreaElement) {
			if (element.value.trim()) return false;
		} else if (element instanceof HTMLSelectElement) {
			if ([...element.options].some(option => option.selected !== option.defaultSelected)) return false;
		} else if (element.textContent?.trim()) return false;
	}
	const keys = active.map(editor => editor.key());
	// Two composers for the same destination otherwise overwrite one draft slot.
	if (new Set(keys).size !== keys.length) return false;
	try {
		return active.every(editor => editor.save());
	} catch {
		return false;
	}
}

if (typeof window !== 'undefined') window.__campPreparePackageRestart = prepareDesktopPackageRestart;
