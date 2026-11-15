/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'apps/misskey/built/desktop-frontend-staging');
const destination = path.join(root, 'apps/misskey/built/_desktop_frontend_');
const files = {};
async function collect(directory, prefix = '') {
	for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
		const name = prefix + entry.name;
		if (entry.isSymbolicLink() || name === 'client-assets/camp') throw new Error(`Forbidden desktop asset: ${name}`);
		if (entry.isDirectory()) await collect(path.join(directory, entry.name), name + '/');
		else files[name] = [new Uint8Array(await fs.readFile(path.join(directory, entry.name))), { mtime: new Date('1980-01-01T00:00:00Z') }];
	}
}
await collect(source);
const archive = zipSync(files, { level: 6 });
const revision = createHash('sha256').update(archive).digest('hex');
const bundle = JSON.parse(await fs.readFile(path.join(source, 'bundle.json'), 'utf8'));
await fs.mkdir(destination, { recursive: true });
await fs.writeFile(path.join(destination, revision + '.zip'), archive);
const manifest = { revision, sha256: revision, size: archive.length, hostApi: 2, version: bundle.version, archive: `/_desktop/frontend/${revision}.zip` };
await fs.writeFile(path.join(destination, 'manifest.json.tmp'), JSON.stringify(manifest));
await fs.rename(path.join(destination, 'manifest.json.tmp'), path.join(destination, 'manifest.json'));
console.log(`Desktop frontend published: ${revision}, ${(archive.length / 1048576).toFixed(2)} MiB`);
