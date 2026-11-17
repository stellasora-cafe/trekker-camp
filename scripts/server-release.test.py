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
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('release_builder', ROOT / 'scripts/build-server-release.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
RUN_ID = 12345
COMMIT = 'c' * 40
WEB = 'ghcr.io/stellasora-cafe/trekker-camp@sha256:' + 'a' * 64
CADDY = 'ghcr.io/stellasora-cafe/trekker-camp-caddy@sha256:' + 'b' * 64


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='camp-release-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = builder.build(ROOT, self.root, RUN_ID, COMMIT, WEB, CADDY)
        self.metadata = self.root / 'metadata.json'
        self.run = {'id': RUN_ID, 'run_number': 10, 'head_sha': COMMIT, 'head_branch': 'master',
                    'event': 'push', 'status': 'completed', 'conclusion': 'success',
                    'path': '.github/workflows/server-release.yml',
                    'head_repository': {'full_name': 'stellasora-cafe/trekker-camp'}}
        self.metadata.write_text(json.dumps({'workflow_runs': [self.run]}))
        self.artifacts = self.root / 'artifacts.json'
        self.artifacts.write_text(json.dumps({'artifacts': [{'id': 56789, 'name': 'camp-server', 'expired': False}]}))

    def shell(self, code, success=True):
        archive = self.root / 'artifact.zip'
        with zipfile.ZipFile(archive, 'w') as outer:
            outer.write(self.bundle, 'camp-server.tar.gz')
        env = {**os.environ, 'SCRIPT': str(ROOT / 'scripts/deploy.sh'), 'TEST_ROOT': str(self.root),
               'METADATA': str(self.metadata), 'ARTIFACTS': str(self.artifacts), 'ARCHIVE': str(archive)}
        body = '''set -Eeuo pipefail
source "$SCRIPT"
github_token=github_pat_fixture
config_dir="$TEST_ROOT/config"
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
  case "$url" in
    */zip) cp "$ARCHIVE" "$output" ;;
    *'/runs/54321/artifacts?'*) printf '{"artifacts":[{"id":1,"name":"camp-server","expired":true}]}' > "$output" ;;
    *'/artifacts?'*) cp "$ARTIFACTS" "$output" ;;
    *) cp "$METADATA" "$output" ;;
  esac
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
                     'packages/backend/test/fixture.ts',
                     'private-assets/public/font.woff2', 'node_modules/package/index.js'):
            path = checkout / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('not a deployment file')
        bundle = builder.build(checkout, self.root / 'output', RUN_ID, COMMIT, WEB, CADDY)
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
            'https://api.github.com/repos/stellasora-cafe/trekker-camp/actions/workflows/server-release.yml/runs?branch=master&status=success&per_page=100',
            f'https://api.github.com/repos/stellasora-cafe/trekker-camp/actions/runs/{RUN_ID}/artifacts?name=camp-server&per_page=100',
            'https://api.github.com/repos/stellasora-cafe/trekker-camp/actions/artifacts/56789/zip',
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

    def test_only_completed_successful_master_server_builds_are_eligible(self):
        for field, value in [('status', 'in_progress'), ('conclusion', 'failure'),
                             ('head_branch', 'topic'), ('event', 'pull_request'),
                             ('path', '.github/workflows/desktop-release.yml'),
                             ('head_repository', {'full_name': 'another/fork'})]:
            with self.subTest(field=field):
                self.metadata.write_text(json.dumps({'workflow_runs': [{**self.run, field: value}]}))
                self.shell('download_release "$TEST_ROOT/rejected"', success=False)

    def test_latest_successful_run_selected_even_if_older_run_finishes_later(self):
        self.metadata.write_text(json.dumps({'workflow_runs': [{**self.run, 'id': 1, 'run_number': 9}, self.run]}))
        self.shell('download_release "$TEST_ROOT/app"')
        self.assertNotIn('/runs/1/', (self.root / 'requested-urls').read_text())

    def test_expired_artifacts_fail_without_changing_deployment(self):
        self.artifacts.write_text(json.dumps({'artifacts': [{'id': 56789, 'name': 'camp-server', 'expired': True}]}))
        self.shell('download_release "$TEST_ROOT/rejected"', success=False)
        self.assertFalse((self.root / 'rejected/RELEASE.json').exists())

    def test_expired_latest_artifact_falls_back_to_previous_successful_build(self):
        self.metadata.write_text(json.dumps({'workflow_runs': [self.run, {**self.run, 'id': 54321, 'run_number': 11}]}))
        self.shell('download_release "$TEST_ROOT/app"')
        self.assertIn('/runs/54321/artifacts?', (self.root / 'requested-urls').read_text())
        self.assertEqual(json.loads((self.root / 'app/RELEASE.json').read_text())['runId'], RUN_ID)

    def test_download_failure_does_not_change_installed_files(self):
        destination = self.root / 'app'
        destination.mkdir()
        (destination / 'RELEASE.json').write_text('installed manifest')
        self.shell('curl() { return 22; }; download_release "$TEST_ROOT/app"', success=False)
        self.assertEqual((destination / 'RELEASE.json').read_text(), 'installed manifest')

    def test_requested_build_must_match_successful_run_and_manifest(self):
        self.metadata.write_text(json.dumps(self.run))
        self.shell(f'download_release "$TEST_ROOT/app" {RUN_ID}')
        self.metadata.write_text(json.dumps({**self.run, 'head_sha': 'd' * 40}))
        self.shell(f'download_release "$TEST_ROOT/rejected" {RUN_ID}', success=False)
        self.assertFalse((self.root / 'rejected/RELEASE.json').exists())
        self.metadata.write_text(json.dumps(self.run))
        self.shell('download_release "$TEST_ROOT/rejected" 99999', success=False)

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
                builder.build(ROOT, self.root, RUN_ID, COMMIT, web, CADDY)


if __name__ == '__main__':
    unittest.main()
