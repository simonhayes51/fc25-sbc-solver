// Complete Postgres + FUT.GG Integration for SBC Solver
// Loads players from your Postgres DB and gets prices from FUT.GG API

const { Pool } = require('pg');

class PostgresFUTGGDataSource {
    constructor() {
        this.dbPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        this.futggApiBase = 'https://www.fut.gg/api/fut/player-prices/25';
        this.rateLimitDelay = 200; // 200ms between requests (5 per second)
        this.priceCache = new Map();
        this.cacheExpiry = 10 * 60 * 1000; // 10 minutes
        this.playersMap = new Map();
    }

    // Load all players from your Postgres database
    async loadPlayersFromDatabase() {
        console.log('🔄 Loading players from Postgres database...');
        
        try {
            const query = `
                SELECT 
                    id, name, rating, version, image_url, created_at, 
                    player_slug, player_url, card_id, price, club, nation, position
                FROM players 
                WHERE card_id IS NOT NULL 
                ORDER BY rating DESC, name ASC
            `;
            
            const result = await this.dbPool.query(query);
            const players = result.rows;
            
            console.log(`📊 Found ${players.length} players in database`);
            
            // Convert to our format and store
            for (const player of players) {
                this.playersMap.set(player.card_id, {
                    id: player.card_id,
                    dbId: player.id,
                    name: player.name,
                    rating: parseInt(player.rating),
                    position: this.normalizePosition(player.position),
                    club: player.club,
                    nation: player.nation,
                    version: player.version,
                    imageUrl: player.image_url,
                    playerSlug: player.player_slug,
                    playerUrl: player.player_url,
                    price: parseInt(player.price) || 0,
                    lastPriceUpdate: player.created_at,
                    rarity: this.getRarityFromVersion(player.version),
                    league: this.getLeagueFromClub(player.club), // You might want to add league to DB
                    alternativePositions: this.getAltPositions(player.position)
                });
            }
            
            console.log(`✅ Loaded ${this.playersMap.size} players into memory`);
            return this.playersMap;
            
        } catch (error) {
            console.error('❌ Error loading players from database:', error);
            throw error;
        }
    }

    // Get price from FUT.GG API
    async getPlayerPriceFromAPI(cardId) {
        const cacheKey = `price_${cardId}`;
        const cached = this.getCachedPrice(cacheKey);
        
        if (cached) {
            return cached;
        }

        try {
            await this.sleep(this.rateLimitDelay);
            
            const url = `${this.futggApiBase}/${cardId}/`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'SBC-Solver/1.0',
                    'Accept': 'application/json',
                    'Referer': 'https://www.fut.gg/'
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.log(`⚠️ Player ${cardId} not found in FUT.GG API`);
                    return 0;
                }
                throw new Error(`FUT.GG API error: ${response.status} - ${response.statusText}`);
            }

            const priceData = await response.json();
            const price = this.extractPriceFromResponse(priceData);
            
            // Cache the price
            this.setCachedPrice(cacheKey, price);
            
            return price;
            
        } catch (error) {
            console.error(`❌ Error fetching price for card ${cardId}:`, error.message);
            
            // Return cached price from database if API fails
            const player = this.playersMap.get(cardId);
            return player?.price || 0;
        }
    }

    // Extract price from FUT.GG API response
    extractPriceFromResponse(data) {
        // Adjust this based on actual FUT.GG API response structure
        // Common patterns:
        if (data.price) return parseInt(data.price);
        if (data.current_price) return parseInt(data.current_price);
        if (data.lowest_price) return parseInt(data.lowest_price);
        if (data.market_price) return parseInt(data.market_price);
        
        // If it's an array, take the first/latest price
        if (Array.isArray(data) && data.length > 0) {
            const latest = data[0];
            return parseInt(latest.price || latest.value || 0);
        }
        
        console.log(`⚠️ Unexpected API response format:`, data);
        return 0;
    }

    // Update prices for specific players (used for SBC solving)
    async updatePricesForPlayers(cardIds, maxConcurrent = 5) {
        console.log(`🔄 Updating prices for ${cardIds.length} players...`);
        
        const results = new Map();
        const batches = this.createBatches(cardIds, maxConcurrent);
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            console.log(`📦 Processing batch ${i + 1}/${batches.length} (${batch.length} players)`);
            
            const batchPromises = batch.map(async (cardId) => {
                try {
                    const price = await this.getPlayerPriceFromAPI(cardId);
                    return { cardId, price, success: true };
                } catch (error) {
                    console.error(`Failed to get price for ${cardId}:`, error.message);
                    return { cardId, price: 0, success: false };
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            
            // Update results and in-memory cache
            for (const { cardId, price, success } of batchResults) {
                results.set(cardId, price);
                
                if (this.playersMap.has(cardId)) {
                    this.playersMap.get(cardId).price = price;
                    this.playersMap.get(cardId).lastPriceUpdate = new Date();
                }
            }
            
            const successCount = batchResults.filter(r => r.success).length;
            console.log(`✅ Batch ${i + 1} complete: ${successCount}/${batch.length} successful`);
            
            // Wait between batches to be respectful
            if (i < batches.length - 1) {
                await this.sleep(1000);
            }
        }
        
        console.log(`✅ Price update complete: ${results.size} prices updated`);
        return results;
    }

    // Find players by SBC criteria
    findPlayersByCriteria(criteria) {
        const results = [];
        
        for (const [cardId, player] of this.playersMap) {
            if (this.playerMatchesCriteria(player, criteria)) {
                results.push({ ...player }); // Return copy to avoid mutation
            }
        }
        
        // Sort by price (cheapest first), then by rating (highest first)
        return results.sort((a, b) => {
            if (a.price !== b.price) return a.price - b.price;
            return b.rating - a.rating;
        });
    }

    // Check if player matches SBC criteria
    playerMatchesCriteria(player, criteria) {
        if (criteria.minRating && player.rating < criteria.minRating) return false;
        if (criteria.maxRating && player.rating > criteria.maxRating) return false;
        if (criteria.maxPrice && player.price > criteria.maxPrice) return false;
        if (criteria.minPrice && player.price < criteria.minPrice) return false;
        
        if (criteria.positions && !this.playerHasPosition(player, criteria.positions)) return false;
        if (criteria.clubs && !criteria.clubs.includes(player.club)) return false;
        if (criteria.nations && !criteria.nations.includes(player.nation)) return false;
        if (criteria.leagues && !criteria.leagues.includes(player.league)) return false;
        
        // Special card types
        if (criteria.versions && !criteria.versions.includes(player.version)) return false;
        if (criteria.excludeVersions && criteria.excludeVersions.includes(player.version)) return false;
        
        return true;
    }

    // Check if player can play in specified positions
    playerHasPosition(player, positions) {
        const playerPositions = [player.position, ...player.alternativePositions];
        return positions.some(pos => playerPositions.includes(pos));
    }

    // Get cheapest squad for SBC segment
    async getCheapestSquadForSegment(requirements) {
        console.log(`🔍 Finding cheapest squad for segment requirements:`, requirements);
        
        // Find eligible players
        const eligiblePlayers = this.findPlayersByCriteria(requirements);
        console.log(`📊 Found ${eligiblePlayers.length} eligible players`);
        
        if (eligiblePlayers.length === 0) {
            console.log('⚠️ No eligible players found for criteria');
            return { players: [], totalCost: 0 };
        }
        
        // For segments that need fresh prices, update top candidates
        if (requirements.needsFreshPrices) {
            const topCandidates = eligiblePlayers.slice(0, 50).map(p => p.id);
            await this.updatePricesForPlayers(topCandidates);
            
            // Re-sort after price updates
            eligiblePlayers.sort((a, b) => {
                if (a.price !== b.price) return a.price - b.price;
                return b.rating - a.rating;
            });
        }
        
        // Select squad (11 players or specified count)
        const playersNeeded = requirements.playersNeeded || 11;
        const selectedPlayers = eligiblePlayers.slice(0, playersNeeded);
        const totalCost = selectedPlayers.reduce((sum, p) => sum + p.price, 0);
        
        console.log(`✅ Squad selected: ${selectedPlayers.length} players, ${totalCost.toLocaleString()} coins`);
        
        return {
            players: selectedPlayers,
            totalCost,
            alternatives: eligiblePlayers.slice(playersNeeded, playersNeeded + 10) // Extra options
        };
    }

    // Update database with latest prices (optional - for persistence)
    async updateDatabasePrices(priceUpdates) {
        if (priceUpdates.size === 0) return;
        
        console.log(`💾 Updating ${priceUpdates.size} prices in database...`);
        
        try {
            const client = await this.dbPool.connect();
            
            for (const [cardId, price] of priceUpdates) {
                await client.query(
                    'UPDATE players SET price = $1, updated_at = NOW() WHERE card_id = $2',
                    [price, cardId]
                );
            }
            
            client.release();
            console.log('✅ Database prices updated');
            
        } catch (error) {
            console.error('❌ Error updating database prices:', error);
        }
    }

    // Utility functions
    createBatches(array, batchSize) {
        const batches = [];
        for (let i = 0; i < array.length; i += batchSize) {
            batches.push(array.slice(i, i + batchSize));
        }
        return batches;
    }

    normalizePosition(position) {
        if (!position) return 'Unknown';
        return position.toUpperCase().trim();
    }

    getRarityFromVersion(version) {
        if (!version) return 'Gold';
        
        const specialVersions = [
            'Team of the Week', 'TOTW', 'In Form', 'IF',
            'Team of the Season', 'TOTS', 'Team of the Year', 'TOTY',
            'Icon', 'Hero', 'Promo'
        ];
        
        return specialVersions.some(special => 
            version.toLowerCase().includes(special.toLowerCase())
        ) ? 'Special' : 'Gold';
    }

    getLeagueFromClub(club) {
        // You might want to add a proper league mapping or add league to your DB
        // For now, return a default or try to infer
        const leagueMappings = {
            'Real Madrid': 'LaLiga',
            'Barcelona': 'LaLiga',
            'Manchester United': 'Premier League',
            'Manchester City': 'Premier League',
            'Liverpool': 'Premier League',
            'Bayern Munich': 'Bundesliga',
            'PSG': 'Ligue 1',
            // Add more mappings as needed
        };
        
        return leagueMappings[club] || 'Unknown League';
    }

    getAltPositions(mainPosition) {
        const positionMappings = {
            'CAM': ['CM', 'CF'],
            'CM': ['CAM', 'CDM'],
            'CDM': ['CM'],
            'CF': ['CAM', 'ST'],
            'ST': ['CF'],
            'LW': ['LM', 'LF'],
            'RW': ['RM', 'RF'],
            'LM': ['LW', 'LB'],
            'RM': ['RW', 'RB']
        };
        
        return positionMappings[mainPosition] || [];
    }

    getCachedPrice(key) {
        const cached = this.priceCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.price;
        }
        return null;
    }

    setCachedPrice(key, price) {
        this.priceCache.set(key, {
            price: parseInt(price) || 0,
            timestamp: Date.now()
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Cleanup
    async close() {
        await this.dbPool.end();
    }
}

// Integration with your SBC Solver
class PostgresSBCSolver {
    constructor() {
        this.dataSource = new PostgresFUTGGDataSource();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        console.log('🚀 Initializing PostgreSQL SBC Solver...');
        
        try {
            // Load all players from database
            await this.dataSource.loadPlayersFromDatabase();
            this.initialized = true;
            
            console.log('✅ SBC Solver ready with real FUT.GG data!');
        } catch (error) {
            console.error('❌ Failed to initialize SBC Solver:', error);
            throw error;
        }
    }

    async solveSBCSegment(segmentName, requirements) {
        if (!this.initialized) {
            await this.initialize();
        }
        
        console.log(`🎯 Solving SBC segment: ${segmentName}`);
        
        // Add fresh prices flag for important segments
        requirements.needsFreshPrices = requirements.priority === 'high';
        
        const solution = await this.dataSource.getCheapestSquadForSegment(requirements);
        
        return {
            segmentName,
            totalCost: solution.totalCost,
            cheapestPlayers: solution.players,
            alternatives: solution.alternatives,
            requirements: this.formatRequirements(requirements),
            solvedAt: new Date()
        };
    }

    formatRequirements(requirements) {
        const formatted = [];
        
        if (requirements.minRating) formatted.push(`Min Rating: ${requirements.minRating}`);
        if (requirements.maxPrice) formatted.push(`Max Price: ${requirements.maxPrice.toLocaleString()}`);
        if (requirements.positions) formatted.push(`Positions: ${requirements.positions.join(', ')}`);
        if (requirements.nations) formatted.push(`Nations: ${requirements.nations.join(', ')}`);
        if (requirements.leagues) formatted.push(`Leagues: ${requirements.leagues.join(', ')}`);
        
        return formatted;
    }

    async close() {
        await this.dataSource.close();
    }
}

module.exports = {
    PostgresFUTGGDataSource,
    PostgresSBCSolver
};

// Example usage:
/*
const solver = new PostgresSBCSolver();

// Initialize with your database
await solver.initialize();

// Solve a segment
const solution = await solver.solveSBCSegment('Rising Talent', {
    minRating: 84,
    maxPrice: 5000,
    positions: ['ST', 'CF'],
    playersNeeded: 11,
    priority: 'high' // Will fetch fresh prices
});

console.log(`Solution: ${solution.totalCost} coins`);
solution.cheapestPlayers.forEach(player => {
    console.log(`${player.name} (${player.rating}) - ${player.price} coins`);
});
*/
