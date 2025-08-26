// Data Sources and API Integration for SBC Solver
// Handles data fetching from various FIFA/FC25 community APIs and websites

class DataSourceManager {
    constructor() {
        this.apiKeys = {
            futbin: process.env.FUTBIN_API_KEY || '',
            futwiz: process.env.FUTWIZ_API_KEY || ''
        };
        
        this.rateLimits = new Map();
        this.cache = new Map();
        this.cacheExpiry = 10 * 60 * 1000; // 10 minutes
    }

    // Rate limiting helper
    async checkRateLimit(source, limit = 60, window = 60000) {
        const now = Date.now();
        const key = source;
        
        if (!this.rateLimits.has(key)) {
            this.rateLimits.set(key, { count: 0, resetTime: now + window });
        }
        
        const rateData = this.rateLimits.get(key);
        
        if (now > rateData.resetTime) {
            rateData.count = 0;
            rateData.resetTime = now + window;
        }
        
        if (rateData.count >= limit) {
            const waitTime = rateData.resetTime - now;
            console.log(`Rate limit hit for ${source}, waiting ${waitTime}ms`);
            await this.sleep(waitTime);
            return this.checkRateLimit(source, limit, window);
        }
        
        rateData.count++;
        return true;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Cache management
    getCached(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    // FUTBIN API Integration
    async fetchFromFutbin(endpoint, params = {}) {
        const cacheKey = `futbin_${endpoint}_${JSON.stringify(params)}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        await this.checkRateLimit('futbin', 100); // 100 requests per minute
        
        const queryString = new URLSearchParams(params).toString();
        const url = `https://api.futbin.com/v1/${endpoint}${queryString ? '?' + queryString : ''}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.apiKeys.futbin}`,
                    'User-Agent': 'SBC-Solver/1.0'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Futbin API error: ${response.status}`);
            }
            
            const data = await response.json();
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Futbin API error:', error);
            throw error;
        }
    }

    // FUTWIZ API Integration
    async fetchFromFutwiz(endpoint, params = {}) {
        const cacheKey = `futwiz_${endpoint}_${JSON.stringify(params)}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        await this.checkRateLimit('futwiz', 50);
        
        const queryString = new URLSearchParams(params).toString();
        const url = `https://api.futwiz.com/${endpoint}${queryString ? '?' + queryString : ''}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'X-API-Key': this.apiKeys.futwiz,
                    'User-Agent': 'SBC-Solver/1.0'
                }
            });
            
            const data = await response.json();
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Futwiz API error:', error);
            throw error;
        }
    }

    // EA Web App Scraper (Using Puppeteer)
    async scrapeEAWebApp() {
        // Note: This requires Puppeteer and careful handling of EA's ToS
        const puppeteer = require('puppeteer');
        
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        try {
            // Set user agent to avoid detection
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            // Navigate to EA Web App
            await page.goto('https://www.ea.com/fifa/ultimate-team/web-app/', {
                waitUntil: 'networkidle2'
            });
            
            // Wait for login or SBC section
            await page.waitForSelector('.sbc-challenges', { timeout: 30000 });
            
            // Extract SBC data
            const sbcData = await page.evaluate(() => {
                const sbcs = [];
                const sbcElements = document.querySelectorAll('.sbc-challenge-item');
                
                sbcElements.forEach(element => {
                    const name = element.querySelector('.sbc-name')?.textContent;
                    const requirements = element.querySelector('.sbc-requirements')?.textContent;
                    const expiry = element.querySelector('.sbc-expiry')?.textContent;
                    
                    if (name) {
                        sbcs.push({ name, requirements, expiry });
                    }
                });
                
                return sbcs;
            });
            
            return sbcData;
        } finally {
            await browser.close();
        }
    }

    // Player Database Builder
    async buildPlayerDatabase() {
        console.log('Building comprehensive player database...');
        
        const players = new Map();
        
        try {
            // Fetch from multiple sources and merge
            const futbinPlayers = await this.fetchFromFutbin('players');
            const futwizPlayers = await this.fetchFromFutwiz('players');
            
            // Merge player data
            this.mergePlayerSources(players, futbinPlayers, 'futbin');
            this.mergePlayerSources(players, futwizPlayers, 'futwiz');
            
            console.log(`Built database with ${players.size} players`);
            return players;
        } catch (error) {
            console.error('Error building player database:', error);
            return this.getFallbackPlayerData();
        }
    }

    mergePlayerSources(playerMap, sourceData, sourceName) {
        if (!sourceData || !sourceData.players) return;
        
        for (const player of sourceData.players) {
            const playerId = player.id || player.baseId;
            
            if (playerMap.has(playerId)) {
                // Merge data, preferring the most recent/accurate
                const existing = playerMap.get(playerId);
                const merged = this.mergePlayerData(existing, player, sourceName);
                playerMap.set(playerId, merged);
            } else {
                // Add new player
                playerMap.set(playerId, this.normalizePlayerData(player, sourceName));
            }
        }
    }

    normalizePlayerData(player, source) {
        return {
            id: player.id || player.baseId,
            name: player.name || player.commonName,
            rating: player.rating || player.overallRating,
            position: player.position,
            alternativePositions: player.altPositions || [],
            league: player.league?.name || player.leagueName,
            nation: player.nation?.name || player.nationName,
            club: player.club?.name || player.clubName,
            price: this.extractPrice(player, source),
            priceSource: source,
            lastUpdated: new Date(),
            rarity: player.rarity,
            cardType: player.cardType,
            stats: {
                pace: player.pace,
                shooting: player.shooting,
                passing: player.passing,
                dribbling: player.dribbling,
                defending: player.defending,
                physical: player.physical
            }
        };
    }

    extractPrice(player, source) {
        switch (source) {
            case 'futbin':
                return player.prices?.ps?.LCPrice || player.ps4Price || 0;
            case 'futwiz':
                return player.price?.ps5 || player.price?.ps4 || 0;
            default:
                return 0;
        }
    }

    mergePlayerData(existing, newData, source) {
        // Prefer more recent price data
        if (newData.lastUpdated > existing.lastUpdated) {
            existing.price = this.extractPrice(newData, source);
            existing.priceSource = source;
            existing.lastUpdated = new Date();
        }
        
        // Keep the highest quality data for other fields
        if (!existing.stats && newData.stats) {
            existing.stats = newData.stats;
        }
        
        return existing;
    }

    // SBC Requirements Parser
    async fetchSBCRequirements(sbcName) {
        console.log(`Fetching SBC requirements for: ${sbcName}`);
        
        try {
            // Try EA Web App first
            const eaData = await this.scrapeEAWebApp();
            const sbcData = eaData.find(sbc => sbc.name.includes(sbcName));
            
            if (sbcData) {
                return this.parseSBCRequirements(sbcData);
            }
            
            // Fallback to community sources
            return await this.fetchFromCommunityAPIs(sbcName);
        } catch (error) {
            console.error('Error fetching SBC requirements:', error);
            return this.getMockSBCRequirements(sbcName);
        }
    }

    parseSBCRequirements(sbcData) {
        const requirements = [];
        const reqText = sbcData.requirements.toLowerCase();
        
        // Parse common requirements
        if (reqText.includes('min. team rating')) {
            const match = reqText.match(/min\. team rating[:\s]*(\d+)/);
            if (match) {
                requirements.push({ type: 'MIN_TEAM_RATING', value: parseInt(match[1]) });
            }
        }
        
        if (reqText.includes('min. team chemistry')) {
            const match = reqText.match(/min\. team chemistry[:\s]*(\d+)/);
            if (match) {
                requirements.push({ type: 'MIN_CHEMISTRY', value: parseInt(match[1]) });
            }
        }
        
        if (reqText.includes('exactly') && reqText.includes('league')) {
            const match = reqText.match(/exactly[:\s]*(\d+)[:\s]*league/);
            if (match) {
                requirements.push({ type: 'EXACT_LEAGUES', value: parseInt(match[1]) });
            }
        }
        
        // Add more parsing logic for other requirements...
        
        return {
            name: sbcData.name,
            requirements,
            expiry: sbcData.expiry,
            rewards: this.extractRewards(sbcData)
        };
    }

    extractRewards(sbcData) {
        // Extract rewards from SBC data
        return ['Premium Gold Pack']; // Placeholder
    }

    async fetchFromCommunityAPIs(sbcName) {
        // Try FUTBIN SBC section
        try {
            const sbcData = await this.fetchFromFutbin(`sbc/${encodeURIComponent(sbcName)}`);
            return this.parseCommunitySDCData(sbcData);
        } catch (error) {
            console.log('Community API fallback failed:', error);
            return this.getMockSBCRequirements(sbcName);
        }
    }

    // Price monitoring system
    async startPriceMonitoring(callback, interval = 5 * 60 * 1000) {
        const monitorPrices = async () => {
            try {
                console.log('Monitoring price changes...');
                
                const priceUpdates = await this.fetchLatestPrices();
                
                if (priceUpdates.size > 0) {
                    callback(priceUpdates);
                }
            } catch (error) {
                console.error('Price monitoring error:', error);
            }
        };
        
        // Initial check
        await monitorPrices();
        
        // Set up interval
        return setInterval(monitorPrices, interval);
    }

    async fetchLatestPrices() {
        const updates = new Map();
        
        try {
            // Get recent price changes from FUTBIN
            const priceData = await this.fetchFromFutbin('prices/recent');
            
            if (priceData && priceData.priceChanges) {
                for (const change of priceData.priceChanges) {
                    updates.set(change.playerId, {
                        newPrice: change.currentPrice,
                        oldPrice: change.previousPrice,
                        change: change.currentPrice - change.previousPrice,
                        changePercent: ((change.currentPrice - change.previousPrice) / change.previousPrice) * 100
                    });
                }
            }
        } catch (error) {
            console.error('Error fetching price updates:', error);
        }
        
        return updates;
    }

    // Fallback data for development
    getFallbackPlayerData() {
        const players = new Map();
        
        // Add comprehensive mock data for testing
        const mockPlayers = [
            {
                id: 1, name: 'Lionel Messi', rating: 90, position: 'RW',
                league: 'MLS', nation: 'Argentina', club: 'Inter Miami',
                price: 45000, rarity: 'Gold', cardType: 'Regular'
            },
            {
                id: 2, name: 'Kylian Mbappé', rating: 91, position: 'ST',
                league: 'LaLiga', nation: 'France', club: 'Real Madrid',
                price: 89000, rarity: 'Gold', cardType: 'Regular'
            },
            // Add 100+ more players for realistic testing...
        ];
        
        for (const player of mockPlayers) {
            players.set(player.id, {
                ...player,
                lastUpdated: new Date(),
                priceSource: 'mock',
                alternativePositions: [],
                stats: {
                    pace: 85, shooting: 90, passing: 88,
                    dribbling: 95, defending: 35, physical: 70
                }
            });
        }
        
        return players;
    }

    getMockSBCRequirements(sbcName) {
        const mockRequirements = {
            'League and Nation Hybrid': {
                name: sbcName,
                requirements: [
                    { type: 'MIN_TEAM_RATING', value: 84 },
                    { type: 'MIN_CHEMISTRY', value: 95 },
                    { type: 'EXACT_LEAGUES', value: 1 },
                    { type: 'EXACT_NATIONS', value: 8 }
                ],
                expiry: '7 days',
                rewards: ['Premium Gold Pack', '5,000 Coins']
            }
        };
        
        return mockRequirements[sbcName] || mockRequirements['League and Nation Hybrid'];
    }
}

// Export the data source manager
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataSourceManager;
}

// Usage example:
/*
const dataManager = new DataSourceManager();

// Initialize and build player database
dataManager.buildPlayerDatabase().then(players => {
    console.log(`Loaded ${players.size} players`);
});

// Fetch specific SBC requirements
dataManager.fetchSBCRequirements('League and Nation Hybrid').then(sbc => {
    console.log('SBC Requirements:', sbc);
});

// Start price monitoring
const priceMonitor = dataManager.startPriceMonitoring((updates) => {
    console.log(`${updates.size} price updates received`);
    for (const [playerId, update] of updates) {
        console.log(`Player ${playerId}: ${update.oldPrice} -> ${update.newPrice}`);
    }
}, 5 * 60 * 1000); // Check every 5 minutes
*/
