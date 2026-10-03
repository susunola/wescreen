"""Local-app approved pairing. Web callers cannot mint approval grants."""
import json
import os
from pathlib import Path
import re
import secrets
import time
from urllib.parse import parse_qs, urlparse

ORIGIN = re.compile(r'chrome-extension://[a-p]{32}')
NONCE = re.compile(r'[a-f0-9]{64}')

def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def trusted_origins(pair_file):
    origins = set()
    if pair_file.exists():
        legacy = pair_file.read_text().strip()
        if ORIGIN.fullmatch(legacy): origins.add(legacy)
    path = pair_file.with_name('trusted-origins.json')
    if path.exists():
        value = json.loads(path.read_text())
        if isinstance(value, list): origins.update(o for o in value if isinstance(o, str) and ORIGIN.fullmatch(o))
    return origins

def parse_pair_url(url):
    parsed = urlparse(url)
    if parsed.scheme != 'wescreen-helper' or parsed.netloc != 'pair' or parsed.path or parsed.fragment:
        raise ValueError('Invalid local pairing link')
    query = parse_qs(parsed.query, strict_parsing=True)
    if set(query) != {'origin', 'challenge'} or any(len(v) != 1 for v in query.values()):
        raise ValueError('Invalid pairing parameters')
    origin, nonce = query['origin'][0], query['challenge'][0]
    if not ORIGIN.fullmatch(origin) or not NONCE.fullmatch(nonce):
        raise ValueError('Invalid extension or challenge')
    return origin, nonce

def grant_pairing(pair_file, origin, nonce):
    if not ORIGIN.fullmatch(origin) or not NONCE.fullmatch(nonce): raise ValueError('Invalid pairing grant')
    directory = pair_file.parent / 'pair-grants'
    directory.mkdir(parents=True, exist_ok=True); directory.chmod(0o700)
    # Expired grants cannot accumulate across launches.
    for path in directory.glob('*.json'):
        if time.time() - path.stat().st_mtime > 120: path.unlink(missing_ok=True)
    write_private(directory / (nonce + '.json'), {'origin': origin, 'expires': time.time() + 120})

def connect_origin(pair_file, origin, nonce=''):
    """Call under the server's pairing lock. Preserve every previously trusted ID."""
    if not ORIGIN.fullmatch(origin): return False
    origins = trusted_origins(pair_file)
    if not origins:
        pair_file.parent.mkdir(parents=True, exist_ok=True)
        pair_file.write_text(origin); pair_file.chmod(0o600)
        return True
    if origin in origins: return True
    if not NONCE.fullmatch(nonce): return False
    grant = pair_file.parent / 'pair-grants' / (nonce + '.json')
    try:
        data = json.loads(grant.read_text())
        if data.get('origin') != origin or not time.time() < data.get('expires', 0) <= time.time() + 121: return False
        write_private(pair_file.with_name('trusted-origins.json'), sorted(origins | {origin}))
        grant.unlink(missing_ok=True)
        return True
    except (OSError, ValueError, TypeError):
        return False
