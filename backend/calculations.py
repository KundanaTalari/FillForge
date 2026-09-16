import ast
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any, Union, Tuple

# Configurable gratuity rate
GRATUITY_RATE = Decimal("0.0481")

CALC_PATTERN = re.compile(r"\[CALC\((.*?)\)\]", re.DOTALL)
VAR_PATTERN = re.compile(r"\{\{([a-zA-Z0-9_]+)\}\}")

class SafeEvaluator(ast.NodeVisitor):
    """
    Safely evaluates simple mathematical expressions using AST.
    Guarantees no arbitrary code execution (no eval, no imports, no function calls).
    """
    ALLOWED_OPERATORS = {
        ast.Add: lambda a, b: a + b,
        ast.Sub: lambda a, b: a - b,
        ast.Mult: lambda a, b: a * b,
        ast.Div: lambda a, b: a / b,
        ast.USub: lambda a: -a,
        ast.UAdd: lambda a: +a,
    }

    def __init__(self, variables: Dict[str, Decimal]):
        self.variables = variables

    def visit_Expression(self, node):
        return self.visit(node.body)

    def visit_Constant(self, node):
        if isinstance(node.value, (int, float)):
            return Decimal(str(node.value))
        raise ValueError(f"Unsupported constant type: {type(node.value)}")

    # Python < 3.8 compatibility if ast.Num exists
    def visit_Num(self, node):
        return Decimal(str(node.n))

    def visit_Name(self, node):
        if node.id in self.variables:
            return self.variables[node.id]
        raise ValueError(f"Variable '{node.id}' is not defined in calculation context")

    def visit_UnaryOp(self, node):
        op_type = type(node.op)
        if op_type in self.ALLOWED_OPERATORS:
            operand = self.visit(node.operand)
            return self.ALLOWED_OPERATORS[op_type](operand)
        raise ValueError(f"Unsupported unary operator: {op_type}")

    def visit_BinOp(self, node):
        op_type = type(node.op)
        if op_type in self.ALLOWED_OPERATORS:
            left = self.visit(node.left)
            right = self.visit(node.right)
            if op_type == ast.Div and right == 0:
                raise ZeroDivisionError("Division by zero in formula")
            return self.ALLOWED_OPERATORS[op_type](left, right)
        raise ValueError(f"Unsupported binary operator: {op_type}")

    def generic_visit(self, node):
        raise ValueError(f"Operation not permitted in calculation: {type(node).__name__}")


def evaluate_expression(expr: str, context: Dict[str, Union[Decimal, int, float, str]]) -> Decimal:
    """
    Evaluates an arithmetic expression safely using AST.
    Replaces any {{var}} references with their variable names before parsing.
    """
    # Replace {{var_name}} with var_name for AST parsing
    cleaned_expr = VAR_PATTERN.sub(r"\1", expr.strip())
    
    # Prepare decimal variable map
    dec_vars: Dict[str, Decimal] = {}
    for k, v in context.items():
        if v is not None and v != "":
            try:
                dec_vars[k] = Decimal(str(v))
            except Exception:
                pass

    tree = ast.parse(cleaned_expr, mode='eval')
    evaluator = SafeEvaluator(dec_vars)
    return evaluator.visit(tree)


def evaluate_calc_tags(text: str, context: Dict[str, Any]) -> str:
    """
    Finds all [CALC(...)] blocks in text, evaluates them safely, and replaces them with the result.
    """
    def replacer(match):
        raw_expr = match.group(1)
        try:
            val = evaluate_expression(raw_expr, context)
            # Format cleanly
            if val == val.to_integral():
                return str(int(val))
            return str(round(float(val), 2))
        except Exception as e:
            return f"[CALC_ERROR: {str(e)}]"

    return CALC_PATTERN.sub(replacer, text)


def format_inr_currency(val: Union[Decimal, float, int]) -> str:
    """
    Formats a numeric amount in standard Indian Currency Format (Lakh/Crore):
    e.g. 600000 -> ₹6,00,000, 9497.50 -> ₹9,497.50
    """
    try:
        dec = Decimal(str(val))
    except Exception:
        return str(val)

    is_negative = dec < 0
    dec = abs(dec)

    # Round to 2 decimal places if there are decimals
    dec_rounded = dec.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    parts = str(dec_rounded).split(".")
    integer_part = parts[0]
    decimal_part = parts[1] if len(parts) > 1 else ""

    # Indian numbering: rightmost 3 digits, then groups of 2 digits
    if len(integer_part) <= 3:
        formatted_int = integer_part
    else:
        last3 = integer_part[-3:]
        remaining = integer_part[:-3]
        groups = []
        while len(remaining) > 2:
            groups.insert(0, remaining[-2:])
            remaining = remaining[:-2]
        if remaining:
            groups.insert(0, remaining)
        groups.append(last3)
        formatted_int = ",".join(groups)

    if decimal_part and decimal_part != "00":
        res = f"₹{formatted_int}.{decimal_part}"
    else:
        res = f"₹{formatted_int}"

    return f"-{res}" if is_negative else res


def round_decimal(val: Decimal, places: int = 2) -> Decimal:
    """Rounds Decimal to specified decimal places using ROUND_HALF_UP."""
    q = Decimal("1") if places == 0 else Decimal("0." + "0" * places)
    return val.quantize(q, rounding=ROUND_HALF_UP)


def calculate_ctc(
    ctc_total: Union[Decimal, float, int, str],
    basic_pf: Union[Decimal, float, int, str] = 1800,
    pf_mode: str = "fixed",
    pf_percentage: Union[Decimal, float, int, str] = 12,
    custom_gratuity_rate: Decimal = GRATUITY_RATE
) -> Dict[str, Dict[str, Any]]:
    """
    Dedicated CTC calculation engine.
    Calculates in strict dependency order:
    1. Annual Basic = CTC Total / 2
    2. Basic Per Month = CTC Total / 24
    3. Annual HRA = CTC Total / 4
    4. HRA Per Month = CTC Total / 48
    5. PF (Fixed or Percentage)
       Fixed:
         PF Per Month = basic_pf
         PF Per Year = basic_pf * 12
       Percentage:
         PF Per Year = (CTC Total / 2) * (pf_percentage / 100)
         PF Per Month = (CTC Total / 24) * (pf_percentage / 100)
    6. Gratuity:
       Gratuity Per Year = (CTC Total / 2) * GRATUITY_RATE
       Gratuity Per Month = (CTC Total / 24) * GRATUITY_RATE
    7. Special Allowance:
       Special Allowance (Annual) = CTC Total - (Annual Basic + Annual HRA + Annual PF + Annual Gratuity)
       Monthly Special Allowance = Special Allowance / 12

    Returns structured dictionary with both raw_value (float) and formatted_value (INR string).
    """
    ctc_dec = Decimal(str(ctc_total or 0))
    basic_pf_dec = Decimal(str(basic_pf or 0))
    pf_pct_dec = Decimal(str(pf_percentage or 12)) / Decimal("100")

    # 1. Annual Basic & Monthly Basic
    annual_basic = ctc_dec / Decimal("2")
    basic_per_month = ctc_dec / Decimal("24")

    # 2. Annual HRA & Monthly HRA
    annual_hra = ctc_dec / Decimal("4")
    hra_per_month = ctc_dec / Decimal("48")

    # 3. PF calculations
    if pf_mode == "percentage":
        pf_per_year = annual_basic * pf_pct_dec
        pf_per_month = basic_per_month * pf_pct_dec
    else:  # fixed mode
        pf_per_month = basic_pf_dec
        pf_per_year = basic_pf_dec * Decimal("12")

    # 4. Gratuity calculations
    gratuity_per_year = annual_basic * custom_gratuity_rate
    gratuity_per_month = basic_per_month * custom_gratuity_rate

    # 5. Special Allowance calculations
    total_deductions = annual_basic + annual_hra + pf_per_year + gratuity_per_year
    special_allowance = ctc_dec - total_deductions
    monthly_special_allowance = special_allowance / Decimal("12")

    # Store definitions
    raw_results = {
        "ctc_total": ctc_dec,
        "annual_basic": round_decimal(annual_basic, 2),
        "basic_per_month": round_decimal(basic_per_month, 2),
        "annual_hra": round_decimal(annual_hra, 2),
        "hra_per_month": round_decimal(hra_per_month, 2),
        "pf_per_year": round_decimal(pf_per_year, 2),
        "pf_per_month": round_decimal(pf_per_month, 2),
        "gratuity_per_year": round_decimal(gratuity_per_year, 2),
        "gratuity_per_month": round_decimal(gratuity_per_month, 2),
        "special_allowance": round_decimal(special_allowance, 2),
        "monthly_special_allowance": round_decimal(monthly_special_allowance, 2),
    }

    formatted = {}
    for k, v in raw_results.items():
        val_float = float(v)
        # Format as int if whole number
        if v == v.to_integral():
            val_float = int(v)
        formatted[k] = {
            "raw_value": val_float,
            "formatted_value": format_inr_currency(v)
        }

    return formatted
