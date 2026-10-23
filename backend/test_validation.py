from validation import detect_variable_type, validate_and_normalize_value


def test_serial_number_is_text_and_preserves_leading_zeroes():
    assert detect_variable_type("serial_number") == "text"
    valid, value, error = validate_and_normalize_value(
        "serial_number", "text", "013", required=True
    )
    assert valid is True
    assert value == "013"
    assert error is None
