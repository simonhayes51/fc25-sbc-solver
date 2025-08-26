// SBC Solution Finder for FC25
// This system finds the cheapest squad solutions for Squad Building Challenges

class SBCSolver {
    constructor() {
        this.players = new Map(); // Cache of all players with current prices
        this.sbcData = new Map(); // Cache of SBC requirements
        this.solutions = new Map(); // Cache of found solutions
    }

    // Fetch player data from multiple sources
    async fetchPlayerData() {
        console.log('Fetching player data...');
        try {
            // Primary source: FUTBIN API (example endpoint)
            const futbinData = await this.fetchFromFUTBIN();
            
            // Fallback: FUTWIZ API
            const futwizData = await this.fetchFromFUTWIZ();
            
            // Merge data sources with price comparison
            this.mergePlayerData(futbinData, futwizData);
            
            console.log(`Loaded ${this.players.size} players`);
        } catch (error) {
            console.error('Error fetching player data:', error);
            // Use mock data for development
            this.loadMockPlayerData();
        }
    }

    // Fetch from FUTBIN (community API)
    async fetchFromFUTBIN() {
        // Note: Replace with actual FUTBIN API endpoints
        // This is a conceptual implementation
        const response = await fetch('https://api.futbin.com/players');
        return await response.json();
    }

    // Fetch from FUTWIZ
    async fetchFromFUTWIZ() {
        const response = await fetch('https://api.futwiz.com/players');
        return await response.json();
    }

    // Load SBC requirements from EA or community sources
    async fetchSBCData(sbcName) {
        console.log(`Fetching SBC data for: ${sbcName}`);
        try {
            // Scrape from EA's web app or use community APIs
            const sbcData = await this.scrapeSBCRequirements(sbcName);
            this.sbcData.set(sbcName, sbcData);
            return sbcData;
        } catch (error) {
            console.error('Error fetching SBC data:', error);
            return this.getMockSBCData(sbcName);
        }
    }

    // Solve multi-segment SBC with sub-challenges
    async solveMultiSegmentSBC(sbcName) {
        console.log(`Solving multi-segment SBC: ${sbcName}`);
        
        const sbcData = await this.fetchSBCData(sbcName);
        const solutions = new Map();
        let totalCost = 0;

        for (const segment of sbcData.segments) {
            console.log(`Solving segment: ${segment.name}`);
            
            const segmentSolution = await this.solveSegment(segment);
            solutions.set(segment.name, segmentSolution);
            totalCost += segmentSolution.totalCost;
        }

        return {
            sbcName,
            totalCost,
            segments: solutions,
            completionReward: sbcData.completionReward,
            expiry: sbcData.expiry
        };
    }

    // Solve individual segment/sub-challenge
    async solveSegment(segment) {
        console.log(`Solving segment: ${segment.name}`);
        
        const solution = {
            segmentName: segment.name,
            totalCost: 0,
            cheapestPlayers: [],
            requirements: segment.requirements,
            reward: segment.reward
        };

        // Get eligible players for this segment
        const eligiblePlayers = this.filterEligiblePlayers(segment.requirements);
        
        // Different solving approach based on segment type
        if (segment.requiresFullSquad) {
            // Full 11-player squad needed
            const squadSolution = await this.optimizeSquad(eligiblePlayers, segment.requirements);
            if (squadSolution) {
                solution.cheapestPlayers = squadSolution.players;
                solution.totalCost = squadSolution.totalCost;
                solution.chemistry = this.calculateChemistry(squadSolution.players);
                solution.rating = this.calculateSquadRating(squadSolution.players);
            }
        } else {
            // Just need cheapest players that meet criteria (no positional requirements)
            const cheapestOptions = this.findCheapestOptions(eligiblePlayers, segment.requirements);
            solution.cheapestPlayers = cheapestOptions.players;
            solution.totalCost = cheapestOptions.totalCost;
        }

        return solution;
    }

    // Find cheapest players that meet criteria (for non-squad segments)
    findCheapestOptions(eligiblePlayers, requirements) {
        const playersNeeded = this.getPlayersNeeded(requirements);
        const sortedPlayers = [...eligiblePlayers].sort((a, b) => a.price - b.price);
        
        const selectedPlayers = [];
        let totalCost = 0;

        // Select cheapest players up to the required count
        for (let i = 0; i < Math.min(playersNeeded, sortedPlayers.length); i++) {
            selectedPlayers.push(sortedPlayers[i]);
            totalCost += sortedPlayers[i].price;
        }

        // Add additional options for flexibility
        const alternatives = sortedPlayers.slice(playersNeeded, playersNeeded + 5);

        return {
            players: selectedPlayers,
            totalCost,
            alternatives
        };
    }

    // Determine how many players are needed for a segment
    getPlayersNeeded(requirements) {
        // Check for specific player count requirement
        const playerCountReq = requirements.find(req => req.type === 'EXACT_PLAYERS');
        if (playerCountReq) {
            return playerCountReq.value;
        }

        // Check if it's a full squad requirement
        const hasPositionReqs = requirements.some(req => req.type === 'POSITION');
        if (hasPositionReqs) {
            return 11; // Full squad
        }

        // Default to showing top 5 cheapest options
        return 5;
    }

    // Core solving algorithm
    async solveSBC(sbcName, requirements) {
        console.log(`Solving SBC: ${sbcName}`);
        
        const solution = {
            totalCost: 0,
            squad: [],
            chemistry: 0,
            rating: 0,
            requirements: requirements
        };

        // Filter eligible players based on requirements
        const eligiblePlayers = this.filterEligiblePlayers(requirements);
        
        // Use constraint satisfaction to find optimal solution
        const optimizedSquad = await this.optimizeSquad(eligiblePlayers, requirements);
        
        if (optimizedSquad) {
            solution.squad = optimizedSquad.players;
            solution.totalCost = optimizedSquad.totalCost;
            solution.chemistry = this.calculateChemistry(optimizedSquad.players);
            solution.rating = this.calculateSquadRating(optimizedSquad.players);
            
            // Cache the solution
            this.solutions.set(sbcName, solution);
        }

        return solution;
    }

    // Filter players based on SBC requirements
    filterEligiblePlayers(requirements) {
        const eligible = [];
        
        for (const [playerId, player] of this.players) {
            let isEligible = true;
            
            // Check each requirement
            for (const req of requirements) {
                if (!this.playerMeetsRequirement(player, req)) {
                    isEligible = false;
                    break;
                }
            }
            
            if (isEligible) {
                eligible.push(player);
            }
        }
        
        // Sort by price (cheapest first)
        return eligible.sort((a, b) => a.price - b.price);
    }

    // Check if player meets specific requirement
    playerMeetsRequirement(player, requirement) {
        switch (requirement.type) {
            case 'MIN_RATING':
                return player.rating >= requirement.value;
            case 'MAX_RATING':
                return player.rating <= requirement.value;
            case 'LEAGUE':
                return requirement.values.includes(player.league);
            case 'NATION':
                return requirement.values.includes(player.nation);
            case 'CLUB':
                return requirement.values.includes(player.club);
            case 'POSITION':
                return requirement.values.includes(player.position);
            case 'CHEMISTRY':
                return player.chemistry >= requirement.value;
            default:
                return true;
        }
    }

    // Optimize squad using genetic algorithm or constraint satisfaction
    async optimizeSquad(eligiblePlayers, requirements) {
        // This is a simplified version - real implementation would be more complex
        const squad = [];
        let totalCost = 0;
        const positions = ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CM', 'CM', 'RW', 'ST', 'LW'];
        
        for (const position of positions) {
            // Find cheapest player for this position that meets requirements
            const positionPlayers = eligiblePlayers.filter(p => 
                p.position === position || p.alternativePositions?.includes(position)
            );
            
            if (positionPlayers.length === 0) {
                console.warn(`No players found for position: ${position}`);
                continue;
            }
            
            // Select cheapest available player
            const selectedPlayer = positionPlayers[0];
            squad.push(selectedPlayer);
            totalCost += selectedPlayer.price;
        }
        
        // Validate the squad meets all requirements
        if (this.validateSquad(squad, requirements)) {
            return { players: squad, totalCost };
        }
        
        // If validation fails, try more complex optimization
        return this.advancedOptimization(eligiblePlayers, requirements);
    }

    // Advanced optimization using backtracking
    advancedOptimization(eligiblePlayers, requirements) {
        // Implement backtracking algorithm for complex requirements
        // This would handle chemistry links, exact player counts, etc.
        console.log('Running advanced optimization...');
        
        // Placeholder for complex algorithm
        return null;
    }

    // Validate that squad meets all SBC requirements
    validateSquad(squad, requirements) {
        for (const req of requirements) {
            if (!this.squadMeetsRequirement(squad, req)) {
                return false;
            }
        }
        return true;
    }

    squadMeetsRequirement(squad, requirement) {
        switch (requirement.type) {
            case 'MIN_TEAM_RATING':
                return this.calculateSquadRating(squad) >= requirement.value;
            case 'MIN_CHEMISTRY':
                return this.calculateChemistry(squad) >= requirement.value;
            case 'EXACT_LEAGUES':
                return this.countUniqueLeagues(squad) === requirement.value;
            case 'MIN_LEAGUES':
                return this.countUniqueLeagues(squad) >= requirement.value;
            case 'EXACT_NATIONS':
                return this.countUniqueNations(squad) === requirement.value;
            default:
                return true;
        }
    }

    // Calculate squad chemistry (simplified)
    calculateChemistry(squad) {
        // Simplified chemistry calculation
        // Real implementation would consider links between players
        let chemistry = 0;
        for (const player of squad) {
            chemistry += this.calculatePlayerChemistry(player, squad);
        }
        return Math.min(chemistry, 100);
    }

    calculatePlayerChemistry(player, squad) {
        // Simplified: base chemistry + links
        let playerChem = 4; // Base chemistry
        
        // Check for same league/nation links
        const links = this.getPlayerLinks(player, squad);
        playerChem += links.strong * 2 + links.weak * 1;
        
        return Math.min(playerChem, 10);
    }

    getPlayerLinks(player, squad) {
        const links = { strong: 0, weak: 0 };
        
        for (const teammate of squad) {
            if (teammate.id === player.id) continue;
            
            if (player.nation === teammate.nation || player.club === teammate.club) {
                links.strong++;
            } else if (player.league === teammate.league) {
                links.weak++;
            }
        }
        
        return links;
    }

    // Calculate squad rating
    calculateSquadRating(squad) {
        if (squad.length === 0) return 0;
        const totalRating = squad.reduce((sum, player) => sum + player.rating, 0);
        return Math.round(totalRating / squad.length);
    }

    countUniqueLeagues(squad) {
        const leagues = new Set(squad.map(p => p.league));
        return leagues.size;
    }

    countUniqueNations(squad) {
        const nations = new Set(squad.map(p => p.nation));
        return nations.size;
    }

    // Price monitoring and updates
    async updatePrices() {
        console.log('Updating player prices...');
        
        // Fetch latest prices from multiple sources
        const priceUpdates = await this.fetchLatestPrices();
        
        // Update cached player data
        for (const [playerId, newPrice] of priceUpdates) {
            if (this.players.has(playerId)) {
                this.players.get(playerId).price = newPrice;
                this.players.get(playerId).lastUpdated = new Date();
            }
        }
        
        // Invalidate cached solutions that might now be outdated
        this.solutions.clear();
        
        console.log(`Updated prices for ${priceUpdates.size} players`);
    }

    // Mock data for development/testing
    loadMockPlayerData() {
        const mockPlayers = [
            { id: 1, name: 'Lionel Messi', rating: 90, position: 'RW', league: 'MLS', nation: 'Argentina', club: 'Inter Miami', price: 45000 },
            { id: 2, name: 'Kylian Mbappé', rating: 91, position: 'ST', league: 'LaLiga', nation: 'France', club: 'Real Madrid', price: 89000 },
            { id: 3, name: 'Erling Haaland', rating: 88, position: 'ST', league: 'Premier League', nation: 'Norway', club: 'Manchester City', price: 65000 },
            // Add more mock players...
        ];
        
        for (const player of mockPlayers) {
            this.players.set(player.id, player);
        }
    }

    getMockSBCData(sbcName) {
        // Multi-segment SBC examples
        const mockSBCData = {
            'Icon Moments Ronaldinho': {
                name: sbcName,
                segments: [
                    {
                        name: 'Born Legend',
                        requiresFullSquad: false,
                        requirements: [
                            { type: 'MIN_RATING', value: 83 },
                            { type: 'EXACT_PLAYERS', value: 11 },
                            { type: 'MIN_CHEMISTRY', value: 95 }
                        ],
                        reward: 'Small Rare Gold Pack'
                    },
                    {
                        name: 'Rising Talent',  
                        requiresFullSquad: true,
                        requirements: [
                            { type: 'MIN_TEAM_RATING', value: 84 },
                            { type: 'MIN_CHEMISTRY', value: 95 },
                            { type: 'EXACT_LEAGUES', value: 1 }
                        ],
                        reward: 'Prime Mixed Players Pack'
                    },
                    {
                        name: 'Top Form',
                        requiresFullSquad: true,
                        requirements: [
                            { type: 'MIN_TEAM_RATING', value: 86 },
                            { type: 'MIN_CHEMISTRY', value: 95 },
                            { type: 'MIN_IF_PLAYERS', value: 1 }
                        ],
                        reward: 'Jumbo Rare Players Pack'
                    },
                    {
                        name: 'World Class',
                        requiresFullSquad: true,
                        requirements: [
                            { type: 'MIN_TEAM_RATING', value: 87 },
                            { type: 'MIN_CHEMISTRY', value: 95 },
                            { type: 'MIN_ICON_PLAYERS', value: 1 }
                        ],
                        reward: 'Ultimate Pack'
                    }
                ],
                completionReward: 'Icon Moments Ronaldinho (94 OVR)',
                expiry: '14 days'
            },
            'POTM Challenge': {
                name: sbcName,
                segments: [
                    {
                        name: 'Liga Portugal',
                        requiresFullSquad: true,
                        requirements: [
                            { type: 'MIN_TEAM_RATING', value: 83 },
                            { type: 'MIN_CHEMISTRY', value: 95 },
                            { type: 'EXACT_LEAGUES', value: 1 },
                            { type: 'LEAGUE', values: ['Liga Portugal'] }
                        ],
                        reward: 'Rare Mixed Players Pack'
                    },
                    {
                        name: 'Premier League',
                        requiresFullSquad: true,
                        requirements: [
                            { type: 'MIN_TEAM_RATING', value: 85 },
                            { type: 'MIN_CHEMISTRY', value: 95 },
                            { type: 'EXACT_LEAGUES', value: 1 },
                            { type: 'LEAGUE', values: ['Premier League'] }
                        ],
                        reward: 'Prime Mixed Players Pack'
                    },
                    {
                        name: 'Top Quality',
                        requiresFullSquad: false,
                        requirements: [
                            { type: 'MIN_RATING', value: 86 },
                            { type: 'EXACT_PLAYERS', value: 3 }
                        ],
                        reward: 'Small Prime Gold Players Pack'
                    }
                ],
                completionReward: 'POTM Bruno Fernandes (87 OVR)',
                expiry: '7 days'
            }
        };
        
        return mockSBCData[sbcName] || mockSBCData['Icon Moments Ronaldinho'];
    }

    // Web scraping helper (conceptual)
    async scrapeSBCRequirements(sbcName) {
        // This would use Puppeteer/Playwright to scrape EA's web app
        // Implementation depends on EA's current web structure
        console.log(`Scraping SBC requirements for: ${sbcName}`);
        
        // Placeholder for actual scraping logic
        return this.getMockSBCData(sbcName);
    }

    async fetchLatestPrices() {
        // Mock price updates
        const updates = new Map();
        updates.set(1, 44000); // Messi price dropped
        updates.set(2, 91000); // Mbappé price increased
        return updates;
    }
}

// Usage example and API
class SBCDashboard {
    constructor() {
        this.solver = new SBCSolver();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        console.log('Initializing SBC Dashboard...');
        await this.solver.fetchPlayerData();
        this.initialized = true;
        console.log('Dashboard ready!');
    }

    async findSBCSolution(sbcName) {
        if (!this.initialized) {
            await this.initialize();
        }

        // Fetch SBC requirements
        const requirements = await this.solver.fetchSBCData(sbcName);
        
        // Solve the SBC
        const solution = await this.solver.solveSBC(sbcName, requirements.requirements);
        
        return {
            sbcName,
            solution,
            lastUpdated: new Date()
        };
    }

    async getAllSBCSolutions() {
        const activeSBCs = ['League and Nation Hybrid', 'First XI', 'Around the World'];
        const solutions = [];
        
        for (const sbc of activeSBCs) {
            const result = await this.findSBCSolution(sbc);
            solutions.push(result);
        }
        
        return solutions;
    }

    // Start price monitoring
    startPriceMonitoring(intervalMinutes = 30) {
        setInterval(async () => {
            await this.solver.updatePrices();
        }, intervalMinutes * 60 * 1000);
    }
}

// Export for use in web application
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SBCSolver, SBCDashboard };
}
