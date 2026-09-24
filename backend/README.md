# FillForge backend

FastAPI API for authentication, template uploads, CTC calculations, document generation, and bulk ZIP generation.

## Setup and run

From the project root:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

All backend data is stored under `backend/storage/`.
