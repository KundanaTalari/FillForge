"""Safe, template-driven [CALC(...)] evaluation for DOCX templates.

The template owns every business formula. This module only parses a limited
math language and resolves calculated-field dependencies; it contains no
salary, PF, HRA, gratuity, or compensation rules.
"""

import ast
import re
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from lxml import etree

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
PLACEHOLDER_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
ASSIGNMENT_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9_ ]*)\s*=\s*(?![=])(.*)$", re.DOTALL)


class FormulaError(ValueError):
    """A template formula is invalid, unsafe, or cannot be resolved."""


@dataclass(frozen=True)
class FormulaBlock:
    source: str
    expression: str
    target: Optional[str] = None


@dataclass(frozen=True)
class SelectBlock:
    """A DOCX-authored dropdown: [SELECT(field_name, option_a, option_b)]."""
    source: str
    name: str
    options: Tuple[str, ...]


def find_calc_blocks(text: str) -> List[FormulaBlock]:
    """Find balanced [CALC(...)] blocks, including nested safe function calls."""
    blocks: List[FormulaBlock] = []
    index = 0
    while True:
        start = text.find("[CALC(", index)
        if start < 0:
            return blocks
        cursor = start + len("[CALC(")
        depth = 1
        while cursor < len(text) and depth:
            if text[cursor] == "(":
                depth += 1
            elif text[cursor] == ")":
                depth -= 1
            cursor += 1
        if depth or cursor >= len(text) or text[cursor] != "]":
            raise FormulaError(f"Invalid formula at character {start}: missing closing )].")
        source = text[start:cursor + 1]
        body = text[start + len("[CALC("):cursor - 1].strip()
        match = ASSIGNMENT_RE.match(body)
        target = match.group(1).strip() if match else None
        expression = match.group(2).strip() if match else body
        if not expression:
            raise FormulaError(f"Invalid formula {source}: expression is empty.")
        blocks.append(FormulaBlock(source=source, expression=expression, target=target))
        index = cursor + 1


def find_select_blocks(text: str) -> List[SelectBlock]:
    """Find and validate non-nested DOCX dropdown tags.

    Values are intentionally plain text so a template can offer numbers,
    departments, locations, or any other fixed choices.
    """
    blocks: List[SelectBlock] = []
    pattern = re.compile(r"\[SELECT\(([^\]]*)\)\]")
    for match in pattern.finditer(text):
        parts = [part.strip() for part in match.group(1).split(",")]
        if len(parts) < 3 or not parts[0] or any(not option for option in parts[1:]):
            raise FormulaError(
                "Dropdown must use [SELECT(field_name, option1, option2)]."
            )
        name = parts[0]
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_ ]*", name):
            raise FormulaError(f"Invalid dropdown field name: {name}")
        blocks.append(SelectBlock(source=match.group(0), name=name, options=tuple(parts[1:])))
    return blocks


def extract_formula_blocks_from_docx(template_path: Path) -> List[FormulaBlock]:
    """Read formulas from body, tables, headers, footers, and text boxes."""
    blocks: List[FormulaBlock] = []
    with zipfile.ZipFile(template_path, "r") as archive:
        for name in archive.namelist():
            if not (name.startswith("word/") and name.endswith(".xml")):
                continue
            try:
                root = etree.fromstring(archive.read(name))
                text = "".join(node.text or "" for node in root.xpath(".//w:t", namespaces={"w": WORD_NS}))
                blocks.extend(find_calc_blocks(text))
            except etree.XMLSyntaxError:
                continue
    return blocks


def extract_select_blocks_from_docx(template_path: Path) -> List[SelectBlock]:
    """Read dropdown definitions from all Word XML parts."""
    blocks: List[SelectBlock] = []
    with zipfile.ZipFile(template_path, "r") as archive:
        for name in archive.namelist():
            if not (name.startswith("word/") and name.endswith(".xml")):
                continue
            try:
                root = etree.fromstring(archive.read(name))
                text = "".join(node.text or "" for node in root.xpath(".//w:t", namespaces={"w": WORD_NS}))
                blocks.extend(find_select_blocks(text))
            except etree.XMLSyntaxError:
                continue
    return blocks


def select_fields(template_path: Path) -> Dict[str, Tuple[str, ...]]:
    """Return the allowed choices for every dropdown field in a template."""
    fields: Dict[str, Tuple[str, ...]] = {}
    for block in extract_select_blocks_from_docx(template_path):
        existing = fields.get(block.name)
        if existing and existing != block.options:
            raise FormulaError(f"Dropdown '{block.name}' has conflicting options in the template.")
        fields[block.name] = block.options
    return fields


def formula_targets(template_path: Path) -> Set[str]:
    return {block.target for block in extract_formula_blocks_from_docx(template_path) if block.target}


class _SafeFormulaEvaluator(ast.NodeVisitor):
    def __init__(self, variables: Dict[str, Decimal]):
        self.variables = variables

    def visit_Expression(self, node: ast.Expression) -> Decimal | bool:
        return self.visit(node.body)

    def visit_Constant(self, node: ast.Constant) -> Decimal:
        if isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return Decimal(str(node.value))
        raise FormulaError("Only decimal numbers are allowed in formulas.")

    def visit_Name(self, node: ast.Name) -> Decimal:
        if node.id not in self.variables:
            raise FormulaError(f"Formula references undefined variable: {node.id}")
        return self.variables[node.id]

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Decimal:
        value = self._number(self.visit(node.operand))
        if isinstance(node.op, ast.UAdd):
            return value
        if isinstance(node.op, ast.USub):
            return -value
        raise FormulaError("Unsupported unary operator in formula.")

    def visit_BinOp(self, node: ast.BinOp) -> Decimal:
        left, right = self._number(self.visit(node.left)), self._number(self.visit(node.right))
        if isinstance(node.op, ast.Add): return left + right
        if isinstance(node.op, ast.Sub): return left - right
        if isinstance(node.op, ast.Mult): return left * right
        if isinstance(node.op, ast.Div):
            if right == 0: raise FormulaError("Division by zero in formula.")
            return left / right
        raise FormulaError("Unsupported operator in formula.")

    def visit_Compare(self, node: ast.Compare) -> bool:
        left = self._number(self.visit(node.left))
        for operator, comparator in zip(node.ops, node.comparators):
            right = self._number(self.visit(comparator))
            if isinstance(operator, ast.Lt): result = left < right
            elif isinstance(operator, ast.LtE): result = left <= right
            elif isinstance(operator, ast.Gt): result = left > right
            elif isinstance(operator, ast.GtE): result = left >= right
            elif isinstance(operator, ast.Eq): result = left == right
            elif isinstance(operator, ast.NotEq): result = left != right
            else: raise FormulaError("Unsupported comparison operator in formula.")
            if not result: return False
            left = right
        return True

    def visit_Call(self, node: ast.Call) -> Decimal:
        if not isinstance(node.func, ast.Name) or node.keywords:
            raise FormulaError("Only IF, MIN, MAX, and ROUND functions are allowed.")
        function = node.func.id.upper()
        if function == "IF":
            if len(node.args) != 3: raise FormulaError("IF requires exactly three arguments.")
            return self._number(self.visit(node.args[1] if self.visit(node.args[0]) else node.args[2]))
        if function in {"MIN", "MAX"}:
            if not node.args: raise FormulaError(f"{function} requires at least one argument.")
            values = [self._number(self.visit(arg)) for arg in node.args]
            return min(values) if function == "MIN" else max(values)
        if function == "ROUND":
            if len(node.args) != 2:
                raise FormulaError("ROUND requires exactly two arguments: number and digits.")
            value = self._number(self.visit(node.args[0]))
            digits = self._number(self.visit(node.args[1]))
            if digits != digits.to_integral_value():
                raise FormulaError("ROUND digits must be an integer.")
            try:
                # ROUND_HALF_UP gives Excel-style rounding: ties move away
                # from zero (10.5 -> 11, -10.5 -> -11), unlike Python round.
                quantizer = Decimal("1").scaleb(-int(digits))
                return value.quantize(quantizer, rounding=ROUND_HALF_UP)
            except (InvalidOperation, OverflowError, ValueError) as exc:
                raise FormulaError("ROUND could not apply the requested number of digits.") from exc
        raise FormulaError(f"Unsupported formula function: {node.func.id}")

    @staticmethod
    def _number(value: Decimal | bool) -> Decimal:
        if isinstance(value, bool):
            raise FormulaError("A comparison may only be used inside IF.")
        return value

    def generic_visit(self, node: ast.AST):
        raise FormulaError(f"Unsupported formula syntax: {type(node).__name__}.")


def _as_decimal(name: str, value: Any) -> Decimal:
    try:
        return Decimal(str(value).replace(",", "").replace("₹", "").strip())
    except Exception as exc:
        raise FormulaError(f"Formula variable '{name}' must be numeric.") from exc


def format_formula_value(value: Decimal) -> str:
    value = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return str(int(value)) if value == value.to_integral() else format(value, "f")


def evaluate_template_formulas(template_path: Path, input_values: Dict[str, Any]) -> Tuple[Dict[str, Decimal], Dict[str, str]]:
    """Evaluate named and inline formulas and return field values + tag replacements."""
    blocks = extract_formula_blocks_from_docx(template_path)
    definitions: Dict[str, FormulaBlock] = {}
    for block in blocks:
        if block.target:
            if block.target in definitions:
                raise FormulaError(f"Duplicate calculated field in template: {block.target}")
            definitions[block.target] = block

    resolved: Dict[str, Decimal] = {}
    resolving: Set[str] = set()
    inputs = {str(key).strip(): value for key, value in input_values.items() if value not in (None, "")}

    def resolve(name: str) -> Decimal:
        if name in resolved: return resolved[name]
        if name in resolving: raise FormulaError("Circular calculation dependency detected.")
        if name in definitions:
            resolving.add(name)
            result = evaluate_expression(definitions[name].expression)
            resolving.remove(name)
            resolved[name] = result
            return result
        if name in inputs: return _as_decimal(name, inputs[name])
        raise FormulaError(f"Formula references undefined variable: {name}")

    def evaluate_expression(expression: str) -> Decimal:
        identifiers: Dict[str, Decimal] = {}
        sequence = 0
        def placeholder(match: re.Match) -> str:
            nonlocal sequence
            reference = match.group(1).strip()
            identifier = f"_v{sequence}"
            sequence += 1
            identifiers[identifier] = resolve(reference)
            return identifier
        parsed_expression = PLACEHOLDER_RE.sub(placeholder, expression)
        try:
            tree = ast.parse(parsed_expression, mode="eval")
        except SyntaxError as exc:
            raise FormulaError(f"Invalid formula '{expression}': {exc.msg}") from exc
        return _SafeFormulaEvaluator(identifiers).visit(tree)

    for target in definitions:
        resolve(target)

    replacements: Dict[str, str] = {}
    for block in blocks:
        value = resolve(block.target) if block.target else evaluate_expression(block.expression)
        replacements[block.source] = format_formula_value(value)
    return resolved, replacements
