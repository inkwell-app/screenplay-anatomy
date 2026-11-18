#!/usr/bin/env node

/**
 * Reproduce the aggregate statistics used by the Screenplay Anatomy Atlas.
 *
 * Input is the MovieSum JSONL release. The raw corpus is never copied into
 * this repository and the generated output contains aggregate statistics only.
 *
 * Usage:
 *   node src/analyze-screenplay-anatomy.mts \
 *     --input /path/to/train.jsonl \
 *     --input /path/to/val.jsonl \
 *     --input /path/to/test.jsonl \
 *     --output /tmp/screenplay-anatomy.generated.json
 */

import type { Hash } from "node:crypto"
import { createHash } from "node:crypto"
import { createReadStream, realpathSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { createInterface } from "node:readline"
import { assertAggregate } from "./aggregate.ts"

// ─── Types ───────────────────────────────────────────────────────────────────

/** One MovieSum JSONL record: the tagged screenplay XML plus its reference summary. */
interface MovieSumRecord {
  script: string
  summary: string
}

/** A tagged element inside one <scene> block. */
interface TaggedElement {
  type: string
  value: string
}

interface Scene {
  actionWords: number
  dialogueWords: number
  dialogueBlocks: number
  narrativeWords: number
  narrativeText: string
  speakerDialogueWords: Map<string, number>
  hasHeading: boolean
}

interface ProgressBucket {
  actionWords: number
  dialogueWords: number
  scenes: number
}

interface NovelNgrams {
  unigram: number | null
  bigram: number | null
  trigram: number | null
}

interface ScriptProgress {
  actionShare: number | null
  scenes: number
}

/** Per-screenplay measurements. Every corpus statistic is derived from these. */
interface ScriptSummary {
  sceneCount: number
  narrativeWords: number
  tokenizedNarrativeWords: number
  dialogueWords: number
  actionWords: number
  dialogueBlocks: number
  speakingCharacterCount: number
  topThreeDialogueShare: number
  summaryWords: number
  compressionRatio: number
  novelNgrams: NovelNgrams
  medianSceneWords: number | null
  longestSceneDecileShare: number | null
  dialogueFreeSceneShare: number | null
  headingCoverage: number
  progress: ScriptProgress[]
  characterIntroductions: Array<number | null>
  exclusionReasons: string[]
}

interface Distribution {
  p10: number | null
  p25: number | null
  median: number | null
  p75: number | null
  p90: number | null
}

interface ConfidenceInterval {
  low: number | null
  high: number | null
}

interface LogNormalFit {
  mu: number
  sigma: number
  rawSkewness: number
  logSkewness: number
  kolmogorovSmirnovD: number
}

/**
 * Indexed read that fails loudly instead of yielding `undefined`.
 *
 * Every call site below is inside a bounds-checked loop, so an out-of-range read
 * is a programming error rather than a data condition. `noUncheckedIndexedAccess`
 * cannot see those bounds; threading a nullish check through each of the ~20
 * quickselect / correlation / bucket reads would bury the algorithms. A throwing
 * accessor keeps them readable AND turns a future off-by-one into a named
 * RangeError instead of a silent `NaN` propagating into published statistics.
 */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) {
    throw new RangeError(`index ${index} is out of range (length ${values.length})`)
  }
  return value
}

const ANALYSIS_VERSION = "1.1.0"
const ANALYZED_AT = "2026-08-10"
const PROGRESS_BUCKETS = 10
const BOOTSTRAP_REPLICATES = 2_000
const BOOTSTRAP_SEED = 20_260_810
const MIN_SCENES = 20
const MIN_NARRATIVE_WORDS = 5_000
const MIN_SPEAKING_CHARACTERS = 3
const MIN_DIALOGUE_BLOCKS = 20

function parseArguments(argv: readonly string[]): { inputs: string[]; output: string } {
  const inputs: string[] = []
  let output: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--input") {
      const value = argv[index + 1]
      if (!value) throw new Error("--input requires a path")
      inputs.push(resolve(value))
      index += 1
    } else if (argument === "--output") {
      const value = argv[index + 1]
      if (!value) throw new Error("--output requires a path")
      output = resolve(value)
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (inputs.length === 0) throw new Error("Provide at least one --input JSONL file")
  if (output === undefined) throw new Error("Provide an --output path")

  const canonicalInputs = inputs.map((input) => realpathSync(input))
  if (new Set(canonicalInputs).size !== canonicalInputs.length)
    throw new Error("Each input file must be provided once")
  return { inputs, output }
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function wordCount(value: string): number {
  const normalized = stripMarkup(value)
  return normalized ? normalized.split(" ").length : 0
}

function tokenize(value: string): string[] {
  return (
    stripMarkup(value)
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []
  )
}

function ngramNovelty(
  sourceTokens: readonly string[],
  summaryTokens: readonly string[],
  size: number,
): number | null {
  const source = new Set<string>()
  const summary = new Set<string>()
  for (let index = 0; index <= sourceTokens.length - size; index += 1) {
    source.add(sourceTokens.slice(index, index + size).join("\u001f"))
  }
  for (let index = 0; index <= summaryTokens.length - size; index += 1) {
    summary.add(summaryTokens.slice(index, index + size).join("\u001f"))
  }
  if (summary.size === 0) return null
  let novel = 0
  for (const gram of summary) if (!source.has(gram)) novel += 1
  return novel / summary.size
}

function normalizeCharacter(value: string): string {
  return stripMarkup(value)
    .toLocaleUpperCase("en-US")
    .replace(
      /\s*\((?:V\. ?O\.|O\. ?S\.|O\. ?C\.|CONT['’]?D|CONTINUED|FILTERED|ON RADIO|ON PHONE).*\)\s*$/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
}

function extractTaggedElements(sceneXml: string): TaggedElement[] {
  const elements: TaggedElement[] = []
  const tagPattern =
    /<(stage_direction|scene_description|character|dialogue|parenthetical|transition|shot)>([\s\S]*?)<\/\1>/gi
  let match = tagPattern.exec(sceneXml)
  while (match !== null) {
    // Both groups are non-optional in the pattern, but a matched group is
    // `string | undefined` to the compiler; bind and skip rather than assert.
    const [, tag, body] = match
    if (tag !== undefined && body !== undefined) {
      elements.push({ type: tag.toLowerCase(), value: body })
    }
    match = tagPattern.exec(sceneXml)
  }
  return elements
}

function parseScript(script: string): Scene[] {
  const scenes: Scene[] = []
  const scenePattern = /<scene>([\s\S]*?)<\/scene>/gi
  let match = scenePattern.exec(script)

  while (match !== null) {
    const sceneBody = match[1]
    if (sceneBody === undefined) {
      match = scenePattern.exec(script)
      continue
    }
    const elements = extractTaggedElements(sceneBody)
    const actionWords = elements
      .filter((element) => element.type === "scene_description")
      .reduce((sum, element) => sum + wordCount(element.value), 0)
    const dialogueWords = elements
      .filter((element) => element.type === "dialogue")
      .reduce((sum, element) => sum + wordCount(element.value), 0)
    const dialogueBlocks = elements.filter((element) => element.type === "dialogue").length
    const speakerDialogueWords = new Map<string, number>()
    let activeSpeaker = ""
    for (const element of elements) {
      if (element.type === "character") {
        activeSpeaker = normalizeCharacter(element.value)
      } else if (element.type === "dialogue" && activeSpeaker) {
        speakerDialogueWords.set(
          activeSpeaker,
          (speakerDialogueWords.get(activeSpeaker) ?? 0) + wordCount(element.value),
        )
      }
    }
    const heading = elements.find((element) => element.type === "stage_direction")

    scenes.push({
      actionWords,
      dialogueWords,
      dialogueBlocks,
      narrativeWords: actionWords + dialogueWords,
      narrativeText: elements
        .filter((element) => element.type === "scene_description" || element.type === "dialogue")
        .map((element) => element.value)
        .join(" "),
      speakerDialogueWords,
      hasHeading: Boolean(heading && stripMarkup(heading.value)),
    })
    match = scenePattern.exec(script)
  }

  return scenes
}

function summarizeScript(record: MovieSumRecord): ScriptSummary {
  const scenes = parseScript(record.script)
  const scriptTokens = scenes.flatMap((scene) => tokenize(scene.narrativeText))
  const summaryTokens = tokenize(record.summary)
  const narrativeWords = scenes.reduce((sum, scene) => sum + scene.narrativeWords, 0)
  const dialogueWords = scenes.reduce((sum, scene) => sum + scene.dialogueWords, 0)
  const actionWords = scenes.reduce((sum, scene) => sum + scene.actionWords, 0)
  const dialogueBlocks = scenes.reduce((sum, scene) => sum + scene.dialogueBlocks, 0)
  const characterDialogueWords = new Map<string, number>()
  const firstCharacterBucket = new Map<string, number>()
  const progress: ProgressBucket[] = Array.from({ length: PROGRESS_BUCKETS }, () => ({
    actionWords: 0,
    dialogueWords: 0,
    scenes: 0,
  }))

  let cumulativeWords = 0
  for (const scene of scenes) {
    const midpoint = cumulativeWords + scene.narrativeWords / 2
    const bucket = Math.min(
      PROGRESS_BUCKETS - 1,
      Math.floor((midpoint / Math.max(1, narrativeWords)) * PROGRESS_BUCKETS),
    )
    const target = at(progress, bucket)
    target.actionWords += scene.actionWords
    target.dialogueWords += scene.dialogueWords
    target.scenes += 1

    for (const [speaker, words] of scene.speakerDialogueWords) {
      if (words <= 0) continue
      if (!firstCharacterBucket.has(speaker)) firstCharacterBucket.set(speaker, bucket)
      characterDialogueWords.set(speaker, (characterDialogueWords.get(speaker) ?? 0) + words)
    }
    cumulativeWords += scene.narrativeWords
  }

  const speakingCharacters = [...characterDialogueWords.entries()]
    .filter(([, words]) => words > 0)
    .sort((left, right) => right[1] - left[1])
  const topThreeDialogueWords = speakingCharacters
    .slice(0, 3)
    .reduce((sum, [, words]) => sum + words, 0)
  const longestSceneCount = Math.max(1, Math.ceil(scenes.length * 0.1))
  const longestSceneDecileWords = scenes
    .map((scene) => scene.narrativeWords)
    .toSorted((left, right) => right - left)
    .slice(0, longestSceneCount)
    .reduce((sum, words) => sum + words, 0)

  const exclusionReasons = []
  if (scenes.length < MIN_SCENES) exclusionReasons.push("too_few_scenes")
  if (narrativeWords < MIN_NARRATIVE_WORDS) exclusionReasons.push("too_few_narrative_words")
  if (speakingCharacters.length < MIN_SPEAKING_CHARACTERS) {
    exclusionReasons.push("too_few_speaking_characters")
  }
  if (dialogueBlocks < MIN_DIALOGUE_BLOCKS) exclusionReasons.push("too_few_dialogue_blocks")

  return {
    sceneCount: scenes.length,
    narrativeWords,
    tokenizedNarrativeWords: scriptTokens.length,
    dialogueWords,
    actionWords,
    dialogueBlocks,
    speakingCharacterCount: speakingCharacters.length,
    topThreeDialogueShare: dialogueWords > 0 ? topThreeDialogueWords / dialogueWords : 0,
    summaryWords: summaryTokens.length,
    compressionRatio: scriptTokens.length > 0 ? summaryTokens.length / scriptTokens.length : 0,
    novelNgrams: {
      unigram: ngramNovelty(scriptTokens, summaryTokens, 1),
      bigram: ngramNovelty(scriptTokens, summaryTokens, 2),
      trigram: ngramNovelty(scriptTokens, summaryTokens, 3),
    },
    medianSceneWords: median(scenes.map((scene) => scene.narrativeWords)),
    longestSceneDecileShare: narrativeWords > 0 ? longestSceneDecileWords / narrativeWords : null,
    dialogueFreeSceneShare:
      scenes.length > 0
        ? scenes.filter((scene) => scene.dialogueWords === 0).length / scenes.length
        : null,
    headingCoverage:
      scenes.length > 0 ? scenes.filter((scene) => scene.hasHeading).length / scenes.length : 0,
    progress: progress.map((bucket) => ({
      actionShare:
        bucket.actionWords + bucket.dialogueWords > 0
          ? bucket.actionWords / (bucket.actionWords + bucket.dialogueWords)
          : null,
      scenes: bucket.scenes,
    })),
    characterIntroductions: Array.from({ length: PROGRESS_BUCKETS }, (_, bucket) => {
      if (speakingCharacters.length === 0) return null
      const introduced = [...firstCharacterBucket.values()].filter(
        (firstBucket) => firstBucket <= bucket,
      ).length
      return introduced / speakingCharacters.length
    }),
    exclusionReasons,
  }
}

function quantile(sortedValues: readonly number[], probability: number): number | null {
  if (sortedValues.length === 0) return null
  if (sortedValues.length === 1) return at(sortedValues, 0)
  const position = (sortedValues.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return at(sortedValues, lower) * (1 - weight) + at(sortedValues, upper) * weight
}

/**
 * `Number.isFinite` is declared `(value: unknown) => boolean`, not a type
 * predicate, so filtering a `(number | null)[]` through it leaves `null` in the
 * static type even though it is gone from the value. This re-states the same
 * runtime check as a guard — `null`, `NaN` and `±Infinity` are all excluded, and
 * ±Infinity is reachable here (a ratio whose denominator is 0), so narrowing via
 * a plain `isNumber` would silently admit it into the sorted quantile input.
 *
 * Deliberately local rather than imported from `@inkwell/shared`: this script is
 * run by bare `node` (type stripping only), and the source-first workspace
 * packages export `.ts` with extensionless relative imports that plain Node
 * cannot resolve. Any workspace import here breaks the script at run time.
 */
function isFiniteNumber(value: number | null): value is number {
  return Number.isFinite(value)
}

function median(values: readonly number[]): number | null {
  const finite = values.filter(isFiniteNumber).sort((left, right) => left - right)
  return quantile(finite, 0.5)
}

function distribution(values: ReadonlyArray<number | null>): Distribution {
  const finite = values.filter(isFiniteNumber).sort((left, right) => left - right)
  return {
    p10: quantile(finite, 0.1),
    p25: quantile(finite, 0.25),
    median: quantile(finite, 0.5),
    p75: quantile(finite, 0.75),
    p90: quantile(finite, 0.9),
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[], average: number = mean(values)): number {
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length)
}

function skewness(values: readonly number[]): number {
  const average = mean(values)
  const deviation = standardDeviation(values, average)
  return (
    values.reduce((sum, value) => sum + ((value - average) / deviation) ** 3, 0) / values.length
  )
}

function errorFunction(value: number): number {
  const sign = value < 0 ? -1 : 1
  const absolute = Math.abs(value)
  const coefficient = 1 / (1 + 0.3275911 * absolute)
  const approximation =
    1 -
    ((((1.061405429 * coefficient - 1.453152027) * coefficient + 1.421413741) * coefficient -
      0.284496736) *
      coefficient +
      0.254829592) *
      coefficient *
      Math.exp(-absolute * absolute)
  return sign * approximation
}

function normalCdf(value: number): number {
  return (1 + errorFunction(value / Math.sqrt(2))) / 2
}

function logNormalFit(values: readonly number[]): LogNormalFit {
  const positive = values.filter((value) => value > 0)
  const logged = positive.map(Math.log)
  const mu = mean(logged)
  const sigma = standardDeviation(logged, mu)
  const sorted = positive.toSorted((left, right) => left - right)
  // A fitted CDF is undefined without a positive log-space deviation.
  let kolmogorovSmirnovD = sigma > 0 ? 0 : Number.NaN
  for (let index = 0; index < sorted.length; index += 1) {
    const theoretical = normalCdf((Math.log(at(sorted, index)) - mu) / sigma)
    const empiricalBefore = index / sorted.length
    const empiricalAfter = (index + 1) / sorted.length
    kolmogorovSmirnovD = Math.max(
      kolmogorovSmirnovD,
      Math.abs(theoretical - empiricalBefore),
      Math.abs(empiricalAfter - theoretical),
    )
  }
  return {
    mu,
    sigma,
    rawSkewness: skewness(positive),
    logSkewness: skewness(logged),
    kolmogorovSmirnovD,
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function selectKth(values: number[], target: number): number {
  let left = 0
  let right = values.length - 1

  while (left < right) {
    const pivot = at(values, Math.floor((left + right) / 2))
    let lower = left
    let upper = right
    while (lower <= upper) {
      while (at(values, lower) < pivot) lower += 1
      while (at(values, upper) > pivot) upper -= 1
      if (lower <= upper) {
        const low = at(values, lower)
        const high = at(values, upper)
        values[lower] = high
        values[upper] = low
        lower += 1
        upper -= 1
      }
    }
    if (target <= upper) right = upper
    else if (target >= lower) left = lower
    else return at(values, target)
  }
  return at(values, target)
}

function sampleMedian(values: number[]): number {
  const upperIndex = Math.floor(values.length / 2)
  const upper = selectKth(values, upperIndex)
  if (values.length % 2 === 1) return upper
  const lower = selectKth(values, upperIndex - 1)
  return (lower + upper) / 2
}

function bootstrapMedianInterval(
  values: ReadonlyArray<number | null>,
  random: () => number,
): ConfidenceInterval {
  const finite = values.filter((value): value is number => Number.isFinite(value))
  if (finite.length === 0) return { low: null, high: null }
  const estimates: number[] = []
  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate += 1) {
    const sample = Array.from({ length: finite.length }, () =>
      at(finite, Math.floor(random() * finite.length)),
    )
    estimates.push(sampleMedian(sample))
  }
  estimates.sort((left, right) => left - right)
  return {
    low: quantile(estimates, 0.025),
    high: quantile(estimates, 0.975),
  }
}

function rank(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }))
  indexed.sort((left, right) => left.value - right.value)
  const ranks: number[] = Array.from({ length: values.length }, () => 0)
  let cursor = 0
  while (cursor < indexed.length) {
    let end = cursor
    while (end + 1 < indexed.length && at(indexed, end + 1).value === at(indexed, cursor).value) {
      end += 1
    }
    const averageRank = (cursor + end + 2) / 2
    for (let index = cursor; index <= end; index += 1) ranks[at(indexed, index).index] = averageRank
    cursor = end + 1
  }
  return ranks
}

function pearson(left: readonly number[], right: readonly number[]): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  let numerator = 0
  let leftSquares = 0
  let rightSquares = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = at(left, index) - leftMean
    const rightDelta = at(right, index) - rightMean
    numerator += leftDelta * rightDelta
    leftSquares += leftDelta ** 2
    rightSquares += rightDelta ** 2
  }
  return numerator / Math.sqrt(leftSquares * rightSquares)
}

function spearman(left: readonly number[], right: readonly number[]): number {
  return pearson(rank(left), rank(right))
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function roundDeep(value: unknown): unknown {
  if (typeof value === "number") return round(value)
  if (Array.isArray(value)) return value.map(roundDeep)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, roundDeep(nested)]),
    )
  }
  return value
}

function summarizeCastDialogueBins(scripts: readonly ScriptSummary[]) {
  const bins = [
    { label: "3–19", minimum: 3, maximum: 19 },
    { label: "20–29", minimum: 20, maximum: 29 },
    { label: "30–39", minimum: 30, maximum: 39 },
    { label: "40–59", minimum: 40, maximum: 59 },
    { label: "60–79", minimum: 60, maximum: 79 },
    { label: "80–119", minimum: 80, maximum: 119 },
    { label: "120+", minimum: 120, maximum: Number.POSITIVE_INFINITY },
  ]

  return bins.map((bin) => {
    const members = scripts.filter(
      (script) =>
        script.speakingCharacterCount >= bin.minimum &&
        script.speakingCharacterCount <= bin.maximum,
    )
    return {
      label: bin.label,
      scripts: members.length,
      speakingCharacters: distribution(members.map((script) => script.speakingCharacterCount)),
      topThreeDialogueShare: distribution(members.map((script) => script.topThreeDialogueShare)),
    }
  })
}

async function readScripts(inputPath: string, digest: Hash): Promise<ScriptSummary[]> {
  const scripts: ScriptSummary[] = []
  const stream = createReadStream(inputPath)
  stream.on("data", (chunk) => digest.update(chunk))
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
  let lineNumber = 0
  for await (const line of lines) {
    lineNumber += 1
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      throw new Error(`Invalid JSON in ${inputPath} at line ${lineNumber}`)
    }
    if (
      typeof record !== "object" ||
      record === null ||
      typeof Reflect.get(record, "script") !== "string" ||
      typeof Reflect.get(record, "summary") !== "string"
    )
      throw new Error(`Expected script and summary strings in ${inputPath} at line ${lineNumber}`)
    scripts.push(summarizeScript(record as MovieSumRecord))
  }
  return scripts
}

async function main(): Promise<void> {
  const { inputs, output } = parseArguments(process.argv.slice(2))
  const digest = createHash("sha256")
  const scripts = []
  for (const input of inputs) scripts.push(...(await readScripts(input, digest)))
  const included = scripts.filter((script) => script.exclusionReasons.length === 0)
  const random = createRandom(BOOTSTRAP_SEED)
  const exclusionCounts: Record<string, number> = {}
  for (const script of scripts) {
    for (const reason of script.exclusionReasons) {
      exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1
    }
  }

  const progress = Array.from({ length: PROGRESS_BUCKETS }, (_, index) => {
    const actionShares = included
      .map((script) => at(script.progress, index).actionShare)
      .filter((value): value is number => Number.isFinite(value))
    const sceneCounts = included.map((script) => at(script.progress, index).scenes)
    const characterShares = included
      .map((script) => at(script.characterIntroductions, index))
      .filter((value): value is number => Number.isFinite(value))
    return {
      decile: index + 1,
      range: `${index * 10}–${(index + 1) * 10}%`,
      actionShare: {
        ...distribution(actionShares),
        confidence95: bootstrapMedianInterval(actionShares, random),
      },
      scenes: {
        ...distribution(sceneCounts),
        confidence95: bootstrapMedianInterval(sceneCounts, random),
      },
      speakingCastIntroduced: {
        ...distribution(characterShares),
        confidence95: bootstrapMedianInterval(characterShares, random),
      },
    }
  })

  const outputData = roundDeep({
    analysisVersion: ANALYSIS_VERSION,
    analyzedAt: ANALYZED_AT,
    corpus: {
      name: "MovieSum",
      creators: ["Rohit Saxena", "Frank Keller"],
      source: "https://huggingface.co/datasets/rohitsaxena/MovieSum",
      paper: "https://aclanthology.org/2024.findings-acl.239/",
      license: "CC BY-NC 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
      adaptationNotice:
        "Aggregate analysis adapted from MovieSum; no screenplay text, summaries, identifiers, or title-level measurements are redistributed.",
      inputSha256: digest.digest("hex"),
      records: scripts.length,
      includedRecords: included.length,
      excludedRecords: scripts.length - included.length,
      exclusionCounts,
    },
    method: {
      unitOfAnalysis: "One screenplay receives equal weight in every corpus summary.",
      progressDefinition:
        "Scenes are assigned by the midpoint of their action-plus-dialogue word count after each screenplay is normalized to 100%.",
      actionDefinition:
        "Words tagged scene_description divided by scene_description plus dialogue words.",
      characterDefinition: "A normalized character cue followed by at least one dialogue block.",
      longestSceneDefinition:
        "The share of a screenplay's action-plus-dialogue words contained in its longest 10% of scenes, rounding the scene count up.",
      dialogueFreeSceneDefinition:
        "The share of parsed scenes containing no tagged dialogue words.",
      thresholds: {
        minimumScenes: MIN_SCENES,
        minimumNarrativeWords: MIN_NARRATIVE_WORDS,
        minimumSpeakingCharacters: MIN_SPEAKING_CHARACTERS,
        minimumDialogueBlocks: MIN_DIALOGUE_BLOCKS,
      },
      bootstrap: {
        statistic: "median",
        interval: "percentile 95%",
        replicates: BOOTSTRAP_REPLICATES,
        seed: BOOTSTRAP_SEED,
      },
    },
    overview: {
      narrativeWords: distribution(included.map((script) => script.narrativeWords)),
      tokenizedNarrativeWords: distribution(
        included.map((script) => script.tokenizedNarrativeWords),
      ),
      sceneCount: distribution(included.map((script) => script.sceneCount)),
      medianSceneWords: distribution(included.map((script) => script.medianSceneWords)),
      longestSceneDecileShare: distribution(
        included.map((script) => script.longestSceneDecileShare),
      ),
      dialogueFreeSceneShare: distribution(included.map((script) => script.dialogueFreeSceneShare)),
      speakingCharacterCount: distribution(included.map((script) => script.speakingCharacterCount)),
      actionShare: distribution(
        included.map((script) => script.actionWords / script.narrativeWords),
      ),
      topThreeDialogueShare: distribution(included.map((script) => script.topThreeDialogueShare)),
      headingCoverage: distribution(included.map((script) => script.headingCoverage)),
      summaryWords: distribution(included.map((script) => script.summaryWords)),
      compressionRatio: distribution(included.map((script) => script.compressionRatio)),
      aggregateCompressionRatio:
        mean(included.map((script) => script.summaryWords)) /
        mean(included.map((script) => script.tokenizedNarrativeWords)),
      novelNgrams: {
        unigram: distribution(included.map((script) => script.novelNgrams.unigram)),
        bigram: distribution(included.map((script) => script.novelNgrams.bigram)),
        trigram: distribution(included.map((script) => script.novelNgrams.trigram)),
      },
      scriptLengthLogNormalFit: logNormalFit(
        included.map((script) => script.tokenizedNarrativeWords),
      ),
      summaryLengthLogNormalFit: logNormalFit(included.map((script) => script.summaryWords)),
    },
    progress,
    castDialogueBins: summarizeCastDialogueBins(included),
    relationships: {
      narrativeWordsVsSceneCountSpearman: spearman(
        included.map((script) => script.narrativeWords),
        included.map((script) => script.sceneCount),
      ),
      castSizeVsTopThreeDialogueShareSpearman: spearman(
        included.map((script) => script.speakingCharacterCount),
        included.map((script) => script.topThreeDialogueShare),
      ),
      scriptLengthVsSummaryLengthPearson: pearson(
        included.map((script) => script.tokenizedNarrativeWords),
        included.map((script) => script.summaryWords),
      ),
      scriptLengthVsSummaryLengthSpearman: spearman(
        included.map((script) => script.tokenizedNarrativeWords),
        included.map((script) => script.summaryWords),
      ),
    },
  })

  assertAggregate(outputData)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(outputData, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  })
  process.stdout.write(
    `Analyzed ${scripts.length} screenplays; included ${included.length}; wrote ${output}\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Analysis failed"}\n`)
  process.exitCode = 1
})
