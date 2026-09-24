# FillForge

FillForge is split into two independent applications.

```text
Fillforge/
├── frontend/             React + TypeScript + Vite user interface
├── backend/              Python + FastAPI document API
│   └── storage/          SQLite database, uploaded templates, generated files
└── .venv/                Local Python virtual environment
```

## Run locally

Open two terminals from the project root.

**Terminal 1 — backend**

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

API: `http://127.0.0.1:8000`  
API docs: `http://127.0.0.1:8000/docs`

**Terminal 2 — frontend**

```powershell
cd frontend
npm install
npm run dev
```

App: `http://localhost:5173`

## Deployment

Deploy `frontend/` as a static Vite site and `backend/` as a FastAPI service.

Set these environment variables in the frontend deployment:

```text
VITE_API_BASE_URL=https://your-api-domain.example
```

Set this environment variable in the backend deployment:

```text
FRONTEND_ORIGINS=https://your-frontend-domain.example
```

The backend keeps its SQLite database and document files in `backend/storage/`. For production, mount persistent storage there or migrate the database/files to managed services.
