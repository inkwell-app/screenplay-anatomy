# Changelog

## 0.1.0

- Publish the Screenplay Anatomy 1.1.0 analysis and its licensed aggregate snapshot.
- Add genre and runtime tables that compare scene counts, dialogue share and distinct speaking cues across eight genres, and scene counts for films running 85–94 and 115–124 minutes.
- Validate each table's fingerprints, field sets, attribution, ordered percentiles and cohort counts.
- Add an explicit aggregate schema, original synthetic fixtures, reproducibility guidance, and independent CI.
- Validate input records, reject duplicate files, and require a fresh output path.
- Report undefined fitted-CDF distances as null for empty and constant samples.
