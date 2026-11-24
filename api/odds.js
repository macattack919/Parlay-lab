export default async function handler(req, res) {
  const apiKey = process.env.PROPLINE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "PropLine is not configured. Add PROPLINE_API_KEY in Vercel Environment Variables." });
  }

  try {
    const url = new URL("https://api.prop-line.com/v1/sports/basketball_ncaab/odds");
    url.searchParams.set("markets", "h2h,spreads,totals");
    url.searchParams.set("includeLinks", "true");

    const response = await fetch(url, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      cache: "no-store"
    });

    const dailyRemaining = response.headers.get("X-Daily-Remaining");
    const dailyUsed = response.headers.get("X-Daily-Used");
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
    const allowedBooks = new Set([
      "draftkings", "fanduel", "betmgm", "betrivers", "fanatics",
      "hardrock", "fliff", "bovada", "pinnacle"
    ]);

    const normalized = events.map(event => {
      const bookmakers = (event.bookmakers || [])
        .filter(book => !allowedBooks.size || allowedBooks.has(book.key))
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

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
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
      events: normalized
    });
  } catch (error) {
    return res.status(502).json({ error: "Could not retrieve PropLine odds.", details: error.message });
  }
}