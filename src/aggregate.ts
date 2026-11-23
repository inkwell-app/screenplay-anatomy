import { readFileSync } from "node:fs"
import { Ajv2020 } from "ajv/dist/2020.js"

const schema = JSON.parse(
  readFileSync(new URL("../schemas/aggregate.schema.json", import.meta.url), "utf8"),
)
interface Aggregate {
  corpus: { inputSha256: string; records: number; includedRecords: number; excludedRecords: number }
  progress: { decile: number }[]
  castDialogueBins: { scripts: number }[]
}
const validate = new Ajv2020({ allErrors: true }).compile<Aggregate>(schema)
export function checkOrder(value: unknown): void {
  if (typeof value !== "object" || value === null) return
  const keys =
    "p10" in value ? ["p10", "p25", "median", "p75", "p90"] : "low" in value ? ["low", "high"] : []
  const numbers: unknown[] = keys.map((key) => Reflect.get(value, key))
  if (numbers.some((number) => number === null) && !numbers.every((number) => number === null))
    throw new Error("Distribution cannot mix null and numeric quantiles")
  let previous = Number.NEGATIVE_INFINITY
  for (const number of numbers)
    if (typeof number === "number") {
      if (number < previous)
        throw new Error("Distribution quantiles or interval endpoints are out of order")
      previous = number
    }
  for (const child of Object.values(value)) checkOrder(child)
}
/** Closed shape, numeric domains and cross-field checks defend the publication boundary. */
export function assertAggregate(value: unknown): Aggregate {
  if (!validate(value)) throw new Error(`Invalid aggregate: ${JSON.stringify(validate.errors)}`)
  if (value.corpus.includedRecords + value.corpus.excludedRecords !== value.corpus.records)
    throw new Error("Included and excluded totals must equal records")
  if (
    value.castDialogueBins.reduce((sum, bin) => sum + bin.scripts, 0) !==
    value.corpus.includedRecords
  )
    throw new Error("Cast bins must partition included records")
  if (value.progress.some((bucket, index) => bucket.decile !== index + 1))
    throw new Error("Progress deciles must be ordered and unique")
  checkOrder(value)
  return value
}
