// Complete Postgres + FUT.GG Integration for SBC Solver
const { Pool } = require('pg');

class PostgresFUTGGDataSource {
    constructor() {
        this.dbPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        this.futggApiBase = 'https://www.fut.gg/api/fut/player-prices/25';
        this.rateLimitDelay = 200;
        this.priceCache = new Map();
        this.cacheExpiry = 10 * 60 * 1000;
        this.playersMap = new Map();
    }

    async loadPlayersFromDatabase() {
        console.log('Loading players from Postgres database...');
        
        try {
            const columnQuery = `
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'fut_players'
                ORDER BY ordinal_position;
            `;
            
            const columnResult = await this.dbPool.query(columnQuery);
            const availableColumns = columnResult.rows.map(row => row.column_name);
            console.log('Available columns in fut_players:', availableColumns);
            
            const countQuery = 'SELECT COUNT(*) as total FROM fut_players WHERE card_id IS NOT NULL';
            const countResult = await this.dbPool.query(countQuery);
            const totalPlayers = parseInt(countResult.rows[0].total);
            console.log(`Total players to load: ${totalPlayers}`);
            
            const batchSize = 100;
            let loaded = 0;
            
            for (let offset = 0; offset < totalPlayers; offset += batchSize) {
                const query = `
                    SELECT 
                        id, name, rating, version, image_url, created_at, 
                        player_slug, player_url, card_id, price, club, nation, position
                    FROM fut_players 
                    WHERE card_id IS NOT NULL 
                    ORDER BY rating DESC, name ASC
                    LIMIT ${batchSize} OFFSET ${offset}
                `;
                
                const result = await this.dbPool.query(query);
                const players = result.rows;
                
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
                        league: this.getLeagueFromClub(player.club),
                        alternativePositions: this.getAltPositions(player.position)
                    });
                }
                
                loaded += players.length;
                console.log(`Loaded batch: ${loaded}/${totalPlayers} players`);
                
                if (offset + batchSize < totalPlayers) {
                    await this.sleep(100);
                }
            }
            
            console.log(`Successfully loaded ${this.playersMap.size} players into memory`);
            return this.playersMap;
            
        } catch (error) {
            console.error('Error loading players from fut_players table:', error);
            throw error;
        }
    }

    async getPlayerPriceFromAPI(cardId) {
        const cacheKey = `price_${cardId}`;
        const cached = this.getCachedPrice(cacheKey);
        
        if (cached) return cached;

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
                    console.log(`Player ${cardId} not found in FUT.GG API`);
                    return 0;
                }
                throw new Error(`FUT.GG API error: ${response.status}`);
            }

            const priceData = await response.json();
            const price = this.extractPriceFromResponse(priceData);
            
            this.setCachedPrice(cacheKey, price);
            return price;
            
        } catch (error) {
            console.error(`Error fetching price for card ${cardId}:`, error.message);
            const player = this.playersMap.get(cardId);
            return player?.price || 0;
        }
    }

    extractPriceFromResponse(data) {
        console.log('FUT.GG API response:', data);
        
        if (data.buy) return parseInt(data.buy);
        if (data.buyPrice) return parseInt(data.buyPrice);
        if (data.price) return parseInt(data.price);
        if (data.current_price) return parseInt(data.current_price);
        
        if (Array.isArray(data) && data.length > 0) {
            const latest = data[0];
            return parseInt(latest.buy || latest.price || 0);
        }
        
        console.log('Could not extract price from response:', data);
        return 0;
    }

    async updatePricesForPlayers(cardIds, maxConcurrent = 5) {
        console.log(`Updating prices for ${cardIds.length} players...`);
        
        const results = new Map();
        const batches = this.createBatches(cardIds, maxConcurrent);
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            console.log(`Processing batch ${i + 1}/${batches.length}`);
            
            const batchPromises = batch.map(async (cardId) => {
                try {
                    const price = await this.getPlayerPriceFromAPI(cardId);
                    return { cardId, price, success: true };
                } catch (error) {
                    return { cardId, price: 0, success: false };
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            
            for (const { cardId, price } of batchResults) {
                results.set(cardId, price);
                
                if (this.playersMap.has(cardId)) {
                    this.playersMap.get(cardId).price = price;
                    this.playersMap.get(cardId).lastPriceUpdate = new Date();
                }
            }
            
            if (i < batches.length - 1) {
                await this.sleep(1000);
            }
        }
        
        console.log(`Price update complete: ${results.size} prices updated`);
        return results;
    }

    findPlayersByCriteria(criteria) {
        const results = [];
        
        for (const [cardId, player] of this.playersMap) {
            if (this.playerMatchesCriteria(player, criteria)) {
                results.push({ ...player });
            }
        }
        
        return results.sort((a, b) => {
            if (a.price !== b.price) return a.price - b.price;
            return b.rating - a.rating;
        });
    }

    playerMatchesCriteria(player, criteria) {
        if (criteria.minRating && player.rating < criteria.minRating) return false;
        if (criteria.maxRating && player.rating > criteria.maxRating) return false;
        if (criteria.maxPrice && player.price > criteria.maxPrice) return false;
        if (criteria.minPrice && player.price < criteria.minPrice) return false;
        
        if (criteria.positions && !this.playerHasPosition(player, criteria.positions)) return false;
        if (criteria.clubs && !criteria.clubs.includes(player.club)) return false;
        if (criteria.nations && !criteria.nations.includes(player.nation)) return false;
        if (criteria.leagues && !criteria.leagues.includes(player.league)) return false;
        if (criteria.versions && !criteria.versions.includes(player.version)) return false;
        
        return true;
    }

    playerHasPosition(player, positions) {
        const playerPositions = [player.position, ...player.alternativePositions];
        return positions.some(pos => playerPositions.includes(pos));
    }

    async getCheapestSquadForSegment(requirements) {
        console.log('Finding cheapest squad for segment requirements:', requirements);
        
        const eligiblePlayers = this.findPlayersByCriteria(requirements);
        console.log(`Found ${eligiblePlayers.length} eligible players`);
        
        if (eligiblePlayers.length === 0) {
            return { players: [], totalCost: 0 };
        }
        
        if (requirements.needsFreshPrices) {
            const topCandidates = eligiblePlayers.slice(0, 50).map(p => p.id);
            await this.updatePricesForPlayers(topCandidates);
            
            eligiblePlayers.sort((a, b) => {
                if (a.price !== b.price) return a.price - b.price;
                return b.rating - a.rating;
            });
        }
        
        const playersNeeded = requirements.playersNeeded || 11;
        const selectedPlayers = eligiblePlayers.slice(0, playersNeeded);
        const totalCost = selectedPlayers.reduce((sum, p) => sum + p.price, 0);
        
        console.log(`Squad selected: ${selectedPlayers.length} players, ${totalCost.toLocaleString()} coins`);
        
        return {
            players: selectedPlayers,
            totalCost,
            alternatives: eligiblePlayers.slice(playersNeeded, playersNeeded + 10)
        };
    }

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
        
        const specialVersions = ['Team of the Week', 'TOTW', 'In Form', 'IF', 'Icon', 'Hero'];
        return specialVersions.some(special => 
            version.toLowerCase().includes(special.toLowerCase())
        ) ? 'Special' : 'Gold';
    }

    getLeagueFromClub(club) {
        const leagueMappings = {
            'Real Madrid': 'LaLiga',
            'Barcelona': 'LaLiga',
            'Manchester United': 'Premier League',
            'Manchester City': 'Premier League',
            'Liverpool': 'Premier League',
            'Bayern Munich': 'Bundesliga',
            'PSG': 'Ligue 1'
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
            'RW': ['RM', 'RF']
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

    async close() {
        await this.dbPool.end();
    }
}

class PostgresSBCSolver {
    constructor() {
        this.dataSource = new PostgresFUTGGDataSource();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        console.log('Initializing PostgreSQL SBC Solver...');
        
        try {
            await this.dataSource.loadPlayersFromDatabase();
            this.initialized = true;
            console.log('SBC Solver ready with real FUT.GG data!');
        } catch (error) {
            console.error('Failed to initialize SBC Solver:', error);
            throw error;
        }
    }

    async solveSBCSegment(segmentName, requirements) {
        if (!this.initialized) {
            await this.initialize();
        }
        
        console.log(`Solving SBC segment: ${segmentName}`);
        
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
