from pathlib import Path
from decimal import Decimal

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


@pytest.mark.parametrize(("expression", "expected"), [
    ("ROUND(10.4, 0)", Decimal("10")),
    ("ROUND(10.5, 0)", Decimal("11")),
    ("ROUND(10.6, 0)", Decimal("11")),
    ("ROUND(123.456, 2)", Decimal("123.46")),
    ("ROUND(123.454, 2)", Decimal("123.45")),
    ("ROUND(123.455, 2)", Decimal("123.46")),
    ("ROUND(-10.5, 0)", Decimal("-11")),
    ("ROUND(MIN(30000, 25000) * 0.12, 0)", Decimal("3000")),
])
def test_round_uses_excel_half_away_from_zero(tmp_path, expression, expected):
    template = make_template(tmp_path / "round.docx", [f"[CALC(result = {expression})]"])
    values, _ = evaluate_template_formulas(template, {})
    assert values["result"] == expected


def test_round_resolves_placeholders_and_preserves_existing_min(tmp_path):
    template = make_template(tmp_path / "round_placeholder.docx", [
        "[CALC(basic_monthly = ROUND({{ctc_total}} / 24, 0))]",
        "[CALC(pf_monthly = MIN({{basic_monthly}}, 25000) * 0.12)]",
    ])
    # 240,012 / 24 = 10,000.5, which must round up to 10,001.
    values, replacements = evaluate_template_formulas(template, {"ctc_total": 240012})
    assert values["basic_monthly"] == Decimal("10001")
    assert values["pf_monthly"] == Decimal("1200.12")
    assert "10001" in replacements.values()


def test_round_rejects_non_integer_digits(tmp_path):
    template = make_template(tmp_path / "invalid_round.docx", ["[CALC(result = ROUND(10.5, 0.5))]"])
    with pytest.raises(FormulaError, match="ROUND digits must be an integer"):
        evaluate_template_formulas(template, {})


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
