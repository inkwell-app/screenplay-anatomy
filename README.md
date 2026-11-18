# Screenplay Anatomy

Reproduce the statistics behind Inkwell’s [Screenplay Anatomy Atlas](https://www.inkwell.software/resources/screenplay-anatomy?utm_source=github&utm_medium=referral&utm_campaign=screenplay_anatomy&utm_id=github_screenplay_anatomy&utm_source_platform=github&utm_content=readme_atlas) and explore a licensed aggregate dataset without downloading a corpus.

[![CI](https://github.com/inkwell-app/screenplay-anatomy/actions/workflows/ci.yml/badge.svg)](https://github.com/inkwell-app/screenplay-anatomy/actions/workflows/ci.yml)
[![Code: MIT](https://img.shields.io/badge/code-MIT-blue)](LICENSE)
[![Data: CC BY-NC 4.0](https://img.shields.io/badge/data-CC_BY--NC_4.0-blue)](LICENSE-DATA)

## Start here

| Goal | Resource |
| --- | --- |
| Explore the published findings | [Interactive atlas](https://www.inkwell.software/resources/screenplay-anatomy?utm_source=github&utm_medium=referral&utm_campaign=screenplay_anatomy&utm_id=github_screenplay_anatomy&utm_source_platform=github&utm_content=readme_findings) |
| Use the aggregate snapshot | [JSON](data/screenplay-anatomy.generated.json), [schema](schemas/aggregate.schema.json), [data dictionary](docs/data-dictionary.md) |
| Reproduce the analysis | [Method and reproducibility](docs/methodology.md) |
| Run without copyrighted inputs | Original [synthetic fixture generator](fixtures/synthetic.ts) and executable tests |
| Cite or adapt the work | [Citation](CITATION.cff), [code license](LICENSE), [data license](LICENSE-DATA) |

The snapshot summarizes 2,200 MovieSum records; 2,077 pass the documented structural thresholds. It contains distributions and relationships, never title-level rows, screenplay text, summaries, or character lists. These are descriptive patterns in one corpus, not prescriptions for successful writing.

## Install and verify

Use Node 22.18+ and pnpm 10.20.0. Runtime analysis uses the local filesystem; it does not download or transmit your inputs.

```bash
git clone https://github.com/inkwell-app/screenplay-anatomy.git
cd screenplay-anatomy
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm typecheck
corepack pnpm test
corepack pnpm check:data
```

Tests generate original synthetic input in a temporary directory, verify hand-computable statistics, and remove the fixture afterward. No MovieSum download is needed to run CI.

## Analyze a corpus you have permission to use

Obtain [MovieSum](https://huggingface.co/datasets/rohitsaxena/MovieSum) under its authors’ terms. Keep input files outside this checkout. Each JSONL record must contain string `script` (MovieSum tagged markup) and `summary` fields; other fields are ignored.

```bash
pnpm analyze --input /path/to/train.jsonl \
  --input /path/to/val.jsonl \
  --input /path/to/test.jsonl \
  --output /tmp/anatomy-reproduction.json
```

The output path must not exist. Duplicate input files, malformed records, missing arguments, and existing output paths fail with a nonzero exit status. Empty inputs succeed with zero included records and null statistics. Input order and exact bytes determine the SHA-256 fingerprint; preserve both when comparing runs.

## Licensing and attribution

Code, documentation, schemas, and original synthetic fixtures are MIT. **MovieSum-derived JSON in `data/` and generated from MovieSum is CC BY-NC 4.0**, not MIT. Retain the corpus attribution, license URL, and adaptation notice when redistributing it; commercial use requires appropriate separate permission. See [LICENSE-DATA](LICENSE-DATA).

MovieSum is by Rohit Saxena and Frank Keller. Cite their [2024 paper](https://aclanthology.org/2024.findings-acl.239/) for the corpus and [CITATION.cff](CITATION.cff) for this analysis. A schema check helps catch accidental extra fields; maintainers still review every data change for provenance and rights.

## Explore Inkwell

- [Plot, the screenplay editor](https://www.inkwell.software/plot?utm_source=github&utm_medium=referral&utm_campaign=screenplay_anatomy&utm_id=github_screenplay_anatomy&utm_source_platform=github&utm_content=readme_plot)
- [Writing resources](https://www.inkwell.software/resources?utm_source=github&utm_medium=referral&utm_campaign=screenplay_anatomy&utm_id=github_screenplay_anatomy&utm_source_platform=github&utm_content=readme_resources)
- [Help and documentation](https://www.inkwell.software/help?utm_source=github&utm_medium=referral&utm_campaign=screenplay_anatomy&utm_id=github_screenplay_anatomy&utm_source_platform=github&utm_content=readme_help)
- [Writing handbook](https://github.com/inkwell-app/writing-handbook)
- [Screenplay interoperability fixtures](https://github.com/inkwell-app/screenplay-interop)
