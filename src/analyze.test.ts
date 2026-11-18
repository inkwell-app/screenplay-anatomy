import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { record } from "../fixtures/synthetic.ts"
import { assertAggregate } from "./aggregate.ts"
import { assertNoCorpusFiles } from "./publication.ts"

const script = fileURLToPath(new URL("./analyze-screenplay-anatomy.mts", import.meta.url))
function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 30000 })
}

test("deterministic statistics, input fingerprint, exclusions, and aggregate-only output", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomy-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const input = join(dir, "input.jsonl"),
    first = join(dir, "first.json"),
    second = join(dir, "second.json")
  const source = `${JSON.stringify(record())}\n${JSON.stringify(record(1))}\n`
  writeFileSync(input, source)
  for (const output of [first, second]) {
    const result = run("--input", input, "--output", output)
    assert.equal(result.status, 0, result.stderr)
  }
  const text = readFileSync(first, "utf8")
  assert.equal(text, readFileSync(second, "utf8"))
  for (const secret of [
    "PRIVATE_TITLE_SENTINEL",
    "PRIVATE_ID_SENTINEL",
    "ALPHA_SENTINEL",
    record().summary,
    "walk walk",
    "hello hello",
  ])
    assert.ok(!text.includes(secret))
  const data = JSON.parse(text)
  assertAggregate(data)
  assert.equal(data.corpus.records, 2)
  assert.equal(data.corpus.includedRecords, 1)
  assert.equal(data.corpus.excludedRecords, 1)
  assert.equal(data.corpus.inputSha256, createHash("sha256").update(source).digest("hex"))
  assert.equal(data.overview.scriptLengthLogNormalFit.kolmogorovSmirnovD, null)
  assert.equal(data.overview.sceneCount.median, 20)
  assert.equal(data.overview.actionShare.median, 0.8)
  assert.equal(data.overview.longestSceneDecileShare.median, 0.1)
  assert.equal(data.overview.speakingCharacterCount.median, 3)
  assert.equal(data.overview.dialogueFreeSceneShare.median, 0)
  assert.equal(
    data.progress.reduce(
      (sum: number, bucket: { scenes: { median: number } }) => sum + bucket.scenes.median,
      0,
    ),
    20,
  )
})

test("empty and excluded inputs produce null distributions", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomy-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, source] of [
    ["empty", ""],
    ["excluded", JSON.stringify(record(1))],
  ]) {
    const input = join(dir, `${name}.jsonl`),
      output = join(dir, `${name}.json`)
    writeFileSync(input, source ?? "")
    const result = run("--input", input, "--output", output)
    assert.equal(result.status, 0, result.stderr)
    const data = JSON.parse(readFileSync(output, "utf8"))
    assertAggregate(data)
    assert.equal(data.corpus.includedRecords, 0)
    assert.equal(data.overview.sceneCount.median, null)
    assert.equal(data.overview.scriptLengthLogNormalFit.kolmogorovSmirnovD, null)
    assert.equal(data.overview.summaryLengthLogNormalFit.kolmogorovSmirnovD, null)
  }
})

test("invalid records, duplicates, missing inputs and existing outputs fail safely", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomy-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const input = join(dir, "input.jsonl"),
    output = join(dir, "output.json")
  for (const source of [
    '{"script":"SECRET_CORPUS_TEXT',
    '{"script":17,"summary":"SECRET_CORPUS_TEXT"}',
  ]) {
    writeFileSync(input, source)
    const result = run("--input", input, "--output", output)
    assert.notEqual(result.status, 0)
    assert.ok(!existsSync(output))
    assert.ok(!result.stderr.includes("SECRET_CORPUS_TEXT"))
  }
  writeFileSync(input, JSON.stringify(record()))
  assert.notEqual(run("--input", input, "--input", input, "--output", output).status, 0)
  assert.ok(!existsSync(output))
  const before = readFileSync(input, "utf8")
  assert.notEqual(run("--input", input, "--output", input).status, 0)
  assert.equal(readFileSync(input, "utf8"), before)
  assert.notEqual(run("--input", join(dir, "missing"), "--output", output).status, 0)
  assert.notEqual(run("--unknown").status, 0)
})

test("publication contract rejects source fields, attribution loss and invalid statistics", () => {
  const data = JSON.parse(
    readFileSync(new URL("../data/screenplay-anatomy.generated.json", import.meta.url), "utf8"),
  )
  assertAggregate(data)
  for (const mutate of [
    (value: typeof data) => {
      value.overview.actionShare.median = 9
    },
    (value: typeof data) => {
      value.overview.sceneCount.median = -1
    },
    (value: typeof data) => {
      value.relationships.scriptLengthVsSummaryLengthPearson = 2
    },
    (value: typeof data) => {
      value.corpus.includedRecords += 1
    },
    (value: typeof data) => {
      value.overview.sceneCount.p10 = value.overview.sceneCount.p90 + 1
    },

    (value: typeof data) => {
      value.titles = ["private title"]
    },
    (value: typeof data) => {
      value.overview.sceneCount.script = "source text"
    },
    (value: typeof data) => {
      delete value.corpus.license
    },
    (value: typeof data) => {
      value.overview.sceneCount.median = "NaN"
    },
  ]) {
    const changed = structuredClone(data)
    mutate(changed)
    assert.throws(() => assertAggregate(changed))
  }
})

test("varied cohort exercises interpolation, ranked relationships and nondegenerate bootstrap", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomy-cohort-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const input = join(dir, "input.jsonl"),
    output = join(dir, "aggregate.json")
  writeFileSync(input, [record(20), record(30)].map((value) => JSON.stringify(value)).join("\n"))
  const result = run("--input", input, "--output", output)
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(readFileSync(output, "utf8"))
  assert.deepEqual(data.overview.sceneCount, { p10: 21, p25: 22.5, median: 25, p75: 27.5, p90: 29 })
  assert.equal(data.relationships.narrativeWordsVsSceneCountSpearman, 1)
  assert.equal(data.relationships.castSizeVsTopThreeDialogueShareSpearman, null)
  assert.deepEqual(data.progress[0].scenes.confidence95, { low: 2, high: 3 })
  assert.ok(data.overview.scriptLengthLogNormalFit.kolmogorovSmirnovD > 0)
})

test("publication scan rejects raw corpus files outside the data directory", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomy-publish-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assertNoCorpusFiles(dir)
  writeFileSync(join(dir, "training.JSONL"), "{}")
  assert.throws(() => assertNoCorpusFiles(dir), /Raw corpus/)
})

test("publication scan finds renamed corpus records and markup outside data", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomy-shapes-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const docs = join(dir, "docs")
  mkdirSync(docs)
  const cases = [
    ["train.json", JSON.stringify({ rows: [record()] })],
    ["corpus.txt", JSON.stringify(record())],
    ["moviesum.xml", record().script],
    ["scripts.csv", '"script","summary"\n"text","summary"'],
    ["oversized.txt", "x".repeat(1024 * 1024 + 1)],
  ]
  for (const [name, body] of cases) {
    assert.ok(name)
    assert.ok(body)
    const path = join(docs, name)
    writeFileSync(path, body)
    assert.throws(() => assertNoCorpusFiles(dir), /corpus|exceeds/)
    rmSync(path)
  }
  writeFileSync(join(docs, "method.txt"), "Method notes, without source text.")
  assertNoCorpusFiles(dir)
})
