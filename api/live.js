import { buildLiveContext, buildScoreboardStatus } from "../lib/live-context.js";
import { projectLiveTotal, projectHalfTeamTotals, evaluateLateGameOverPotential } from "../lib/total-model.js";

const SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball";

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function mapStats(summary, teamId) {
  const team = (summary?.boxscore?.teams || []).find(item => String(item.team?.id) === String(teamId));
  const stats = {};
  (team?.statistics || []).forEach(stat => {
    const value = stat.displayValue ?? stat.value ?? null;
    [stat.name, stat.label, stat.abbreviation, stat.displayName].filter(Boolean)
      .forEach(key => { stats[String(key).toLowerCase()] = value; });
  });
  return stats;
}
function mapPlay(play) {
  const participants = Array.isArray(play.participants) ? play.participants.map(p => ({
    id: p.athlete?.id || p.id || null,
    name: p.athlete?.displayName || p.athlete?.shortName || p.displayName || p.name || null,
    role: p.type?.text || p.type?.name || p.role || p.type || ""
  })) : [];
  return {
    sequence: num(play.sequenceNumber ?? play.sequence),
    period: num(play.period?.number) || 0,
    clock: play.clock?.displayValue || "",
    homeScore: num(play.homeScore), awayScore: num(play.awayScore),
    teamId: play.team?.id || null, teamName: play.team?.displayName || null,
    possessionTeamId: play.possession?.team?.id || play.possession?.teamId || null,
    scoringPlay: !!play.scoringPlay, points: num(play.scoreValue),
    type: play.type?.text || play.type?.name || null,
    typeText: play.type?.text || play.type?.name || "",
    participants, description: play.text || ""
  };
}
function situationTeam(timeouts, fouls) {
  return {
    timeouts: { used: num(timeouts?.timeoutsCurrent), remaining: num(timeouts?.timeoutsRemainingCurrent) },
    fouls: {
      teamFouls: num(fouls?.teamFouls),
      teamFoulsCurrent: num(fouls?.teamFoulsCurrent),
      foulsToGive: num(fouls?.foulsToGive),
      bonusState: fouls?.bonusState ?? null
    }
  };
}
async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`ESPN request failed (${response.status})`);
  return response.json();
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { out[index] = await fn(items[index]); } catch (error) { out[index] = { error: error.message }; }
    }
  }));
  return out;
}

export default async function handler(req, res) {
  try {
    const dateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const part = type => dateParts.find(item => item.type === type)?.value || "";
    const today = `${part("year")}${part("month")}${part("day")}`;
    const date = String(req.query?.date || today).replace(/[^0-9]/g, "");
    if (!/^\d{8}$/.test(date)) return res.status(400).json({ error: "Invalid date. Use YYYYMMDD." });

    const refreshToken = Date.now();
    const scoreboard = await getJson(`${SITE_BASE}/scoreboard?${new URLSearchParams({ dates: date, limit: "500", groups: "50", _ts: String(refreshToken) })}`);
    const liveEvents = (scoreboard.events || []).filter(event => event.status?.type?.state === "in");

    const games = await mapLimit(liveEvents, 5, async event => {
      const id = String(event.id);
      const competitors = event.competitions?.[0]?.competitors || [];
      const homeComp = competitors.find(team => team.homeAway === "home");
      const awayComp = competitors.find(team => team.homeAway === "away");
      if (!homeComp || !awayComp) return { id, error: "Missing home/away scoreboard teams." };

      const [summary, situation] = await Promise.all([
        getJson(`${SITE_BASE}/summary?event=${encodeURIComponent(id)}&_ts=${refreshToken}`),
        getJson(`${CORE_BASE}/events/${encodeURIComponent(id)}/competitions/${encodeURIComponent(id)}/situation?lang=en&region=us&_ts=${refreshToken}`).catch(() => null)
      ]);
      const plays = (summary.plays || []).map(mapPlay);
      const homeStats = mapStats(summary, homeComp.id);
      const awayStats = mapStats(summary, awayComp.id);
      const home = { id: String(homeComp.id), name: homeComp.team?.location || homeComp.team?.displayName || homeComp.team?.name || "Home", score: num(homeComp.score) ?? 0, stats: homeStats };
      const away = { id: String(awayComp.id), name: awayComp.team?.location || awayComp.team?.displayName || awayComp.team?.name || "Away", score: num(awayComp.score) ?? 0, stats: awayStats };
      const period = num(event.status?.period) || 0;
      const clock = event.status?.displayClock || "";
      const homeSituation = situation ? situationTeam(situation.homeTimeouts, situation.homeFouls) : null;
      const awaySituation = situation ? situationTeam(situation.awayTimeouts, situation.awayFouls) : null;
      const context = buildLiveContext({
        plays, homeTeamId: home.id, awayTeamId: away.id,
        homeScore: home.score, awayScore: away.score, period, clock, league: "ncaa"
      });
      const scoreboardStatus = situation ? buildScoreboardStatus({
        league: "ncaa", period, home: homeSituation, away: awaySituation
      }) : null;
      const clockMatch = String(clock).match(/^(\d+):(\d{1,2})$/);
      const clockSeconds = clockMatch ? Number(clockMatch[1]) * 60 + Number(clockMatch[2]) : null;
      const remainingMinutes = context.remainingMinutes ?? (clockSeconds === null ? null :
        period > 2 ? clockSeconds / 60 : ((2 - period) * 20 + clockSeconds / 60));
      const projection = projectLiveTotal({
        league: "ncaa", state: "in", period, clock,
        periodLengthSeconds: 1200, regulationPeriods: 2, home, away
      });
      const halfProjection = projectHalfTeamTotals({
        league: "ncaa", state: "in", period, clock,
        periodLengthSeconds: 1200, regulationPeriods: 2,
        home, away, scoringEvents: plays.filter(play => play.scoringPlay)
      });
      const homeBonus = scoreboardStatus?.home?.bonus;
      const awayBonus = scoreboardStatus?.away?.bonus;
      const lateGameOverPotential = evaluateLateGameOverPotential({
        league: "ncaa", state: "in", period, regulationPeriods: 2, remainingMinutes,
        homeScore: home.score, awayScore: away.score,
        homeTeamId: home.id, awayTeamId: away.id,
        possessionTeamId: context.possession?.teamId,
        homeOffense: homeBonus ? { label: homeBonus === "DB" ? "DOUBLE BONUS" : "BONUS", tone: "up" } : null,
        awayOffense: awayBonus ? { label: awayBonus === "DB" ? "DOUBLE BONUS" : "BONUS", tone: "up" } : null,
        homeTimeouts: scoreboardStatus?.home?.timeouts?.remaining,
        awayTimeouts: scoreboardStatus?.away?.timeouts?.remaining
      });
      return {
        id, matchup: `${away.name} at ${home.name}`,
        status: event.status?.type?.shortDetail || event.status?.type?.description || "LIVE",
        period, clock, home, away, updated: new Date().toISOString(),
        context, scoreboardStatus, projection, halfProjection, lateGameOverPotential,
        dataQuality: {
          boxScoreAvailable: Object.keys(homeStats).length > 0 && Object.keys(awayStats).length > 0,
          playByPlayAvailable: plays.length > 0,
          situationAvailable: !!situation,
          possessionSource: context.possession?.source || "unavailable",
          possessionConfidence: context.possession?.confidence || "unknown"
        }
      };
    });

    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    return res.status(200).json({
      source: "ESPN + GFI live model", league: "ncaa", updated: new Date().toISOString(),
      liveCount: liveEvents.length, successfulCount: games.filter(game => !game.error).length, games
    });
  } catch (error) {
    return res.status(502).json({ error: "Live intelligence request failed.", details: error.message });
  }
}
