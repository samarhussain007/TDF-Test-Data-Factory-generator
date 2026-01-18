// src/core/generate_rows.ts
import { faker } from "@faker-js/faker";
import type { SchemaModel } from "../types/schema.js";
import type { Scenario } from "../types/scenario.js";
import type { TablePlan, GenerationPlan } from "../types/plan.js";
import type { GeneratedRow, GeneratedData } from "../types/data.js";
import type { RNG } from "../types/rng.js";
import {
  randomInt,
  randomFloat,
  randomPick,
  weightedPick,
  randomBool,
} from "../util/rng.js";

/**
 * Generate all rows based on the plan.
 */
export function generateRows(
  schema: SchemaModel,
  scenario: Scenario,
  plan: GenerationPlan,
): GeneratedData {
  const data = new Map<string, GeneratedRow[]>();
  const rng = plan.rng;

  // Seed faker with same seed for consistency
  faker.seed(plan.seed);

  // Track generated primary keys per table for FK resolution
  const primaryKeys = new Map<string, unknown[]>();

  for (const tableName of plan.tableOrder) {
    const tablePlan = plan.tablePlans.get(tableName);
    if (!tablePlan) continue;

    const tableSchema = schema.tables[tableName];
    const tableScenario = scenario.tables[tableName];
    if (!tableSchema) continue;

    const rows: GeneratedRow[] = [];
    const pks: unknown[] = [];

    if (tablePlan.mode === "count") {
      // Simple count mode
      for (let i = 0; i < tablePlan.rowCount; i++) {
        const row = generateSingleRow(
          rng,
          tableSchema,
          tableScenario,
          primaryKeys,
          i,
        );
        rows.push(row);
        pks.push(extractPk(row, tableSchema.primaryKey));
      }
    } else if (tablePlan.mode === "perParent") {
      // Per-parent mode
      const parentPks = primaryKeys.get(tablePlan.parentTable!) ?? [];
      let rowIndex = 0;

      for (let parentIdx = 0; parentIdx < parentPks.length; parentIdx++) {
        const count = tablePlan.parentRowCounts![parentIdx] ?? 0;
        const parentPk = parentPks[parentIdx];

        for (let j = 0; j < count; j++) {
          const row = generateSingleRow(
            rng,
            tableSchema,
            tableScenario,
            primaryKeys,
            rowIndex,
          );
          // Set FK columns from parent PK (handles both single and composite)
          assignFkValues(row, tablePlan.parentFk!, parentPk);
          rows.push(row);
          pks.push(extractPk(row, tableSchema.primaryKey));
          rowIndex++;
        }
      }
    } else if (tablePlan.mode === "m2m") {
      // M2M bridge table mode
      const leftPks = primaryKeys.get(tablePlan.leftTable!) ?? [];
      const rightPks = primaryKeys.get(tablePlan.rightTable!) ?? [];

      if (rightPks.length === 0) {
        console.warn(`Warning: No rows in ${tablePlan.rightTable} for M2M`);
      }

      let rowIndex = 0;
      for (let leftIdx = 0; leftIdx < leftPks.length; leftIdx++) {
        const count = tablePlan.perLeftCounts![leftIdx] ?? 0;
        const leftPk = leftPks[leftIdx];

        // Pick random rights for this left (without replacement if possible)
        const selectedRights = pickNRandom(
          rng,
          rightPks,
          Math.min(count, rightPks.length),
        );

        for (const rightPk of selectedRights) {
          const row = generateSingleRow(
            rng,
            tableSchema,
            tableScenario,
            primaryKeys,
            rowIndex,
          );
          // Set FK columns from left and right PKs (handles both single and composite)
          assignFkValues(row, tablePlan.leftFk!, leftPk);
          assignFkValues(row, tablePlan.rightFk!, rightPk);
          rows.push(row);
          pks.push(extractPk(row, tableSchema.primaryKey));
          rowIndex++;
        }
      }
    }

    data.set(tableName, rows);
    primaryKeys.set(tableName, pks);
  }

  return data;
}

function generateSingleRow(
  rng: RNG,
  tableSchema: SchemaModel["tables"][string],
  tableScenario: Scenario["tables"][string] | undefined,
  primaryKeys: Map<string, unknown[]>,
  rowIndex: number,
): GeneratedRow {
  const row: GeneratedRow = {};
  const distributions = tableScenario?.distributions ?? {};
  const columnOverrides = tableScenario?.columns ?? {};

  for (const [colName, colSchema] of Object.entries(tableSchema.columns)) {
    // Check for column override
    const override = columnOverrides[colName];
    const distribution = distributions[colName];

    // Skip FK columns that will be set by parent logic
    // They'll be overwritten later if needed

    let value: unknown;

    if (override?.fixed !== undefined) {
      value = override.fixed;
    } else if (override?.oneOf) {
      value = randomPick(rng, override.oneOf);
    } else if (override?.range) {
      if (isIntegerType(colSchema.dbType)) {
        value = randomInt(rng, override.range.min, override.range.max);
      } else {
        value = randomFloat(rng, override.range.min, override.range.max);
      }
    } else if (distribution) {
      value = weightedPick(rng, distribution);
    } else if (colSchema.enumValues && colSchema.enumValues.length > 0) {
      value = randomPick(rng, colSchema.enumValues);
    } else {
      // Generate based on column type
      value = generateValueForType(
        rng,
        colSchema.dbType,
        colName,
        colSchema.isPrimaryKey,
        rowIndex,
        primaryKeys,
      );
    }

    // Handle null rate
    if (
      override?.nullRate !== undefined &&
      colSchema.isNullable &&
      randomBool(rng, override.nullRate)
    ) {
      value = null;
    }

    // Handle nullable columns without override (small chance of null)
    if (
      value !== null &&
      colSchema.isNullable &&
      !colSchema.isPrimaryKey &&
      !override &&
      randomBool(rng, 0.05)
    ) {
      value = null;
    }

    row[colName] = value;
  }

  // Apply rules
  if (tableScenario?.rules) {
    for (const rule of tableScenario.rules) {
      if (matchesCondition(row, rule.if)) {
        for (const [col, val] of Object.entries(rule.set)) {
          if (val === "__AUTO_NOT_NULL__") {
            // Generate a non-null value for this column
            const colSchema = tableSchema.columns[col];
            if (colSchema) {
              row[col] = generateValueForType(
                rng,
                colSchema.dbType,
                col,
                false,
                rowIndex,
                primaryKeys,
              );
            }
          } else {
            row[col] = val;
          }
        }
      }
    }
  }

  return row;
}

function matchesCondition(
  row: GeneratedRow,
  condition?: Record<string, unknown>,
): boolean {
  if (!condition) return true;

  for (const [key, expected] of Object.entries(condition)) {
    // Handle nested keys like "invoice.status"
    if (key.includes(".")) {
      // Skip cross-table references for now (would need more context)
      continue;
    }
    if (row[key] !== expected) {
      return false;
    }
  }
  return true;
}

function generateValueForType(
  rng: RNG,
  dbType: string,
  colName: string,
  isPrimaryKey: boolean,
  rowIndex: number,
  _primaryKeys: Map<string, unknown[]>,
): unknown {
  const type = dbType.toLowerCase();

  // UUID types
  if (type === "uuid") {
    return faker.string.uuid();
  }

  // Integer types
  if (type === "int2" || type === "smallint") {
    return isPrimaryKey ? rowIndex + 1 : randomInt(rng, 1, 1000);
  }
  if (type === "int4" || type === "integer" || type === "int") {
    return isPrimaryKey ? rowIndex + 1 : randomInt(rng, 1, 100000);
  }
  if (type === "int8" || type === "bigint") {
    return isPrimaryKey ? rowIndex + 1 : randomInt(rng, 1, 1000000);
  }
  if (type === "serial" || type === "serial4") {
    return rowIndex + 1;
  }
  if (type === "bigserial" || type === "serial8") {
    return rowIndex + 1;
  }

  // Floating point types
  if (type === "float4" || type === "real") {
    return Math.round(randomFloat(rng, 0, 1000) * 100) / 100;
  }
  if (type === "float8" || type === "double precision") {
    return Math.round(randomFloat(rng, 0, 10000) * 100) / 100;
  }
  if (type === "numeric" || type === "decimal") {
    return Math.round(randomFloat(rng, 0, 10000) * 100) / 100;
  }

  // Text types
  if (type === "text" || type === "varchar" || type.startsWith("character")) {
    return generateTextByPattern(rng, colName);
  }

  // Boolean
  if (type === "bool" || type === "boolean") {
    return randomBool(rng, 0.5);
  }

  // Date/time types
  if (type === "date") {
    return faker.date.recent({ days: 90 }).toISOString().split("T")[0];
  }
  if (
    type === "timestamp" ||
    type === "timestamptz" ||
    type.includes("timestamp")
  ) {
    return faker.date.recent({ days: 90 }).toISOString();
  }
  if (type === "time" || type === "timetz") {
    return (
      faker.date.recent().toISOString().split("T")[1]?.split(".")[0] ??
      "00:00:00"
    );
  }

  // JSON types
  if (type === "json" || type === "jsonb") {
    return {};
  }

  // Array types
  if (type.startsWith("_")) {
    return [];
  }

  // Default: return a string
  return faker.lorem.word();
}

function generateTextByPattern(rng: RNG, colName: string): string {
  const name = colName.toLowerCase();
  const patterns: Array<[RegExp, () => string]> = [
    [/email/, () => faker.internet.email()],
    [
      /(^|_)first[_]?name|\bfname\b|given[_]?name/,
      () => faker.person.firstName(),
    ],
    [
      /(^|_)last[_]?name|\blname\b|surname|family[_]?name/,
      () => faker.person.lastName(),
    ],
    [/user[_]?name|username|login|handle/, () => faker.internet.username()],
    [/\bname\b/, () => faker.person.fullName()],
    [/(phone|mobile|cell|tel)/, () => faker.phone.number()],
    [/(address|addr)/, () => faker.location.streetAddress()],
    [/(city|town)/, () => faker.location.city()],
    [/country|nation/, () => faker.location.countryCode()],
    [/(zip|postal|postcode)/, () => faker.location.zipCode()],
    [/(url|website|link|href)/, () => faker.internet.url()],
    [/(description|desc|bio|about|summary)/, () => faker.lorem.sentence()],
    [/(title|headline|subject)/, () => faker.lorem.words(randomInt(rng, 2, 5))],
    [
      /(company|organisation|organization|org|employer)/,
      () => faker.company.name(),
    ],
    [/(currency|ccy)/, () => faker.finance.currencyCode()],
  ];

  for (const [regex, generator] of patterns) {
    if (regex.test(name)) {
      return generator();
    }
  }

  return generateGenericText(rng);
}

function generateGenericText(rng: RNG): string {
  const pick = randomInt(rng, 1, 6);
  switch (pick) {
    case 1:
      return faker.lorem.word();
    case 2:
      return faker.lorem.words(randomInt(rng, 2, 4));
    case 3:
      return faker.lorem.sentence();
    case 4:
      return faker.lorem.slug();
    case 5:
      return faker.string.alphanumeric({ length: randomInt(rng, 6, 12) });
    default:
      return faker.internet.url();
  }
}

function isIntegerType(dbType: string): boolean {
  const type = dbType.toLowerCase();
  return (
    type === "int2" ||
    type === "int4" ||
    type === "int8" ||
    type === "integer" ||
    type === "bigint" ||
    type === "smallint" ||
    type.includes("serial")
  );
}

function extractPk(row: GeneratedRow, primaryKey: string[]): unknown {
  if (primaryKey.length === 0) {
    return null;
  }
  if (primaryKey.length === 1) {
    return row[primaryKey[0]!];
  }
  // Composite PK - return as tuple
  return primaryKey.map((col) => row[col]);
}

/**
 * Assign FK column values from a PK value (handles both single and composite).
 */
function assignFkValues(
  row: GeneratedRow,
  fkColumns: string[],
  pkValue: unknown,
): void {
  if (fkColumns.length === 1) {
    // Single FK column - PK value is scalar or array
    row[fkColumns[0]!] = Array.isArray(pkValue) ? pkValue[0] : pkValue;
  } else {
    // Composite FK - PK value should be array
    const pkValues = Array.isArray(pkValue) ? pkValue : [pkValue];
    for (let i = 0; i < fkColumns.length; i++) {
      row[fkColumns[i]!] = pkValues[i];
    }
  }
}

function pickNRandom<T>(rng: RNG, arr: T[], n: number): T[] {
  if (n >= arr.length) {
    return [...arr];
  }

  const result: T[] = [];
  const used = new Set<number>();

  while (result.length < n) {
    const idx = Math.floor(rng() * arr.length);
    if (!used.has(idx)) {
      used.add(idx);
      result.push(arr[idx]!);
    }
  }

  return result;
}
