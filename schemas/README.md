# Schemas

- [`receipt-v1.schema.json`](receipt-v1.schema.json) — Herdr X-Ray trust receipt schema, JSON Schema Draft 2020-12

`receiptHash` is an integrity hash over every persisted receipt field except `receiptHash` itself. `analysisHash` uses a separately versioned stable projection and is intended for reproducible comparison across volatile timestamps and online enrichment.

Milestone 0 checks schema syntax and contract fixtures. Full schema validation, canonicalization, hashing, and mutation verification are Milestone 3 deliverables.
