import os
import uuid
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, JSONResponse

from db import init_db, insert_document, get_all_documents, get_document_by_id, delete_document_by_id, record_generation
from storage import init_storage, get_template_path, get_generated_path, get_bulk_path, sanitize_filename
from generation import extract_placeholders_from_docx, render_document, convert_to_pdf
from bulk import generate_sample_sheet, process_bulk_generation
from calculations import calculate_ctc
from validation import validate_and_normalize_value, is_calculated_variable
from schemas import GenerateRequest, BulkGenerateResponse

app = FastAPI(title="FillForge API", version="1.0.0")

# Enable CORS for local Vite development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_storage()
    init_db()

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "FillForge"}

@app.get("/documents")
def list_documents():
    return get_all_documents()

@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    # Validate extension
    if not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx documents are supported.")

    doc_id = str(uuid.uuid4())
    clean_orig_name = sanitize_filename(file.filename)
    saved_filename = f"{doc_id}_{clean_orig_name}"
    target_path = get_template_path(saved_filename)

    # Save uploaded file
    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        with open(target_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # Extract placeholders
    try:
        placeholders = extract_placeholders_from_docx(target_path)
    except Exception as e:
        if target_path.exists():
            target_path.unlink()
        raise HTTPException(status_code=400, detail=f"Failed to parse DOCX placeholders: {str(e)}")

    # Insert into DB
    insert_document(doc_id, file.filename, saved_filename, placeholders)

    return {
        "id": doc_id,
        "name": file.filename,
        "filename": saved_filename,
        "placeholders": placeholders
    }

@app.get("/documents/{doc_id}")
def get_document(doc_id: str):
    doc = get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@app.get("/documents/{doc_id}/preview")
def preview_document(doc_id: str):
    doc = get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = get_template_path(doc["filename"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Template file not found on server")

    return FileResponse(
        path=str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=doc["name"]
    )

@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    doc = get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = get_template_path(doc["filename"])
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception as e:
            print(f"Warning deleting file: {e}")

    delete_document_by_id(doc_id)
    return {"status": "deleted", "id": doc_id}

@app.post("/calculate")
def live_calculation(payload: Dict[str, Any]):
    """
    Computes live CTC calculations for immediate UI feedback.
    Never relies solely on frontend calculations.
    """
    ctc = payload.get("ctc_total", 0)
    pf = payload.get("basic_pf", 1800)
    mode = payload.get("pf_mode", "fixed")
    pct = payload.get("pf_percentage", 12)

    try:
        breakdown = calculate_ctc(
            ctc_total=ctc,
            basic_pf=pf,
            pf_mode=mode,
            pf_percentage=pct
        )
        return breakdown
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Calculation error: {str(e)}")

@app.post("/documents/{doc_id}/generate")
async def generate_document(doc_id: str, request: GenerateRequest):
    doc = get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    tpl_path = get_template_path(doc["filename"])
    if not tpl_path.exists():
        raise HTTPException(status_code=404, detail="Template file missing")

    # Validate inputs
    validated_values = {}
    validation_errors = []
    placeholders = doc["placeholders"]

    for p in placeholders:
        p_name = p["name"]
        if p.get("calculated", False):
            continue

        val = request.values.get(p_name)
        is_valid, norm_val, err = validate_and_normalize_value(
            field_name=p_name,
            var_type=p.get("type", "text"),
            value=val,
            required=p.get("required", False)
        )
        if not is_valid:
            validation_errors.append(err)
        else:
            validated_values[p_name] = norm_val

    if validation_errors:
        raise HTTPException(status_code=422, detail={"errors": validation_errors})

    # Prepare file naming
    first_n = validated_values.get("first_name") or ""
    last_n = validated_values.get("last_name") or ""
    emp_id = validated_values.get("employee_id") or ""
    stem = Path(doc["name"]).stem
    
    parts = [p for p in [stem, emp_id, first_n, last_n] if p]
    base_name = sanitize_filename("_".join(parts) or "generated_document")
    gen_id = str(uuid.uuid4())
    unique_base = f"{base_name}_{gen_id[:8]}"

    # Render document
    try:
        output_file, mime_type = render_document(
            template_path=tpl_path,
            values=validated_values,
            output_filename_base=unique_base,
            output_format=request.format,
            pf_mode=request.pf_mode,
            pf_percentage=request.pf_percentage
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document generation failed: {str(e)}")

    record_generation(gen_id, doc_id, "single", request.format, validated_values, str(output_file))

    ext = ".pdf" if request.format.lower() == "pdf" else ".docx"
    download_filename = f"{base_name}{ext}"

    return FileResponse(
        path=str(output_file),
        media_type=mime_type,
        filename=download_filename,
        headers={"Content-Disposition": f'attachment; filename="{download_filename}"'}
    )

@app.get("/documents/{doc_id}/sample-sheet")
def download_sample_sheet(doc_id: str):
    doc = get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    csv_data = generate_sample_sheet(doc["placeholders"])
    clean_stem = Path(doc["name"]).stem
    filename = f"{clean_stem}_sample_data.csv"

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.post("/documents/{doc_id}/bulk-generate")
async def bulk_generate(
    doc_id: str,
    file: UploadFile = File(...),
    format: str = Form("pdf"),
    pf_mode: str = Form("fixed"),
    pf_percentage: float = Form(12.0)
):
    doc = get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    tpl_path = get_template_path(doc["filename"])
    if not tpl_path.exists():
        raise HTTPException(status_code=404, detail="Template file missing")

    file_bytes = await file.read()
    ext = Path(file.filename).suffix.lower()
    if ext not in [".csv", ".xlsx", ".xls"]:
        raise HTTPException(status_code=400, detail="Invalid spreadsheet format. Please upload .csv or .xlsx file.")

    try:
        result = process_bulk_generation(
            template_path=tpl_path,
            file_bytes=file_bytes,
            file_extension=ext,
            placeholders=doc["placeholders"],
            output_format=format,
            pf_mode=pf_mode,
            pf_percentage=pf_percentage
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Bulk processing error: {str(e)}")

@app.get("/documents/download-bulk/{batch_id}")
def download_bulk_zip(batch_id: str):
    safe_batch = sanitize_filename(batch_id)
    zip_path = get_bulk_path(f"bulk_{safe_batch}.zip")
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Bulk batch archive not found or expired.")

    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=f"fillforge_bulk_{safe_batch[:8]}.zip",
        headers={"Content-Disposition": f'attachment; filename="fillforge_bulk_{safe_batch[:8]}.zip"'}
    )

@app.post("/seed-samples")
@app.post("/api/seed-samples")
def trigger_seed_samples():
    from create_samples import seed_samples
    seed_samples()
    return {"status": "ok", "message": "Sample templates seeded."}
