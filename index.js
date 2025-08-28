const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

console.log('🚀 Starting FC25 SBC Solver...');

// Initialize scraper instance
let scraper = null;
try {
  const LiveScraper = require('./scraper');
  scraper = new LiveScraper();
  console.log('✅ Scraper initialized');
} catch (error) {
  console.error('❌ Scraper initialization failed:', error.message);
}

// Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    message: 'FC25 SBC Solver running',
    scraperLoaded: scraper !== null,
    version: '2.0.0'
  });
});

app.get('/api/sbc/live', async (req, res) => {
  const { expand = 'false', limit } = req.query;
  const shouldExpand = expand === 'true';
  const limitNum = limit ? parseInt(limit, 10) : 10;
  
  console.log(`📡 SBC request: expand=${shouldExpand}, limit=${limitNum}`);

  try {
    if (!scraper) {
      throw new Error('Scraper not initialized');
    }

    const sbcs = await scraper.getActiveSBCs({ 
      expand: shouldExpand, 
      limit: limitNum 
    });
    
    res.json({
      success: true,
      count: sbcs.length,
      sbcs: sbcs.map(sbc => ({
        name: sbc.name,
        source: sbc.source,
        expiry: sbc.expiresText,
        url: sbc.url,
        segments: sbc.segmentCount,
        difficulty: sbc.difficulty,
        estimatedCost: sbc.estimatedCost
      })),
      lastUpdated: new Date().toISOString(),
      cached: sbcs.length > 0 && sbcs[0].source !== 'Mock Data'
    });
    
  } catch (error) {
    console.error('❌ SBC fetch failed:', error.message);
    
    // Enhanced fallback mock data
    const fallbackSBCs = [
      {
        name: 'Icon Moments Ronaldinho',
        source: 'Fallback Data',
        expiry: '14 days remaining',
        url: '#',
        segments: 4,
        difficulty: 'Expert',
        estimatedCost: 2500000
      },
      {
        name: 'POTM Challenge',
        source: 'Fallback Data',
        expiry: '7 days remaining',
        url: '#',
        segments: 3,
        difficulty: 'Advanced', 
        estimatedCost: 850000
      },
      {
        name: 'Team of the Week',
        source: 'Fallback Data',
        expiry: '3 days remaining',
        url: '#',
        segments: 1,
        difficulty: 'Intermediate',
        estimatedCost: 45000
      }
    ];
    
    res.json({
      success: true,
      count: fallbackSBCs.length,
      sbcs: fallbackSBCs.slice(0, limitNum),
      lastUpdated: new Date().toISOString(),
      cached: false,
      note: 'Using fallback data - scraper temporarily unavailable',
      error: error.message
    });
  }
});

// Test scraper connectivity
app.get('/api/sbc/test', async (req, res) => {
  try {
    if (!scraper) {
      return res.json({
        success: false,
        message: 'Scraper not initialized',
        scraperLoaded: false
      });
    }

    console.log('🧪 Testing scraper connectivity...');
    const testResults = await scraper.testConnection();
    
    res.json({
      success: true,
      message: 'Scraper test completed',
      scraperLoaded: true,
      connectivity: testResults,
      endpoints: ['/api/health', '/api/sbc/live', '/api/sbc/test'],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Scraper test failed:', error.message);
    
    res.json({
      success: false,
      message: 'Scraper test failed',
      error: error.message,
      scraperLoaded: scraper !== null,
      timestamp: new Date().toISOString()
    });
  }
});

// Refresh scraper cache manually
app.post('/api/sbc/refresh', async (req, res) => {
  try {
    if (!scraper) {
      return res.status(500).json({
        success: false,
        error: 'Scraper not initialized'
      });
    }

    console.log('🔄 Manual cache refresh requested');
    
    // Clear cache
    scraper.cache.clear();
    
    // Fetch fresh data
    const sbcs = await scraper.getActiveSBCs({ limit: 10 });
    
    res.json({
      success: true,
      message: 'Cache refreshed successfully',
      count: sbcs.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Cache refresh failed:', error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    availableEndpoints: [
      '/api/health',
      '/api/sbc/live', 
      '/api/sbc/test',
      'POST /api/sbc/refresh'
    ]
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FC25 SBC Solver running on http://0.0.0.0:${PORT}`);
  console.log(`🌍 Health check: http://0.0.0.0:${PORT}/api/health`);
  console.log(`📊 Dashboard: http://0.0.0.0:${PORT}`);
  console.log('🎯 Ready to find SBC solutions!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📡 SIGTERM received - shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📡 SIGINT received - shutting down gracefully');
  process.exit(0);
});
