import os
import re
import subprocess
import shutil
import zipfile
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from docx import Document
from docxtpl import DocxTemplate

from storage import get_template_path, get_generated_path, sanitize_filename
from validation import detect_variable_type, is_calculated_variable, validate_and_normalize_value
from calculations import calculate_ctc, evaluate_calc_tags, format_inr_currency

VAR_REGEX = re.compile(r"\{\{([a-zA-Z0-9_]+)\}\}")
CALC_REGEX = re.compile(r"\[CALC\((.*?)\)\]")

def extract_placeholders_from_docx(file_path: Path) -> List[Dict[str, Any]]:
    """
    Extracts all {{placeholder}} variables and [CALC(...)] expressions from a DOCX file.
    Inspects paragraphs, tables, headers, and footers.
    Returns normalized placeholder metadata in deterministic order.
    """
    detected_vars = set()

    # Method 1: Try DocxTemplate undeclared variables
    try:
        tpl = DocxTemplate(str(file_path))
        undeclared = tpl.get_undeclared_template_variables()
        for var in undeclared:
            detected_vars.add(var.strip())
    except Exception:
        pass

    # Method 2: Comprehensive text scan across docx XML components
    try:
        doc = Document(str(file_path))

        # Helper to scan elements
        def scan_text(text: str):
            for m in VAR_REGEX.finditer(text):
                detected_vars.add(m.group(1).strip())

        # Body paragraphs
        for p in doc.paragraphs:
            scan_text(p.text)

        # Tables
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for p in cell.paragraphs:
                        scan_text(p.text)

        # Headers and footers across sections
        for section in doc.sections:
            if section.header:
                for p in section.header.paragraphs:
                    scan_text(p.text)
                for t in section.header.tables:
                    for r in t.rows:
                        for c in r.cells:
                            for p in c.paragraphs:
                                scan_text(p.text)
            if section.footer:
                for p in section.footer.paragraphs:
                    scan_text(p.text)
                for t in section.footer.tables:
                    for r in t.rows:
                        for c in r.cells:
                            for p in c.paragraphs:
                                scan_text(p.text)

    except Exception as e:
        print(f"Warning during docx scan: {e}")

    # Build placeholder items
    placeholders = []
    # Deterministic sort: non-calculated first, then calculated
    sorted_vars = sorted(list(detected_vars))
    
    # Priority order for standard fields:
    priority_order = [
        "first_name", "last_name", "employee_name", "employee_id",
        "designation", "department", "date_of_joining", "joining_date",
        "ctc_total", "salary", "basic_pf", "pf_mode", "pf_percentage"
    ]
    
    def sort_key(name: str):
        is_calc = is_calculated_variable(name)
        pri = priority_order.index(name) if name in priority_order else 999
        return (1 if is_calc else 0, pri, name)

    sorted_vars.sort(key=sort_key)

    for var in sorted_vars:
        v_type = detect_variable_type(var)
        calc = is_calculated_variable(var)
        placeholders.append({
            "name": var,
            "type": v_type,
            "required": not calc,
            "calculated": calc,
            "description": f"Computed {var.replace('_', ' ')}" if calc else f"Enter {var.replace('_', ' ')}"
        })

    return placeholders


def convert_to_pdf(docx_path: Path) -> Path:
    """
    Converts a DOCX file to PDF using headless LibreOffice.
    Returns the path to the generated PDF.
    """
    docx_path = Path(docx_path).resolve()
    if not docx_path.exists():
        raise FileNotFoundError(f"DOCX file not found: {docx_path}")

    out_dir = docx_path.parent
    expected_pdf = out_dir / (docx_path.stem + ".pdf")

    # Check for libreoffice / soffice command
    libreoffice_cmd = None
    for cmd in ("soffice", "libreoffice"):
        if shutil.which(cmd):
            libreoffice_cmd = cmd
            break

    if not libreoffice_cmd:
        raise RuntimeError(
            "LibreOffice is not installed or not in PATH. Please install libreoffice (e.g. `apt-get install libreoffice`) to enable PDF conversion."
        )

    cmd = [
        libreoffice_cmd,
        "--headless",
        "--convert-to", "pdf:writer_pdf_Export",
        "--outdir", str(out_dir),
        str(docx_path)
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice PDF conversion failed: {result.stderr.strip() or result.stdout.strip()}")

    if not expected_pdf.exists():
        raise RuntimeError(f"PDF conversion completed but output file was not found: {expected_pdf}")

    return expected_pdf


def render_document(
    template_path: Path,
    values: Dict[str, Any],
    output_filename_base: str,
    output_format: str = "docx",
    pf_mode: str = "fixed",
    pf_percentage: float = 12.0
) -> Tuple[Path, str]:
    """
    Fills a DOCX template with given values, performs CTC calculations,
    processes [CALC(...)] tags, and generates DOCX or PDF.
    Returns (output_path, mime_type).
    """
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    # Step 1: CTC Calculation if ctc_total or salary provided
    ctc_val = values.get("ctc_total") or values.get("salary") or values.get("ctc")
    basic_pf_val = values.get("basic_pf", 1800)

    # Initialize context with user values
    context: Dict[str, Any] = dict(values)

    # If CTC value is present, compute complete CTC breakdown
    if ctc_val is not None and str(ctc_val).strip() != "":
        try:
            ctc_breakdown = calculate_ctc(
                ctc_total=ctc_val,
                basic_pf=basic_pf_val,
                pf_mode=pf_mode,
                pf_percentage=pf_percentage
            )
            # Inject both raw and formatted values
            for k, res in ctc_breakdown.items():
                context[k] = res["raw_value"]
                context[f"{k}_formatted"] = res["formatted_value"]
        except Exception as e:
            print(f"Warning during CTC breakdown calculation: {e}")

    # Also make sure full_name / employee_name convenience variables exist if first & last provided
    if "first_name" in values and "last_name" in values:
        context["employee_name"] = f"{values['first_name']} {values['last_name']}".strip()

    # Step 2: Use docxtpl to render
    out_docx = get_generated_path(f"{output_filename_base}.docx")
    
    try:
        doc = DocxTemplate(str(template_path))
        doc.render(context)
        doc.save(str(out_docx))
    except Exception as e:
        # Fallback: manually replace in document paragraphs if docxtpl has syntax issues
        print(f"DocxTemplate render error ({e}), falling back to direct run replacement...")
        doc = Document(str(template_path))
        for p in doc.paragraphs:
            for k, v in context.items():
                target = f"{{{{{k}}}}}"
                if target in p.text:
                    p.text = p.text.replace(target, str(v))
            if "[CALC(" in p.text:
                p.text = evaluate_calc_tags(p.text, context)

        for t in doc.tables:
            for row in t.rows:
                for cell in row.cells:
                    for p in cell.paragraphs:
                        for k, v in context.items():
                            target = f"{{{{{k}}}}}"
                            if target in p.text:
                                p.text = p.text.replace(target, str(v))
                        if "[CALC(" in p.text:
                            p.text = evaluate_calc_tags(p.text, context)
        doc.save(str(out_docx))

    # Step 3: Handle PDF format conversion if requested
    if output_format.lower() == "pdf":
        pdf_path = convert_to_pdf(out_docx)
        return pdf_path, "application/pdf"
    else:
        return out_docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
