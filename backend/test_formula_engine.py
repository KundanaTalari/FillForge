from pathlib import Path

import pytest
from docx import Document

from formula_engine import FormulaError, evaluate_template_formulas, select_fields
from generation import extract_placeholders_from_docx, render_document


def make_template(path: Path, formulas: list[str]) -> Path:
    document = Document()
    for formula in formulas:
        document.add_paragraph(formula)
    document.add_paragraph("Result: {{total_fixed_monthly}}")
    document.save(path)
    return path


def test_dependency_resolution_and_pf_boundaries(tmp_path):
    template = make_template(tmp_path / "rules.docx", [
        "[CALC(basic_monthly = {{ctc_total}} / 24)]",
        "[CALC(pf_monthly = MIN({{basic_monthly}}, 25000) * 0.12)]",
        "[CALC(hra_monthly = {{basic_monthly}} * 0.10)]",
        "[CALC(total_fixed_monthly = {{basic_monthly}} + {{hra_monthly}} + {{pf_monthly}})]",
    ])
    # Basic values: 20k, 25k, 25,001, and 30k. PF cap is defined by template.
    for basic, expected_pf in [(20000, 2400), (25000, 3000), (25001, 3000), (30000, 3000)]:
        values, _ = evaluate_template_formulas(template, {"ctc_total": basic * 24})
        assert values["basic_monthly"] == basic
        assert values["pf_monthly"] == expected_pf


def test_if_min_max_and_inline_formula(tmp_path):
    template = make_template(tmp_path / "if.docx", [
        "[CALC(basic_monthly = {{ctc_total}} / 24)]",
        "[CALC(pf_monthly = IF({{basic_monthly}} <= 25000, {{basic_monthly}} * 0.12, 25000 * 0.12))]",
        "Inline PF: [CALC(MAX({{pf_monthly}}, 1800))]",
    ])
    values, replacements = evaluate_template_formulas(template, {"ctc_total": 600000})
    assert values["basic_monthly"] == 25000
    assert values["pf_monthly"] == 3000
    assert "3000" in replacements.values()


def test_undefined_variable_is_clear(tmp_path):
    template = make_template(tmp_path / "undefined.docx", ["[CALC(result = {{unknown_variable}} + 100)]"])
    with pytest.raises(FormulaError, match="undefined variable: unknown_variable"):
        evaluate_template_formulas(template, {"ctc_total": 100})


def test_invalid_formula_is_clear(tmp_path):
    template = make_template(tmp_path / "invalid.docx", ["[CALC(result = {{ctc_total}} /)]"])
    with pytest.raises(FormulaError, match="Invalid formula"):
        evaluate_template_formulas(template, {"ctc_total": 100})


def test_circular_dependency_is_clear(tmp_path):
    template = make_template(tmp_path / "cycle.docx", [
        "[CALC(a = {{b}} + 1)]",
        "[CALC(b = {{a}} + 1)]",
    ])
    with pytest.raises(FormulaError, match="Circular calculation dependency detected"):
        evaluate_template_formulas(template, {})


def test_docx_generation_preserves_template_and_reacts_to_changed_formula(tmp_path):
    template = make_template(tmp_path / "integration.docx", [
        "[CALC(total_fixed_monthly = {{ctc_total}} / 24)]",
    ])
    output_one, _ = render_document(template, {"ctc_total": 240000}, "formula_one", "docx")
    assert output_one.exists()
    # Changing only the DOCX formula changes the result; backend code is untouched.
    make_template(template, ["[CALC(total_fixed_monthly = {{ctc_total}} / 12)]"])
    output_two, _ = render_document(template, {"ctc_total": 240000}, "formula_two", "docx")
    assert output_two.exists()
    assert output_one.read_bytes() != output_two.read_bytes()


def test_docx_select_tag_becomes_a_dropdown_field_and_renders_selection(tmp_path):
    template = make_template(tmp_path / "dropdown.docx", [
        "Annual medical insurance: [SELECT(insurance_annual, 8000, 15000)]",
    ])
    fields = select_fields(template)
    assert fields == {"insurance_annual": ("8000", "15000")}
    placeholders = extract_placeholders_from_docx(template)
    insurance = next(field for field in placeholders if field["name"] == "insurance_annual")
    assert insurance["options"] == ["8000", "15000"]

    output, _ = render_document(template, {"insurance_annual": 15000}, "dropdown_output", "docx")
    generated = Document(output)
    assert "[SELECT(" not in "\n".join(paragraph.text for paragraph in generated.paragraphs)
    assert "15000" in "\n".join(paragraph.text for paragraph in generated.paragraphs)
