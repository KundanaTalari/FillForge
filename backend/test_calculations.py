import sys
from decimal import Decimal
from calculations import calculate_ctc, evaluate_expression, evaluate_calc_tags, format_inr_currency

def test_ctc_exact_example():
    """Verifies Section 32 CTC calculation test case."""
    res = calculate_ctc(ctc_total=600000, basic_pf=1800, pf_mode="fixed")
    
    assert res["annual_basic"]["raw_value"] == 300000, f"Annual Basic failed: {res['annual_basic']}"
    assert res["basic_per_month"]["raw_value"] == 25000, f"Basic Per Month failed: {res['basic_per_month']}"
    assert res["annual_hra"]["raw_value"] == 150000, f"Annual HRA failed: {res['annual_hra']}"
    assert res["hra_per_month"]["raw_value"] == 12500, f"HRA Per Month failed: {res['hra_per_month']}"
    assert res["pf_per_year"]["raw_value"] == 21600, f"PF Per Year failed: {res['pf_per_year']}"
    assert res["pf_per_month"]["raw_value"] == 1800, f"PF Per Month failed: {res['pf_per_month']}"
    assert res["gratuity_per_year"]["raw_value"] == 14430, f"Gratuity Per Year failed: {res['gratuity_per_year']}"
    assert res["gratuity_per_month"]["raw_value"] == 1202.50, f"Gratuity Per Month failed: {res['gratuity_per_month']}"
    assert res["special_allowance"]["raw_value"] == 113970, f"Special Allowance failed: {res['special_allowance']}"
    assert res["monthly_special_allowance"]["raw_value"] == 9497.50, f"Monthly Special Allowance failed: {res['monthly_special_allowance']}"

    assert "₹3,00,000" in res["annual_basic"]["formatted_value"]
    assert "₹25,000" in res["basic_per_month"]["formatted_value"]
    assert "₹1,50,000" in res["annual_hra"]["formatted_value"]
    assert "₹12,500" in res["hra_per_month"]["formatted_value"]
    assert "₹21,600" in res["pf_per_year"]["formatted_value"]
    assert "₹1,800" in res["pf_per_month"]["formatted_value"]
    assert "₹14,430" in res["gratuity_per_year"]["formatted_value"]
    assert "₹1,202.50" in res["gratuity_per_month"]["formatted_value"]
    assert "₹1,13,970" in res["special_allowance"]["formatted_value"]
    assert "₹9,497.50" in res["monthly_special_allowance"]["formatted_value"]
    print("✅ All CTC calculations passed exact specifications!")

def test_safe_evaluation():
    ctx = {"ctc_total": 600000, "basic_pf": 1800}
    val = evaluate_expression("{{ctc_total}} / 2", ctx)
    assert val == 300000, f"Expected 300000, got {val}"

    val_pf = evaluate_expression("{{basic_pf}} * 12", ctx)
    assert val_pf == 21600, f"Expected 21600, got {val_pf}"

    text = "Your annual basic is [CALC({{ctc_total}}/2)] and monthly is [CALC({{ctc_total}}/24)]."
    rendered = evaluate_calc_tags(text, ctx)
    assert "Your annual basic is 300000 and monthly is 25000." == rendered, f"Got: {rendered}"
    print("✅ Safe expression evaluation passed!")

def test_percentage_pf():
    res = calculate_ctc(ctc_total=600000, pf_mode="percentage", pf_percentage=12)
    # Annual basic = 300000, 12% = 36000
    assert res["pf_per_year"]["raw_value"] == 36000
    assert res["pf_per_month"]["raw_value"] == 3000
    print("✅ Percentage PF calculation passed!")

if __name__ == "__main__":
    test_ctc_exact_example()
    test_safe_evaluation()
    test_percentage_pf()
