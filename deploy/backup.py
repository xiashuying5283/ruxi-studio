"""Offline, consistent backup. Stop web AND worker before invoking inside a container."""
import os
from pathlib import Path
import tarfile
from datetime import datetime, timezone

source = Path(os.getenv('DATA_DIR', '/data'))
target = Path('/backups')
target.mkdir(parents=True, exist_ok=True)
file = target / ('ruxi-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '.tar.gz')
with tarfile.open(file, 'w:gz') as archive:
    archive.add(source, arcname='data')
print(file.name)
