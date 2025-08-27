// Load all players from your Postgres database with timeout handling
async loadPlayersFromDatabase() {
    console.log('Loading players from Postgres database...');
    
    try {
        // First, check table exists and get column info
        const columnQuery = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'fut_players'
            ORDER BY ordinal_position;
        `;
        
        const columnResult = await this.dbPool.query(columnQuery);
        const availableColumns = columnResult.rows.map(row => row.column_name);
        console.log('Available columns in fut_players:', availableColumns);
        
        // Get total count first
        const countQuery = 'SELECT COUNT(*) as total FROM fut_players WHERE card_id IS NOT NULL';
        const countResult = await this.dbPool.query(countQuery);
        const totalPlayers = parseInt(countResult.rows[0].total);
        console.log(`Total players to load: ${totalPlayers}`);
        
        // Load in smaller batches to avoid timeout
        const batchSize = 1000;
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
                    league: this.getLeagueFromClub(player.club),
                    alternativePositions: this.getAltPositions(player.position)
                });
            }
            
            loaded += players.length;
            console.log(`Loaded batch: ${loaded}/${totalPlayers} players`);
            
            // Small delay between batches
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