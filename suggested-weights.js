// ============================================================
//  Suggested weights — the recommended starting point for the Ranking tab.
// ============================================================
//
//  Synthesised from five EA attendee personas, each voiced by an independent
//  agent answering: "where should the hub put down roots as a lasting
//  community?" (the 2-month popup being a trial run of the city).
//
//  Each persona priced every criterion by willingness-to-pay — dollars per
//  month it would pay to base the hub in a city one point better on that
//  criterion. Each persona's vector is normalised, then the five are blended
//  equally. The prompt was run twice and the two runs averaged (run-to-run
//  correlation 0.99). No organizer overrides are applied. Full derivation
//  and audit trail: the personas/ directory in the repo — personas.md,
//  weights-*.md, persona-weights.csv, synthesis.md.
//
//  Each weight is a plain multiplier on that criterion's 1-10 score: a
//  linear, relative scale where a criterion at 6 counts six times one at 1.
//  A weight of 0 drops the criterion from the ranking. Only the ratios matter.
//
//  The Ranking tab starts from these values; the "Reset weights" button
//  returns here. Visitors can still freely override any slider afterwards.
//
//  Cost of living is NOT weighted here. It is handled separately as a
//  value-per-dollar multiplier on the quality score; SUGGESTED_K (bottom of
//  this file) is the default cost-sensitivity.
//
//  To adjust: change the numbers below. Criterion names must match the UI
//  labels exactly. A criterion omitted entirely defaults to 1.
//
// ============================================================

window.SUGGESTED_WEIGHTS = {

  // ── Visas, residency & tax ──────────────────────────────────
  "Best long-term visa option":          10.0,
  "Path to permanent residency":         4.3,
  "Path to citizenship":                 1.8,
  "Tax residency favorability":          4.3,

  // ── Visa-free access, by nationality ────────────────────────
  "Tourist days: US":                    0.4,
  "Tourist days: UK":                    0.4,
  "Tourist days: EU":                    0.4,
  "Tourist days: Canada":                0.4,
  "Tourist days: Australia":             0.4,

  // ── Climate & environment ───────────────────────────────────
  "Best months (good for staying)":      1.6,
  "Avoid months (consider leaving)":     2.1,
  "Weather year-round":                  2.3,
  "Air quality year-round":              5.4,

  // ── Place & daily life ──────────────────────────────────────
  "Walkability":                         3.9,
  "Public transport":                    1.7,
  "Beauty":                              1.0,
  "Plazas / public life":                1.9,
  "Safety":                              4.6,
  "High trust society":                  2.8,
  "Ease of integration":                 4.7,

  // ── Community & remote work ─────────────────────────────────
  "Digital nomad scene":                 2.2,
  "EA community":                        2.4,
  "Internet & call quality":             7.1,
  "Time zone":                           3.6,

  // ── Housing (ease of finding/organizing — not price) ────────
  "Short-term housing & coliving":       1.0,
  "Long-term housing":                   4.3,

  // ── Recreation & nature ─────────────────────────────────────
  "Climbing / bouldering gym":           0.6,
  "Hiking":                              1.1,
  "Accessible nature":                   1.6,
  "Free cultural events":                1.4,

  // ── Inclusion & language ────────────────────────────────────
  "LGBT / women / minorities":           2.4,
  "English proficiency":                 3.3,
  "Language ease for English speakers":  1.4,

  // ── Food & health ───────────────────────────────────────────
  "Vegan / veg options":                 1.4,
  "ADHD drug accessibility":             3.0,

  // ── Governance ──────────────────────────────────────────────
  "Governmental stability":              5.6,

};

// ── Default cost-sensitivity ──────────────────────────────────
//  Cost of living is a value-per-dollar multiplier, not a weight:
//     multiplier = (median_burn / city_burn) ^ k
//  k = 0 ignores cost; k = 1 is strict value-per-dollar. The personas'
//  blended cost-sensitivity is ~0.66; held at 0.6 by organizer choice.
//  The Ranking tab's cost-sensitivity slider starts here.
window.SUGGESTED_K = 0.6;
