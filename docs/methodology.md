# Method and reproducibility

## What is measured

One screenplay receives equal weight in corpus summaries. Scenes come from MovieSum `<scene>` blocks. Action words come from `scene_description`; dialogue words from `dialogue`. Headings, transitions, parentheticals, and shots do not count as narrative words. Word counts split cleaned text on whitespace; tokenized counts use Unicode letters and numbers. These different definitions are retained explicitly in the output.

A speaking character is a normalized character cue followed by dialogue. Cues are uppercased and common voice/continuation suffixes removed. This is a heuristic, not entity resolution: aliases can remain separate and identical names can be combined within one script.

Included scripts have at least 20 scenes, 5,000 narrative words, three speaking characters, and 20 dialogue blocks. A script can fail multiple thresholds, so exclusion-reason counts can exceed excluded records.

Each scene is assigned to a progress decile using its narrative-word midpoint. Within each screenplay, decile action share is action words divided by narrative words; corpus summaries weight scripts equally, not words. Quantiles use linear interpolation. Bootstrap intervals resample per-script values 2,000 times with a fixed pseudo-random seed of 20260810. Intervals describe sample variability, not corpus representativeness or causal effects.

## Reproduce and compare

The checked-in snapshot uses analysis version 1.1.0. `analyzedAt` is the historical snapshot date, 2026-08-10, retained for byte-compatible reproduction; it is **not a live execution timestamp**. Record your execution time, runtime version, input source revision, and split ordering separately when publishing a new run.

The input hash covers concatenated raw bytes in command-line order, including whitespace and line endings. Use train, validation, then test for the published snapshot. Compare your fingerprint with `corpus.inputSha256` before interpreting a statistics mismatch. The original corpus is not distributed here, and the synthetic test run does not establish that a fresh upstream download matches the published snapshot.

The script retains per-script numerical summaries in memory, but exports only corpus aggregates. It is a batch research tool, not a service for untrusted uploads. Very large corpora can exhaust memory; run locally with an appropriate resource budget.

## Limits

MovieSum is a selected corpus with extraction and markup artifacts. Structural filters change the population; no claim of representativeness across languages, genres, budgets, or eras follows. Correlations are descriptive. A null statistic means insufficient or undefined observations, not zero. Small synthetic cohorts are useful for checking code, not drawing research conclusions. Do not infer an individual title’s properties from these aggregates.

The public tool corrects one degenerate-sample diagnostic: fitted-CDF distance is null when log-space deviation is undefined or zero. Nondegenerate snapshot statistics are unchanged. Synthetic tests use the MovieSum input shape only; their temporary outputs are test artifacts, not MovieSum research results.

## Work through the synthetic fixture

The original fixture generator creates 20 scenes with 240 action words and three 20-word dialogue blocks per scene. That is 300 narrative words per scene, 6,000 total, an action share of 240/300 = 0.8, three speaking characters, and 60 dialogue blocks. All four inclusion thresholds pass. The largest two scenes contain 600/6,000 = 0.1 of narrative words. Each progress decile contains two scenes. The one-scene variant fails scene, narrative-word, and dialogue-block thresholds; exclusion reasons overlap.

The varied cohort adds a 30-scene version. Its scene-count median is 25 and linearly interpolated p10 is 21. Scene count and narrative-word count have a Spearman correlation of one; constant cast size makes the cast/dialogue-share correlation undefined. The executable tests verify these calculations and bootstrap bounds. These original artificial inputs demonstrate the computation, not real-world screenplay distributions.
