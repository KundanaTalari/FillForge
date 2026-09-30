import re
from datetime import datetime
from decimal import Decimal
from typing import Dict, Any, Tuple, Optional, List

EMAIL_REGEX = re.compile(r"^[\w\.\+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-\.]+$")
PHONE_REGEX = re.compile(r"^[\+]?[0-9\s\-\(\)]{7,18}$")

def detect_variable_type(name: str) -> str:
    """
    Infers variable type from placeholder name based on domain conventions.
    """
    s = name.lower().strip()
    # Split `ReportingManager`, `employee_age`, and `employee-age` into
    # semantic tokens. Never use raw substring matching for `age`: it appears
    # inside normal words such as ManAGER and enGAGEment.
    tokens = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower().replace("-", "_").split("_")
    token_set = {token for token in tokens if token}

    # Amount-in-words fields are text. Whether they are calculated is decided
    # by a named [CALC(field = ...)] formula in the DOCX, not this backend.
    if "inwords" in s or "_in_words" in s:
        return "text"
    
    # Datetime before date
    if s.endswith("_at") or "datetime" in s or s in ["created_at", "updated_at", "timestamp"]:
        return "datetime"

    # Time
    if "time" in s or s.startswith("time_") or s.endswith("_time"):
        return "time"

    # Date
    if "date" in s or s.startswith("dob") or s in ["date_of_birth", "date_of_joining", "joining_date", "relieving_date"]:
        return "date"

    # Currency
    if any(k in s for k in ["ctc", "salary", "basic", "hra", "allowance", "gratuity", "pf", "bonus", "stipend", "pay", "fee"]):
        if not ("percentage" in s or "percent" in s or "mode" in s):
            return "currency"

    # Percentage
    if any(k in s for k in ["percentage", "percent", "pct", "rate"]):
        return "percentage"

    # Email
    if "email" in s:
        return "email"

    # Phone
    if any(k in s for k in ["phone", "mobile", "contact_no", "contact_number", "cell"]):
        return "phone"

    # Boolean
    if s.startswith("is_") or s.startswith("has_") or s in ["active", "verified", "eligible"]:
        return "boolean"

    # Numbers
    if token_set.intersection({"count", "qty", "quantity", "age", "years", "months", "days", "number", "num", "score", "rank"}):
        return "number"

    # Default
    return "text"


def is_calculated_variable(name: str) -> bool:
    """Calculated status comes from a named DOCX formula, not name heuristics."""
    return False


def validate_and_normalize_value(field_name: str, var_type: str, value: Any, required: bool = True) -> Tuple[bool, Any, Optional[str]]:
    """
    Validates and normalizes an input value according to its type.
    Returns (is_valid, normalized_value, error_message).
    """
    if value is None or (isinstance(value, str) and value.strip() == ""):
        if required and not is_calculated_variable(field_name):
            return False, None, f"'{field_name}' is required."
        return True, "", None

    val_str = str(value).strip()

    if var_type == "text":
        return True, val_str, None

    elif var_type in ("currency", "number"):
        # Remove currency symbols and commas
        cleaned = re.sub(r"[₹$,\s]", "", val_str)
        try:
            num = Decimal(cleaned)
            # If integer, return int; else float
            if num == num.to_integral():
                return True, int(num), None
            return True, float(num), None
        except Exception:
            return False, None, f"'{field_name}' must be a valid number."

    elif var_type == "percentage":
        cleaned = re.sub(r"[%\s]", "", val_str)
        try:
            num = float(cleaned)
            if num < 0 or num > 100:
                return False, None, f"'{field_name}' percentage must be between 0 and 100."
            return True, num, None
        except Exception:
            return False, None, f"'{field_name}' must be a valid percentage (0-100)."

    elif var_type == "date":
        # Browsers submit HTML date inputs as YYYY-MM-DD, but offer letters
        # should render dates in the Indian day-month-year format.
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
            try:
                dt = datetime.strptime(val_str, fmt)
                return True, dt.strftime("%d-%m-%Y"), None
            except ValueError:
                pass
        return False, None, f"'{field_name}' must be a valid date in YYYY-MM-DD format."

    elif var_type == "time":
        for fmt in ("%H:%M:%S", "%H:%M", "%I:%M %p", "%I:%M:%S %p"):
            try:
                tm = datetime.strptime(val_str, fmt)
                return True, tm.strftime("%H:%M:%S"), None
            except ValueError:
                pass
        return False, None, f"'{field_name}' must be a valid time in HH:MM:SS format."

    elif var_type == "datetime":
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(val_str, fmt)
                return True, dt.strftime("%Y-%m-%dT%H:%M:%S"), None
            except ValueError:
                pass
        return False, None, f"'{field_name}' must be a valid datetime in ISO format."

    elif var_type == "email":
        if EMAIL_REGEX.match(val_str):
            return True, val_str.lower(), None
        return False, None, f"'{field_name}' must be a valid email address."

    elif var_type == "phone":
        if PHONE_REGEX.match(val_str):
            return True, val_str, None
        return False, None, f"'{field_name}' must be a valid phone number."

    elif var_type == "boolean":
        if isinstance(value, bool):
            return True, value, None
        if val_str.lower() in ("true", "1", "yes", "y"):
            return True, True, None
        if val_str.lower() in ("false", "0", "no", "n"):
            return True, False, None
        return False, None, f"'{field_name}' must be a boolean (true/false)."

    return True, val_str, None
