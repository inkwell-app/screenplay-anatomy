# Aggregate data dictionary

The machine-readable contract is [aggregate.schema.json](../schemas/aggregate.schema.json). It rejects unknown fields throughout the result, missing attribution, and invalid numeric types. Schema validity is necessary but does not replace review of data provenance or the correctness of an analysis.

| Field | Meaning / unit |
| --- | --- |
| `analysisVersion`, `analyzedAt` | Method version and historical snapshot date |
| `corpus` | Source attribution, input byte fingerprint, record counts and overlapping exclusion reasons |
| `method` | Definitions, inclusion thresholds, bootstrap seed and replication count |
| `overview` | Corpus distributions of script word counts, scene counts, scene lengths, shares, cast size, summary length and compression |
| `overview.novelNgrams` | Share of distinct summary n-grams absent from the screenplay, for n=1,2,3 |
| `overview.*LogNormalFit` | Log-space mean/sigma, raw/log skewness, and Kolmogorov–Smirnov descriptive distance |
| `progress` | Ten narrative-progress buckets with action share, scene count and cumulative share of speaking cast introduced by the end of each decile |
| `castDialogueBins` | Cast-size ranges, number of scripts, cast distributions and top-three dialogue share |
| `relationships` | Pearson/Spearman coefficients for named variable pairs |

A distribution contains `p10`, `p25`, `median`, `p75`, and `p90`. Progress distributions also include `confidence95.low/high`. Shares are fractions from 0 to 1, not percentages. Correlation coefficients range from -1 to 1 when defined. Numerical summaries are rounded to four decimal places. Missing/undefined values serialize as `null` (including empty populations and zero-variance correlations).

The aggregate snapshot has a separate noncommercial data license. Keep its `corpus` attribution block with any redistribution or adaptation.

## Ratios and fitted distributions

`overview.compressionRatio` summarizes each script’s summary-token count divided by its screenplay-token count. `aggregateCompressionRatio` divides the sum of summary tokens by the sum of screenplay tokens across included scripts; this weights longer scripts differently from the median per-script ratio. `summaryWords` uses the same Unicode tokenization as `tokenizedNarrativeWords`.

`longestSceneDecileShare` sums the largest ceil(10% × scene count) scenes’ narrative words and divides by all narrative words. `topThreeDialogueShare` divides words attributed to the three most talkative normalized speakers by all tagged dialogue words, including dialogue without an assigned speaker.

`progress.speakingCastIntroduced` is cumulative: a character counts in every bucket at or after their first speaking scene. Its final decile is one for included scripts. A progress bucket with no narrative words has undefined action share; that script is omitted from that bucket’s action-share distribution, while its scene count is zero.

Log-normal fits report natural-log mean (`mu`) and standard deviation (`sigma`), raw/log skewness, and maximum empirical-vs-fitted CDF distance (`kolmogorovSmirnovD`). The distance is descriptive, not a calibrated goodness-of-fit p-value. Individual fit fields are null when undefined. In particular, the fitted-CDF distance is null for empty, singleton, or constant samples because there is no positive log-space deviation.

## Genre and runtime tables

The genre and runtime tables summarize the same 2,077 eligible MovieSum scripts as the overview. Keep the following attribution with the genre table, whose JSON contains the input and lookup fingerprints. Screenplay statistics are adapted from MovieSum by Rohit Saxena and Frank Keller (2024), licensed CC BY-NC 4.0. Genre tags and film runtimes are from Wikidata contributors, CC0. The tables contain cohort summaries only. [MovieSum](https://huggingface.co/datasets/rohitsaxena/MovieSum) · [MovieSum license](https://creativecommons.org/licenses/by-nc/4.0/) · [Wikidata genre](https://www.wikidata.org/wiki/Property:P136) · [Wikidata duration](https://www.wikidata.org/wiki/Property:P2047)

In the genre table, `covered` counts scripts with at least one of the eight selected genre tags. A script with two matching tags contributes once to each group. `scenes` counts scenes, `dialogue` is the fraction of narrative words in dialogue, and `cast` counts distinct normalized speaking cues. The overview histograms include all eligible scripts. Each histogram starts at zero and includes overflow in its final bin.

The runtime table records the observation date and filtering method. The four exclusion counts account for the difference between `eligible` and `retained`. The two runtime windows cover a subset of retained scripts. Each range includes its lower bound and excludes its upper bound. Its scene-count bins sum to its sample size.

`inputSha256` identifies the MovieSum split bytes. Each table's `lookupSha256` identifies its specific Wikidata lookup. Later edits to Wikidata can change those inputs. The published contracts validate exact fingerprints, field sets, attribution, ordered percentiles, and cohort counts. [Cohort validation](../src/cohorts.ts)
