// src/util/fs.ts
import { readFile, writeFile as fsWriteFile, mkdir } from "fs/promises";
import { dirname } from "path";

/**
 * Read and parse a JSON file.
 */
export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}

/**
 * Write content to a file, creating directories if needed.
 */
export async function writeFile(
  filePath: string,
  content: string
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await fsWriteFile(filePath, content, "utf-8");
}

/**
 * Write JSON to a file with pretty formatting.
 */
export async function writeJsonFile(
  filePath: string,
  data: unknown
): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await writeFile(filePath, content);
}
