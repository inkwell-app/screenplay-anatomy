import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"

function hasCorpusRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  if (
    typeof Reflect.get(value, "script") === "string" &&
    typeof Reflect.get(value, "summary") === "string"
  )
    return true
  return Object.values(value).some(hasCorpusRecord)
}
const TEXT_LIMIT = 1024 * 1024
const TEXT_FORMATS = new Set([".json", ".xml", ".csv", ".txt"])
/** Catch accidental corpus inputs by format and record shape; provenance still needs review. */
export function assertNoCorpusFiles(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Unexpected publication symlink: ${path}`)
    if (/\.(jsonl|ndjson)$/i.test(entry.name))
      throw new Error(`Raw corpus file must not be published: ${path}`)
    if (entry.isDirectory()) {
      assertNoCorpusFiles(path)
      continue
    }
    if (!TEXT_FORMATS.has(extname(entry.name).toLowerCase())) continue
    if (statSync(path).size > TEXT_LIMIT)
      throw new Error(`Publication text artifact exceeds 1 MiB: ${path}`)
    const body = readFileSync(path, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      /* Non-JSON text is checked by its markup/header below. */
    }
    const csvHeader = (body.split(/\r?\n/, 1)[0] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^"|"$/g, ""))
    if (
      hasCorpusRecord(parsed) ||
      (/<scene(?:\s|>)/i.test(body) && /<(scene_description|dialogue)(?:\s|>)/i.test(body)) ||
      (csvHeader.includes("script") && csvHeader.includes("summary"))
    )
      throw new Error(`Raw corpus-shaped content must not be published: ${path}`)
  }
}
