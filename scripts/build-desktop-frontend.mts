/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile } from '../apps/misskey/packages/frontend/node_modules/vite/dist/node/index.js';
import { LocaleInliner } from '../apps/misskey/packages/frontend-builder/locale-inliner.js';
import { createLogger } from '../apps/misskey/packages/frontend-builder/logger.js';
import locales from '../apps/misskey/packages/i18n/built/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = path.join(root, 'apps/misskey/packages/frontend');
const output = path.join(root, 'apps/misskey/built/desktop-frontend-staging');
const viteOutput = path.join(output, 'vite');
const meta = JSON.parse(await fs.readFile(path.join(root, 'apps/misskey/package.json'), 'utf8'));

// This output is generated inside the server build directory.
if (!output.startsWith(path.join(root, 'apps/misskey/built') + path.sep)) throw new Error('Invalid frontend output path');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(frontend, 'vite.config.ts'), frontend);
if (!loaded) throw new Error('Frontend Vite configuration not found');
const config = loaded.config;
const rolldown = config.build!.rolldownOptions!;
const configuredOutput = rolldown.output;
if (Array.isArray(configuredOutput)) throw new Error('Expected one frontend output');

await build({
	...config,
	configFile: false,
	root: frontend,
	mode: 'production',
	build: {
		...config.build,
		outDir: viteOutput,
		emptyOutDir: true,
		rolldownOptions: {
			...rolldown,
			// Syntax highlighting definitions must work without the CDN too.
			external: [],
			output: { ...configuredOutput, paths: undefined },
		},
	},
});

const logger = createLogger();
const inliner = await LocaleInliner.create({ outputDir: viteOutput, logger, scriptsDir: 'scripts', i18nFile: 'src/i18n.ts' });
await inliner.loadFiles();
inliner.collectsModifications();
await inliner.saveAllLocales(locales);
if (logger.errorCount > 0) throw new Error('Desktop localization failed');

async function copyPublic(source: string, destination: string) {
	await fs.mkdir(destination, { recursive: true });
	for (const item of await fs.readdir(source, { withFileTypes: true })) {
		// The camp junction is privately licensed runtime artwork and fonts.
		if (item.name === 'camp' || item.isSymbolicLink()) continue;
		const from = path.join(source, item.name);
		const to = path.join(destination, item.name);
		if (item.isDirectory()) await copyPublic(from, to);
		else if (item.isFile()) await fs.copyFile(from, to);
	}
}

await copyPublic(path.join(frontend, 'assets'), path.join(output, 'client-assets'));
await copyPublic(path.join(root, 'apps/misskey/packages/backend/assets'), path.join(output, 'static-assets'));
await fs.copyFile(path.join(output, 'client-assets/trekker-camp/branding/favicon-v1.ico'), path.join(output, 'favicon.ico'));
await fs.copyFile(path.join(output, 'client-assets/trekker-camp/branding/apple-touch-icon-v1.png'), path.join(output, 'apple-touch-icon.png'));
await fs.mkdir(path.join(output, 'assets/locales'), { recursive: true });
for (const [lang, locale] of Object.entries(locales)) {
	await fs.writeFile(path.join(output, `assets/locales/${lang}.${meta.version}.json`), JSON.stringify({ ...locale, _version_: meta.version }));
}

const manifest = JSON.parse(await fs.readFile(path.join(viteOutput, 'manifest.json'), 'utf8'));
const styles = new Set<string>();
const visited = new Set<string>();
function collectStyles(key: string) {
	if (visited.has(key)) return;
	visited.add(key);
	const chunk = manifest[key];
	if (!chunk) throw new Error(`Missing manifest chunk: ${key}`);
	for (const css of chunk.css ?? []) styles.add(css);
	for (const imported of chunk.imports ?? []) collectStyles(imported);
}
collectStyles('src/_boot_.ts');
await fs.writeFile(path.join(output, 'bundle.json'), JSON.stringify({
	version: meta.version,
	entry: manifest['src/_boot_.ts'].file,
	css: [...styles],
	langs: Object.keys(locales),
}, null, 2));
