// Focused FUT.GG-first SBC scraper with full segment requirements & reward
// Deps: npm i axios cheerio

const axios = require('axios');
const cheerio = require('cheerio');

const FUTGG_LIST = 'https://www.fut.gg/sbc/';
const FUTBIN_LIST = 'https://www.futbin.com/25/squad-building-challenges';

const UA = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
];
const ua = () => UA[Math.floor(Math.random() * UA.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tidy = (s) => (s || '').replace(/\s+/g, ' ').trim();
const textOf = ($el) => tidy($el.text());

function parseExpiry(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const mDays = lower.match(/(\d+)\s*day/);
  if (mDays) return new Date(now + Number(mDays[1]) * DAY).toISOString();
  const mHM = lower.match(/(\d+)\s*h(?:\s*(\d+)\s*m)?/);
  if (mHM) {
    const h = Number(mHM[1]); const m = Number(mHM[2] || 0);
    return new Date(now + (h * 3600 + m * 60) * 1000).toISOString();
  }
  return null;
}

async function getHTML(url) {
  const r = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': ua(),
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  });
  return String(r.data || '');
}

/* ========== LIST (FUT.GG first, FUTBIN fallback) ========== */
async function listFutGG() {
  const html = await getHTML(FUTGG_LIST);
  const $ = cheerio.load(html);
  const items = [];

  $('a[href*="/sbc/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    if (!/^\/sbc\/[a-z0-9-]+/i.test(href)) return;

    const name = textOf($a.find('[class*="title"],[class*="name"],h3,h2')) || textOf($a);
    if (!name) return;

    const expiresText =
      textOf($a.find('[class*="expire"],[class*="ends"],[class*="remaining"]')) || '';
    const segText =
      textOf($a.find('[class*="segment"],[class*="segments"],[class*="badge"]')) || '';
    const segMatch = segText.match(/(\d+)\s*segment/i);
    const segmentCount = segMatch ? Number(segMatch[1]) : null;

    items.push({
      source: 'FUT.GG',
      id: href.replace(/^\/sbc\//, '').replace(/\/$/, ''),
      url: new URL(href, 'https://www.fut.gg').toString(),
      name,
      segmentCount,
      expiresText,
      expiresAt: parseExpiry(expiresText),
      updatedAt: new Date().toISOString(),
    });
  });

  // dedupe
  const seen = new Set();
  return items.filter(x => {
    const k = `${x.source}:${x.id}:${x.name}`.toLowerCase();
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

async function listFutbinFallback() {
  // Only used if FUT.GG list fails/empty
  const html = await getHTML(FUTBIN_LIST);
  const $ = cheerio.load(html);
  const items = [];
  $('a[href*="/25/sbc/"], a[href*="/25/squad-building-challenges/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    if (!/\/25\/sbc\//i.test(href) && !/\/25\/squad-building-challenges\//i.test(href)) return;

    const name = textOf($a.find('.title, .name, h3, h2')) || textOf($a);
    if (!name) return;

    const expiresText =
      textOf($a.find('[class*="expire"],[class*="ends"],[class*="remain"]')) ||
      textOf($a.parent().find('[class*="expire"],[class*="ends"],[class*="remain"]')) || '';

    const segText = textOf($a.find('[class*="segment"],[class*="segments"],small,.badge')) || '';
    const segMatch = segText.match(/(\d+)\s*segment/i) || segText.match(/\((\d+)\)/);
    const segmentCount = segMatch ? Number(segMatch[1]) : null;

    const abs = href.startsWith('http') ? href : `https://www.futbin.com${href}`;
    const id = href
      .replace(/^\/25\/sbc\//, '')
      .replace(/^\/25\/squad-building-challenges\//, '')
      .replace(/\/$/, '');

    items.push({
      source: 'FUTBIN',
      id,
      url: abs,
      name,
      segmentCount,
      expiresText,
      expiresAt: parseExpiry(expiresText),
      updatedAt: new Date().toISOString(),
    });
  });

  const seen = new Set();
  return items.filter(x => {
    const k = `${x.source}:${x.id}:${x.name}`.toLowerCase();
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

/* ========== DETAIL (FUT.GG full requirements) ========== */
async function detailFutGG(url) {
  const html = await getHTML(url);
  const $ = cheerio.load(html);

  // Try to pick up SBC title from page as a sanity check
  const pageTitle =
    tidy($('h1').first().text()) ||
    tidy($('[class*="title"],[class*="name"]').first().text()) ||
    null;

  // Segments are usually rendered as cards/rows; be generous with selectors
  const segments = [];
  const containers = $(
    // common FUT.GG segment container patterns
    '[class*="segment-card"], [data-testid*="segment"], [class*="Segment"], .card, .panel, .grid, .list'
  );

  containers.each((_, c) => {
    const $c = $(c);

    // Segment name candidates
    const segName =
      textOf($c.find('h3, h4, [class*="title"], [class*="name"]')) ||
      textOf($c.find('a[href*="/squad/"], a[href*="/challenge/"]'));

    // Requirements – usually bullet lists
    const requirements = [];
    $c.find('ul li, .requirements li, [class*="requirement"]').each((__, li) => {
      const t = textOf($(li));
      if (t && !requirements.includes(t)) requirements.push(t);
    });

    // Reward / pack text
    const reward =
      textOf($c.find('[class*="reward"], .badge:contains("Reward"), [class*="pack"]')) || '';
    // Optional on-page “cost”/“price” summaries (textual)
    const costText =
      textOf($c.find('[class*="cost"], [class*="price"], .badge:contains("Cost")')) || '';

    // Filter out generic layout cards: require a plausible name + at least some data
    if (segName && (requirements.length || reward || costText)) {
      segments.push({
        name: segName,
        requirements,
        reward: reward || null,
        costText: costText || null,
      });
    }
  });

  // Deduplicate by name
  const seen = new Set();
  const unique = segments.filter(s => {
    const k = s.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  return { pageTitle, segments: unique };
}

/* ========== Aggregator + Cache ========== */
class LiveSBCScraper {
  constructor(opts = {}) {
    this.ttlMs = Number(opts.ttlMs || 10 * 60 * 1000);      // 10 min cache
    this.detailDelayMs = Number(opts.detailDelayMs || 350); // politeness
    this.sbcCache = new Map(); // 'LIVE_LIST' / `DETAIL:${url}`
  }

  _get(k) {
    const e = this.sbcCache.get(k);
    if (!e) return null;
    if (Date.now() - e.ts > this.ttlMs) { this.sbcCache.delete(k); return null; }
    return e.data;
  }
  _set(k, data) { this.sbcCache.set(k, { ts: Date.now(), data }); }

  async listAll() {
    const cached = this._get('LIVE_LIST');
    if (cached) return cached;

    let list = [];
    try {
      list = await listFutGG();
    } catch (e) {
      console.warn('[SBC] FUT.GG list failed:', e.message);
    }
    if (!list.length) {
      try { list = await listFutbinFallback(); }
      catch (e) { console.warn('[SBC] FUTBIN fallback list failed:', e.message); }
    }

    this._set('LIVE_LIST', list);
    return list;
  }

  async expand(item) {
    if (!item?.url) return { ...item, segments: [] };
    const ck = `DETAIL:${item.url}`;
    const cached = this._get(ck);
    if (cached) return { ...item, segments: cached.segments };

    let detail = { pageTitle: null, segments: [] };
    try {
      if (item.source === 'FUTBIN') {
        // prefer to re-point FUTBIN list item to FUT.GG detail if a matching slug exists?
        // (kept simple: if FUTBIN, we still try its URL via FUT.GG parser first; if empty, leave [])
        detail = await detailFutGG(item.url.includes('fut.gg')
          ? item.url
          : item.url.replace('https://www.futbin.com/25/sbc/', 'https://www.fut.gg/sbc/'));
      } else {
        detail = await detailFutGG(item.url);
      }
    } catch (e) {
      console.warn(`[SBC] detail fetch failed for ${item.url}:`, e.message);
    }

    this._set(ck, detail);
    return { ...item, segments: detail.segments || [] };
  }

  /**
   * getActiveSBCs({ expand=false, limit=null })
   * - expand: include full segments (requirements + reward)
   * - limit: only expand the first N SBCs
   */
  async getActiveSBCs({ expand = false, limit = null } = {}) {
    const list = await this.listAll();
    if (!expand) return list;

    const targets = typeof limit === 'number' ? list.slice(0, limit) : list;
    const out = [];
    for (const it of targets) {
      out.push(await this.expand(it));
      await sleep(this.detailDelayMs);
    }
    if (typeof limit === 'number' && list.length > limit) {
      return [...out, ...list.slice(limit)];
    }
    return out;
  }

  async getDetailByUrl(url) {
    const { segments } = await detailFutGG(url);
    return { url, segments };
  }
}

module.exports = LiveSBCScraper;
