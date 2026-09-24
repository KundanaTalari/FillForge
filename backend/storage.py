import re
from pathlib import Path

# Keep documents, generated files, and archives inside the backend regardless
# of the terminal folder used to start Uvicorn.
BACKEND_DIR = Path(__file__).resolve().parent
STORAGE_BASE = BACKEND_DIR / "storage"
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


def person_document_name(values: dict, template_name: str = "") -> str:
    """Build a filename from the employee's name and designation.

    The template name is deliberately only a fallback. A generated offer
    belongs to the employee, so a single download should be e.g.
    ``Kundana_Talari_Associate_Software.docx``, not the template's name.
    """
    normalized = {str(key).lower().replace("_", ""): value for key, value in values.items()}

    def first_value(*keys: str) -> str:
        for key in keys:
            value = normalized.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return ""

    full_name = first_value("fullname", "employeename", "candidatename", "name")
    if not full_name:
        full_name = " ".join(filter(None, [first_value("firstname"), first_value("lastname")]))
    designation = first_value("designation", "jobtitle", "role")
    template_stem = Path(template_name).stem if template_name else ""
    employee_parts = [part for part in [full_name, designation] if part]
    if employee_parts:
        return sanitize_filename("_".join(employee_parts))

    return sanitize_filename(template_stem or "document")

def get_template_path(filename: str) -> Path:
    safe = sanitize_filename(filename)
    return TEMPLATES_DIR / safe

def get_generated_path(filename: str) -> Path:
    safe = sanitize_filename(filename)
    return GENERATED_DIR / safe

def get_bulk_path(filename: str) -> Path:
    safe = sanitize_filename(filename)
    return BULK_DIR / safe
