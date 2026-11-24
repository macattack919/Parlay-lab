# Parlay Lab
**Stop Guessing, Start Stacking.**

A standalone NCAA men's basketball parlay analytics app. The first milestone includes a responsive dashboard, a three-leg parlay builder, American-odds conversion, combined-odds calculations, and sportsbook boost scenarios.

## Current status
- NCAA scoreboard endpoint powered by ESPN's public site API.
- Manual odds entry for each leg until a verified odds provider is selected.
- Three-leg parlay calculator with 20%, 25%, and 30% profit-boost scenarios.
- No fabricated sportsbook lines or claimed live betting signals.

## Run locally
This is a Vercel-style static frontend with a serverless API route:
```bash
npm install
npm run dev
```

## Deploy
Import this repository into Vercel. No environment variables are required for the initial ESPN scoreboard endpoint.

## Roadmap
1. Confirm odds provider and ingest team totals / game totals.
2. Add candidate discovery and correlation-aware probability analysis.
3. Add live leg monitoring and settled-results tracking.
4. Backtest strategy performance.
