// src/models/schema.ts
import { z } from "zod";

export const ColumnSchema = z.object({
  name: z.string(),
  dbType: z.string(),
  isNullable: z.boolean(),
  hasDefault: z.boolean(),
  isPrimaryKey: z.boolean().default(false),
  enumValues: z.array(z.string()).optional(),
});

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
