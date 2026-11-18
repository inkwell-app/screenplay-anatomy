import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { assertAggregate } from "./aggregate.ts"
import { assertNoCorpusFiles } from "./publication.ts"

for (const name of readdirSync(new URL("../data/", import.meta.url))) {
  if (!name.endsWith(".json")) throw new Error(`Unexpected data artifact: ${name}`)
  assertAggregate(JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8")))
}
process.stdout.write("Aggregate schema and attribution valid\n")

assertNoCorpusFiles(fileURLToPath(new URL("../", import.meta.url)))
