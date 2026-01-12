// src/util/rng.ts
import seedrandom from "seedrandom";
import type { RNG } from "../types/rng.js";

/**
 * Create a seeded random number generator.
 */
export function createRng(seed?: number | string): RNG {
  const seedStr = seed != null ? String(seed) : String(Date.now());
  return seedrandom(seedStr);
}

/**
 * Pick a random integer in [min, max] inclusive.
 */
export function randomInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Pick a random float in [min, max].
 */
export function randomFloat(rng: RNG, min: number, max: number): number {
  return rng() * (max - min) + min;
}

/**
 * Pick a random element from an array.
 */
export function randomPick<T>(rng: RNG, arr: T[]): T {
  if (arr.length === 0) {
    throw new Error("Cannot pick from empty array");
  }
  return arr[Math.floor(rng() * arr.length)]!;
}

/**
 * Weighted random pick from a weight map.
 * @param rng Random number generator
 * @param weights Map of value -> weight (weight >= 0)
 * @returns The selected key
 */
export function weightedPick<T extends string>(
  rng: RNG,
  weights: Record<T, number>
): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);

  if (total <= 0) {
    throw new Error("Total weight must be positive");
  }

  let r = rng() * total;
  for (const [key, weight] of entries) {
    r -= weight;
    if (r <= 0) {
      return key;
    }
  }

  // Fallback (shouldn't happen)
  return entries[entries.length - 1]![0];
}

/**
 * Shuffle an array in place using Fisher-Yates.
 */
export function shuffle<T>(rng: RNG, arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Generate a random boolean with given probability of true.
 */
export function randomBool(rng: RNG, probability = 0.5): boolean {
  return rng() < probability;
}
