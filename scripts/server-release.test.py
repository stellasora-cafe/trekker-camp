# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('release_builder', ROOT / 'scripts/build-server-release.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
TAG = 'server-v2026.11.0'
WEB = 'ghcr.io/stellasora-cafe/trekker-camp@sha256:' + 'a' * 64
CADDY = 'ghcr.io/stellasora-cafe/trekker-camp-caddy@sha256:' + 'b' * 64


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='camp-release-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = builder.build(ROOT, self.root, TAG, 'c' * 40, WEB, CADDY)
        self.metadata = self.root / 'metadata.json'
        self.metadata.write_text(json.dumps([
            {'tag_name': 'desktop-v9.0.0', 'assets': []},
            {'tag_name': TAG, 'draft': False, 'prerelease': False, 'assets': [{'name': self.bundle.name}]},
        ]))

    def shell(self, code, success=True):
        env = {**os.environ, 'SCRIPT': str(ROOT / 'scripts/deploy.sh'), 'TEST_ROOT': str(self.root),
               'METADATA': str(self.metadata), 'ARCHIVE': str(self.bundle)}
        body = '''set -Eeuo pipefail
source "$SCRIPT"
curl() {
  local url output
  while (($#)); do
    case "$1" in
      https://*) url=$1; shift ;;
      -o) output=$2; shift 2 ;;
      *) shift ;;
    esac
  done
  printf '%s\\n' "$url" >> "$TEST_ROOT/requested-urls"
  if [[ $url == https://api.github.com/* ]]; then cp "$METADATA" "$output";
  else cp "$ARCHIVE" "$output"; fi
}
''' + code
        result = subprocess.run(['bash', '-c', body], env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def test_bundle_is_allowlist_only_without_source_or_private_resources(self):
        checkout = self.root / 'checkout'
        for name in builder.FILES:
            path = checkout / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((ROOT / name).read_bytes())
        for name in ('AGENTS.md', '.git/config', '.config/default.yml',
                     'apps/desktop/client.exe', 'apps/update-service/wrangler.jsonc',
                     'apps/misskey/packages/backend/test/fixture.ts',
                     'private-assets/public/font.woff2', 'node_modules/package/index.js'):
            path = checkout / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('not a deployment file')
        bundle = builder.build(checkout, self.root / 'output', TAG, 'c' * 40, WEB, CADDY)
        with tarfile.open(bundle) as archive:
            names = archive.getnames()
            self.assertEqual(set(names), set(builder.FILES) | {'RELEASE.json', 'compose.release.yml'})
            self.assertFalse(any(name.startswith(('apps/', 'node_modules/', '.git/', 'private-assets/'))
                                 or 'AGENTS' in name or name == '.config/default.yml'
                                 or name.endswith(('.png', '.woff2')) for name in names))
            release = json.load(archive.extractfile('RELEASE.json'))
            self.assertEqual(release['web'], WEB)

    def test_download_selects_server_release_and_preserves_existing_data(self):
        destination = self.root / 'app'
        (destination / '.config').mkdir(parents=True)
        (destination / '.config/default.yml').write_text('existing configuration')
        self.shell('download_release "$TEST_ROOT/app"')
        self.assertEqual((destination / '.config/default.yml').read_text(), 'existing configuration')
        self.assertTrue((destination / 'scripts/deploy.sh').is_file())
        self.assertFalse((destination / '.git').exists())
        self.assertEqual((self.root / 'requested-urls').read_text().splitlines(), [
            'https://api.github.com/repos/stellasora-cafe/trekker-camp/releases?per_page=100',
            f'https://github.com/stellasora-cafe/trekker-camp/releases/download/{TAG}/camp-server-{TAG}.tar.gz',
        ])

    def test_invalid_members_rejected_before_any_write(self):
        with tarfile.open(self.bundle, 'r:gz') as archive:
            files = {m.name: archive.extractfile(m).read() for m in archive.getmembers()}
        for bad in ('../escape', 'AGENTS.md', 'apps/desktop/client.exe', 'apps/update-service/wrangler.jsonc', 'private-assets/public/font.woff2'):
            with self.subTest(bad=bad):
                with tarfile.open(self.bundle, 'w:gz') as archive:
                    for name, data in {**files, bad: b'no'}.items():
                        member = tarfile.TarInfo(name)
                        member.size = len(data)
                        archive.addfile(member, io.BytesIO(data))
                self.shell('download_release "$TEST_ROOT/rejected"', success=False)
                self.assertFalse((self.root / 'rejected/RELEASE.json').exists())

    def test_draft_and_prerelease_are_not_automatic_updates(self):
        for field in ('draft', 'prerelease'):
            payload = json.loads(self.metadata.read_text())
            payload[1]['draft'] = field == 'draft'
            payload[1]['prerelease'] = field == 'prerelease'
            self.metadata.write_text(json.dumps(payload))
            self.shell('download_release "$TEST_ROOT/rejected"', success=False)

    def test_prepare_keeps_old_release_pointer_until_deployment_succeeds(self):
        self.shell('''
camp_dir="$TEST_ROOT/app"
mkdir -p "$camp_dir/.config"
printf 'old-release' > "$camp_dir/.config/server-release"
prepare_release
[[ $(< "$camp_dir/.config/server-release") == old-release ]]
[[ -f $release_source/RELEASE.json ]]
''')

    def test_compose_uses_release_images_without_building(self):
        self.shell('''
camp_dir="$TEST_ROOT/app"
mkdir -p "$camp_dir"
resolve_storage
prepare_release
docker() { printf '%s\\n' "$*" > "$TEST_ROOT/compose-command"; }
compose config --quiet
grep -F -- "$release_source/compose.release.yml" "$TEST_ROOT/compose-command"
grep -F -- "$release_source/compose.assets.yml" "$TEST_ROOT/compose-command"
''')

    def test_packaging_requires_immutable_official_images(self):
        for web in (WEB.replace('@sha256:' + 'a' * 64, ':latest'), WEB.replace('stellasora-cafe', 'other')):
            with self.assertRaises(ValueError):
                builder.build(ROOT, self.root, TAG, 'c' * 40, web, CADDY)


if __name__ == '__main__':
    unittest.main()
