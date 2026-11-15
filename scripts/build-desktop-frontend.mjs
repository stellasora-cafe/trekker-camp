/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = path.join(root, 'apps/misskey/packages/frontend');

async function run(command, args, cwd = root) {
	await execa(command, args, { cwd, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
}

// Build the server's desktop frontend independently of the native installer.
if (!process.argv.includes('--publish-only')) await run('pnpm', ['--filter', 'frontend...', '--filter', '!frontend', '-r', 'build']);
await run('pnpm', ['exec', 'tsx', path.join(root, 'scripts/build-desktop-frontend.mts')], frontend);
await run('node', ['scripts/publish-desktop-frontend.mjs']);
