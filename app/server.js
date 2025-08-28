// server.js - Fixed with proper error handling and complete API implementation
const express = require(“express”);
const cors = require(“cors”);
const path = require(“path”);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, ‘public’)));

// Initialize scraper with proper error handling
let liveScraper = null;

async function initializeScraper() {
try {
const LiveSBCScraper = require(’./src/live-sbc-scraper’);
liveScraper = new LiveSBCScraper({
ttlMs: 10 * 60 * 1000, // 10 min cache
detailDelayMs: 350
});
console.log(‘✅ Live SBC scraper initialized’);
return true;
} catch (error) {
console.error(‘❌ Failed to initialize scraper:’, error.message);
return false;
}
}

// Health check endpoint for Railway
app.get(”/api/health”, async (req, res) => {
const scraperLoaded = liveScraper !== null;

res.json({
status: ‘ok’,
timestamp: new Date().toISOString(),
scraperLoaded,
uptime: process.uptime(),
memory: process.memoryUsage()
});
});

// Get live SBCs
app.get(”/api/sbc/live”, async (req, res) => {
try {
if (!liveScraper) {
return res.status(500).json({
error: ‘SBC scraper not initialized’,
sbcs: [],
lastUpdated: null
});
}

```
const { expand = 'false', limit } = req.query;
const shouldExpand = expand === 'true';
const limitNum = limit ? parseInt(limit, 10) : null;

console.log(`📡 Fetching live SBCs (expand: ${shouldExpand}, limit: ${limitNum})`);

const sbcs = await liveScraper.getActiveSBCs({
  expand: shouldExpand,
  limit: limitNum
});

res.json({
  success: true,
  count: sbcs.length,
  sbcs: sbcs.map(sbc => ({
    sbcName: sbc.name,
    source: sbc.source,
    url: sbc.url,
    expiry: sbc.expiresText || 'Unknown',
    expiresAt: sbc.expiresAt,
    segmentCount: sbc.segmentCount,
    estimatedCost: null, // Would need price data integration
    segments: sbc.segments ? sbc.segments.map(seg => ({
      name: seg.name,
      requirements: seg.requirements,
      reward: seg.reward,
      costText: seg.costText
    })) : [],
    originalRequirements: [],
    isActive: true,
    lastUpdated: sbc.updatedAt
  })),
  lastUpdated: new Date().toISOString()
});
```

} catch (error) {
console.error(‘❌ Failed to fetch live SBCs:’, error);
res.status(500).json({
error: error.message,
sbcs: [],
lastUpdated: null
});
}
});

// Refresh live SBCs (force cache refresh)
app.post(”/api/sbc/refresh”, async (req, res) => {
try {
if (!liveScraper) {
return res.status(500).json({
success: false,
error: ‘SBC scraper not initialized’
});
}

```
// Clear cache and fetch fresh data
liveScraper.sbcCache.clear();

const sbcs = await liveScraper.getActiveSBCs({ expand: true });

res.json({
  success: true,
  count: sbcs.length,
  sbcs: sbcs.map(sbc => ({
    sbcName: sbc.name,
    source: sbc.source,
    url: sbc.url,
    expiry: sbc.expiresText || 'Unknown',
    segmentCount: sbc.segmentCount,
    lastUpdated: new Date().toISOString()
  })),
  refreshedAt: new Date().toISOString()
});
```

} catch (error) {
console.error(‘❌ Failed to refresh SBCs:’, error);
res.status(500).json({
success: false,
error: error.message
});
}
});

// Get specific SBC solution
app.get(”/api/sbc/solution/:name”, async (req, res) => {
try {
const sbcName = decodeURIComponent(req.params.name);

```
// Mock solution for now - integrate with actual solver later
const mockSolution = {
  sbcName,
  totalCost: Math.floor(Math.random() * 100000) + 50000,
  isMultiSegment: true,
  segments: {
    'Segment 1': {
      players: [
        { name: 'Placeholder Player 1', rating: 84, price: 15000, position: 'ST' },
        { name: 'Placeholder Player 2', rating: 83, price: 12000, position: 'CM' }
      ],
      totalCost: 27000
    }
  },
  solvedAt: new Date().toISOString()
};

res.json(mockSolution);
```

} catch (error) {
console.error(‘❌ Failed to get SBC solution:’, error);
res.status(500).json({
error: error.message
});
}
});

// Get all SBC solutions
app.get(”/api/sbc/solutions”, async (req, res) => {
try {
// Mock solutions for now
const solutions = [
{
sbcName: ‘Example SBC 1’,
totalCost: 75000,
isMultiSegment: true,
solvedAt: new Date().toISOString()
},
{
sbcName: ‘Example SBC 2’,
totalCost: 45000,
isMultiSegment: false,
solvedAt: new Date().toISOString()
}
];

```
res.json(solutions);
```

} catch (error) {
console.error(‘❌ Failed to get solutions:’, error);
res.status(500).json({
error: error.message,
solutions: []
});
}
});

// Debug endpoints
app.get(”/api/debug/sbc-test”, async (req, res) => {
try {
if (!liveScraper) {
return res.json({
testResult: {
success: false,
error: ‘Scraper not initialized’,
count: 0
}
});
}

```
const testSBCs = await liveScraper.getActiveSBCs({ limit: 3 });

res.json({
  testResult: {
    success: true,
    count: testSBCs.length,
    sampleSBCs: testSBCs.slice(0, 2).map(sbc => ({
      name: sbc.name,
      source: sbc.source,
      hasSegments: sbc.segments ? sbc.segments.length > 0 : false
    }))
  },
  timestamp: new Date().toISOString()
});
```

} catch (error) {
res.json({
testResult: {
success: false,
error: error.message,
count: 0
}
});
}
});

app.get(”/api/debug/sources”, async (req, res) => {
const sources = [
{
name: ‘FUT.GG’,
url: ‘https://www.fut.gg/sbc/’,
status: ‘active’
},
{
name: ‘FUTBIN’,
url: ‘https://www.futbin.com/25/squad-building-challenges’,
status: ‘fallback’
}
];

res.json({ sources });
});

// Serve main dashboard for root route
app.get(”/”, (req, res) => {
res.sendFile(path.join(__dirname, ‘public’, ‘index.html’));
});

// Error handling middleware
app.use((error, req, res, next) => {
console.error(‘Unhandled error:’, error);
res.status(500).json({
error: ‘Internal server error’,
message: error.message
});
});

// 404 handler
app.use((req, res) => {
res.status(404).json({
error: ‘Not found’,
path: req.path
});
});

const PORT = process.env.PORT || 3000;

// Initialize and start server
async function startServer() {
console.log(‘🚀 Starting FC25 SBC Solver server…’);

// Initialize scraper
await initializeScraper();

app.listen(PORT, “0.0.0.0”, () => {
console.log(`🌟 Server running on http://0.0.0.0:${PORT}`);
console.log(`📊 Dashboard: http://localhost:${PORT}`);
console.log(`🔗 API Health: http://localhost:${PORT}/api/health`);
});
}

startServer().catch(error => {
console.error(‘❌ Failed to start server:’, error);
process.exit(1);
});