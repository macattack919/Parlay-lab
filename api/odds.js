function toDecimal(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}
function toAmerican(decimal) {
  if (!(decimal > 1)) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}
function legFrom(event, book, market, outcome) {
  return {
    eventId: event.id,
    matchup: (event.awayTeam || event.away_team || "Away") + " at " + (event.homeTeam || event.home_team || "Home"),
    team: market.team || null,
    market: market.team ? "Team total under" : "Game total over",
    side: outcome.name,
    point: outcome.point ?? null,
    price: Number(outcome.price),
    bookKey: book.key,
    bookTitle: book.title || book.key,
    bookLink: book.link || null,
    lineType: market.line_type || "main",
    live: Boolean(event.live)
  };
}
function buildOpportunities(events) {
  const byBook = new Map();
  for (const event of events) {
    for (const book of (event.bookmakers || [])) {
      if (!byBook.has(book.key)) byBook.set(book.key, { title: book.title || book.key, under: [], over: [] });
      const bucket = byBook.get(book.key);
      for (const market of (book.markets || [])) {
        if (market.key !== "totals" || (market.period && market.period !== "full")) continue;
        for (const outcome of (market.outcomes || [])) {
          const side = String(outcome.name || "").toLowerCase();
          const price = Number(outcome.price);
          if (!Number.isFinite(price) || price > -400 || price < -600) continue;
          const leg = legFrom(event, book, market, outcome);
          if (market.team && side === "under") bucket.under.push(leg);
          if (!market.team && side === "over") bucket.over.push(leg);
        }
      }
    }
  }

  const exact = [];
  const near = [];
  const liveExact = [];
  const pregameExact = [];
  let examined = 0;
  for (const [bookKey, bucket] of byBook) {
    const under = bucket.under;
    const over = bucket.over;
    for (let i = 0; i < under.length; i++) {
      for (let j = i + 1; j < under.length; j++) {
        if (under[i].eventId === under[j].eventId) continue;
        for (let k = 0; k < over.length; k++) {
          if (over[k].eventId === under[i].eventId || over[k].eventId === under[j].eventId) continue;
          if (++examined > 50000) break;
          const legs = [under[i], under[j], over[k]];
          const decimal = legs.reduce((product, leg) => product * toDecimal(leg.price), 1);
          const baseAmerican = toAmerican(decimal);
          const boostedDecimal = 1 + (decimal - 1) * 1.2;
          const boostedAmerican = toAmerican(boostedDecimal);
          const item = {
            bookKey, bookTitle: bucket.title, legs,
            baseAmerican, boostedAmerican, decimal: Number(decimal.toFixed(4)),
            boostedDecimal: Number(boostedDecimal.toFixed(4)),
            boostPercent: 20
          };
          if (boostedAmerican >= 100 && boostedAmerican <= 150) {
            exact.push(item);
            if (legs.every(leg => leg.live)) liveExact.push(item);
            else if (legs.every(leg => !leg.live)) pregameExact.push(item);
          } else near.push({ ...item, distance: Math.min(Math.abs(boostedAmerican - 100), Math.abs(boostedAmerican - 150)) });
        }
        if (examined > 50000) break;
      }
      if (examined > 50000) break;
    }
    if (examined > 50000) break;
  }
  const sort = (a, b) => Math.abs(a.boostedAmerican - 125) - Math.abs(b.boostedAmerican - 125);
  exact.sort(sort);
  near.sort(sort);
  return { opportunities: exact.slice(0, 30), liveOpportunities: liveExact.slice(0, 30), pregameOpportunities: pregameExact.slice(0, 30), nearMisses: near.slice(0, 12), combinationsExamined: examined };
}

export default async function handler(req, res) {
  const apiKey = process.env.PROPLINE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "PropLine is not configured. Add PROPLINE_API_KEY in Vercel Environment Variables." });
  }

  try {
    const url = new URL("https://api.prop-line.com/v1/sports/basketball_ncaab/odds");
    url.searchParams.set("markets", "totals");
    url.searchParams.set("includeLinks", "true");

    const response = await fetch(url, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      cache: "no-store"
    });

    const dailyRemaining = response.headers.get("X-Daily-Remaining");
    const dailyUsed = response.headers.get("X-Daily-Used");
    const rateLimitRemaining = response.headers.get("RateLimit-Remaining");
    const missingMarkets = response.headers.get("X-PropLine-Missing-Markets");
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: body?.error || body?.message || `PropLine returned HTTP ${response.status}`,
        details: body,
        dailyRemaining,
        dailyUsed
      });
    }

    const events = Array.isArray(body) ? body : (body.events || body.data || []);
    const normalized = events.map(event => {
      const bookmakers = (event.bookmakers || [])
        .map(book => ({
          key: book.key,
          title: book.title || book.key,
          link: book.link || null,
          markets: (book.markets || [])
            .filter(market => market.key === "totals")
            .map(market => ({
              key: market.key,
              description: market.description || "Total",
              team: market.team || null,
              period: market.period || null,
              lineType: market.line_type || "main",
              outcomes: (market.outcomes || [])
                .filter(outcome => ["over", "under"].includes(String(outcome.name || "").toLowerCase()))
                .map(outcome => ({
                  name: outcome.name,
                  description: outcome.description || null,
                  point: outcome.point ?? null,
                  price: outcome.price ?? null
                }))
            }))
            .filter(market => market.outcomes.length)
        }))
        .filter(book => book.markets.length);

      return {
        id: event.id,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        commenceTime: event.commence_time,
        live: Boolean(event.live),
        bookmakers
      };
    }).filter(event => event.bookmakers.length);

    const totalMarkets = normalized.reduce((sum, event) =>
      sum + event.bookmakers.reduce((bookSum, book) => bookSum + book.markets.length, 0), 0);
    const teamTotalMarkets = normalized.reduce((sum, event) =>
      sum + event.bookmakers.reduce((bookSum, book) =>
        bookSum + book.markets.filter(market => market.team).length, 0), 0);
    const gameTotalMarkets = totalMarkets - teamTotalMarkets;
    const scan = buildOpportunities(normalized);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({
      source: "PropLine",
      sport: "basketball_ncaab",
      updated: new Date().toISOString(),
      count: normalized.length,
      totalMarkets,
      teamTotalMarkets,
      gameTotalMarkets,
      dailyRemaining,
      dailyUsed,
      rateLimitRemaining,
      missingMarkets,
      ...scan,
      events: normalized
    });
  } catch (error) {
    return res.status(502).json({ error: "Could not retrieve PropLine odds.", details: error.message });
  }
}