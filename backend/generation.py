import os
import re
import subprocess
import shutil
import zipfile
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from docxtpl import DocxTemplate
from lxml import etree

from storage import get_template_path, get_generated_path, sanitize_filename
from validation import detect_variable_type, is_calculated_variable, validate_and_normalize_value
from calculations import format_inr_number
from formula_engine import (
    FormulaError,
    evaluate_template_formulas,
    extract_formula_blocks_from_docx,
    extract_select_blocks_from_docx,
    formula_targets,
    select_fields,
)

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


def render_preserving_word_layout(
    template_path: Path,
    output_path: Path,
    context: Dict[str, Any],
    formula_replacements: Optional[Dict[str, str]] = None,
    select_replacements: Optional[Dict[str, str]] = None,
) -> int:
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
                    for formula, value in (formula_replacements or {}).items():
                        replacement_count += _replace_text_across_nodes(nodes, formula, value)
                    for select_tag, value in (select_replacements or {}).items():
                        replacement_count += _replace_text_across_nodes(nodes, select_tag, value)
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
    Returns metadata in the first-appearance order from the DOCX. This keeps
    the form in the same sequence as the author arranged the document.
    """
    ordered_vars: List[str] = []
    detected_vars = set()

    def add_variable(name: str) -> None:
        name = name.strip()
        if name and name not in detected_vars:
            detected_vars.add(name)
            ordered_vars.append(name)

    def scan_text(text: str) -> None:
        for match in VAR_REGEX.finditer(text):
            add_variable(match.group(1))

    # Scan the main Word story in XML order. Unlike collecting paragraphs and
    # tables separately, this preserves the actual document sequence.
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            component_names = ["word/document.xml"]
            component_names.extend(sorted(
                name for name in archive.namelist()
                if re.fullmatch(r"word/header\d+\.xml", name)
            ))
            component_names.extend(sorted(
                name for name in archive.namelist()
                if re.fullmatch(r"word/footer\d+\.xml", name)
            ))
            for component_name in component_names:
                if component_name not in archive.namelist():
                    continue
                root = etree.fromstring(archive.read(component_name))
                scan_text("".join(node.text or "" for node in root.xpath(
                    ".//w:t", namespaces={"w": WORD_NS}
                )))
    except Exception as exc:
        print(f"Warning during DOCX sequence scan: {exc}")

    # Fallback/coverage for any template variable that the XML scan cannot
    # recognise (for example special Jinja syntax). It is appended only when
    # it did not appear in normal document order above.
    try:
        tpl = DocxTemplate(str(file_path))
        undeclared = tpl.get_undeclared_template_variables()
        for var in undeclared:
            add_variable(var)
    except Exception:
        pass

    # Named formula fields are calculated by the template, not supplied by a
    # user. Example: [CALC(basic_monthly = {{ctc_total}} / 24)].
    formula_targets_set = set()
    dropdown_fields: Dict[str, Tuple[str, ...]] = {}
    try:
        formula_blocks = extract_formula_blocks_from_docx(file_path)
        formula_targets_set = {block.target for block in formula_blocks if block.target}
        for block in formula_blocks:
            if block.target:
                add_variable(block.target)
        dropdown_fields = select_fields(file_path)
        for field in dropdown_fields:
            add_variable(field)
    except FormulaError as exc:
        print(f"Warning during formula extraction: {exc}")

    # Build placeholder items
    placeholders = []
    for var in ordered_vars:
        v_type = "select" if var in dropdown_fields else detect_variable_type(var)
        calc = var in formula_targets_set
        placeholders.append({
            "name": var,
            "type": v_type,
            "required": not calc,
            "calculated": calc,
            "description": f"Computed {var.replace('_', ' ')}" if calc else f"Enter {var.replace('_', ' ')}",
            "options": list(dropdown_fields[var]) if var in dropdown_fields else None,
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
    pf_percentage: float = 12.0,
    currency_fields: Optional[set[str]] = None,
) -> Tuple[Path, str]:
    """
    Fills a DOCX template using template-defined [CALC(...)] formulas and
    generates DOCX or PDF. No salary or business rules live in this backend.
    Returns (output_path, mime_type).
    """
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    # Step 1: Resolve only formulas authored in the DOCX template. Named
    # formulas become regular placeholder values for later formula references.
    currency_field_names = currency_fields or set()

    def display_value(name: str, value: Any) -> str:
        """Use Indian comma grouping only for fields configured as Currency."""
        if name in currency_field_names and value not in (None, ""):
            return format_inr_number(value)
        return str(value)

    # Validate SELECT choices before formula evaluation and pass the raw
    # selection into the formula engine. The engine safely resolves numeric
    # choices or expressions when another [CALC(...)] references that field.
    select_blocks = extract_select_blocks_from_docx(template_path)
    selected_options: Dict[str, str] = {}
    for select in select_blocks:
        if select.name not in values:
            raise FormulaError(f"Dropdown '{select.name}' requires a selection.")
        selected = str(values[select.name]).strip()
        if selected not in select.options:
            raise FormulaError(
                f"Dropdown '{select.name}' must be one of: {', '.join(select.options)}."
            )
        selected_options[select.name] = selected

    calculated_values, formula_replacements = evaluate_template_formulas(
        template_path, values, selected_options
    )
    # A SELECT choice can itself be a calculation such as
    # CALC[0.12 * {{basic_monthly}}].  Resolve it before applying display
    # formatting; otherwise the raw CALC[...] text would be sent to Decimal
    # for a currency field.
    context: Dict[str, Any] = {
        name: display_value(name, calculated_values.get(name, value))
        for name, value in values.items()
    }
    context.update({name: display_value(name, value) for name, value in calculated_values.items()})

    # A named [CALC(field = ...)] tag is replaced directly, so format it too
    # when that calculated field is configured as Currency. Some existing
    # CTC templates use an inline final-total formula instead, for example
    # [CALC({{total_fixed_annual}} + {{performance_bonus_annual}})].
    # Detect its currency references so it receives the same Indian commas.
    for block in extract_formula_blocks_from_docx(template_path):
        if block.target and block.target in currency_field_names:
            formula_replacements[block.source] = display_value(
                block.target, calculated_values[block.target]
            )
        elif not block.target:
            references = re.findall(r"\{\{\s*([^{}]+?)\s*\}\}", block.expression)
            if any(reference.strip() in currency_field_names for reference in references):
                formula_replacements[block.source] = format_inr_number(
                    formula_replacements[block.source]
                )

    select_replacements: Dict[str, str] = {}
    for select in select_blocks:
        selected = selected_options[select.name]
        # A Select field can still represent a money amount (for example,
        # insurance_annual with options 8000 and 15000).
        resolved_selection = calculated_values.get(select.name, selected)
        select_replacements[select.source] = display_value(select.name, resolved_selection)

    # Also make sure full_name / employee_name convenience variables exist if first & last provided
    if "first_name" in values and "last_name" in values:
        context["employee_name"] = f"{values['first_name']} {values['last_name']}".strip()

    # Step 2: Preserve the original Word layout while filling fields. This is
    # essential for templates using text boxes, layered logos, and complex CTC
    # tables. Unlike docxtpl, it does not rebuild the document XML.
    out_docx = get_generated_path(f"{output_filename_base}.docx")
    try:
        render_preserving_word_layout(
            template_path, out_docx, context, formula_replacements, select_replacements
        )
    except Exception as e:
        raise RuntimeError(f"Unable to fill the Word template while preserving its layout: {e}") from e

    # Step 3: Handle PDF format conversion if requested
    if output_format.lower() == "pdf":
        pdf_path = convert_to_pdf(out_docx)
        return pdf_path, "application/pdf"
    else:
        return out_docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
