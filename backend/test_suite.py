import io
import os
import zipfile
import pytest
from pathlib import Path
from decimal import Decimal

from calculations import calculate_ctc, evaluate_expression, format_inr_currency
from validation import detect_variable_type, validate_and_normalize_value, is_calculated_variable
from generation import extract_placeholders_from_docx, render_document, convert_to_pdf
from bulk import process_bulk_generation, generate_sample_sheet
from db import init_db, get_all_documents, get_document_by_id
from storage import init_storage, get_template_path

def test_1_ctc_exact_values():
    """Requirement 9, 10, 11, 12, 14, 32: Exact CTC formula verification."""
    res = calculate_ctc(ctc_total=600000, basic_pf=1800, pf_mode="fixed")
    
    assert res["annual_basic"]["raw_value"] == 300000
    assert res["basic_per_month"]["raw_value"] == 25000
    assert res["annual_hra"]["raw_value"] == 150000
    assert res["hra_per_month"]["raw_value"] == 12500
    assert res["pf_per_year"]["raw_value"] == 21600
    assert res["pf_per_month"]["raw_value"] == 1800
    assert res["gratuity_per_year"]["raw_value"] == 14430
    assert res["gratuity_per_month"]["raw_value"] == 1202.50
    assert res["special_allowance"]["raw_value"] == 113970
    assert res["monthly_special_allowance"]["raw_value"] == 9497.50

def test_2_type_detection():
    """Requirement 6: Variable Type Detection."""
    assert detect_variable_type("first_name") == "text"
    assert detect_variable_type("last_name") == "text"
    assert detect_variable_type("ctc_total") == "currency"
    assert detect_variable_type("salary") == "currency"
    assert detect_variable_type("date_of_joining") == "date"
    assert detect_variable_type("joining_time") == "time"
    assert detect_variable_type("created_at") == "datetime"
    assert detect_variable_type("email") == "email"
    assert detect_variable_type("phone") == "phone"
    assert detect_variable_type("is_active") == "boolean"
    assert detect_variable_type("pf_percentage") == "percentage"

def test_3_template_placeholder_extraction():
    """Requirement 4, 18: DOCX placeholder extraction."""
    docs = get_all_documents()
    assert len(docs) >= 1
    doc = docs[0]
    tpl_path = get_template_path(doc["filename"])
    assert tpl_path.exists()

    placeholders = extract_placeholders_from_docx(tpl_path)
    p_names = [p["name"] for p in placeholders]
    assert "first_name" in p_names
    assert "ctc_total" in p_names or "salary" in p_names

def test_4_docx_and_pdf_generation():
    """Requirement 20, 30, 31: DOCX & PDF generation with LibreOffice."""
    docs = get_all_documents()
    offer_doc = next((d for d in docs if "Offer" in d["name"]), docs[0])
    tpl_path = get_template_path(offer_doc["filename"])

    values = {
        "first_name": "Test",
        "last_name": "User",
        "employee_id": "EMP-999",
        "designation": "Staff Architect",
        "department": "Engineering",
        "date_of_joining": "2026-09-07",
        "joining_time": "10:00:00",
        "email": "test.user@example.com",
        "phone": "+1-555-0144",
        "ctc_total": 600000,
        "basic_pf": 1800,
    }

    # Test DOCX rendering
    docx_file, docx_mime = render_document(
        template_path=tpl_path,
        values=values,
        output_filename_base="test_gen_docx",
        output_format="docx"
    )
    assert docx_file.exists()
    assert docx_file.stat().st_size > 1000

    # Test PDF conversion
    pdf_file, pdf_mime = render_document(
        template_path=tpl_path,
        values=values,
        output_filename_base="test_gen_pdf",
        output_format="pdf"
    )
    assert pdf_file.exists()
    assert pdf_mime == "application/pdf"
    assert pdf_file.stat().st_size > 1000

def test_5_bulk_10_rows_1_invalid():
    """Requirement 21, 33: Bulk processing with 10 rows (9 valid, 1 invalid)."""
    docs = get_all_documents()
    offer_doc = next((d for d in docs if "Offer" in d["name"]), docs[0])
    tpl_path = get_template_path(offer_doc["filename"])

    # Create CSV with 9 valid rows and 1 invalid row (row 5 missing required date_of_joining)
    csv_rows = [
        "first_name,last_name,employee_id,designation,department,date_of_joining,ctc_total,basic_pf,email,phone"
    ]
    for i in range(1, 11):
        if i == 5:
            # Invalid row: missing date_of_joining and invalid ctc
            csv_rows.append(f"Person{i},Last{i},EMP-{i},Dev,IT,,invalid_ctc,1800,p{i}@test.com,555-010{i}")
        else:
            csv_rows.append(f"Person{i},Last{i},EMP-{i},Dev,IT,2026-09-01,600000,1800,p{i}@test.com,555-010{i}")

    csv_content = "\n".join(csv_rows).encode("utf-8")

    result = process_bulk_generation(
        template_path=tpl_path,
        file_bytes=csv_content,
        file_extension=".csv",
        placeholders=offer_doc["placeholders"],
        output_format="pdf"
    )

    assert result["succeeded"] == 9, f"Expected 9 succeeded, got {result['succeeded']}"
    assert result["failed"] == 1, f"Expected 1 failed, got {result['failed']}"
    assert len(result["failures"]) == 1
    assert result["failures"][0]["row"] == 5
    assert result["batch_id"] is not None
    print("✅ Bulk generation test passed (9 succeeded, 1 failed, batch completed cleanly)!")

if __name__ == "__main__":
    init_storage()
    init_db()
    test_1_ctc_exact_values()
    test_2_type_detection()
    test_3_template_placeholder_extraction()
    test_4_docx_and_pdf_generation()
    test_5_bulk_10_rows_1_invalid()
    print("🎉 ALL TESTS PASSED SUCCESSFULLY!")
