import io
import csv
import zipfile
import uuid
import re
from pathlib import Path
from typing import List, Dict, Any, Tuple
import pandas as pd

from storage import get_template_path, get_bulk_path, sanitize_filename, person_document_name
from validation import validate_and_normalize_value, is_calculated_variable
from generation import render_document


def normalize_column_name(name: Any) -> str:
    """Match spreadsheet headers such as `Full Name`, `full_name`, and `FullName`."""
    return re.sub(r"[^a-z0-9]", "", str(name).lower())

def generate_sample_sheet(placeholders: List[Dict[str, Any]]) -> str:
    """
    Generates sample CSV content with placeholder headers and a realistic sample row.
    Only input (non-calculated) fields are included as standard columns.
    """
    input_fields = [p["name"] for p in placeholders if not p.get("calculated", False)]
    if not input_fields:
        input_fields = [p["name"] for p in placeholders]

    sample_values = {
        "first_name": "John",
        "last_name": "Doe",
        "employee_name": "John Doe",
        "employee_id": "EMP-1001",
        "designation": "Senior Software Engineer",
        "department": "Engineering",
        "date_of_joining": "2026-09-01",
        "joining_date": "2026-09-01",
        "ctc_total": 600000,
        "salary": 600000,
        "basic_pf": 1800,
        "email": "john.doe@example.com",
        "phone": "+1-555-0199",
        "date_of_birth": "1994-05-15",
    }

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(input_fields)

    sample_row = []
    for f in input_fields:
        if f in sample_values:
            sample_row.append(sample_values[f])
        else:
            sample_row.append(f"Sample {f.replace('_', ' ').title()}")
    writer.writerow(sample_row)

    # Second sample row for easy multi-record testing
    sample_row_2 = []
    sample_values_2 = {
        "first_name": "Jane",
        "last_name": "Smith",
        "employee_name": "Jane Smith",
        "employee_id": "EMP-1002",
        "designation": "Lead Product Manager",
        "department": "Product",
        "date_of_joining": "2026-09-15",
        "joining_date": "2026-09-15",
        "ctc_total": 900000,
        "salary": 900000,
        "basic_pf": 1800,
        "email": "jane.smith@example.com",
        "phone": "+1-555-0288",
        "date_of_birth": "1992-08-20",
    }
    for f in input_fields:
        if f in sample_values_2:
            sample_row_2.append(sample_values_2[f])
        else:
            sample_row_2.append(f"Sample 2 {f.replace('_', ' ').title()}")
    writer.writerow(sample_row_2)

    return output.getvalue()


def process_bulk_generation(
    template_path: Path,
    file_bytes: bytes,
    file_extension: str,
    placeholders: List[Dict[str, Any]],
    output_format: str = "pdf",
    pf_mode: str = "fixed",
    pf_percentage: float = 12.0,
    download_filename: str | None = None,
) -> Dict[str, Any]:
    """
    Parses CSV/XLSX bytes, processes each row individually, and packages results into a ZIP.
    Returns status summary with failure list.
    """
    # Parse sheet into list of dicts
    rows = []
    try:
        if file_extension.lower() in [".xlsx", ".xls"]:
            df = pd.read_excel(io.BytesIO(file_bytes))
        else:
            df = pd.read_csv(io.BytesIO(file_bytes))
        
        # Clean column headers
        df.columns = [str(c).strip() for c in df.columns]
        rows = df.to_dict(orient="records")
    except Exception as e:
        raise ValueError(f"Failed to read spreadsheet file: {str(e)}")

    if not rows:
        raise ValueError("Spreadsheet contains no data rows.")

    batch_id = str(uuid.uuid4())
    zip_path = get_bulk_path(f"bulk_{batch_id}.zip")

    succeeded = 0
    failed = 0
    failures = []
    generated_files: List[Tuple[str, Path]] = []
    used_archive_names = set()

    # Map placeholders for quick validation lookup. Spreadsheet headings are
    # often written with spaces, while DOCX fields tend to be camelCase.
    placeholder_map = {p["name"]: p for p in placeholders}
    spreadsheet_columns = {
        normalize_column_name(column): column for column in df.columns
    }

    for idx, row in enumerate(rows, start=1):
        row_clean = {}
        row_errors = []

        # Convert NaN to None
        for k, v in row.items():
            if pd.isna(v):
                row_clean[k] = None
            else:
                row_clean[k] = v

        # Copy equivalent spreadsheet columns to the exact DOCX placeholder
        # name used by rendering and filename generation.
        for p_name in placeholder_map:
            if p_name not in row_clean:
                source_column = spreadsheet_columns.get(normalize_column_name(p_name))
                if source_column is not None:
                    row_clean[p_name] = row_clean.get(source_column)

        # Validate fields
        for p_name, p_meta in placeholder_map.items():
            if p_meta.get("calculated", False):
                continue

            val = row_clean.get(p_name)
            # If the column was omitted in the sheet, treat as optional
            is_col_present = normalize_column_name(p_name) in spreadsheet_columns
            is_req = p_meta.get("required", True) and is_col_present

            is_valid, norm_val, err = validate_and_normalize_value(
                field_name=p_name,
                var_type=p_meta.get("type", "text"),
                value=val,
                required=is_req
            )

            if not is_valid:
                row_errors.append(err)
            else:
                row_clean[p_name] = norm_val

        if row_errors:
            failed += 1
            failures.append({
                "row": idx,
                "error": "; ".join(row_errors)
            })
            continue

        # Use each employee's Name and Designation, including templates whose
        # fields are written as {{Name}} / {{Designation}} rather than snake case.
        # The template name is only used if the spreadsheet has neither value.
        base_name = person_document_name(row_clean, template_path.stem)
        if not base_name or base_name == "document":
            base_name = f"record_{idx}"
        base_name = sanitize_filename(f"{base_name}_{uuid.uuid4().hex[:6]}")

        try:
            out_file, mime = render_document(
                template_path=template_path,
                values=row_clean,
                output_filename_base=base_name,
                output_format=output_format,
                pf_mode=pf_mode,
                pf_percentage=pf_percentage
            )
            # Meaningful archive name
            ext = ".pdf" if output_format.lower() == "pdf" else ".docx"
            archive_stem = person_document_name(row_clean, template_path.stem)
            if not archive_stem or archive_stem == "document":
                archive_stem = f"record_{idx}"
            archive_name = f"{archive_stem}{ext}"
            duplicate = 2
            while archive_name.lower() in used_archive_names:
                archive_name = f"{archive_stem}_{duplicate}{ext}"
                duplicate += 1
            used_archive_names.add(archive_name.lower())
            generated_files.append((archive_name, out_file))
            succeeded += 1
        except Exception as e:
            failed += 1
            failures.append({
                "row": idx,
                "error": f"Generation error: {str(e)}"
            })

    # Create ZIP archive if there are any succeeded documents
    if generated_files:
        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zipf:
            for arc_name, f_path in generated_files:
                if f_path.exists():
                    zipf.write(f_path, arcname=arc_name)

    return {
        "succeeded": succeeded,
        "failed": failed,
        "failures": failures,
        "batch_id": batch_id if succeeded > 0 else None,
        "download_url": f"/documents/download-bulk/{batch_id}" if succeeded > 0 else None,
        "download_filename": download_filename if succeeded > 0 else None,
    }
