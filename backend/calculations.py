"""Generic display helpers only.

Business calculations belong in DOCX [CALC(...)] formulas and are evaluated by
formula_engine.py. This module intentionally contains no salary rules.
"""

from decimal import Decimal, ROUND_HALF_UP
from typing import Union


def format_inr_currency(value: Union[Decimal, float, int]) -> str:
    """Format a number in Indian currency notation for presentation only."""
    amount = Decimal(str(value))
    negative = amount < 0
    amount = abs(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    integer, _, fractional = format(amount, "f").partition(".")
    if len(integer) > 3:
        last_three, remaining = integer[-3:], integer[:-3]
        groups = []
        while remaining:
            groups.insert(0, remaining[-2:])
            remaining = remaining[:-2]
        integer = ",".join(groups + [last_three])
    suffix = f".{fractional}" if fractional != "00" else ""
    return f"{'-' if negative else ''}₹{integer}{suffix}"
