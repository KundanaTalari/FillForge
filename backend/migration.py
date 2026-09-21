"""One-way import of templates previously tracked in storage/documents.json."""
import json
from pathlib import Path

from db import document_exists, insert_document

LEGACY_DOCUMENTS_FILE = Path("storage/documents.json")

def import_legacy_documents() -> int:
    if not LEGACY_DOCUMENTS_FILE.exists():
        return 0
    try:
        documents = json.loads(LEGACY_DOCUMENTS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0

    imported = 0
    for document in documents if isinstance(documents, list) else []:
        doc_id = document.get("id")
        if not doc_id or document_exists(doc_id):
            continue
        insert_document(
            doc_id,
            str(document.get("name") or "Untitled document.docx"),
            str(document.get("filename") or ""),
            document.get("placeholders") or [],
        )
        imported += 1
    return imported
