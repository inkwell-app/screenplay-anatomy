import { Ajv2020 } from "ajv/dist/2020.js"
import { checkOrder } from "./aggregate.ts"

// These two published snapshots use the train, validation and test split bytes
// in that order. Each lookup digest identifies its own Wikidata observation.
const inputSha256 = { const: "5992b076833b40a88ae96f3c9740dc615bff94b76d27f32ac2a6ad72213215f1" }
const ajv = new Ajv2020()
const count = { type: "integer", minimum: 0 }
const nonnegative = { type: "number", minimum: 0 }
const percentiles = ["p10", "p25", "median", "p75", "p90"]
const genres = [
  "action",
  "adventure",
  "comedy",
  "drama",
  "horror",
  "romance",
  "scienceFiction",
  "thriller",
]

function object(properties: Record<string, object>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }
}
function fields(names: string[], schema: object) {
  return Object.fromEntries(names.map((name) => [name, schema]))
}
function counts(length: number) {
  return { type: "array", items: count, minItems: length, maxItems: length }
}
function histogram(width: number, bins: number) {
  return object({ binWidth: { const: width }, counts: counts(bins) })
}
const cohort = object({
  scripts: { type: "integer", minimum: 1 },
  scenes: object(fields(percentiles, nonnegative)),
  dialogue: object(fields(percentiles, { ...nonnegative, maximum: 1 })),
  cast: object(fields(percentiles, nonnegative)),
})
interface GenreSnapshot {
  covered: number
  inputSha256: string
  all: { scripts: number }
  groups: Record<string, { scripts: number }>
  histograms: Record<string, { counts: number[] }>
}
const validateGenres = ajv.compile<GenreSnapshot>(
  object({
    inputSha256,
    lookupSha256: { const: "06abb5ab254f8b2e089331b596a738044868fd6dbc148ea11f406bac4ec36412" },
    covered: count,
    all: cohort,
    groups: object(fields(genres, cohort)),
    histograms: object({
      scenes: histogram(10, 30),
      dialogue: histogram(0.05, 20),
      cast: histogram(5, 30),
    }),
  }),
)

const runtimeSources = object({
  scenes: {
    const:
      "MovieSum, Rohit Saxena and Frank Keller (2024), https://huggingface.co/datasets/rohitsaxena/MovieSum, CC BY-NC 4.0",
  },
  runtime: { const: "Wikidata contributors, https://www.wikidata.org/wiki/Property:P2047, CC0" },
})
function runtimeGroup(from: number, until: number) {
  return object({
    from: { const: from },
    until: { const: until },
    scripts: { type: "integer", minimum: 1 },
    ...fields(percentiles, nonnegative),
    counts: counts(31),
  })
}
interface RuntimeSnapshot {
  eligible: number
  retained: number
  inputSha256: string
  exclusions: Record<string, number>
  groups: { scripts: number; counts: number[] }[]
}
const validateRuntimes = ajv.compile<RuntimeSnapshot>(
  object({
    observedOn: { const: "2026-11-20" },
    sources: runtimeSources,
    license: { const: "https://creativecommons.org/licenses/by-nc/4.0/" },
    method: {
      const:
        "One screenplay record per observation. Match one film by IMDb ID. Require exactly one distinct positive best-rank runtime in minutes, with no qualifiers on any best-rank statement. Runtime windows include from and exclude until. Counts begin at zero scenes in binWidth intervals. The last bin includes overflowAt scenes and above.",
    },
    inputSha256,
    lookupSha256: { const: "cab56a7d5714a77b5e8d504f27c78f7b1f5fa2e23f536fa495a27c3cd9653630" },
    eligible: count,
    retained: count,
    exclusions: object(
      fields(["item", "missingOrInvalidMinutes", "conflicting", "qualified"], count),
    ),
    binWidth: { const: 10 },
    overflowAt: { const: 300 },
    groups: {
      type: "array",
      prefixItems: [runtimeGroup(85, 95), runtimeGroup(115, 125)],
      minItems: 2,
      maxItems: 2,
      items: false,
    },
  }),
)

const sum = (values: number[]) => values.reduce((total, next) => total + next, 0)

type Corpus = { includedRecords: number; inputSha256: string }

export function assertGenres(value: unknown, corpus: Corpus): void {
  if (!validateGenres(value))
    throw new Error(`Invalid genre snapshot: ${ajv.errorsText(validateGenres.errors)}`)
  if (value.inputSha256 !== corpus.inputSha256)
    throw new Error("Genre input differs from the overview corpus")
  const eligible = corpus.includedRecords
  const sizes = Object.values(value.groups).map((group) => group.scripts)
  if (
    value.all.scripts !== eligible ||
    value.covered > eligible ||
    sizes.some((size) => size > value.covered) ||
    sum(sizes) < value.covered
  )
    throw new Error("Genre membership counts disagree with coverage")
  for (const { counts } of Object.values(value.histograms))
    if (sum(counts) !== eligible)
      throw new Error("Genre overview histogram must count every eligible script")
  checkOrder(value)
}

export function assertRuntimes(value: unknown, corpus: Corpus): void {
  if (!validateRuntimes(value))
    throw new Error(`Invalid runtime snapshot: ${ajv.errorsText(validateRuntimes.errors)}`)
  if (value.inputSha256 !== corpus.inputSha256)
    throw new Error("Runtime input differs from the overview corpus")
  const eligible = corpus.includedRecords
  if (
    value.eligible !== eligible ||
    value.retained + sum(Object.values(value.exclusions)) !== eligible
  )
    throw new Error("Runtime exclusions and retained scripts must partition eligible scripts")
  if (sum(value.groups.map((group) => group.scripts)) > value.retained)
    throw new Error("Runtime windows exceed retained scripts")
  for (const group of value.groups)
    if (sum(group.counts) !== group.scripts)
      throw new Error("Runtime histogram must count every script in its window")
  checkOrder(value)
}
