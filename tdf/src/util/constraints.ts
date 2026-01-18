// src/util/constraints.ts

export type RangeBound = {
  column: string;
  min?: number;
  max?: number;
  minInclusive?: boolean;
  maxInclusive?: boolean;
};

export type RelationalConstraint = {
  leftColumn: string;
  operator: "<=" | ">=" | "<" | ">" | "=" | "!=";
  rightColumn: string;
};

export type ParsedCheckConstraint = {
  ranges: RangeBound[];
  relational: RelationalConstraint[];
  raw: string;
};

/**
 * Parse a check constraint expression to extract useful constraints.
 * Handles common patterns like:
 * - (column >= 1 AND column <= 90)
 * - (column > 0)
 * - (reserved <= on_hand)
 */
export function parseCheckConstraint(
  expression: string,
): ParsedCheckConstraint {
  const ranges: RangeBound[] = [];
  const relational: RelationalConstraint[] = [];

  // Remove outer parens if present
  let expr = expression.trim();
  if (expr.startsWith("(") && expr.endsWith(")")) {
    expr = expr.slice(1, -1).trim();
  }

  // Split by AND to handle compound conditions
  const parts = splitByAnd(expr);

  for (const part of parts) {
    const trimmed = part.trim();

    // Try to parse as range constraint: column op value
    const rangeMatch = trimmed.match(
      /^([a-z_][a-z0-9_]*)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/i,
    );
    if (rangeMatch) {
      const [, column, operator, valueStr] = rangeMatch;
      const value = parseFloat(valueStr!);

      // Find or create range bound for this column
      let bound = ranges.find((r) => r.column === column);
      if (!bound) {
        bound = { column: column! };
        ranges.push(bound);
      }

      // Update bounds based on operator
      switch (operator) {
        case ">=":
          bound.min = value;
          bound.minInclusive = true;
          break;
        case ">":
          bound.min = value;
          bound.minInclusive = false;
          break;
        case "<=":
          bound.max = value;
          bound.maxInclusive = true;
          break;
        case "<":
          bound.max = value;
          bound.maxInclusive = false;
          break;
        case "=":
          bound.min = value;
          bound.max = value;
          bound.minInclusive = true;
          bound.maxInclusive = true;
          break;
      }
      continue;
    }

    // Try to parse as relational constraint: col1 op col2
    const relMatch = trimmed.match(
      /^([a-z_][a-z0-9_]*)\s*(<=|>=|<|>|=|!=)\s*([a-z_][a-z0-9_]*)$/i,
    );
    if (relMatch) {
      const [, leftCol, op, rightCol] = relMatch;
      relational.push({
        leftColumn: leftCol!,
        operator: op as RelationalConstraint["operator"],
        rightColumn: rightCol!,
      });
      continue;
    }
  }

  return { ranges, relational, raw: expression };
}

/**
 * Split expression by AND, respecting parentheses.
 */
function splitByAnd(expr: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let i = 0;

  while (i < expr.length) {
    const char = expr[i]!;

    if (char === "(") {
      depth++;
      current += char;
    } else if (char === ")") {
      depth--;
      current += char;
    } else if (depth === 0 && expr.slice(i, i + 5).toUpperCase() === " AND ") {
      parts.push(current.trim());
      current = "";
      i += 4; // Skip " AND"
    } else {
      current += char;
    }
    i++;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Apply range bounds to a value generation.
 * Adjusts min/max to respect check constraints.
 */
export function applyRangeBounds(
  column: string,
  bounds: RangeBound[],
  defaultMin: number,
  defaultMax: number,
): { min: number; max: number } {
  const bound = bounds.find((b) => b.column === column);
  if (!bound) {
    return { min: defaultMin, max: defaultMax };
  }

  let min = defaultMin;
  let max = defaultMax;

  if (bound.min !== undefined) {
    min = Math.max(min, bound.minInclusive ? bound.min : bound.min + 1);
  }

  if (bound.max !== undefined) {
    max = Math.min(max, bound.maxInclusive ? bound.max : bound.max - 1);
  }

  return { min, max };
}

/**
 * Check if a row satisfies relational constraints.
 * Returns the columns that need adjustment if violated.
 */
export function validateRelationalConstraints(
  row: Record<string, unknown>,
  constraints: RelationalConstraint[],
): { valid: boolean; violations: RelationalConstraint[] } {
  const violations: RelationalConstraint[] = [];

  for (const constraint of constraints) {
    const left = row[constraint.leftColumn];
    const right = row[constraint.rightColumn];

    // Skip if either value is null or not a number
    if (
      left == null ||
      right == null ||
      typeof left !== "number" ||
      typeof right !== "number"
    ) {
      continue;
    }

    let satisfied = false;
    switch (constraint.operator) {
      case "<=":
        satisfied = left <= right;
        break;
      case ">=":
        satisfied = left >= right;
        break;
      case "<":
        satisfied = left < right;
        break;
      case ">":
        satisfied = left > right;
        break;
      case "=":
        satisfied = left === right;
        break;
      case "!=":
        satisfied = left !== right;
        break;
    }

    if (!satisfied) {
      violations.push(constraint);
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Adjust a row to satisfy relational constraints.
 * For simple cases like (reserved <= on_hand), adjust the left side.
 */
export function fixRelationalConstraints(
  row: Record<string, unknown>,
  constraints: RelationalConstraint[],
): void {
  for (const constraint of constraints) {
    const left = row[constraint.leftColumn];
    const right = row[constraint.rightColumn];

    if (
      left == null ||
      right == null ||
      typeof left !== "number" ||
      typeof right !== "number"
    ) {
      continue;
    }

    // For <= and <, ensure left is within bounds
    if (constraint.operator === "<=") {
      if (left > right) {
        // Adjust left to be at most right
        row[constraint.leftColumn] = right;
      }
    } else if (constraint.operator === "<") {
      if (left >= right) {
        row[constraint.leftColumn] = Math.max(0, right - 1);
      }
    } else if (constraint.operator === ">=") {
      if (left < right) {
        row[constraint.leftColumn] = right;
      }
    } else if (constraint.operator === ">") {
      if (left <= right) {
        row[constraint.leftColumn] = right + 1;
      }
    }
  }
}
