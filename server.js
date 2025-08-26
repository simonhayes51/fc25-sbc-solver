// server.js - Express server with Postgres + FUT.GG integration (patched)
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

// Import Postgres-based SBC solver and live SBC scraper
const { PostgresSBCSolver } = require('./src/postgres-futgg-integration');
const LiveSBCScraper = require('./src/live-sbc-scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize SBC systems with Postgres and live scraper
const sbcSolver = new PostgresSBCSolver();
const liveSBCScraper = new LiveSBCScraper();
let isInitialized = false;

// Initialize on startup
async function initializeSystem() {
  if (isInitialized) return;

  try {
    console.log('🚀 Initializing SBC System...');

    if (!process.env.DATABASE_URL) {
      console.log('⚠️ No DATABASE_URL found, running in demo mode');
      isInitialized = true;
      return;
    }

    console.log('💾 Database URL found, connecting to Postgres...');
    await sbcSolver.initialize();
    console.log('✅ SBC System ready with real data!');
    isInitialized = true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    console.log('🔄 Falling back to demo mode...');
    isInitialized = true;
    console.log('✅ SBC System ready in demo mode!');
  }
}

/* =========================
   Health / Readiness Probes
   ========================= */

// Liveness: MUST always be cheap and 200
app.get('/api/health', (req, res) => {
  try {
    res.status(200).json({
      status: 'ok',
      initialized: Boolean(isInitialized),
      timestamp: new Date().toISOString(),
      database: process.env.DATABASE_URL ? 'configured' : 'not configured',
      uptimeSec: Math.round(process.uptime()),
      rssMB: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch {
    // Keep liveness 200 even if something unexpected happens
    res.status(200).json({ status: 'ok', note: 'minimal' });
  }
});

// Optional readiness: proves deps are ready; safe for platforms that support a separate check
app.get('/api/ready', (req, res) => {
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  const dataSourceReady = Boolean(sbcSolver?.dataSource);
  const ready = isInitialized && (!dbConfigured || dataSourceReady); // ready in demo OR DB+dataSource ready

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    initialized: Boolean(isInitialized),
    dbConfigured,
    dataSourceReady
  });
});

/* =========================
   Helpers
   ========================= */

async function getHighPriorityPlayers() {
  try {
    const list = sbcSolver?.dataSource?.findPlayersByCriteria?.({
      minRating: 82,
      maxRating: 89,
      maxPrice: 50000
    }) ?? [];
    return list.slice(0, 100).map(p => p.id);
  } catch (error) {
    console.error('Error getting high priority players:', error);
    return [];
  }
}

/* =========================
   API Routes
   ========================= */

// Get all SBC solutions (live when DB ready; demo otherwise)
app.get('/api/sbc/solutions', async (req, res) => {
  try {
    if (!isInitialized) {
      console.log('⚠️ API called but system not initialized');
      return res.status(503).json({
        error: 'System initializing, please wait...',
        retry_after: 30,
        initialized: false
      });
    }

    // Demo mode or no dataSource → return demo payload
    if (!process.env.DATABASE_URL || !sbcSolver?.dataSource) {
      console.log('📊 Returning demo SBC solutions...');
      return res.json([
        {
          sbcName: 'Icon Moments Ronaldinho',
          isMultiSegment: true,
          totalCost: 450000,
          segments: {
            'Born Legend': {
              segmentName: 'Born Legend',
              totalCost: 25000,
              cheapestPlayers: [
                { name: 'Matheus Nunes', rating: 83, position: 'CM', price: 2800 },
                { name: 'Timber', rating: 83, position: 'CB', price: 2600 },
                { name: 'Soucek', rating: 83, position: 'CDM', price: 2200 }
              ],
              requirements: ['Min Rating: 83', 'Demo Mode'],
              reward: 'Small Rare Gold Pack'
            },
            'Rising Talent': {
              segmentName: 'Rising Talent',
              totalCost: 85000,
              cheapestPlayers: [
                { name: 'Alisson', rating: 89, position: 'GK', price: 15000 },
                { name: 'Van Dijk', rating: 90, position: 'CB', price: 25000 },
                { name: 'Salah', rating: 89, position: 'RW', price: 35000 }
              ],
              requirements: ['Min Team Rating: 84', 'Demo Mode'],
              reward: 'Prime Mixed Players Pack'
            }
          },
          completionReward: 'Icon Moments Ronaldinho (94 OVR)',
          expiry: '14 days',
          lastUpdated: new Date()
        },
        {
          sbcName: 'First XI Demo',
          isMultiSegment: false,
          totalCost: 45000,
          solution: {
            totalCost: 45000,
            chemistry: 100,
            rating: 82,
            squad: [
              { name: 'Courtois', rating: 89, position: 'GK', price: 12000 },
              { name: 'Benzema', rating: 87, position: 'ST', price: 18000 },
              { name: 'Modric', rating: 88, position: 'CM', price: 15000 }
            ]
          },
          requirements: ['Min Team Rating: 82', 'Demo Mode'],
          lastUpdated: new Date()
        }
      ]);
    }

    // Real SBC segment definitions (example)
    const sbcSegments = [
      {
        sbcName: 'Icon Moments Ronaldinho',
        segments: [
          {
            name: 'Born Legend',
            requirements: { minRating: 83, playersNeeded: 11, maxPrice: 5000, priority: 'medium' }
          },
          {
            name: 'Rising Talent',
            requirements: { minRating: 84, playersNeeded: 11, maxPrice: 15000, priority: 'high' }
          },
          {
            name: 'Top Form',
            requirements: { minRating: 86, playersNeeded: 11, versions: ['Team of the Week', 'In Form'], priority: 'high' }
          }
        ]
      },
      {
        sbcName: 'POTM Bruno Fernandes',
        segments: [
          {
            name: 'Liga Portugal',
            requirements: { minRating: 83, playersNeeded: 11, leagues: ['Liga Portugal'], maxPrice: 8000, priority: 'medium' }
          },
          {
            name: 'Premier League',
            requirements: { minRating: 85, playersNeeded: 11, leagues: ['Premier League'], maxPrice: 12000, priority: 'high' }
          }
        ]
      },
      {
        sbcName: 'First XI',
        segments: [
          {
            name: 'Single Squad',
            requirements: { minRating: 82, playersNeeded: 11, maxPrice: 8000, priority: 'medium' }
          }
        ]
      }
    ];

    const solutions = [];

    // Solve each defined SBC
    for (const sbc of sbcSegments) {
      const sbcSolution = {
        sbcName: sbc.sbcName,
        isMultiSegment: sbc.segments.length > 1,
        totalCost: 0,
        segments: {}, // <-- JSON-safe (no Map)
        lastUpdated: new Date()
      };

      for (const segment of sbc.segments) {
        try {
          if (!sbcSolver?.solveSBCSegment) {
            throw new Error('solveSBCSegment not available');
          }

          const segmentSolution = await sbcSolver.solveSBCSegment(segment.name, segment.requirements);

          sbcSolution.segments[segment.name] = {
            segmentName: segment.name,
            totalCost: segmentSolution.totalCost,
            cheapestPlayers: segmentSolution.cheapestPlayers,
            requirements: segmentSolution.requirements,
            reward: segment.reward || 'Premium Pack'
          };

          sbcSolution.totalCost += Number(segmentSolution.totalCost || 0);
        } catch (segmentError) {
          console.error(`Error solving segment ${segment.name}:`, segmentError);
          sbcSolution.segments[segment.name] = {
            segmentName: segment.name,
            totalCost: 0,
            cheapestPlayers: [],
            requirements: ['Error loading segment'],
            error: 'Could not solve segment'
          };
        }
      }

      solutions.push(sbcSolution);
    }

    console.log(`✅ Generated ${solutions.length} SBC solutions`);
    res.json(solutions);
  } catch (error) {
    console.error('Error generating SBC solutions:', error);
    res.status(500).json({ error: 'Failed to generate solutions', message: error.message });
  }
});

// Get specific SBC solution
app.get('/api/sbc/solution/:name', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(503).json({ error: 'System initializing, please wait...' });
    }

    if (!sbcSolver?.solveSBCSegment) {
      return res.status(503).json({ error: 'Solver not ready' });
    }

    const sbcName = decodeURIComponent(req.params.name);
    console.log(`🎯 Solving specific SBC: ${sbcName}`);

    const solution = await sbcSolver.solveSBCSegment(sbcName, {
      minRating: 82,
      playersNeeded: 11,
      maxPrice: 10000,
      priority: 'high'
    });

    if (!solution || !Array.isArray(solution.cheapestPlayers) || solution.cheapestPlayers.length === 0) {
      return res.status(404).json({ error: 'SBC solution not found' });
    }

    res.json({ sbcName, solution, lastUpdated: new Date() });
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

    if (!sbcSolver?.dataSource?.updatePricesForPlayers) {
      return res.status(503).json({ error: 'Data source not ready' });
    }

    console.log('🔄 Manual price update requested');

    const highPriorityPlayers = await getHighPriorityPlayers();

    if (highPriorityPlayers.length > 0) {
      const updated = await sbcSolver.dataSource.updatePricesForPlayers(highPriorityPlayers, 10);
      return res.json({
        message: 'Prices updated successfully',
        updated: (updated && updated.size) || 0,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ message: 'No players needed price updates', updated: 0, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error updating prices:', error);
    res.status(500).json({ error: 'Failed to update prices' });
  }
});

// Get live SBCs from scraper
app.get('/api/sbc/live', async (req, res) => {
  try {
    console.log('🔍 Fetching live SBCs...');
    const liveSBCs = await liveSBCScraper.getActiveSBCs();
    res.json({
      count: Array.isArray(liveSBCs) ? liveSBCs.length : 0,
      sbcs: liveSBCs ?? [],
      lastUpdated: new Date().toISOString(),
      sources: ['FUTBIN', 'FUT.GG']
    });
  } catch (error) {
    console.error('Error fetching live SBCs:', error);
    res.status(500).json({ error: 'Failed to fetch live SBCs', message: error.message });
  }
});

// Refresh live SBC cache
app.post('/api/sbc/refresh', async (req, res) => {
  try {
    console.log('🔄 Refreshing live SBC cache...');
    if (liveSBCScraper?.sbcCache?.clear) liveSBCScraper.sbcCache.clear();
    const freshSBCs = await liveSBCScraper.getActiveSBCs();
    res.json({
      message: 'SBC cache refreshed successfully',
      count: Array.isArray(freshSBCs) ? freshSBCs.length : 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error refreshing SBC cache:', error);
    res.status(500).json({ error: 'Failed to refresh SBC cache' });
  }
});

// Player DB stats
app.get('/api/players/stats', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(503).json({ error: 'System initializing, please wait...' });
    }

    const totalPlayers = sbcSolver?.dataSource?.playersMap?.size ?? 0;
    const values = sbcSolver?.dataSource?.playersMap?.values?.();
    const playersArr = values ? Array.from(values) : [];
    const playersWithPrices = playersArr.filter(p => Number(p.price) > 0).length;

    res.json({
      totalPlayers,
      playersWithPrices,
      lastUpdated: new Date().toISOString(),
      database: process.env.DATABASE_URL ? 'PostgreSQL + FUT.GG' : 'Demo'
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

/* =========================
   Scheduled tasks (prod)
   ========================= */
if (process.env.NODE_ENV === 'production') {
  // Update prices every 2 hours for high-priority players
  cron.schedule('0 */2 * * *', async () => {
    if (isInitialized && sbcSolver?.dataSource?.updatePricesForPlayers) {
      console.log('🔄 Scheduled price update starting...');
      try {
        const highPriorityPlayers = await getHighPriorityPlayers();
        if (highPriorityPlayers.length > 0) {
          const updated = await sbcSolver.dataSource.updatePricesForPlayers(
            highPriorityPlayers.slice(0, 50), // Limit batch
            5 // concurrency
          );
          console.log(`✅ Scheduled price update completed: ${(updated && updated.size) || 0} prices updated`);
        } else {
          console.log('⚠️ No high-priority players found for scheduled update');
        }
      } catch (error) {
        console.error('❌ Scheduled price update failed:', error);
      }
    }
  });

  // Health/Init nudge every 15 minutes
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
  initializeSystem(); // Initialize after server starts
});

// Graceful shutdown
async function shutdown() {
  try {
    console.log('👋 Server shutting down gracefully...');
    if (isInitialized && sbcSolver?.close) {
      await sbcSolver.close();
    }
  } catch (e) {
    console.error('Error during shutdown:', e);
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;