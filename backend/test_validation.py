from validation import detect_variable_type


def test_performance_fields_default_to_number_not_currency():
    assert detect_variable_type("performance_bonus") == "number"
    assert detect_variable_type("PerformanceBonus") == "number"
    assert detect_variable_type("performance_bonus_annual") == "currency"


def test_regular_salary_fields_still_default_to_currency():
    assert detect_variable_type("special_allowance") == "currency"
    assert detect_variable_type("gross_monthly") == "currency"
    assert detect_variable_type("total_fixed_annual") == "currency"
