// server.js - Express server with Postgres + FUT.GG integration
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

// Import Postgres-based SBC solver instead of mock data
const { PostgresSBCSolver } = require('./src/postgres-futgg-integration');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize SBC systems with Postgres
const sbcSolver = new PostgresSBCSolver();
let isInitialized = false;

// Initialize on startup
async function initializeSystem() {
    if (isInitialized) return;
    
    try {
        console.log('🚀 Initializing SBC System with Postgres + FUT.GG...');
        await sbcSolver.initialize();
        console.log('✅ SBC System ready with real data!');
        isInitialized = true;
        
    } catch (error) {
        console.error('❌ Initialization failed:', error);
        console.log('🔄 System will retry initialization on next request');
    }
}

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        initialized: isInitialized,
        timestamp: new Date().toISOString(),
        database: process.env.DATABASE_URL ? 'connected' : 'not configured'
    });
});

// Get all SBC solutions with real data
app.get('/api/sbc/solutions', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({ 
                error: 'System initializing, please wait...',
                retry_after: 30 
            });
        }
        
        console.log('📊 Generating SBC solutions with real FUT.GG data...');
        
        // Define realistic SBC segments with requirements
        const sbcSegments = [
            {
                sbcName: 'Icon Moments Ronaldinho',
                segments: [
                    {
                        name: 'Born Legend',
                        requirements: {
                            minRating: 83,
                            playersNeeded: 11,
                            maxPrice: 5000, // Max 5k per player
                            priority: 'medium'
                        }
                    },
                    {
                        name: 'Rising Talent',
                        requirements: {
                            minRating: 84,
                            playersNeeded: 11,
                            maxPrice: 15000,
                            priority: 'high' // Get fresh prices
                        }
                    },
                    {
                        name: 'Top Form',
                        requirements: {
                            minRating: 86,
                            playersNeeded: 11,
                            versions: ['Team of the Week', 'In Form'], // IF players only
                            priority: 'high'
                        }
                    }
                ]
            },
            {
                sbcName: 'POTM Bruno Fernandes',
                segments: [
                    {
                        name: 'Liga Portugal',
                        requirements: {
                            minRating: 83,
                            playersNeeded: 11,
                            leagues: ['Liga Portugal'],
                            maxPrice: 8000,
                            priority: 'medium'
                        }
                    },
                    {
                        name: 'Premier League',
                        requirements: {
                            minRating: 85,
                            playersNeeded: 11,
                            leagues: ['Premier League'],
                            maxPrice: 12000,
                            priority: 'high'
                        }
                    }
                ]
            },
            {
                sbcName: 'First XI',
                segments: [
                    {
                        name: 'Single Squad',
                        requirements: {
                            minRating: 82,
                            playersNeeded: 11,
                            maxPrice: 8000,
                            priority: 'medium'
                        }
                    }
                ]
            }
        ];

        const solutions = [];

        // Solve each SBC
        for (const sbc of sbcSegments) {
            const sbcSolution = {
                sbcName: sbc.sbcName,
                isMultiSegment: sbc.segments.length > 1,
                totalCost: 0,
                segments: new Map(),
                lastUpdated: new Date()
            };

            // Solve each segment
            for (const segment of sbc.segments) {
                try {
                    const segmentSolution = await sbcSolver.solveSBCSegment(segment.name, segment.requirements);
                    
                    sbcSolution.segments.set(segment.name, {
                        segmentName: segment.name,
                        totalCost: segmentSolution.totalCost,
                        cheapestPlayers: segmentSolution.cheapestPlayers,
                        requirements: segmentSolution.requirements,
                        reward: segment.reward || 'Premium Pack'
                    });
                    
                    sbcSolution.totalCost += segmentSolution.totalCost;
                    
                } catch (segmentError) {
                    console.error(`Error solving segment ${segment.name}:`, segmentError);
                    
                    // Add fallback segment with error
                    sbcSolution.segments.set(segment.name, {
                        segmentName: segment.name,
                        totalCost: 0,
                        cheapestPlayers: [],
                        requirements: ['Error loading segment'],
                        error: 'Could not solve segment'
                    });
                }
            }

            solutions.push(sbcSolution);
        }
        
        console.log(`✅ Generated ${solutions.length} SBC solutions`);
        res.json(solutions);
        
    } catch (error) {
        console.error('Error generating SBC solutions:', error);
        res.status(500).json({ 
            error: 'Failed to generate solutions',
            message: error.message
        });
    }
});

// Get specific SBC solution
app.get('/api/sbc/solution/:name', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({ error: 'System initializing, please wait...' });
        }
        
        const sbcName = decodeURIComponent(req.params.name);
        console.log(`🎯 Solving specific SBC: ${sbcName}`);
        
        // This would be expanded based on the specific SBC
        const solution = await sbcSolver.solveSBCSegment(sbcName, {
            minRating: 82,
            playersNeeded: 11,
            maxPrice: 10000,
            priority: 'high'
        });
        
        if (!solution || solution.cheapestPlayers.length === 0) {
            return res.status(404).json({ error: 'SBC solution not found' });
        }
        
        res.json({
            sbcName,
            solution,
            lastUpdated: new Date()
        });
        
    } catch (error) {
        console.error('Error fetching specific solution:', error);
        res.status(500).json({ error: 'Failed to fetch solution' });
    }
});

// Update prices manually
app.post('/api/sbc/update-prices', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({ error: 'System initializing, please wait...' });
        }
        
        console.log('🔄 Manual price update requested');
        
        // Get player IDs that need price updates (high-priority for SBCs)
        const highPriorityPlayers = await getHighPriorityPlayers();
        
        if (highPriorityPlayers.length > 0) {
            const updated = await sbcSolver.dataSource.updatePricesForPlayers(highPriorityPlayers, 10);
            
            res.json({ 
                message: 'Prices updated successfully',
                updated: updated.size,
                timestamp: new Date().toISOString()
            });
        } else {
            res.json({ 
                message: 'No players needed price updates',
                updated: 0,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('Error updating prices:', error);
        res.status(500).json({ error: 'Failed to update prices' });
    }
});

// Get high-priority players for price updates
async function getHighPriorityPlayers() {
    try {
        // Get players commonly used in SBCs (ratings 82+, reasonable prices)
        const highPriorityPlayers = sbcSolver.dataSource.findPlayersByCriteria({
            minRating: 82,
            maxRating: 89,
            maxPrice: 50000 // Under 50k coins
        });
        
        // Return top 100 most relevant players
        return highPriorityPlayers.slice(0, 100).map(p => p.id);
        
    } catch (error) {
        console.error('Error getting high priority players:', error);
        return [];
    }
}

// Search SBCs
app.get('/api/sbc/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query required' });
        }
        
        // For now, return filtered mock results
        // This could be expanded to search your actual SBC database
        const mockSBCs = ['Icon Moments Ronaldinho', 'POTM Bruno Fernandes', 'First XI'];
        const filtered = mockSBCs.filter(sbc => 
            sbc.toLowerCase().includes(query.toLowerCase())
        );
        
        res.json(filtered.map(name => ({ sbcName: name })));
        
    } catch (error) {
        console.error('Error searching SBCs:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get player database stats
app.get('/api/players/stats', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({ error: 'System initializing, please wait...' });
        }
        
        const totalPlayers = sbcSolver.dataSource.playersMap.size;
        const playersWithPrices = Array.from(sbcSolver.dataSource.playersMap.values())
            .filter(p => p.price > 0).length;
        
        res.json({
            totalPlayers,
            playersWithPrices,
            lastUpdated: new Date().toISOString(),
            database: 'PostgreSQL + FUT.GG'
        });
        
    } catch (error) {
        console.error('Error fetching player stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Serve the dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Scheduled tasks for production
if (process.env.NODE_ENV === 'production') {
    // Update prices every 2 hours for high-priority players
    cron.schedule('0 */2 * * *', async () => {
        if (isInitialized) {
            console.log('🔄 Scheduled price update starting...');
            try {
                const highPriorityPlayers = await getHighPriorityPlayers();
                
                if (highPriorityPlayers.length > 0) {
                    const updated = await sbcSolver.dataSource.updatePricesForPlayers(
                        highPriorityPlayers.slice(0, 50), // Limit to 50 players per scheduled update
                        5 // 5 concurrent requests
                    );
                    console.log(`✅ Scheduled price update completed: ${updated.size} prices updated`);
                } else {
                    console.log('⚠️ No high-priority players found for scheduled update');
                }
            } catch (error) {
                console.error('❌ Scheduled price update failed:', error);
            }
        }
    });
    
    // Health check every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
        if (!isInitialized) {
            console.log('🔄 Attempting to reinitialize system...');
            await initializeSystem();
        }
    });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔗 API: http://localhost:${PORT}/api`);
    console.log(`💾 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
    
    // Initialize system after server starts
    initializeSystem();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('👋 Server shutting down gracefully...');
    
    if (isInitialized) {
        await sbcSolver.close();
    }
    
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('👋 Server shutting down gracefully...');
    
    if (isInitialized) {
        await sbcSolver.close();
    }
    
    process.exit(0);
});

module.exports = app;
