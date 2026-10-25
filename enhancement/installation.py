"""Local compatibility and build identity; does not expose installation paths."""
import hashlib
from pathlib import Path

PROTOCOL_VERSION=2

def build_id(root):
    root=Path(root);digest=hashlib.sha256()
    for file in sorted(root.iterdir()):
        if file.is_file() and file.suffix in ('.py','.sh','.command','.txt'):
            digest.update(file.name.encode());digest.update(file.read_bytes())
    return digest.hexdigest()[:20]
