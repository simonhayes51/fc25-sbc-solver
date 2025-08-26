// Live SBC Scraper - Gets active SBCs from multiple sources

class LiveSBCScraper {
    constructor() {
        this.sources = {
            futbin: 'https://www.futbin.com/25/squad-building-challenges',
            futgg: 'https://www.fut.gg/sbc',
            ea: 'https://www.ea.com/fifa/ultimate-team/web-app'
        };
        
        this.sbcCache = new Map();
        this.cacheExpiry = 30 * 60 * 1000; // 30 minutes
    }

    // Main method to get live SBCs
    async getLiveSBCs() {
        console.log('🔍 Fetching live SBCs from multiple sources...');
        
        const liveSBCs = [];
        
        try {
            // Try FUTBIN first (most reliable)
            const futbinSBCs = await this.scrapeFromFUTBIN();
            liveSBCs.push(...futbinSBCs);
            
        } catch (error) {
            console.error('FUTBIN SBC scraping failed:', error);
        }
        
        try {
            // Try FUT.GG as backup
            const futggSBCs = await this.scrapeFromFUTGG();
            liveSBCs.push(...futggSBCs);
            
        } catch (error) {
            console.error('FUT.GG SBC scraping failed:', error);
        }
        
        // Remove duplicates and return
        const uniqueSBCs = this.removeDuplicateSBCs(liveSBCs);
        
        console.log(`✅ Found ${uniqueSBCs.length} live SBCs`);
        return uniqueSBCs;
    }

    // Scrape SBCs from FUTBIN
    async scrapeFromFUTBIN() {
        console.log('🔄 Scraping SBCs from FUTBIN...');
        
        try {
            const response = await fetch(this.sources.futbin, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const html = await response.text();
            
            // Parse HTML for SBC information
            const sbcs = this.parseFUTBINHTML(html);
            
            console.log(`📊 Found ${sbcs.length} SBCs from FUTBIN`);
            return sbcs;
            
        } catch (error) {
            console.error('Error scraping FUTBIN SBCs:', error);
            return [];
        }
    }

    // Parse FUTBIN HTML for SBC data
    parseFUTBINHTML(html) {
        const sbcs = [];
        
        // This would require a proper HTML parser like cheerio in Node.js
        // For now, using regex patterns (not ideal but works)
        
        // Look for SBC cards in HTML
        const sbcPattern = /<div[^>]*class="[^"]*sbc-card[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
        const sbcMatches = html.match(sbcPattern) || [];
        
        for (const match of sbcMatches) {
            try {
                const sbc = this.extractSBCFromHTML(match);
                if (sbc) {
                    sbcs.push(sbc);
                }
            } catch (error) {
                console.error('Error parsing SBC HTML:', error);
            }
        }
        
        return sbcs;
    }

    // Extract SBC details from HTML snippet
    extractSBCFromHTML(htmlSnippet) {
        // Extract SBC name
        const nameMatch = htmlSnippet.match(/title="([^"]+)"/i) || 
                         htmlSnippet.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
        const name = nameMatch ? nameMatch[1].trim() : 'Unknown SBC';
        
        // Extract expiry
        const expiryMatch = htmlSnippet.match(/(\d+)\s*days?\s*left/i) || 
                           htmlSnippet.match(/expires?[:\s]*([^<]+)/i);
        const expiry = expiryMatch ? expiryMatch[1] : 'Unknown';
        
        // Extract requirements (basic patterns)
        const requirements = this.extractRequirements(htmlSnippet);
        
        // Extract cost/rating hints
        const costMatch = htmlSnippet.match(/(\d+(?:,\d+)*)[k\s]*coins?/i);
        const estimatedCost = costMatch ? parseInt(costMatch[1].replace(/,/g, '')) * 1000 : 0;
        
        const ratingMatch = htmlSnippet.match/(\d{2})[+\s]*rating/i);
        const minRating = ratingMatch ? parseInt(ratingMatch[1]) : 75;
        
        return {
            name,
            expiry,
            requirements,
            estimatedCost,
            minRating,
            source: 'FUTBIN',
            isActive: true,
            scrapedAt: new Date()
        };
    }

    // Extract requirements from HTML
    extractRequirements(html) {
        const requirements = [];
        
        // Common requirement patterns
        const patterns = [
            { regex: /min\.?\s*(\d+)\s*rating/i, type: 'MIN_RATING' },
            { regex: /max\.?\s*(\d+)\s*rating/i, type: 'MAX_RATING' },
            { regex: /(\d+)\s*chemistry/i, type: 'MIN_CHEMISTRY' },
            { regex: /exactly?\s*(\d+)\s*league/i, type: 'EXACT_LEAGUES' },
            { regex: /exactly?\s*(\d+)\s*nation/i, type: 'EXACT_NATIONS' },
            { regex: /min\.?\s*(\d+)\s*league/i, type: 'MIN_LEAGUES' },
            { regex: /(\d+)\s*IF/i, type: 'MIN_IF_PLAYERS' },
            { regex: /(\d+)\s*icon/i, type: 'MIN_ICON_PLAYERS' }
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern.regex);
            if (match) {
                requirements.push({
                    type: pattern.type,
                    value: parseInt(match[1])
                });
            }
        }
        
        return requirements;
    }

    // Try FUT.GG API endpoints
    async scrapeFromFUTGG() {
        console.log('🔄 Checking FUT.GG for SBC data...');
        
        const possibleEndpoints = [
            'https://www.fut.gg/api/sbc/active',
            'https://www.fut.gg/api/challenges',
            'https://www.fut.gg/sbc/current'
        ];
        
        for (const endpoint of possibleEndpoints) {
            try {
                const response = await fetch(endpoint, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'SBC-Solver/1.0'
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    console.log(`✅ Found FUT.GG SBC endpoint: ${endpoint}`);
                    return this.parseFUTGGData(data);
                }
            } catch (error) {
                // Try next endpoint
                continue;
            }
        }
        
        console.log('⚠️ No FUT.GG SBC endpoints found');
        return [];
    }

    // Parse FUT.GG API response
    parseFUTGGData(data) {
        if (!data || !Array.isArray(data)) return [];
        
        return data.map(sbc => ({
            name: sbc.name || sbc.title,
            expiry: sbc.expiry || sbc.expires_at,
            requirements: this.convertFUTGGRequirements(sbc.requirements || []),
            estimatedCost: sbc.estimated_cost || 0,
            minRating: sbc.min_rating || 75,
            source: 'FUT.GG',
            isActive: sbc.active !== false,
            scrapedAt: new Date()
        }));
    }

    // Convert FUT.GG requirements to our format
    convertFUTGGRequirements(requirements) {
        return requirements.map(req => ({
            type: req.type || 'UNKNOWN',
            value: req.value || req.min_value || 0,
            description: req.description
        }));
    }

    // Alternative: Get SBCs from EA's web app (advanced)
    async scrapeFromEAWebApp() {
        console.log('🔄 Attempting to scrape EA Web App...');
        
        try {
            // This would require Puppeteer to handle the SPA
            // For now, try to find their API endpoints
            
            const response = await fetch('https://www.ea.com/fifa/ultimate-team/web-app/', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const html = await response.text();
            
            // Look for API endpoints in the JavaScript
            const apiMatches = html.match(/(?:api|endpoint|url).*?\/ut\/game\/fc25\/sbc[^"']*/gi) || [];
            
            if (apiMatches.length > 0) {
                console.log('🔍 Found potential EA SBC endpoints:', apiMatches);
            }
            
            return [];
            
        } catch (error) {
            console.error('Error accessing EA Web App:', error);
            return [];
        }
    }

    // Remove duplicate SBCs from multiple sources
    removeDuplicateSBCs(sbcs) {
        const unique = new Map();
        
        for (const sbc of sbcs) {
            const normalizedName = sbc.name.toLowerCase().trim();
            
            if (!unique.has(normalizedName)) {
                unique.set(normalizedName, sbc);
            } else {
                // Keep the one with more requirements info
                const existing = unique.get(normalizedName);
                if (sbc.requirements.length > existing.requirements.length) {
                    unique.set(normalizedName, sbc);
                }
            }
        }
        
        return Array.from(unique.values());
    }

    // Convert live SBC to our solver format
    convertToSolverFormat(liveSBC) {
        return {
            sbcName: liveSBC.name,
            segments: [
                {
                    name: 'Main Challenge',
                    requirements: {
                        minRating: liveSBC.minRating,
                        playersNeeded: 11,
                        maxPrice: Math.floor(liveSBC.estimatedCost / 11), // Distribute cost
                        priority: 'high',
                        // Convert requirements
                        ...this.convertRequirementsToSolverFormat(liveSBC.requirements)
                    }
                }
            ],
            expiry: liveSBC.expiry,
            source: liveSBC.source,
            lastUpdated: liveSBC.scrapedAt
        };
    }

    convertRequirementsToSolverFormat(requirements) {
        const solverReqs = {};
        
        for (const req of requirements) {
            switch (req.type) {
                case 'MIN_CHEMISTRY':
                    solverReqs.minChemistry = req.value;
                    break;
                case 'EXACT_LEAGUES':
                    solverReqs.exactLeagues = req.value;
                    break;
                case 'EXACT_NATIONS':
                    solverReqs.exactNations = req.value;
                    break;
                case 'MIN_IF_PLAYERS':
                    solverReqs.versions = ['In Form', 'Team of the Week'];
                    break;
                case 'MIN_ICON_PLAYERS':
                    solverReqs.versions = ['Icon'];
                    break;
            }
        }
        
        return solverReqs;
    }

    // Cache management
    getCachedSBCs() {
        const cached = this.sbcCache.get('live_sbcs');
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        return null;
    }

    setCachedSBCs(sbcs) {
        this.sbcCache.set('live_sbcs', {
            data: sbcs,
            timestamp: Date.now()
        });
    }

    // Main public method
    async getActiveSBCs() {
        // Check cache first
        const cached = this.getCachedSBCs();
        if (cached) {
            console.log(`📋 Returning ${cached.length} cached SBCs`);
            return cached;
        }
        
        // Fetch live data
        const liveSBCs = await this.getLiveSBCs();
        
        // Convert to solver format
        const solverSBCs = liveSBCs.map(sbc => this.convertToSolverFormat(sbc));
        
        // Cache results
        this.setCachedSBCs(solverSBCs);
        
        return solverSBCs;
    }
}

module.exports = LiveSBCScraper;

// Usage example:
/*
const scraper = new LiveSBCScraper();

// Get active SBCs
const activeSBCs = await scraper.getActiveSBCs();

console.log(`Found ${activeSBCs.length} active SBCs:`);
activeSBCs.forEach(sbc => {
    console.log(`- ${sbc.sbcName} (expires: ${sbc.expiry})`);
});
*/
