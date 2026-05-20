# Coliving Hub City Explorer

Interactive comparison of 26 cities for choosing where to base a coliving and coworking hub. Live at **[cities.moiri.dev](https://cities.moiri.dev)**.

Rank cities by your own priorities, compare them side by side, drill into any single city, and trace every figure back to its source.

## What it does

- **Ranking**: adjustable per-criterion weight sliders, with an optional cost-of-living value adjustment.
- **Compare**: any subset of cities side by side; picking exactly two opens a head-to-head view.
- **City detail**: every criterion, score, and justification for each city.
- **Sources** and **Methodology**: a searchable source index and the full scoring legend.
- Weights and city selections persist locally, and "copy link" produces a URL that reproduces them for someone else.

## The data

26 cities scored on 36 criteria spanning visas, cost, climate, safety, community, recreation, and governance. Each score is the mean of three independent blind-scoring passes against a fixed calibration set.

The whole dataset ships in `data.js`, which is self-contained: the site needs nothing else to run. `data.js` and the downloadable `data-bundle.zip` are generated from a separate research dataset and committed here so the site is ready to serve as is.

## Running locally

It is a static site, so any static file server works:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Files

- `index.html`, `app.js`, `styles.css`: the application
- `suggested-weights.js`: the recommended starting weights
- `data.js`: the full city dataset (generated)
- `data-bundle.zip`: the same dataset as downloadable CSVs (generated)
