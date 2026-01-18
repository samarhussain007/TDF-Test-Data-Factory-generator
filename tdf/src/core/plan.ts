import type { SchemaModel } from "../types/schema.js";
import type { Scenario } from "../types/scenario.js";
import type { TablePlan, GenerationPlan } from "../types/plan.js";
import type { RNG } from "../types/rng.js";
import { toposort, buildFkEdges } from "../util/toposort.js";
import { createRng, randomInt } from "../util/rng.js";

/**
 * Build a generation plan from schema and scenario.
 */
export function buildPlan(
  schema: SchemaModel,
  scenario: Scenario,
): GenerationPlan {
  const seed = scenario.seed ?? Date.now();
  const rng = createRng(seed);

  // Get tables from scenario that exist in schema
  const scenarioTables = Object.keys(scenario.tables).filter(
    (t) => schema.tables[t],
  );

  // Build FK edges for topological sort
  const allEdges = buildFkEdges(schema.tables);

  // Filter edges to only include scenario tables
  const relevantEdges = allEdges.filter(
    (e) => scenarioTables.includes(e.from) && scenarioTables.includes(e.to),
  );

  // Topologically sort tables
  const tableOrder = toposort(scenarioTables, relevantEdges);

  // Track row counts per table (needed for perParent/m2m)
  const rowCounts = new Map<string, number>();
  const tablePlans = new Map<string, TablePlan>();

  for (const tableName of tableOrder) {
    const tableScenario = scenario.tables[tableName];
    if (!tableScenario) continue;

    let plan: TablePlan;

    if (tableScenario.count != null) {
      // Fixed count mode
      const count = tableScenario.count;
      rowCounts.set(tableName, count);
      plan = {
        table: tableName,
        mode: "count",
        rowCount: count,
      };
    } else if (tableScenario.perParent) {
      // Per-parent mode
      const pp = tableScenario.perParent;
      const parentCount = rowCounts.get(pp.parent) ?? 0;

      // Normalize FK to array
      const fkColumns = typeof pp.fk === "string" ? [pp.fk] : pp.fk;

      // Validate FK columns match a real FK constraint
      const tableSchema = schema.tables[tableName];
      if (tableSchema) {
        validateFkColumns(tableSchema, pp.parent, fkColumns);
      }

      // Generate count for each parent row
      const parentRowCounts: number[] = [];
      let totalRows = 0;
      for (let i = 0; i < parentCount; i++) {
        const n = randomInt(rng, pp.min, pp.max);
        parentRowCounts.push(n);
        totalRows += n;
      }

      rowCounts.set(tableName, totalRows);
      plan = {
        table: tableName,
        mode: "perParent",
        rowCount: totalRows,
        parentTable: pp.parent,
        parentFk: fkColumns,
        parentRowCounts,
      };
    } else if (tableScenario.m2m) {
      // Many-to-many mode
      const m2m = tableScenario.m2m;
      const leftCount = rowCounts.get(m2m.left.table) ?? 0;

      // Normalize FK columns to arrays
      const leftFkColumns =
        typeof m2m.left.fk === "string" ? [m2m.left.fk] : m2m.left.fk;
      const rightFkColumns =
        typeof m2m.right.fk === "string" ? [m2m.right.fk] : m2m.right.fk;

      // Validate FK columns match real FK constraints
      const tableSchema = schema.tables[tableName];
      if (tableSchema) {
        validateFkColumns(tableSchema, m2m.left.table, leftFkColumns);
        validateFkColumns(tableSchema, m2m.right.table, rightFkColumns);
      }

      // Generate count of rights for each left
      const perLeftCounts: number[] = [];
      let totalRows = 0;
      for (let i = 0; i < leftCount; i++) {
        const n = randomInt(rng, m2m.perLeft.min, m2m.perLeft.max);
        perLeftCounts.push(n);
        totalRows += n;
      }

      rowCounts.set(tableName, totalRows);
      plan = {
        table: tableName,
        mode: "m2m",
        rowCount: totalRows,
        leftTable: m2m.left.table,
        leftFk: leftFkColumns,
        rightTable: m2m.right.table,
        rightFk: rightFkColumns,
        perLeftCounts,
      };
    } else {
      // Should not happen if scenario is validated
      throw new Error(`Table ${tableName} has no count mode specified`);
    }

    tablePlans.set(tableName, plan);
  }

  return {
    seed,
    tableOrder,
    tablePlans,
    rng,
  };
}

/**
 * Validate that FK columns match a real FK constraint in the table schema.
 */
function validateFkColumns(
  tableSchema: SchemaModel["tables"][string],
  refTable: string,
  fkColumns: string[],
): void {
  // Find matching FK constraint
  const matchingFk = tableSchema.foreignKeys.find(
    (fk) =>
      fk.refTable === refTable &&
      fk.columns.length === fkColumns.length &&
      fk.columns.every((col, idx) => col === fkColumns[idx]),
  );

  if (!matchingFk) {
    throw new Error(
      `Table ${tableSchema.name}: FK columns [${fkColumns.join(", ")}] -> ${refTable} do not match any FK constraint. ` +
        `Available FKs to ${refTable}: ${
          tableSchema.foreignKeys
            .filter((fk) => fk.refTable === refTable)
            .map((fk) => `[${fk.columns.join(", ")}]`)
            .join(", ") || "none"
        }`,
    );
  }
}
