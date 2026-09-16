import re
from pathlib import Path

STORAGE_BASE = Path("storage")
TEMPLATES_DIR = STORAGE_BASE / "templates"
GENERATED_DIR = STORAGE_BASE / "generated"
BULK_DIR = STORAGE_BASE / "bulk"

def init_storage():
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    BULK_DIR.mkdir(parents=True, exist_ok=True)

def sanitize_filename(name: str) -> str:
    """Sanitizes a filename to prevent path traversal and invalid filesystem characters."""
    # Strip any directory components
    name = Path(name).name
    # Replace spaces and unusual chars
    cleaned = re.sub(r'[^a-zA-Z0-9_\.\-]', '_', name)
    # Prevent leading dots or empty
    cleaned = cleaned.lstrip('.')
    return cleaned or "document"

def get_template_path(filename: str) -> Path:
    safe = sanitize_filename(filename)
    return TEMPLATES_DIR / safe

def get_generated_path(filename: str) -> Path:
    safe = sanitize_filename(filename)
    return GENERATED_DIR / safe

def get_bulk_path(filename: str) -> Path:
    safe = sanitize_filename(filename)
    return BULK_DIR / safe
