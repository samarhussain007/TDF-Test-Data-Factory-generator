// src/types/plan.ts
import type { RNG } from "./rng.js";

export type TablePlan = {
  table: string;
  mode: "count" | "perParent" | "m2m";
  rowCount: number;
  // For perParent mode
  parentTable?: string;
  parentFk?: string;
  parentRowCounts?: number[]; // how many rows per parent
  // For m2m mode
  leftTable?: string;
  leftFk?: string;
  rightTable?: string;
  rightFk?: string;
  perLeftCounts?: number[]; // how many rights per left
};

export type GenerationPlan = {
  seed: number;
  tableOrder: string[];
  tablePlans: Map<string, TablePlan>;
  rng: RNG;
};
