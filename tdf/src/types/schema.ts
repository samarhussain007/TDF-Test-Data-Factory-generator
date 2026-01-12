// src/types/schema.ts
import { z } from "zod";
import {
  SchemaModelSchema,
  TableSchema as TableSchemaVal,
  ColumnSchema as ColumnSchemaVal,
} from "../models/schema.js";

export type SchemaModel = z.infer<typeof SchemaModelSchema>;
export type TableSchema = z.infer<typeof TableSchemaVal>;
export type ColumnSchema = z.infer<typeof ColumnSchemaVal>;
