// src/live-sbc-scraper.js - FIXED with axios and better error handling
const axios = require('axios');
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
    
    // Use axios instead of fetch for better Node.js compatibility
    this.client = axios.create({
      timeout: this.requestTimeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    
    console.log('🎯 LiveSBCScraper initialized');
  }

  // Public entry
  async getActiveSBCs() {
    console.log('🔍 Getting active SBCs...');
    
    const cached = this._getCached('live_sbcs');
    if (cached) {
      console.log(`📋 Returning ${cached.length} cached SBCs`);
      return cached;
    }

    try {
      const live = await this._getLiveSBCs();
      const solver = live.map((sbc) => this._toSolverFormat(sbc));
      
      console.log(`✅ Found ${solver.length} live SBCs, caching...`);
      this._setCached('live_sbcs', solver);
      
      return solver;
    } catch (error) {
      console.error('❌ Failed to get live SBCs:', error);
      
      // Return empty array instead of throwing
      return [];
    }
  }

  // ----- Internals -----
  async _getLiveSBCs() {
    console.log('🔍 Fetching live SBCs (FUTBIN + FUT.GG)…');
    const all = [];

    // FUTBIN
    try {
      console.log('📊 Scraping FUTBIN...');
      const fromFutbin = await this._scrapeFutbin();
      console.log(`✅ FUTBIN: ${fromFutbin.length} SBCs found`);
      all.push(...fromFutbin);
    } catch (e) {
      console.error('❌ FUTBIN scrape failed:', e.message);
    }

    // FUT.GG
    try {
      console.log('📊 Scraping FUT.GG...');
      const fromFutgg = await this._scrapeFutgg();
      console.log(`✅ FUT.GG: ${fromFutgg.length} SBCs found`);
      all.push(...fromFutgg);
    } catch (e) {
      console.error('❌ FUT.GG scrape failed:', e.message);
    }

    const unique = this._dedupeByName(all);
    console.log(`✅ Total unique SBCs: ${unique.length}`);
    return unique;
  }

  async _scrapeFutbin() {
    console.log('🔄 Scraping FUTBIN…', this.sources.futbin);
    
    const html = await this._safeFetchText(this.sources.futbin);
    if (!html) {
      console.warn('❌ No HTML received from FUTBIN');
      return [];
    }

    console.log(`📄 FUTBIN HTML received: ${html.length} characters`);
    const $ = cheerio.load(html);
    const results = [];

    // Enhanced FUTBIN selectors
    const candidates = $(
      'a[href*="/squad-building-challenge/"], ' +
      '.sbc-card, .sbc_challenge, .sbcs-list .card, ' + 
      '.content .card, div[class*="sbc"], ' +
      'h3:contains("SBC"), h4:contains("SBC"), ' +
      '[class*="challenge"]:has(h3), [class*="challenge"]:has(h4)'
    );

    console.log(`🔍 Found ${candidates.length} potential SBC elements`);

    const seen = new Set();
    candidates.each((i, el) => {
      try {
        const node = $(el);

        // Enhanced name extraction
        let name = '';
        
        // Try link text first
        if (node.is('a')) {
          name = node.text().trim();
        }
        
        // Try title attribute
        if (!name) {
          name = node.attr('title')?.trim() || '';
        }
        
        // Try heading text
        if (!name) {
          name = node.find('h1,h2,h3,h4,h5').first().text().trim();
        }
        
        // Try any text content
        if (!name) {
          const fullText = node.text().trim();
          // Take first line that looks like a title
          const lines = fullText.split('\n').filter(line => line.trim().length > 0);
          name = lines[0]?.trim() || '';
        }

        name = this._cleanName(name);
        if (!name || name.length < 3) {
          return; // Skip this element
        }

        // Avoid duplicates
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        // Extract additional data
        const text = node.text();
        
        // Expiry (enhanced patterns)
        const expiry = this._extractExpiry(text);

        // Estimated cost (enhanced)
        const estCost = this._parseCost(text);

        // Rating requirement
        const minRating = this._parseMinRating(text) ?? 75;

        // Requirements (enhanced extraction)
        const requirements = this._extractRequirementHints(text);
        
        // Extract URL for detailed scraping
        const href = node.attr('href') || node.find('a').first().attr('href');
        const fullUrl = href ? (href.startsWith('http') ? href : `https://www.futbin.com${href}`) : null;

        const sbcData = {
          name,
          expiry,
          requirements,
          estimatedCost: estCost,
          minRating,
          source: 'FUTBIN',
          url: fullUrl,
          isActive: true,
          scrapedAt: new Date(),
        };
        
        console.log(`📋 FUTBIN SBC: ${name} (${estCost ? (estCost/1000).toFixed(0) + 'k' : 'no cost'}) - ${requirements.length} requirements`);
        results.push(sbcData);

      } catch (error) {
        console.warn(`⚠️ Error processing FUTBIN element ${i}:`, error.message);
      }
    });

    console.log(`✅ FUTBIN extraction complete: ${results.length} SBCs`);
    return results;
  }

  async _scrapeFutgg() {
    console.log('🔄 Scraping FUT.GG…', this.sources.futgg);
    
    const html = await this._safeFetchText(this.sources.futgg);
    if (!html) {
      console.warn('❌ No HTML received from FUT.GG');
      return [];
    }

    console.log(`📄 FUT.GG HTML received: ${html.length} characters`);
    const $ = cheerio.load(html);
    const results = [];

    // Enhanced FUT.GG selectors
    const candidates = $(
      'a[href^="/sbc/"], a[href*="/sbc/"], ' +
      '.sbc-card, .challenge-card, [class*="sbc"], ' +
      '[class*="challenge"]:has(h1), [class*="challenge"]:has(h2), ' +
      '[
