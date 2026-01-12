// src/types/scenario.ts
import { z } from "zod";
import {
  ScenarioSchema,
  ScenariosFileSchema,
  TableScenario as TableScenarioVal,
  ColumnOverride as ColumnOverrideVal,
  Rule as RuleVal,
} from "../models/scenario.js";

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenariosFile = z.infer<typeof ScenariosFileSchema>;
export type TableScenario = z.infer<typeof TableScenarioVal>;
export type ColumnOverride = z.infer<typeof ColumnOverrideVal>;
export type Rule = z.infer<typeof RuleVal>;
