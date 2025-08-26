// server.js
"use strict";

/**
 * FC25 SBC Solution Finder API (multi-segment)
 *
 * Features:
 * - Express + CORS + JSON parsing
 * - Health & diagnostics endpoints
 * - In-memory cache helper with TTL
 * - Optional PostgreSQL persistence (Railway DATABASE_URL)
 * - node-cron task to prune old rows
 * - POST /api/sbc/solve to build squads for 1..N segments
 *
 * Post body schema (example):
 * {
 *   "segments": [
 *     {
 *       "name": "England Gold",
 *       "requirements": {
 *         "minOverall": 80,
 *         "maxOverall": 99,            // optional
 *         "minChemistry": 20,          // optional - soft placeholder
 *         "minNationCount": { "ENG": 3 },
 *         "minLeagueCount": { "Premier League": 4 },
 *         "minClubCount": { "Arsenal": 1 },
 *         "positions": ["GK","RB","CB","CB","LB","CM","CM","CAM","RW","LW","ST"], // target formation/slots (11)
 *         "minRare": 0,                // optional
 *         "allowDuplicates": false     // optional, default false
 *       }
 *     }
 *   ],
 *   "candidates": [
 *     {
 *       "id": 100664475,
 *       "name": "Bukayo Saka",
 *       "rating": 86,
 *       "position": "RW",             // canonical pos
 *       "altPositions": ["RM","LW"],  // optional
 *       "nation": "ENG",
 *       "league": "Premier League",
 *       "club": "Arsenal",
 *       "rare": true,                 // optional
 *       "chemLinks": {                // optional lightweight chemistry hints
 *         "nation": true,
 *         "league": true,
 *         "club": true
 *       },
 *       "price": 18000                // optional, used for cheapest
 *     }
 *   ],
 *   "options": {
 *     "objective": "cheapest",        // "cheapest" | "highest" | "balanced"
 *     "preferAltPositions": true      // use altPositions to satisfy slots
 *   }
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "solutions": [
 *     {
 *       "segment": "England Gold",
 *       "status": "ok",
 *       "squad": [ {player}, ... 11 ],
 *       "summary": {
 *         "cost": 123456,
 *         "avgRating": 83.5,
 *         "nationCounts": {...},
 *         "leagueCounts": {...},
 *         "clubCounts": {...},
 *         "chemEstimate": 24
 *       }
 *     }
 *   ]
 * }
 */

const express = require("express");
const cors = require("cors");
const axios = require("axios"); // kept for future expansion (e.g., fetching external data)
const _ = require("lodash");
const cron = require("node-cron");
const { Pool } = require("pg");

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "production";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const DATABASE_URL = process.env.DATABASE_URL || "";

// ---------- App ----------
const app = express();
app.use(cors({ origin: ALLOW_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Simple request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---------- Optional PostgreSQL ----------
let pool = null;
(async () => {
  if (DATABASE_URL) {
    try {
      pool = new Pool({ connectionString: DATABASE_URL, max: 4, ssl: NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sbc_solves (
          id SERIAL PRIMARY KEY,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          metadata JSONB,
          solution JSONB
        );
      `);
      console.log("✅ PostgreSQL connected and table ensured.");
    } catch (err) {
      console.error("⚠️ PostgreSQL init failed:", err.message);
      pool = null;
    }
  } else {
    console.warn("ℹ️ DATABASE_URL not provided. Skipping PostgreSQL.");
  }
})();

// ---------- In-memory cache helper ----------
const memCache = new Map(); // key -> { expiresAt, data }
function setCache(key, data, ttlMs = 60_000) {
  memCache.set(key, { expiresAt: Date.now() + ttlMs, data });
}
function getCache(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return hit.data;
}

// ---------- Utilities ----------
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function countByProp(list, prop) {
  return list.reduce((acc, item) => {
    const k = item?.[prop] ?? "UNKNOWN";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

function estimateChemistry(players = []) {
  // Very rough stand-in: +1 per shared club link, +0.5 per league, +0.25 per nation overlap, capped at 33
  let chem = 0;
  const byClub = countByProp(players, "club");
  const byLeague = countByProp(players, "league");
  const byNation = countByProp(players, "nation");

  chem += Object.values(byClub).reduce((s, n) => s + Math.max(0, n - 1), 0) * 1.0;
  chem += Object.values(byLeague).reduce((s, n) => s + Math.max(0, n - 1), 0) * 0.5;
  chem += Object.values(byNation).reduce((s, n) => s + Math.max(0, n - 1), 0) * 0.25;

  return clamp(Math.round(chem), 0, 33);
}

function summarizeSquad(squad) {
  const cost = _.sumBy(squad, (p) => p.price || 0);
  const avgRating = squad.length ? _.round(_.meanBy(squad, "rating"), 2) : 0;
  return {
    cost,
    avgRating,
    nationCounts: countByProp(squad, "nation"),
    leagueCounts: countByProp(squad, "league"),
    clubCounts: countByProp(squad, "club"),
    chemEstimate: estimateChemistry(squad),
  };
}

// Returns true if candidate fits basic requirement filters
function candidatePassesBasic(req, player) {
  if (!player) return false;

  if (req.minOverall && player.rating < req.minOverall) return false;
  if (req.maxOverall && player.rating > req.maxOverall) return false;

  if (req.minRare && req.minRare > 0) {
    const isRare = !!player.rare;
    if (!isRare) return false;
  }

  return true;
}

// Attempts to assign 11 players to the given positions
function assignPlayersToPositions(req, candidates, options) {
  const positions = req.positions && req.positions.length ? req.positions : ["GK","RB","CB","CB","LB","CM","CM","CAM","RW","LW","ST"];
  const allowDuplicates = !!req.allowDuplicates;

  // Filter by basic (overall/rarity)
  let pool = candidates.filter((p) => candidatePassesBasic(req, p));

  // Objective sorting
  const objective = options?.objective || "cheapest";
  if (objective === "cheapest") {
    pool = _.sortBy(pool, (p) => p.price || Number.MAX_SAFE_INTEGER);
  } else if (objective === "highest") {
    pool = _.orderBy(pool, ["rating", (p) => -(p.price || 0)], ["desc", "asc"]);
  } else {
    // balanced: rating per price
    pool = _.orderBy(
      pool,
      [(p) => (p.rating || 0) / (p.price || (p.rating ? 1000 : 1)), "rating"],
      ["desc", "desc"]
    );
  }

  // Track used ids to prevent duplicates
  const used = new Set();
  const squad = [];

  for (const slot of positions) {
    // Try strict match
    let pick = pool.find((p) => !used.has(p.id) && p.position === slot);
    // Try altPositions if allowed
    if (!pick && options?.preferAltPositions) {
      pick = pool.find((p) => !used.has(p.id) && Array.isArray(p.altPositions) && p.altPositions.includes(slot));
    }
    // Fallback: any same category (e.g., RW ~ RM ~ RW/LW) – very loose
    if (!pick) {
      pick = pool.find((p) => !used.has(p.id) && (p.position?.includes("W") && slot.includes("W")));
    }

    if (pick) {
      squad.push({ ...pick, assignedPosition: slot });
      if (!allowDuplicates) used.add(pick.id);
    } else {
      // No candidate found for slot
      return { ok: false, reason: `No candidate for position ${slot}`, squad };
    }
  }

  return { ok: true, squad };
}

// Validates squad against counts (nation/league/club) and chemistry
function validateSquad(req, squad) {
  const summary = summarizeSquad(squad);

  // Nation counts
  if (req.minNationCount) {
    for (const [nation, min] of Object.entries(req.minNationCount)) {
      const have = summary.nationCounts[nation] || 0;
      if (have < min) return { ok: false, reason: `Need ${min} ${nation} (have ${have})` };
    }
  }
  // League counts
  if (req.minLeagueCount) {
    for (const [league, min] of Object.entries(req.minLeagueCount)) {
      const have = summary.leagueCounts[league] || 0;
      if (have < min) return { ok: false, reason: `Need ${min} from ${league} (have ${have})` };
    }
  }
  // Club counts
  if (req.minClubCount) {
    for (const [club, min] of Object.entries(req.minClubCount)) {
      const have = summary.clubCounts[club] || 0;
      if (have < min) return { ok: false, reason: `Need ${min} from ${club} (have ${have})` };
    }
  }
  // Chemistry estimate
  if (req.minChemistry && summary.chemEstimate < req.minChemistry) {
    return { ok: false, reason: `Chemistry too low: need ${req.minChemistry}, have ${summary.chemEstimate}` };
  }

  return { ok: true, summary };
}

// Attempts multiple tries to satisfy constraints by slightly reshuffling
function tryBuildSquad(req, candidates, options) {
  // quick fast-path
  let attempt = assignPlayersToPositions(req, candidates, options);
  if (!attempt.ok) return attempt;

  let check = validateSquad(req, attempt.squad);
  if (check.ok) return { ok: true, squad: attempt.squad, summary: check.summary };

  // Limited reshuffles: swap 2-3 times
  for (let i = 0; i < 8; i++) {
    const shuffled = _.shuffle(candidates);
    attempt = assignPlayersToPositions(req, shuffled, options);
    if (!attempt.ok) continue;

    check = validateSquad(req, attempt.squad);
    if (check.ok) return { ok: true, squad: attempt.squad, summary: check.summary };
  }

  return { ok: false, reason: check.reason || "Unable to meet constraints after several attempts." };
}

// ---------- Routes ----------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), env: NODE_ENV, db: !!pool });
});

app.get("/api/ping", (_req, res) => res.send("pong"));

app.post("/api/cache/clear", (req, res) => {
  memCache.clear();
  res.json({ ok: true, cleared: true });
});

/**
 * Solve multi-segment SBC
 * Body: { segments: [...], candidates: [...], options: {...} }
 */
app.post("/api/sbc/solve", async (req, res) => {
  try {
    const { segments, candidates, options } = req.body || {};

    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ ok: false, error: "segments[] is required" });
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ ok: false, error: "candidates[] is required" });
    }

    const solutions = [];
    let remaining = [...candidates];

    for (const seg of segments) {
      const name = seg?.name || `Segment ${solutions.length + 1}`;
      const requirements = seg?.requirements || {};

      const result = tryBuildSquad(requirements, remaining, options);
      if (!result.ok) {
        solutions.push({ segment: name, status: "fail", reason: result.reason, squad: result.squad || [] });
        // Optional: stop on first failure
        // break;
        continue;
      }

      const squad = result.squad;
      const summary = result.summary || summarizeSquad(squad);
      solutions.push({ segment: name, status: "ok", squad, summary });

      // Remove chosen players if duplicates not allowed across segments
      if (!requirements.allowDuplicates) {
        const chosenIds = new Set(squad.map((p) => p.id));
        remaining = remaining.filter((p) => !chosenIds.has(p.id));
      }
    }

    // Optionally persist
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO sbc_solves(metadata, solution) VALUES ($1, $2)`,
          [{ options, segmentsCount: segments.length }, { solutions }]
        );
      } catch (e) {
        console.warn("⚠️ Failed to persist solve:", e.message);
      }
    }

    res.json({ ok: true, solutions });
  } catch (err) {
    console.error("Solve error:", err);
    res.status(500).json({ ok: false, error: "Internal error", detail: err?.message });
  }
});

/**
 * Fetch last N stored solves (diagnostics)
 * GET /api/sbc/solves?limit=10
 */
app.get("/api/sbc/solves", async (req, res) => {
  if (!pool) return res.status(503).json({ ok: false, error: "DB not configured" });
  const limit = clamp(parseInt(req.query.limit || "10", 10) || 10, 1, 100);
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, metadata, solution FROM sbc_solves ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Cron: prune old rows (every night at 03:30) ----------
if (pool) {
  cron.schedule("30 3 * * *", async () => {
    try {
      const { rowCount } = await pool.query(`DELETE FROM sbc_solves WHERE created_at < NOW() - INTERVAL '14 days'`);
      if (rowCount) console.log(`🧹 Pruned ${rowCount} old sbc_solves rows.`);
    } catch (e) {
      console.warn("Cron prune failed:", e.message);
    }
  });
}

// ---------- Start ----------
app.listen(PORT, HOST, () => {
  console.log(`✅ FC25 SBC Solver API listening on http://${HOST}:${PORT} [${NODE_ENV}]`);
});
