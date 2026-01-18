// src/models/schema.ts
import { z } from "zod";

export const ColumnSchema = z.object({
  name: z.string(),
  dbType: z.string(),
  isNullable: z.boolean(),
  defaultExpr: z.string().nullable(),
  isPrimaryKey: z.boolean().default(false),
  enumValues: z.array(z.string()).optional(),
});

/** Patterns that indicate a DB-generated default (sequences, UUIDs) */
const DB_GENERATED_PATTERNS = [
  /^nextval\(/i,
  /^gen_random_uuid\(\)/i,
  /^uuid_generate_v[14]\(\)/i,
];

/** Check if a column has any default expression */
export function hasDefault(col: { defaultExpr: string | null }): boolean {
  return col.defaultExpr != null;
}

/** Check if a column's default is DB-generated (serial, identity, UUID generation) */
export function isDbGeneratedDefault(col: {
  defaultExpr: string | null;
}): boolean {
  if (!col.defaultExpr) return false;
  return DB_GENERATED_PATTERNS.some((pattern) =>
    pattern.test(col.defaultExpr!),
  );
}

export const ForeignKeySchema = z.object({
  column: z.string(),
  refTable: z.string(),
  refColumn: z.string(),
  constraintName: z.string().optional(),
});

export const UniqueSchema = z.object({
  columns: z.array(z.string()).min(1),
  constraintName: z.string().optional(),
});

export const TableSchema = z.object({
  name: z.string(),
  columns: z.record(z.string(), ColumnSchema),
  primaryKey: z.array(z.string()).default([]),
  foreignKeys: z.array(ForeignKeySchema).default([]),
  uniques: z.array(UniqueSchema).default([]),
});

export const SchemaModelSchema = z.object({
  dialect: z.literal("postgres"),
  tables: z.record(z.string(), TableSchema),
});
