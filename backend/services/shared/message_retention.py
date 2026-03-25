"""
Single MESSAGE_RETENTION_DAYS policy (required env, no in-code default).

- Positive float: age-based cleanup after that many days (same cutoff for compliance MEK,
  soft-deleted DM keys, and edit-history rows). Value may be an arithmetic expression.
- 0: retain forever (no time-based cleanup; compliance MEK is still stored when a public key is configured).
- -1: do not store compliance-wrapped MEK; no time-based cleanup (same as 0 for expiry).
"""

from __future__ import annotations

import ast
import math
import os
from dataclasses import dataclass
from datetime import timedelta
MESSAGE_RETENTION_DAYS = "MESSAGE_RETENTION_DAYS"

_state: MessageRetentionState | None = None


@dataclass(frozen=True)
class MessageRetentionState:
    """Parsed MESSAGE_RETENTION_DAYS (days, after evaluating optional expression)."""

    days: float

    def never_store_compliance_mek(self) -> bool:
        return self.days == -1.0

    def cleanup_enabled(self) -> bool:
        return self.days > 0.0

    def retention_timedelta(self) -> timedelta:
        return timedelta(days=self.days)


def _eval_numeric(node: ast.AST) -> float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            raise ValueError("MESSAGE_RETENTION_DAYS expression must be numeric")
        if isinstance(node.value, (int, float)):
            return float(node.value)
        raise ValueError("MESSAGE_RETENTION_DAYS expression must be numeric")
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval_numeric(node.operand)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd):
        return _eval_numeric(node.operand)
    if isinstance(node, ast.BinOp):
        left = _eval_numeric(node.left)
        right = _eval_numeric(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.FloorDiv):
            return left // right
        if isinstance(node.op, ast.Mod):
            return left % right
        if isinstance(node.op, ast.Pow):
            return left ** right
        raise ValueError("Unsupported operator in MESSAGE_RETENTION_DAYS")
    if isinstance(node, ast.Num):  # py<3.8 compatibility
        return float(node.n)
    raise ValueError("Unsupported syntax in MESSAGE_RETENTION_DAYS (only numbers and + - * / // % **)")


def eval_message_retention_expression(raw: str) -> float:
    s = raw.strip()
    if not s:
        raise ValueError("MESSAGE_RETENTION_DAYS must not be empty")
    tree = ast.parse(s, mode="eval")
    if not isinstance(tree, ast.Expression):
        raise ValueError("Invalid MESSAGE_RETENTION_DAYS expression")
    value = _eval_numeric(tree.body)
    if math.isnan(value) or math.isinf(value):
        raise ValueError("MESSAGE_RETENTION_DAYS must be finite")
    if value < 0 and value != -1.0:
        raise ValueError("MESSAGE_RETENTION_DAYS must be >= 0, or exactly -1")
    return value


def load_message_retention_from_env() -> MessageRetentionState:
    raw = os.getenv(MESSAGE_RETENTION_DAYS)
    if raw is None or not str(raw).strip():
        raise ValueError(
            "MESSAGE_RETENTION_DAYS environment variable must be set "
            "(float days; expressions like 1/24/60*5 allowed; 0 = retain forever; -1 = do not store compliance MEK)"
        )
    return MessageRetentionState(days=eval_message_retention_expression(str(raw)))


def get_message_retention() -> MessageRetentionState:
    global _state
    if _state is None:
        _state = load_message_retention_from_env()
    return _state


def reset_message_retention_cache_for_tests() -> None:
    global _state
    _state = None
