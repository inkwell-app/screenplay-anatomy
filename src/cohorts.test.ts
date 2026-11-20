import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { assertAggregate } from "./aggregate.ts"
import { assertGenres, assertRuntimes } from "./cohorts.ts"

function snapshot(name: string) {
  return JSON.parse(
    readFileSync(new URL(`../data/${name}.generated.json`, import.meta.url), "utf8"),
  )
}
const { corpus } = assertAggregate(snapshot("screenplay-anatomy"))

test("genre snapshots preserve provenance, coverage, numeric domains and aggregate-only fields", () => {
  const genres = snapshot("anatomy-genres")
  assertGenres(genres, corpus)
  for (const mutate of [
    (value: typeof genres) => {
      value.groups.drama.title = "Synthetic title"
    },
    (value: typeof genres) => {
      delete value.groups.action
    },
    (value: typeof genres) => {
      value.lookupSha256 = value.inputSha256
    },
    (value: typeof genres) => {
      value.groups.comedy.dialogue.p90 = 1.2
    },
    (value: typeof genres) => {
      value.all.cast.median = value.all.cast.p90 + 1
    },
    (value: typeof genres) => {
      value.covered = 0
    },
    (value: typeof genres) => {
      value.histograms.scenes.counts[0] += 1
    },
  ]) {
    const invalid = structuredClone(genres)
    mutate(invalid)
    assert.throws(() => assertGenres(invalid, corpus))
  }
})

test("runtime snapshots preserve attribution, disjoint windows, exclusions and counted bins", () => {
  const runtimes = snapshot("anatomy-runtimes")
  assertRuntimes(runtimes, corpus)
  for (const mutate of [
    (value: typeof runtimes) => {
      value.groups[1].from = 85
    },
    (value: typeof runtimes) => {
      value.groups[0].imdb = "Synthetic ID"
    },
    (value: typeof runtimes) => {
      value.groups[0].counts.pop()
    },
    (value: typeof runtimes) => {
      value.groups[1].counts[0] += 1
    },
    (value: typeof runtimes) => {
      value.groups[0].p25 = value.groups[0].p90 + 1
    },
    (value: typeof runtimes) => {
      value.exclusions.qualified = -1
    },
    (value: typeof runtimes) => {
      value.retained -= 1
    },
    (value: typeof runtimes) => {
      value.sources.runtime = "unknown"
    },
    (value: typeof runtimes) => {
      value.license = "CC0"
    },
  ]) {
    const invalid = structuredClone(runtimes)
    mutate(invalid)
    assert.throws(() => assertRuntimes(invalid, corpus))
  }
  assert.throws(() => assertRuntimes(runtimes, { ...corpus, inputSha256: "0".repeat(64) }))
})
