// server.js — FIXED Failsafe-first Express with working live SBC data
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Minimal middleware (won't block health) ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- Failsafe logging for startup/crash issues ---
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

// --- FIXED: Boot flags / late-bound deps ---
let isInitialized = false;
let sbcSolver = null;
let liveSBCScraper = null; // FIXED: Consistent variable naming

// FIXED: Proper scraper initialization
try {
  const LiveSBCScraperClass = require('./src/live-sbc-scraper');
  liveSBCScraper = new LiveSBCScraperClass();
  console.log('✅ LiveSBCScraper loaded successfully');
} catch (e) {
  console.error('❌ Failed to load live-sbc-scraper:', e.message);
  console.error('📄 Full error details:', e);
  liveSBCScraper = {
    async getActiveSBCs() {
      console.warn('⚠️ Using fallback SBC scraper - no real data available');
      return [];
    }
  };
}

// --- Liveness first: MUST be cheap and always 200 ---
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    initialized: Boolean(isInitialized),
    dbConfigured: Boolean(process.env.DATABASE_URL),
    scraperLoaded: Boolean(liveSBCScraper?.getActiveSBCs),
    uptimeSec: Math.round(process.uptime()),
    rssMB: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    ts: new Date().toISOString(),
  });
});
// also accept /health (some platforms default to this)
app.get('/health', (req, res) => res.redirect(307, '/api/health'));

// --- Readiness: 200 only when deps ready (optional for platform) ---
app.get('/api/ready', (req, res) => {
  const dbConfigured = !!process.env.DATABASE_URL;
  const dataSourceReady = !!(sbcSolver && sbcSolver.dataSource);
  const scraperReady = !!(liveSBCScraper && liveSBCScraper.getActiveSBCs);
  const ready = isInitialized && scraperReady && (!dbConfigured || dataSourceReady);
  
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    initialized: Boolean(isInitialized),
    dbConfigured,
    dataSourceReady,
    scraperReady,
    ts: new Date().toISOString(),
  });
});

// --- Deferred initialization to avoid import-time crashes ---
async function initializeSystem() {
  if (isInitialized) return;
  try {
    console.log('🚀 Initializing system...');

    if (!process.env.DATABASE_URL) {
      console.log('⚠️ No DATABASE_URL; starting in demo mode.');
      isInitialized = true;
      return;
    }

    console.log('💾 DATABASE_URL found; connecting to Postgres…');
    
    // Defer heavy requires until after health routes are live
    const { PostgresSBCSolver } = require('./src/postgres-futgg-integration');
    
    sbcSolver = new PostgresSBCSolver();
    await sbcSolver.initialize();
    console.log('✅ Data source ready.');
    isInitialized = true;
  } catch (err) {
    console.error('❌ initializeSystem failed:', err?.message || err);
    console.log('🟡 Falling back to demo mode.');
    isInitialized = true; // stay live, but in demo
  }
}

/* =========================
   Helpers
   ========================= */
async function getHighPriorityPlayers() {
  try {
    const list = sbcSolver?.dataSource?.findPlayersByCriteria?.({
      minRating: 82,
      maxRating: 89,
      maxPrice: 50000,
    }) ?? [];
    return list.slice(0, 100).map(p => p.id);
  } catch (e) {
    console.error('getHighPriorityPlayers error:', e);
    return [];
  }
}

/* =========================
   API Routes
   ========================= */

// Demo or real SBC solutions
app.get('/api/sbc/solutions', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(503).json({ error: 'System initializing, try again shortly' });
    }

    // Demo fallback when DB not configured or dataSource not ready
    if (!process.env.DATABASE_URL || !sbcSolver?.dataSource) {
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
                { name: 'Soucek', rating: 83, position: 'CDM', price: 2200 },
              ],
              requirements: ['Min Rating: 83', 'Demo Mode'],
              reward: 'Small Rare Gold Pack',
            },
            'Rising Talent': {
              segmentName: 'Rising Talent',
              totalCost: 85000,
              cheapestPlayers: [
                { name: 'Alisson', rating: 89, position: 'GK', price: 15000 },
                { name: 'Van Dijk', rating: 90, position: 'CB', price: 25000 },
                { name: 'Salah', rating: 89, position: 'RW', price: 35000 },
              ],
              requirements: ['Min Team Rating: 84', 'Demo Mode'],
              reward: 'Prime Mixed Players Pack',
            },
          },
          completionReward: 'Icon Moments Ronaldinho (94 OVR)',
          expiry: '14 days',
          lastUpdated: new Date(),
        },
      ]);
    }

    // Example definitions to exercise the solver
    const sbcSegments = [
      {
        sbcName: 'Icon Moments Ronaldinho',
        segments: [
          { name: 'Born Legend',  requirements: { minRating: 83, playersNeeded: 11, maxPrice: 5000,  priority: 'medium' } },
          { name: 'Rising Talent', requirements: { minRating: 84, playersNeeded: 11, maxPrice: 15000, priority: 'high'   } },
          { name: 'Top Form',      requirements: { minRating: 86, playersNeeded: 11, versions: ['Team of the Week','In Form'], priority: 'high' } },
        ],
      },
    ];

    const solutions = [];
    for (const sbc of sbcSegments) {
      const sbcSolution = {
        sbcName: sbc.sbcName,
        isMultiSegment: sbc.segments.length > 1,
        totalCost: 0,
        segments: {},
        lastUpdated: new Date(),
      };

      for (const segment of sbc.segments) {
        try {
          if (!sbcSolver?.solveSBCSegment) throw new Error('solver not ready');
          const seg = await sbcSolver.solveSBCSegment(segment.name, segment.requirements);
          sbcSolution.segments[segment.name] = {
            segmentName: segment.name,
            totalCost: Number(seg.totalCost || 0),
            cheapestPlayers: seg.cheapestPlayers || [],
            requirements: seg.requirements || segment.requirements,
            reward: segment.reward || 'Premium Pack',
          };
          sbcSolution.totalCost += Number(seg.totalCost || 0);
        } catch (e) {
          console.error(`Segment "${segment.name}" failed:`, e?.message || e);
          sbcSolution.segments[segment.name] = {
            segmentName: segment.name,
            totalCost: 0,
            cheapestPlayers: [],
            requirements: ['Error loading segment'],
            error: 'Could not solve segment',
          };
        }
      }

      solutions.push(sbcSolution);
    }

    res.json(solutions);
  } catch (e) {
    console.error('/api/sbc/solutions error:', e);
    res.status(500).json({ error: 'Failed to generate solutions', message: e.message });
  }
});

// Single SBC
app.get('/api/sbc/solution/:name', async (req, res) => {
  try {
    if (!isInitialized) return res.status(503).json({ error: 'System initializing' });
    if (!sbcSolver?.solveSBCSegment) return res.status(503).json({ error: 'Solver not ready' });

    const sbcName = decodeURIComponent(req.params.name);
    const solution = await sbcSolver.solveSBCSegment(sbcName, {
      minRating: 82, playersNeeded: 11, maxPrice: 10000, priority: 'high',
    });

    if (!solution?.cheapestPlayers?.length) {
      return res.status(404).json({ error: 'SBC solution not found' });
    }

    res.json({ sbcName, solution, lastUpdated: new Date() });
  } catch (e) {
    console.error('/api/sbc/solution error:', e);
    res.status(500).json({ error: 'Failed to fetch solution' });
  }
});

// Manual price refresh
app.post('/api/sbc/update-prices', async (req, res) => {
  try {
    if (!isInitialized) return res.status(503).json({ error: 'System initializing' });
    if (!sbcSolver?.dataSource?.updatePricesForPlayers) return res.status(503).json({ error: 'Data source not ready' });

    const ids = await getHighPriorityPlayers();
    if (!ids.length) return res.json({ message: 'No players to update', updated: 0, ts: new Date().toISOString() });

    const updated = await sbcSolver.dataSource.updatePricesForPlayers(ids, 10);
    res.json({ message: 'Prices updated', updated: (updated && updated.size) || 0, ts: new Date().toISOString() });
  } catch (e) {
    console.error('/api/sbc/update-prices error:', e);
    res.status(500).json({ error: 'Failed to update prices' });
  }
});

// FIXED: Live SBCs endpoint
app.get('/api/sbc/live', async (req, res) => {
  try {
    console.log('🎯 Live SBC endpoint called');
    
    if (!liveSBCScraper?.getActiveSBCs) {
      console.warn('⚠️ LiveSBCScraper not available');
      return res.json({ 
        count: 0, 
        sbcs: [], 
        lastUpdated: new Date().toISOString(), 
        sources: ['FUT.GG'],
        error: 'SBC scraper not initialized'
      });
    }
    
    console.log('🔄 Calling liveSBCScraper.getActiveSBCs()...');
    const live = await liveSBCScraper.getActiveSBCs();
    console.log(`📊 Retrieved ${Array.isArray(live) ? live.length : 0} live SBCs`);
    
    res.json({
      count: Array.isArray(live) ? live.length : 0,
      sbcs: live ?? [],
      lastUpdated: new Date().toISOString(),
      sources: ['FUTBIN', 'FUT.GG'],
      debug: {
        scraperAvailable: Boolean(liveSBCScraper),
        dataType: typeof live,
        isArray: Array.isArray(live)
      }
    });
  } catch (e) {
    console.error('❌ /api/sbc/live error:', e);
    res.status(500).json({ 
      error: 'Failed to fetch live SBCs', 
      message: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

// ENHANCED: Manual SBC refresh endpoint
app.post('/api/sbc/refresh', async (req, res) => {
  try {
    console.log('🔄 Manual SBC refresh triggered...');
    
    if (!liveSBCScraper?.getActiveSBCs) {
      return res.status(503).json({ 
        error: 'SBC scraper not available',
        suggestion: 'Check server logs for scraper initialization errors'
      });
    }
    
    // Force fresh data (bypass cache)
    if (liveSBCScraper.sbcCache?.clear) {
      liveSBCScraper.sbcCache.clear();
      console.log('🗑️ Cache cleared');
    }
    
    const startTime = Date.now();
    const freshSBCs = await liveSBCScraper.getActiveSBCs();
    const duration = Date.now() - startTime;
    
    console.log(`✅ Manual refresh completed: ${Array.isArray(freshSBCs) ? freshSBCs.length : 0} SBCs in ${duration}ms`);
    
    res.json({
      success: true,
      count: Array.isArray(freshSBCs) ? freshSBCs.length : 0,
      sbcs: freshSBCs || [],
      refreshDuration: duration,
      timestamp: new Date(),
      sources: ['FUTBIN', 'FUT.GG']
    });
    
  } catch (error) {
    console.error('❌ Manual SBC refresh failed:', error);
    res.status(500).json({
      error: 'Refresh failed',
      message: error.message
    });
  }
});

// DEBUG: Test endpoint to debug the scraper directly
app.get('/api/debug/sbc-test', async (req, res) => {
  try {
    console.log('🧪 Testing live SBC scraper directly...');
    
    const diagnosis = {
      timestamp: new Date(),
      scraperStatus: {
        loaded: Boolean(liveSBCScraper),
        hasMethod: Boolean(liveSBCScraper?.getActiveSBCs),
        type: typeof liveSBCScraper
      }
    };
    
    // Test the scraper method
    if (liveSBCScraper?.getActiveSBCs) {
      try {
        console.log('🔄 Testing getActiveSBCs()...');
        const startTime = Date.now();
        const result = await liveSBCScraper.getActiveSBCs();
        const duration = Date.now() - startTime;
        
        diagnosis.testResult = {
          success: true,
          duration: duration,
          resultType: typeof result,
          isArray: Array.isArray(result),
          count: Array.isArray(result) ? result.length : 0,
          sampleData: Array.isArray(result) ? result.slice(0, 2) : result
        };
        
        console.log(`✅ Scraper test successful: ${diagnosis.testResult.count} SBCs`);
        
      } catch (error) {
        console.error('❌ Scraper test failed:', error);
        diagnosis.testResult = {
          success: false,
          error: error.message,
          stack: error.stack
        };
      }
    } else {
      diagnosis.testResult = {
        success: false,
        error: 'getActiveSBCs method not available'
      };
    }
    
    res.json(diagnosis);
    
  } catch (error) {
    console.error('🚨 Debug test failed:', error);
    res.status(500).json({
      error: 'Debug test failed',
      message: error.message
    });
  }
});

// DEBUG: Source connectivity test
app.get('/api/debug/sources', async (req, res) => {
  try {
    const axios = require('axios');
    
    const sources = [
      { name: 'FUTBIN_SBC', url: 'https://www.futbin.com/25/squad-building-challenges' },
      { name: 'FUTGG_SBC', url: 'https://www.fut.gg/sbc/' },
      { name: 'FUTBIN_MAIN', url: 'https://www.futbin.com/' }
    ];
    
    const results = {};
    
    for (const source of sources) {
      try {
        console.log(`🔗 Testing ${source.name}...`);
        
        const response = await axios.get(source.url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        results[source.name] = {
          accessible: true,
          status: response.status,
          contentLength: response.data?.length || 0,
          hasContent: response.data?.includes('sbc') || response.data?.includes('challenge') || false
        };
        
        console.log(`✅ ${source.name}: ${response.status} (${results[source.name].contentLength} chars)`);
        
      } catch (error) {
        console.error(`❌ ${source.name}: ${error.message}`);
        results[source.name] = {
          accessible: false,
          error: error.message,
          code: error.code
        };
      }
    }
    
    res.json({
      timestamp: new Date(),
      sourceTests: results,
      recommendation: Object.values(results).every(r => r.accessible) ? 
        'All sources accessible - scraper should work' :
        'Some sources blocked - check network/firewall'
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Source test failed' });
  }
});

// Serve dashboard (static index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled middleware error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

/* =========================
   Schedules (prod only)
   ========================= */
if (process.env.NODE_ENV === 'production') {
  cron.schedule('0 */2 * * *', async () => {
    if (isInitialized && sbcSolver?.dataSource?.updatePricesForPlayers) {
      try {
        console.log('🔄 Scheduled price update…');
        const ids = await getHighPriorityPlayers();
        if (ids.length) {
          const updated = await sbcSolver.dataSource.updatePricesForPlayers(ids.slice(0, 50), 5);
          console.log(`✅ Scheduled update: ${(updated && updated.size) || 0} prices`);
        } else {
          console.log('ℹ️ No high-priority players found for scheduled update');
        }
      } catch (e) {
        console.error('❌ Scheduled price update failed:', e);
      }
    }
  });

  // ENHANCED: Live SBC refresh schedule
  cron.schedule('*/15 * * * *', async () => {
    if (liveSBCScraper?.getActiveSBCs) {
      try {
        console.log('🎯 Scheduled SBC refresh...');
        liveSBCScraper.sbcCache?.clear?.();
        const sbcs = await liveSBCScraper.getActiveSBCs();
        console.log(`✅ Scheduled SBC refresh: ${Array.isArray(sbcs) ? sbcs.length : 0} SBCs`);
      } catch (e) {
        console.error('❌ Scheduled SBC refresh failed:', e);
      }
    }
  });

  cron.schedule('*/15 * * * *', async () => {
    if (!isInitialized) {
      console.log('🔁 Reinitializing (cron)…');
      await initializeSystem();
    }
  });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Server listening on 0.0.0.0:${PORT}`);
  console.log(`💾 DB configured: ${Boolean(process.env.DATABASE_URL)}`);
  console.log(`🎯 SBC Scraper loaded: ${Boolean(liveSBCScraper?.getActiveSBCs)}`);
  initializeSystem(); // fire and forget
});

// Graceful shutdown
async function shutdown() {
  try {
    console.log('👋 Shutting down gracefully…');
    if (isInitialized && sbcSolver?.close) await sbcSolver.close();
  } catch (e) {
    console.error('Shutdown error:', e);
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
