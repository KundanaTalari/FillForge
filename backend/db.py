import sqlite3
import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional

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
            "placeholders": json.loads(r["placeholders"]),
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
        "placeholders": json.loads(row["placeholders"]),
        "created_at": row["created_at"]
    }

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
