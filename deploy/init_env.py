"""Create a private deployment environment without printing credentials."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parents[1]
target = root / '.env'
if target.exists():
    raise SystemExit('.env already exists; it was not overwritten.')
text = (root / '.env.example').read_text()
text = text.replace('SECRET_KEY=GENERATE_ME', 'SECRET_KEY=' + secrets.token_urlsafe(48))
text = text.replace('ADMIN_PASSWORD=GENERATE_ME', 'ADMIN_PASSWORD=' + secrets.token_urlsafe(24))
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as file:
    file.write(text)
print('Created .env (mode 0600). Open it locally to read your password and configure API keys.')
