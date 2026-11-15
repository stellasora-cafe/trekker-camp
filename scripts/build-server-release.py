# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

"""Build the resource-free server deployment bundle from a release tag."""
import argparse
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

FILES = (
    'compose.vps.yml', 'compose.assets.yml', 'compose.maintenance.yml',
    '.config/docker_example.yml', '.config/docker_example.env',
    'scripts/deploy.sh', 'scripts/backup.sh', 'scripts/caddy/Dockerfile',
    'scripts/caddy/cloudflare-proxies.caddy', 'scripts/caddy/camp-site.caddy',
)


def build(root, output, tag, commit, web, caddy):
    if not re.fullmatch(r'server-v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?', tag):
        raise ValueError('Expected server-vVERSION tag')
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise ValueError('Expected full Git commit')
    images = {'web': web, 'caddy': caddy}
    for component, image in images.items():
        name = 'trekker-camp' + ('-caddy' if component == 'caddy' else '')
        if not re.fullmatch(re.escape('ghcr.io/stellasora-cafe/' + name + '@sha256:') + '[a-f0-9]{64}', image):
            raise ValueError('Images must be pinned to official GHCR digests')
    content = {name: (root / name).read_bytes() for name in FILES}
    content['RELEASE.json'] = json.dumps({'tag': tag, 'commit': commit, **images}, indent=2).encode()
    content['compose.release.yml'] = ('services:\n' + ''.join(
        f'  {key}:\n    build: !reset null\n    image: {image}\n' for key, image in images.items())).encode()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'camp-server-{tag}.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        for name, data in content.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            entry.mode = 0o644
            tar.addfile(entry, io.BytesIO(data))
    return archive


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--web', required=True)
    parser.add_argument('--caddy', required=True)
    parser.add_argument('--out', type=Path, default=Path('release'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    tagged = subprocess.check_output(['git', 'rev-parse', args.tag + '^{commit}'], cwd=root, text=True).strip()
    if commit != tagged:
        raise SystemExit('Checkout must match the release tag')
    if any(json.loads((root / p).read_text())['version'] != args.tag.removeprefix('server-v') for p in ('package.json', 'apps/misskey/package.json')):
        raise SystemExit('Release tag must match package versions')
    print(build(root, args.out, args.tag, commit, args.web, args.caddy))
