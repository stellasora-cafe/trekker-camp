// SPDX-FileCopyrightText: trekker-camp contributors
// SPDX-License-Identifier: Apache-2.0

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../misskey/packages/frontend/package.json', import.meta.url));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
const source = readFileSync(new URL('../internal/webclient/package_update.go', import.meta.url), 'utf8');
const script = source.match(/const packageRestartSafeScript = `([\s\S]*?)`/)[1];

test('package restart permits empty inline composer and protects drafts, uploads and dialogs', () => {
	const window = new Window();
	const document = window.document;
	document.body.innerHTML = '<main id="misskey_app"><form><textarea></textarea><input type="file" hidden></form></main>';
	const safe = () => window.eval(script);
	assert.equal(safe(), true);
	document.querySelector('textarea').value = 'unsent draft';
	assert.equal(safe(), false);
	document.querySelector('textarea').value = '';
	document.querySelector('form').dataset.campPendingEdit = 'true';
	assert.equal(safe(), false);
	delete document.querySelector('form').dataset.campPendingEdit;
	const dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	document.body.append(dialog);
	assert.equal(safe(), false);
	dialog.remove();
	const transfer = new window.DataTransfer();
	transfer.items.add(new window.File(['pending'], 'upload.txt'));
	document.querySelector('input').files = transfer.files;
	assert.equal(safe(), false);
	document.getElementById('misskey_app').remove();
	assert.equal(safe(), false);
	window.close();
});
