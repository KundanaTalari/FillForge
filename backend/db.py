import sqlite3
import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional
from validation import is_calculated_variable

DB_PATH = Path("storage/fillforge.db")

def get_db_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Documents table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        placeholders TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """)

    # Generations table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS generations (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        type TEXT NOT NULL,
        format TEXT NOT NULL,
        values_json TEXT NOT NULL,
        output_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
    )
    """)

    conn.commit()
    conn.close()

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
    conn.close()
    return dict(row) if row else None

def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def insert_user(user_id: str, name: str, email: str, salt: str, password_hash: str):
    conn = get_db_connection()
    conn.execute(
        "INSERT INTO users (id, name, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, name, email.lower(), salt, password_hash, datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()

def insert_document(doc_id: str, name: str, filename: str, placeholders: List[Dict[str, Any]]):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        "INSERT INTO documents (id, name, filename, placeholders, created_at) VALUES (?, ?, ?, ?, ?)",
        (doc_id, name, filename, json.dumps(placeholders), now)
    )
    conn.commit()
    conn.close()

def update_document_placeholders(doc_id: str, placeholders: List[Dict[str, Any]]):
    """Refresh extracted template fields after parser improvements."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE documents SET placeholders = ? WHERE id = ?",
        (json.dumps(placeholders), doc_id),
    )
    conn.commit()
    conn.close()

def document_exists(doc_id: str) -> bool:
    conn = get_db_connection()
    row = conn.execute("SELECT 1 FROM documents WHERE id = ?", (doc_id,)).fetchone()
    conn.close()
    return row is not None

def get_all_documents() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, filename, placeholders, created_at FROM documents ORDER BY created_at DESC")
    rows = cursor.fetchall()
    docs = []
    for r in rows:
        docs.append({
            "id": r["id"],
            "name": r["name"],
            "filename": r["filename"],
            "placeholders": normalize_placeholders(json.loads(r["placeholders"])),
            "created_at": r["created_at"]
        })
    conn.close()
    return docs

def get_document_by_id(doc_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, filename, placeholders, created_at FROM documents WHERE id = ?", (doc_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "filename": row["filename"],
        "placeholders": normalize_placeholders(json.loads(row["placeholders"])),
        "created_at": row["created_at"]
    }

def normalize_placeholders(placeholders: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Correct metadata saved before amount-in-words fields were recognized."""
    for placeholder in placeholders:
        name = placeholder.get("name", "")
        if name.lower() in {"ctcinwords", "ctc_in_words", "annualcompensationinwords"}:
            placeholder.update({"type": "text", "required": False, "calculated": True, "description": "Computed CTC amount in words"})
        elif is_calculated_variable(name):
            placeholder.update({
                "type": "currency",
                "required": False,
                "calculated": True,
                "description": "Calculated automatically from CTC",
            })
        # Correct metadata saved by the former substring-based type detector,
        # which read the `age` in ManAGER / enGAGEment as a numeric age field.
        elif name.lower() in {"reportingmanager", "reportingmanagerdesignation", "engagementtype"}:
            placeholder["type"] = "text"
    return placeholders

def delete_document_by_id(doc_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def record_generation(gen_id: str, doc_id: str, gen_type: str, fmt: str, values: Any, output_path: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        "INSERT INTO generations (id, document_id, type, format, values_json, output_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (gen_id, doc_id, gen_type, fmt, json.dumps(values), output_path, now)
    )
    conn.commit()
    conn.close()
