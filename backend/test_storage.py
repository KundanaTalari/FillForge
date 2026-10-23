from storage import download_name_from_pattern


def test_download_name_pattern_uses_document_values_and_built_ins():
    result = download_name_from_pattern(
        "{{employee_id}}_{{filename}}_{{full_name}}",
        {"employee_id": "EMP-001", "full_name": "Kundana Talari"},
        "Offer Letter.docx",
        "document-123",
    )
    assert result == "EMP-001_Offer_Letter_Kundana_Talari"


def test_download_name_pattern_prefers_an_id_field_and_rejects_unknown_tokens():
    assert download_name_from_pattern("{{id}}", {"id": "EMP-002"}, "Offer.docx", "document-123") == "EMP-002"

    try:
        download_name_from_pattern("{{missing}}", {}, "Offer.docx", "document-123")
    except ValueError as exc:
        assert "Unknown download-name placeholder" in str(exc)
    else:
        raise AssertionError("An unknown placeholder should be rejected.")
