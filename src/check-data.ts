import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { assertAggregate } from "./aggregate.ts"
import { assertGenres, assertRuntimes } from "./cohorts.ts"
import { assertNoCorpusFiles } from "./publication.ts"

const directory = new URL("../data/", import.meta.url)
const files = [
  "screenplay-anatomy.generated.json",
  "anatomy-genres.generated.json",
  "anatomy-runtimes.generated.json",
] as const
for (const name of readdirSync(directory)) {
  if (!files.some((file) => file === name)) throw new Error(`Unexpected data artifact: ${name}`)
}
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, directory), "utf8"))
const aggregate = assertAggregate(read(files[0]))
assertGenres(read(files[1]), aggregate.corpus)
assertRuntimes(read(files[2]), aggregate.corpus)
assertNoCorpusFiles(fileURLToPath(new URL("../", import.meta.url)))
process.stdout.write(
  "Three aggregate snapshots validated with attribution and publication checks\n",
)
