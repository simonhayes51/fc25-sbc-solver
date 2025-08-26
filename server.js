// server.js - Express server for Railway deployment
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

// Import our SBC classes
const { SBCSolver, SBCDashboard } = require('./src/sbc-solver');
const DataSourceManager = require('./src/data-sources');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize SBC systems
const dataManager = new DataSourceManager();
const sbcDashboard = new SBCDashboard();
let isInitialized = false;

// Initialize on startup
async function initializeSystem() {
    if (isInitialized) return;
    
    try {
        console.log('🚀 Initializing SBC System...');
        await sbcDashboard.initialize();
        console.log('✅ SBC System ready!');
        isInitialized = true;
        
        // Start price monitoring every 15 minutes
        sbcDashboard.startPriceMonitoring(15);
        console.log('📈 Price monitoring started');
        
    } catch (error) {
        console.error('❌ Initialization failed:', error);
    }
}

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        initialized: isInitialized,
        timestamp: new Date().toISOString()
    });
});

// Get all SBC solutions
app.get('/api/sbc/solutions', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({ error: 'System initializing, please wait...' });
        }
        
        const solutions = await sbcDashboard.getAllSBCSolutions();
        res.json(solutions);
    } catch (error) {
        console.error('Error fetching solutions:', error);
        res.status(500).json({ error: 'Failed to fetch solutions' });
    }
});

// Get specific SBC solution
app.get('/api/sbc/solution/:name', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({ error: 'System initializing, please wait...' });
        }
        
        const sbcName = decodeURIComponent(req.params.name);
        const solution = await sbcDashboard.findSBCSolution(sbcName);
        
        if (!solution) {
            return res.status(404).json({ error: 'SBC not found' });
        }
        
        res.json(solution);
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
        await sbcDashboard.solver.updatePrices();
        res.json({ message: 'Prices updated successfully' });
    } catch (error) {
        console.error('Error updating prices:', error);
        res.status(500).json({ error: 'Failed to update prices' });
    }
});

// Search SBCs
app.get('/api/sbc/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query required' });
        }
        
        const allSolutions = await sbcDashboard.getAllSBCSolutions();
        const filtered = allSolutions.filter(sbc => 
            sbc.sbcName.toLowerCase().includes(query.toLowerCase())
        );
        
        res.json(filtered);
    } catch (error) {
        console.error('Error searching SBCs:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get active SBCs from EA (scraping endpoint)
app.get('/api/sbc/active', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({ error: 'System initializing, please wait...' });
        }
        
        // This would scrape EA's web app for active SBCs
        const activeSBCs = await dataManager.scrapeEAWebApp();
        res.json(activeSBCs);
    } catch (error) {
        console.error('Error fetching active SBCs:', error);
        res.status(500).json({ error: 'Failed to fetch active SBCs' });
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

// Scheduled tasks
if (process.env.NODE_ENV === 'production') {
    // Update prices every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
        if (isInitialized) {
            console.log('🔄 Scheduled price update');
            try {
                await sbcDashboard.solver.updatePrices();
                console.log('✅ Scheduled price update completed');
            } catch (error) {
                console.error('❌ Scheduled price update failed:', error);
            }
        }
    });
    
    // Refresh SBC data every 2 hours
    cron.schedule('0 */2 * * *', async () => {
        if (isInitialized) {
            console.log('🔄 Refreshing SBC data');
            try {
                await sbcDashboard.getAllSBCSolutions();
                console.log('✅ SBC data refresh completed');
            } catch (error) {
                console.error('❌ SBC data refresh failed:', error);
            }
        }
    });
}

// Start server
app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔗 API: http://localhost:${PORT}/api`);
    
    // Initialize system after server starts
    initializeSystem();
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 Server shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('👋 Server shutting down gracefully');
    process.exit(0);
});

module.exports = app;
