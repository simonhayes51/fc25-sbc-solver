// src/live-sbc-scraper.js - Fixed with proper error handling and axios
const axios = require(‘axios’);
const cheerio = require(‘cheerio’);

const FUTGG_LIST = ‘https://www.fut.gg/sbc/’;
const FUTBIN_LIST = ‘https://www.futbin.com/25/squad-building-challenges’;

const USER_AGENTS = [
‘Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36’,
‘Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15’,
‘Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36’,
];

const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cleanText = (str) => (str || ‘’).replace(/\s+/g, ’ ’).trim();

function parseExpiry(text) {
if (!text) return null;

const lower = text.toLowerCase();
const now = Date.now();
const DAY_MS = 24 * 3600 * 1000;

// Match “X days”
const dayMatch = lower.match(/(\d+)\s*day/);
if (dayMatch) {
const days = parseInt(dayMatch[1]);
return new Date(now + days * DAY_MS).toISOString();
}

// Match “X hours” or “X hours Y minutes”
const hourMatch = lower.match(/(\d+)\s*h(?:our)?(?:\s*(\d+)\s*m(?:in)?)?/);
if (hourMatch) {
const hours = parseInt(hourMatch[1]);
const minutes = parseInt(hourMatch[2] || ‘0’);
return new Date(now + (hours * 3600 + minutes * 60) * 1000).toISOString();
}

return null;
}

async function fetchHTML(url, retries = 3) {
for (let i = 0; i < retries; i++) {
try {
console.log(`📡 Fetching: ${url} (attempt ${i + 1}/${retries})`);

```
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    validateStatus: (status) => status < 500 // Don't retry on 4xx errors
  });
  
  if (response.status === 200 && response.data) {
    console.log(`✅ Successfully fetched ${url} (${response.data.length} chars)`);
    return String(response.data);
  }
  
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  
} catch (error) {
  console.warn(`❌ Attempt ${i + 1} failed for ${url}:`, error.message);
  
  if (i === retries - 1) {
    throw new Error(`Failed to fetch ${url} after ${retries} attempts: ${error.message}`);
  }
  
  // Wait before retry with exponential backoff
  await sleep(1000 * Math.pow(2, i));
}
```

}
}

async function scrapeFutGGList() {
try {
const html = await fetchHTML(FUTGG_LIST);
const $ = cheerio.load(html);
const items = [];

```
console.log('🔍 Parsing FUT.GG SBC list...');

// More comprehensive selectors for FUT.GG
const candidates = $([
  'a[href*="/sbc/"]',
  '[class*="sbc"] a',
  '[class*="challenge"] a',
  '.card a[href*="/sbc/"]',
  '.grid a[href*="/sbc/"]'
].join(', '));

console.log(`📋 Found ${candidates.length} potential SBC links`);

candidates.each((_, element) => {
  try {
    const $link = $(element);
    const href = $link.attr('href');
    
    if (!href || !href.match(/^\/sbc\/[a-z0-9-]+/i)) {
      return; // Skip invalid links
    }
    
    // Extract SBC name from various sources
    let name = cleanText($link.find('[class*="title"], [class*="name"], h1, h2, h3, h4').first().text());
    if (!name) {
      name = cleanText($link.text());
    }
    if (!name) {
      name = cleanText($link.attr('title') || '');
    }
    
    if (!name || name.length < 3) {
      return; // Skip if no valid name found
    }
    
    // Look for expiry information
    const $parent = $link.closest('.card, .item, [class*="sbc"], [class*="challenge"]');
    const expiryText = cleanText($parent.find('[class*="expir"], [class*="end"], [class*="remain"], [class*="time"]').first().text());
    
    // Look for segment information
    const segmentText = cleanText($parent.find('[class*="segment"], .badge, [class*="parts"]').first().text());
    const segmentMatch = segmentText.match(/(\d+)\s*segment/i);
    const segmentCount = segmentMatch ? parseInt(segmentMatch[1]) : null;
    
    const item = {
      source: 'FUT.GG',
      id: href.replace(/^\/sbc\//, '').replace(/\/$/, ''),
      url: new URL(href, 'https://www.fut.gg').toString(),
      name: name,
      segmentCount,
      expiresText: expiryText || null,
      expiresAt: parseExpiry(expiryText),
      updatedAt: new Date().toISOString()
    };
    
    items.push(item);
    
  } catch (error) {
    console.warn('⚠️ Error parsing FUT.GG item:', error.message);
  }
});

// Remove duplicates based on name and ID
const seen = new Set();
const unique = items.filter(item => {
  const key = `${item.source}:${item.id}:${item.name.toLowerCase()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log(`✅ FUT.GG: Found ${unique.length} unique SBCs`);
return unique;
```

} catch (error) {
console.error(‘❌ FUT.GG scraping failed:’, error.message);
return [];
}
}

async function scrapeFutbinFallback() {
try {
const html = await fetchHTML(FUTBIN_LIST);
const $ = cheerio.load(html);
const items = [];

```
console.log('🔍 Parsing FUTBIN SBC list (fallback)...');

// FUTBIN selectors
const candidates = $([
  'a[href*="/25/sbc/"]',
  'a[href*="/squad-building-challenge/"]',
  '.sbc-card a',
  '[class*="sbc"] a'
].join(', '));

console.log(`📋 Found ${candidates.length} potential FUTBIN links`);

candidates.each((_, element) => {
  try {
    const $link = $(element);
    const href = $link.attr('href');
    
    if (!href || (!href.includes('/25/sbc/') && !href.includes('/squad-building-challenge/'))) {
      return;
    }
    
    let name = cleanText($link.find('.title, .name, h3, h4').first().text());
    if (!name) {
      name = cleanText($link.text());
    }
    
    if (!name || name.length < 3) {
      return;
    }
    
    const $parent = $link.closest('.card, .item, [class*="sbc"]');
    const expiryText = cleanText($parent.find('[class*="expir"], [class*="end"], [class*="remain"]').first().text());
    
    const segmentText = cleanText($parent.find('[class*="segment"], .badge, small').first().text());
    const segmentMatch = segmentText.match(/(\d+)\s*segment/i) || segmentText.match(/\((\d+)\)/);
    const segmentCount = segmentMatch ? parseInt(segmentMatch[1]) : null;
    
    const fullUrl = href.startsWith('http') ? href : `https://www.futbin.com${href}`;
    const id = href
      .replace(/^\/25\/sbc\//, '')
      .replace(/^\/squad-building-challenge\//, '')
      .replace(/\/$/, '');
    
    const item = {
      source: 'FUTBIN',
      id,
      url: fullUrl,
      name,
      segmentCount,
      expiresText: expiryText || null,
      expiresAt: parseExpiry(expiryText),
      updatedAt: new Date().toISOString()
    };
    
    items.push(item);
    
  } catch (error) {
    console.warn('⚠️ Error parsing FUTBIN item:', error.message);
  }
});

const seen = new Set();
const unique = items.filter(item => {
  const key = `${item.source}:${item.id}:${item.name.toLowerCase()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log(`✅ FUTBIN: Found ${unique.length} unique SBCs`);
return unique;
```

} catch (error) {
console.error(‘❌ FUTBIN scraping failed:’, error.message);
return [];
}
}

async function scrapeSBCDetails(url) {
try {
const html = await fetchHTML(url);
const $ = cheerio.load(html);

```
console.log(`🔍 Parsing SBC details from ${url}`);

// Extract page title
const pageTitle = cleanText($('h1').first().text()) ||
                 cleanText($('[class*="title"], [class*="name"]').first().text()) ||
                 null;

// Find segments/challenges
const segments = [];
const segmentSelectors = [
  '[class*="segment"]',
  '[class*="challenge"]',
  '.card',
  '.panel',
  '[data-testid*="segment"]',
  '.grid > div',
  '.list > div'
];

for (const selector of segmentSelectors) {
  const containers = $(selector);
  
  containers.each((_, container) => {
    try {
      const $container = $(container);
      
      // Extract segment name
      const segmentName = cleanText(
        $container.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text() ||
        $container.find('a[href*="/squad/"], a[href*="/challenge/"]').first().text()
      );
      
      if (!segmentName || segmentName.length < 3) {
        return; // Skip if no valid segment name
      }
      
      // Extract requirements
      const requirements = [];
      $container.find('ul li, .requirements li, [class*="requirement"], .badge').each((_, reqElement) => {
        const reqText = cleanText($(reqElement).text());
        if (reqText && !requirements.includes(reqText) && reqText.length < 100) {
          requirements.push(reqText);
        }
      });
      
      // Extract reward information
      const reward = cleanText(
        $container.find('[class*="reward"], [class*="pack"], .badge:contains("Pack")').first().text()
      ) || null;
      
      // Extract cost information if available
      const costText = cleanText(
        $container.find('[class*="cost"], [class*="price"]').first().text()
      ) || null;
      
      // Only add if we have meaningful data
      if (segmentName && (requirements.length > 0 || reward || costText)) {
        segments.push({
          name: segmentName,
          requirements,
          reward,
          costText
        });
      }
      
    } catch (error) {
      console.warn('⚠️ Error parsing segment:', error.message);
    }
  });
  
  // If we found segments, break
  if (segments.length > 0) break;
}

// Remove duplicates
const seen = new Set();
const uniqueSegments = segments.filter(segment => {
  const key = segment.name.toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log(`✅ Found ${uniqueSegments.length} segments for ${pageTitle || 'SBC'}`);

return {
  pageTitle,
  segments: uniqueSegments
};
```

} catch (error) {
console.error(`❌ Failed to parse details for ${url}:`, error.message);
return { pageTitle: null, segments: [] };
}
}

class LiveSBCScraper {
constructor(options = {}) {
this.ttlMs = options.ttlMs || 10 * 60 * 1000; // 10 minutes cache
this.detailDelayMs = options.detailDelayMs || 350; // Politeness delay
this.sbcCache = new Map(); // Cache for both list and details

```
console.log('🎯 LiveSBCScraper initialized with options:', {
  ttlMs: this.ttlMs,
  detailDelayMs: this.detailDelayMs
});
```

}

_getCached(key) {
const entry = this.sbcCache.get(key);
if (!entry) return null;

```
if (Date.now() - entry.timestamp > this.ttlMs) {
  this.sbcCache.delete(key);
  return null;
}

return entry.data;
```

}

_setCache(key, data) {
this.sbcCache.set(key, {
data,
timestamp: Date.now()
});
}

async listAll() {
const cached = this._getCached(‘LIVE_LIST’);
if (cached) {
console.log(‘📋 Using cached SBC list’);
return cached;
}

```
console.log('🔄 Fetching fresh SBC list...');

let sbcList = [];

// Try FUT.GG first
try {
  sbcList = await scrapeFutGGList();
  console.log(`✅ FUT.GG returned ${sbcList.length} SBCs`);
} catch (error) {
  console.warn('⚠️ FUT.GG failed:', error.message);
}

// Fallback to FUTBIN if FUT.GG failed or returned no results
if (sbcList.length === 0) {
  try {
    console.log('🔄 Trying FUTBIN fallback...');
    sbcList = await scrapeFutbinFallback();
    console.log(`✅ FUTBIN returned ${sbcList.length} SBCs`);
  } catch (error) {
    console.warn('⚠️ FUTBIN fallback failed:', error.message);
  }
}

// Cache the results
this._setCache('LIVE_LIST', sbcList);

console.log(`📊 Total SBCs found: ${sbcList.length}`);
return sbcList;
```

}

async expand(sbcItem) {
if (!sbcItem?.url) {
return { …sbcItem, segments: [] };
}

```
const cacheKey = `DETAIL:${sbcItem.url}`;
const cached = this._getCached(cacheKey);

if (cached) {
  return { ...sbcItem, segments: cached.segments };
}

console.log(`🔍 Expanding details for: ${sbcItem.name}`);

try {
  const details = await scrapeSBCDetails(sbcItem.url);
  this._setCache(cacheKey, details);
  
  return {
    ...sbcItem,
    segments: details.segments || []
  };
  
} catch (error) {
  console.error(`❌ Failed to expand ${sbcItem.name}:`, error.message);
  return { ...sbcItem, segments: [] };
}
```

}

async getActiveSBCs(options = {}) {
const { expand = false, limit = null } = options;

```
console.log('🎯 Getting active SBCs with options:', { expand, limit });

const sbcList = await this.listAll();

if (!expand) {
  return sbcList;
}

// Determine which SBCs to expand
const toExpand = typeof limit === 'number' ? sbcList.slice(0, limit) : sbcList;
const expanded = [];

console.log(`🔄 Expanding ${toExpand.length} SBCs...`);

for (let i = 0; i < toExpand.length; i++) {
  const sbc = toExpand[i];
  
  console.log(`📈 Expanding ${i + 1}/${toExpand.length}: ${sbc.name}`);
  
  const expandedSBC = await this.expand(sbc);
  expanded.push(expandedSBC);
  
  // Add delay between requests to be polite
  if (i < toExpand.length - 1) {
    await sleep(this.detailDelayMs);
  }
}

// If we have a limit, append the non-expanded items
if (typeof limit === 'number' && sbcList.length > limit) {
  const remaining = sbcList.slice(limit);
  return [...expanded, ...remaining];
}

return expanded;
```

}

async getDetailByUrl(url) {
const details = await scrapeSBCDetails(url);
return {
url,
segments: details.segments || []
};
}
}

module.exports = LiveSBCScraper;