// src/live-sbc-scraper.js
// Live SBC Scraper - pulls active SBCs from FUTBIN & FUT.GG with caching.
// CommonJS export for compatibility with require().

let _fetch = globalThis.fetch;
if (!_fetch) {
  // Node <18 fallback
  _fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

const cheerio = require('cheerio');

class LiveSBCScraper {
  constructor(opts = {}) {
    this.sources = {
      futbin: 'https://www.futbin.com/25/squad-building-challenges',
      futgg: 'https://www.fut.gg/sbc',
    };
    this.sbcCache = new Map();
    this.cacheExpiry = opts.cacheExpiryMs ?? 30 * 60 * 1000; // 30 min
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15000;
  }

  // Public entry
  async getActiveSBCs() {
    const cached = this._getCached('live_sbcs');
    if (cached) {
      console.log(`📋 Returning ${cached.length} cached SBCs`);
      return cached;
    }

    const live = await this._getLiveSBCs();
    const solver = live.map((sbc) => this._toSolverFormat(sbc));
    this._setCached('live_sbcs', solver);
    return solver;
  }

  // ----- Internals -----
  async _getLiveSBCs() {
    console.log('🔍 Fetching live SBCs (FUTBIN + FUT.GG)…');
    const all = [];

    // FUTBIN
    try {
      const fromFutbin = await this._scrapeFutbin();
      all.push(...fromFutbin);
    } catch (e) {
      console.error('FUTBIN scrape failed:', e);
    }

    // FUT.GG
    try {
      const fromFutgg = await this._scrapeFutgg();
      all.push(...fromFutgg);
    } catch (e) {
      console.error('FUT.GG scrape failed:', e);
    }

    const unique = this._dedupeByName(all);
    console.log(`✅ Found ${unique.length} live SBCs`);
    return unique;
  }

  async _scrapeFutbin() {
    console.log('🔄 Scraping FUTBIN…', this.sources.futbin);
    const html = await this._safeFetchText(this.sources.futbin, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!html) return [];

    const $ = cheerio.load(html);
    const results = [];

    // FUTBIN changes DOM often; be generous with selectors.
    // 1) Try obvious card containers
    const candidates = $(
      '.sbc-card, .sbc_challenge, .sbcs-list .card, .content .card, div[class*="sbc"], a[href*="/squad-building-challenges/"]'
    );

    const seen = new Set();
    candidates.each((_, el) => {
      const node = $(el);

      // Name: prefer title attr or heading text or link text
      const titleAttr = node.attr('title');
      let name =
        (titleAttr && titleAttr.trim()) ||
        node.find('h1,h2,h3,h4,h5').first().text().trim() ||
        node.text().trim();

      name = this._cleanName(name);
      if (!name || name.length < 3) return;

      // Avoid duplicates while walking noisy DOM
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      // Expiry (rough)
      const text = node.text();
      const expiry =
        this._matchOne(text, /(\d+)\s*days?\s*left/i) ||
        this._matchOne(text, /expires?[:\s]*([A-Za-z0-9 :\-\/]+)$/i) ||
        'Unknown';

      // Estimated cost (accept k/m notation)
      const estCost = this._parseCost(text);

      // Rating
      const minRating = this._parseMinRating(text) ?? 75;

      // Requirements (very rough heuristics)
      const requirements = this._extractRequirementHints(text);

      results.push({
        name,
        expiry,
        requirements,
        estimatedCost: estCost,
        minRating,
        source: 'FUTBIN',
        isActive: true,
        scrapedAt: new Date(),
      });
    });

    return results;
  }

  async _scrapeFutgg() {
    console.log('🔄 Scraping FUT.GG…', this.sources.futgg);
    const html = await this._safeFetchText(this.sources.futgg, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!html) return [];

    const $ = cheerio.load(html);
    const results = [];

    // Common patterns: SBC listing tiles / links under /sbc/<slug>
    $('a[href^="/sbc/"], .sbc-card, [class*="sbc"]').each((_, el) => {
      const node = $(el);

      let name =
        node.attr('title')?.trim() ||
        node.find('h1,h2,h3,h4,h5').first().text().trim() ||
        node.text().trim();

      name = this._cleanName(name);
      if (!name || name.length < 3) return;

      const text = node.text();

      const expiry =
        this._matchOne(text, /(\d+)\s*days?\s*left/i) ||
        this._matchOne(text, /expires?[:\s]*([A-Za-z0-9 :\-\/]+)$/i) ||
        'Unknown';

      const estimatedCost = this._parseCost(text);
      const minRating = this._parseMinRating(text) ?? 75;
      const requirements = this._extractRequirementHints(text);

      results.push({
        name,
        expiry,
        requirements,
        estimatedCost,
        minRating,
        source: 'FUT.GG',
        isActive: true,
        scrapedAt: new Date(),
      });
    });

    return results;
  }

  // ---------- Helpers ----------
  _cleanName(s) {
    if (!s) return '';
    // Trim and collapse spaces; strip stray UI text
    return s
      .replace(/\s+/g, ' ')
      .replace(/(view|details|challenge|sbc)\s*$/i, '')
      .trim();
  }

  _matchOne(str, rx) {
    const m = String(str || '').match(rx);
    return m ? m[1].trim() : null;
  }

  _parseCost(text) {
    // Examples: "150k", "1.2m", "120,000", "120k coins"
    const t = String(text || '').toLowerCase();
    const km = t.match(/(\d+(?:[.,]\d+)?)(\s*[km])\b/);
    if (km) {
      const n = parseFloat(km[1].replace(',', '.'));
      const mul = km[2].includes('m') ? 1_000_000 : 1_000;
      return Math.round(n * mul);
    }
    const raw = t.match(/(\d{2,3}(?:[.,]\d{3})+)/); // 12,000 / 120.000
    if (raw) {
      return parseInt(raw[1].replace(/[.,]/g, ''), 10);
    }
    return 0;
    }

  _parseMinRating(text) {
    const t = String(text || '');
    // match "Min 84 rating" / "84+ rating"
    const m =
      t.match(/min\.?\s*(\d{2})\s*rating/i) ||
      t.match(/(\d{2})\s*\+\s*rating/i) ||
      t.match(/overall\s*(\d{2})/i);
    return m ? parseInt(m[1], 10) : null;
  }

  _extractRequirementHints(text) {
    const t = String(text || '');
    const reqs = [];

    const patterns = [
      { type: 'MIN_RATING', rx: /min\.?\s*(\d{2})\s*rating/i },
      { type: 'MAX_RATING', rx: /max\.?\s*(\d{2})\s*rating/i },
      { type: 'MIN_CHEMISTRY', rx: /(\d{1,3})\s*chemistry/i },
      { type: 'EXACT_LEAGUES', rx: /exact(?:ly)?\s*(\d{1,2})\s*leagues?/i },
      { type: 'EXACT_NATIONS', rx: /exact(?:ly)?\s*(\d{1,2})\s*nations?/i },
      { type: 'MIN_LEAGUES', rx: /min\.?\s*(\d{1,2})\s*leagues?/i },
      { type: 'MIN_IF_PLAYERS', rx: /(\d{1,2})\s*(?:if|inform|in\s*form)s?/i },
      { type: 'MIN_ICON_PLAYERS', rx: /(\d{1,2})\s*icons?/i },
      { type: 'SQUAD_SIZE', rx: /(?:squad|players?)\s*[:\-]?\s*(\d{1,2})/i },
    ];

    for (const { type, rx } of patterns) {
      const m = t.match(rx);
      if (m) {
        reqs.push({ type, value: parseInt(m[1], 10) });
      }
    }

    return reqs;
  }

  _dedupeByName(items) {
    const map = new Map();
    for (const it of items) {
      const key = it.name.toLowerCase().trim();
      const prev = map.get(key);
      if (!prev) {
        map.set(key, it);
        continue;
      }
      // prefer the one with richer requirements
      if ((it.requirements?.length || 0) > (prev.requirements?.length || 0)) {
        map.set(key, it);
      }
    }
    return [...map.values()];
  }

  _toSolverFormat(live) {
    return {
      sbcName: live.name,
      segments: [
        {
          name: 'Main Challenge',
          requirements: {
            minRating: live.minRating ?? 75,
            playersNeeded:
              live.requirements?.find((r) => r.type === 'SQUAD_SIZE')?.value ??
              11,
            maxPrice: Math.max(0, Math.floor((live.estimatedCost || 0) / 11)),
            priority: 'high',
            ...this._requirementsToSolver(live.requirements),
          },
        },
      ],
      expiry: live.expiry,
      source: live.source,
      lastUpdated: live.scrapedAt,
    };
  }

  _requirementsToSolver(reqs = []) {
    const out = {};
    for (const r of reqs) {
      switch (r.type) {
        case 'MIN_CHEMISTRY':
          out.minChemistry = r.value;
          break;
        case 'EXACT_LEAGUES':
          out.exactLeagues = r.value;
          break;
        case 'EXACT_NATIONS':
          out.exactNations = r.value;
          break;
        case 'MIN_IF_PLAYERS':
          out.versions = Array.from(
            new Set([...(out.versions || []), 'In Form', 'Team of the Week'])
          );
          break;
        case 'MIN_ICON_PLAYERS':
          out.versions = Array.from(new Set([...(out.versions || []), 'Icon']));
          break;
        default:
          break;
      }
    }
    return out;
  }

  _getCached(key) {
    const hit = this.sbcCache.get(key);
    if (hit && Date.now() - hit.timestamp < this.cacheExpiry) {
      return hit.data;
    }
    return null;
  }

  _setCached(key, data) {
    this.sbcCache.set(key, { data, timestamp: Date.now() });
  }

  async _safeFetchText(url, fetchInit = {}) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), this.requestTimeoutMs);
    try {
      const res = await _fetch(url, { ...fetchInit, signal: ctrl.signal });
      if (!res.ok) {
        console.warn('Fetch failed', url, res.status);
        return null;
      }
      return await res.text();
    } catch (e) {
      console.warn('Fetch error', url, e.message || e);
      return null;
    } finally {
      clearTimeout(tid);
    }
  }
}

module.exports = LiveSBCScraper;
module.exports.default = LiveSBCScraper;
