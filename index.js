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

// Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'FC25 SBC Solver running'
  });
});

app.get('/api/sbc/live', async (req, res) => {
  // Initialize scraper lazily
  try {
    const LiveScraper = require('./scraper');
    const scraper = new LiveScraper();
    
    const sbcs = await scraper.getActiveSBCs({ expand: false, limit: 10 });
    
    res.json({
      success: true,
      count: sbcs.length,
      sbcs: sbcs.map(sbc => ({
        name: sbc.name,
        source: sbc.source,
        expiry: sbc.expiresText,
        url: sbc.url,
        segments: sbc.segmentCount
      })),
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.warn('Scraper failed, using mock data:', error.message);
    
    // Fallback mock data
    const mockSBCs = [
      {
        name: 'Icon Moments Ronaldinho',
        source: 'Mock Data',
        expiry: '14 days',
        url: '#',
        segments: 4
      },
      {
        name: 'POTM Challenge',
        source: 'Mock Data', 
        expiry: '7 days',
        url: '#',
        segments: 3
      }
    ];
    
    res.json({
      success: true,
      count: mockSBCs.length,
      sbcs: mockSBCs,
      lastUpdated: new Date().toISOString(),
      note: 'Using mock data - scraper unavailable'
    });
  }
});

app.get('/api/sbc/test', (req, res) => {
  res.json({
    message: 'SBC API working!',
    endpoints: ['/api/health', '/api/sbc/live'],
    timestamp: new Date().toISOString()
  });
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log(`🌍 Health check: /api/health`);
  console.log('🎯 FC25 SBC Solver ready!');
});
