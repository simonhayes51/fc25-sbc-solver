// server.js - Minimal bulletproof version for Railway deployment
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

console.log('🚀 Starting FC25 SBC Solver...');

// Simple health check - MUST work for Railway
app.get('/api/health', (req, res) => {
  console.log('Health check requested');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'FC25 SBC Solver is running',
    uptime: process.uptime()
  });
});

// Mock SBC data for now - replace with scraper later
app.get('/api/sbc/live', (req, res) => {
  console.log('Live SBCs requested');
  
  const mockSBCs = [
    {
      sbcName: 'Icon Moments Ronaldinho',
      source: 'Mock Data',
      expiry: '14 days',
      segmentCount: 4,
      url: 'https://www.fut.gg/sbc/example',
      isActive: true,
      lastUpdated: new Date().toISOString()
    },
    {
      sbcName: 'POTM Challenge',
      source: 'Mock Data', 
      expiry: '7 days',
      segmentCount: 3,
      url: 'https://www.fut.gg/sbc/example2',
      isActive: true,
      lastUpdated: new Date().toISOString()
    }
  ];

  res.json({
    success: true,
    count: mockSBCs.length,
    sbcs: mockSBCs,
    lastUpdated: new Date().toISOString(),
    message: 'Mock data - scraper will be enabled after successful deployment'
  });
});

// Debug endpoint
app.get('/api/debug/test', (req, res) => {
  res.json({
    message: 'Server is working perfectly!',
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

// Root route - serve index.html or simple message
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  
  // Try to serve index.html, fallback to simple message
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>FC25 SBC Solver</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #1a1a2e; color: white; }
            .container { max-width: 600px; margin: 0 auto; }
            .status { background: #16213e; padding: 20px; border-radius: 10px; margin: 20px 0; }
            a { color: #00d4ff; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚽ FC25 SBC Solver</h1>
            <div class="status">
              <h2>✅ Server Running Successfully!</h2>
              <p>Deployment completed at: ${new Date().toISOString()}</p>
            </div>
            <h3>API Endpoints:</h3>
            <ul style="text-align: left;">
              <li><a href="/api/health">/api/health</a> - System status</li>
              <li><a href="/api/sbc/live">/api/sbc/live</a> - Live SBC data</li>
              <li><a href="/api/debug/test">/api/debug/test</a> - Debug info</li>
            </ul>
            <p><strong>🎯 Your FC25 SBC Solver is ready!</strong></p>
          </div>
        </body>
        </html>
      `);
    }
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    message: 'This endpoint does not exist'
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Health check: http://0.0.0.0:${PORT}/api/health`);
  console.log('🎯 FC25 SBC Solver ready for connections!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📡 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📡 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in production, just log
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

module.exports = app;
