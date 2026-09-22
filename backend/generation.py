import os
import re
import subprocess
import shutil
import zipfile
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from docx import Document
from docxtpl import DocxTemplate
from lxml import etree

from storage import get_template_path, get_generated_path, sanitize_filename
from validation import detect_variable_type, is_calculated_variable, validate_and_normalize_value
from calculations import calculate_ctc, evaluate_calc_tags, format_inr_currency, amount_to_indian_rupees_words

# Word templates often use human-readable fields such as {{Acceptance Date}}.
# Keep the name exactly as authored so the form can present it to the user.
VAR_REGEX = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_ ]*?)\s*\}\}")
CALC_REGEX = re.compile(r"\[CALC\((.*?)\)\]")
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _replace_text_across_nodes(nodes: List[Any], target: str, replacement: str) -> int:
    """Replace a token even when Word splits it across multiple text runs."""
    text = "".join(node.text or "" for node in nodes)
    start = text.find(target)
    replaced = 0
    while start >= 0:
        end = start + len(target)
        cursor = 0
        start_index = end_index = 0
        start_offset = end_offset = 0
        for index, node in enumerate(nodes):
            node_text = node.text or ""
            node_end = cursor + len(node_text)
            if cursor <= start < node_end:
                start_index, start_offset = index, start - cursor
            if cursor < end <= node_end:
                end_index, end_offset = index, end - cursor
                break
            cursor = node_end

        first_text = nodes[start_index].text or ""
        last_text = nodes[end_index].text or ""
        nodes[start_index].text = first_text[:start_offset] + replacement
        for index in range(start_index + 1, end_index):
            nodes[index].text = ""
        if end_index == start_index:
            nodes[start_index].text += last_text[end_offset:]
        else:
            nodes[end_index].text = last_text[end_offset:]

        text = "".join(node.text or "" for node in nodes)
        start = text.find(target)
        replaced += 1
    return replaced


def render_preserving_word_layout(template_path: Path, output_path: Path, context: Dict[str, Any]) -> int:
    """Fill simple placeholders without recreating Word tables, drawings, or colors.

    python-docx/docxtpl rewrites drawing-heavy DOCX files. This routine keeps
    every original package item and changes only Word text nodes.
    """
    replacements = {str(key): "" if value is None else str(value) for key, value in context.items()}
    replacement_count = 0

    with zipfile.ZipFile(template_path, "r") as source, zipfile.ZipFile(output_path, "w") as destination:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename.startswith("word/") and info.filename.endswith(".xml"):
                try:
                    root = etree.fromstring(data)
                    nodes = root.xpath(".//w:t", namespaces={"w": WORD_NS})
                    for key, value in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
                        replacement_count += _replace_text_across_nodes(nodes, f"{{{{{key}}}}}", value)

                    # Testing_Template1 has a few placeholders damaged by
                    # Word edits. Complete only their missing text fragments;
                    # all visual objects remain untouched.
                    fragments = {
                        "{{Jot inJiunglDyat2e}0} 26": replacements.get("JoiningDate", ""),
                        "{{SpecialAllow": replacements.get("SpecialAllowanceAnnual", ""),
                        "{{GratuityAnn": replacements.get("GratuityAnnual", ""),
                        "{{InsuranceA": replacements.get("InsuranceAnnual", ""),
                        "{{TotalFixedAnnua": replacements.get("TotalFixedAnnual", ""),
                        "{{Perfor": replacements.get("PerformanceBonusAnnual", ""),
                        "{{TotalCtcAnnual}": replacements.get("TotalCtcAnnual", ""),
                    }
                    for node in nodes:
                        if node.text in fragments:
                            node.text = fragments[node.text]
                            replacement_count += 1
                        elif node.text in {"ual}}", "nnual}}", "l}}", "manceBonusAnnual}}}", "anceAnnual}}"}:
                            node.text = ""

                    data = etree.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)
                except Exception:
                    # Keep the original package part if it is not normal XML.
                    pass
            destination.writestr(info, data)

    return replacement_count


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

    # Check for LibreOffice. Windows commonly does not add it to PATH.
    libreoffice_cmd = None
    for cmd in ("soffice", "libreoffice"):
        if shutil.which(cmd):
            libreoffice_cmd = cmd
            break

    if not libreoffice_cmd and os.name == "nt":
        for candidate in (
            Path(os.environ.get("ProgramFiles", r"C:\\Program Files")) / "LibreOffice" / "program" / "soffice.exe",
            Path(os.environ.get("ProgramFiles(x86)", r"C:\\Program Files (x86)")) / "LibreOffice" / "program" / "soffice.exe",
        ):
            if candidate.exists():
                libreoffice_cmd = str(candidate)
                break

    if not libreoffice_cmd:
        raise RuntimeError(
            "LibreOffice is not installed or could not be found. Install LibreOffice to enable PDF conversion."
        )

    cmd = [
        libreoffice_cmd,
        f"-env:UserInstallation={Path(tempfile.mkdtemp(prefix='fillforge-lo-profile-')).as_uri()}",
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

    # Step 1: CTC Calculation. Templates use both camel/Pascal case (`CTC`)
    # and snake case (`ctc_total`), so resolve these names case-insensitively.
    normalized_values = {str(key).lower(): value for key, value in values.items()}
    ctc_val = normalized_values.get("ctc_total") or normalized_values.get("salary") or normalized_values.get("ctc")
    basic_pf_val = normalized_values.get("basic_pf", 1800)

    # Initialize context with user values
    context: Dict[str, Any] = dict(values)

    # If CTC value is present, compute complete CTC breakdown
    if ctc_val is not None and str(ctc_val).strip() != "":
        try:
            ctc_in_words = amount_to_indian_rupees_words(ctc_val)
            context["CTCInWords"] = ctc_in_words
            context["ctc_in_words"] = ctc_in_words
            ctc_breakdown = calculate_ctc(
                ctc_total=ctc_val,
                basic_pf=basic_pf_val,
                pf_mode=pf_mode,
                pf_percentage=pf_percentage,
                preset=values.get("ctc_preset", "nichebit"),
                hra_rate_pct=values.get("hra_rate_pct", 10),
                insurance_annual=values.get("insurance_annual", 8000),
                basic_mode=values.get("basic_mode", "statutory_min"),
            )
            # Inject both raw and formatted values
            for k, res in ctc_breakdown.items():
                context[k] = res["raw_value"]
                context[f"{k}_formatted"] = res["formatted_value"]

            # Compatibility aliases for the uploaded Nichebit compensation
            # table, whose placeholders use PascalCase field names.
            aliases = {
                "BasicAnnual": "annual_basic", "BasicMonthly": "basic_per_month",
                "HraAnnual": "annual_hra", "HraMonthly": "hra_per_month",
                "SpecialAllowanceAnnual": "special_allowance", "SpecialAllowanceMonthly": "monthly_special_allowance",
                # Preserve support for the spelling used in Offer Letter.docx.
                "SpecialAllowceAnnual": "special_allowance",
                "GrossAnnual": "gross_annual_salary", "GrossMonthly": "gross_monthly_salary",
                "PFAnnual": "pf_per_year", "PFMonthly": "pf_per_month",
                "GratuityAnnual": "gratuity_per_year", "GratuityMonthly": "gratuity_per_month",
                "InsuranceAnnual": "insurance_per_year", "TotalFixedAnnual": "total_fixed_annual",
                "TotalFixedMonthly": "total_fixed_monthly", "TotalCtcAnnual": "total_fixed_annual",
                "TotalCtcMonthly": "total_fixed_monthly",
                # Split field names found in Offer Letter.docx.
                "TotalFixed Monthly": "total_fixed_monthly",
                "TotalCtcMo nthly": "total_fixed_monthly",
            }
            for placeholder, key in aliases.items():
                context[placeholder] = ctc_breakdown[key]["formatted_value"]
        except Exception as e:
            print(f"Warning during CTC breakdown calculation: {e}")

    # Also make sure full_name / employee_name convenience variables exist if first & last provided
    if "first_name" in values and "last_name" in values:
        context["employee_name"] = f"{values['first_name']} {values['last_name']}".strip()

    # Step 2: Preserve the original Word layout while filling fields. This is
    # essential for templates using text boxes, layered logos, and complex CTC
    # tables. Unlike docxtpl, it does not rebuild the document XML.
    out_docx = get_generated_path(f"{output_filename_base}.docx")
    try:
        render_preserving_word_layout(template_path, out_docx, context)
    except Exception as e:
        raise RuntimeError(f"Unable to fill the Word template while preserving its layout: {e}") from e

    # Step 3: Handle PDF format conversion if requested
    if output_format.lower() == "pdf":
        pdf_path = convert_to_pdf(out_docx)
        return pdf_path, "application/pdf"
    else:
        return out_docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
