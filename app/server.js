// server.js - Ultra minimal with zero external dependencies
const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// Simple CORS headers
function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Simple JSON response
function sendJSON(res, statusCode, data) {
  setCORSHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

// Simple HTML response
function sendHTML(res, html) {
  setCORSHeaders(res);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

// Create server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  console.log(`${new Date().toISOString()} - ${req.method} ${pathname}`);
  
  // Handle OPTIONS requests for CORS
  if (req.method === 'OPTIONS') {
    setCORSHeaders(res);
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Routes
  if (pathname === '/api/health') {
    sendJSON(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'FC25 SBC Solver is running - Ultra minimal version',
      uptime: process.uptime(),
      version: '1.0.0',
      nodeVersion: process.version
    });
    
  } else if (pathname === '/api/sbc/live') {
    const mockSBCs = [
      {
        sbcName: 'Icon Moments Ronaldinho',
        source: 'Mock Data',
        expiry: '14 days',
        segmentCount: 4,
        isActive: true,
        lastUpdated: new Date().toISOString()
      },
      {
        sbcName: 'POTM Challenge',
        source: 'Mock Data',
        expiry: '7 days', 
        segmentCount: 3,
        isActive: true,
        lastUpdated: new Date().toISOString()
      }
    ];
    
    sendJSON(res, 200, {
      success: true,
      count: mockSBCs.length,
      sbcs: mockSBCs,
      lastUpdated: new Date().toISOString(),
      message: 'Mock data - real scraper will be added later'
    });
    
  } else if (pathname === '/api/debug/test') {
    sendJSON(res, 200, {
      message: 'Ultra minimal server working perfectly!',
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
    
  } else if (pathname === '/' || pathname === '/index.html') {
    // Serve simple HTML dashboard
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>FC25 SBC Solver</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: linear-gradient(135deg, #1a1a2e, #16213e);
                color: white;
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 800px; margin: 0 auto; text-align: center; }
            .header {
                background: rgba(255,255,255,0.1);
                padding: 40px;
                border-radius: 15px;
                margin-bottom: 30px;
                backdrop-filter: blur(10px);
            }
            .status {
                background: rgba(46,213,115,0.2);
                padding: 20px;
                border-radius: 10px;
                margin: 20px 0;
                border: 2px solid rgba(46,213,115,0.5);
            }
            .endpoints {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 10px;
                margin: 20px 0;
            }
            .endpoint {
                background: rgba(0,212,255,0.1);
                padding: 15px;
                margin: 10px 0;
                border-radius: 8px;
                border-left: 4px solid #00d4ff;
            }
            .endpoint a {
                color: #00d4ff;
                text-decoration: none;
                font-family: monospace;
                font-weight: bold;
            }
            .endpoint a:hover { text-decoration: underline; }
            button {
                background: linear-gradient(45deg, #00d4ff, #0099cc);
                border: none;
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                margin: 5px;
                font-weight: bold;
            }
            button:hover { transform: translateY(-1px); }
            #results {
                background: rgba(0,0,0,0.3);
                padding: 15px;
                border-radius: 8px;
                margin: 20px 0;
                text-align: left;
                font-family: monospace;
                white-space: pre-wrap;
                display: none;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚽ FC25 SBC Solver</h1>
                <p>Ultra-Minimal Version - Successfully Deployed!</p>
            </div>
            
            <div class="status">
                <h2>🎉 DEPLOYMENT SUCCESS!</h2>
                <p>Server running with ZERO external dependencies</p>
                <p>Deployed at: ${new Date().toISOString()}</p>
            </div>
            
            <div class="endpoints">
                <h3>🔗 API Endpoints</h3>
                
                <div class="endpoint">
                    <strong>Health Check:</strong><br>
                    <a href="/api/health" target="_blank">/api/health</a><br>
                    <button onclick="testEndpoint('/api/health')">Test Now</button>
                </div>
                
                <div class="endpoint">
                    <strong>Live SBCs:</strong><br>
                    <a href="/api/sbc/live" target="_blank">/api/sbc/live</a><br>
                    <button onclick="testEndpoint('/api/sbc/live')">Test Now</button>
                </div>
                
                <div class="endpoint">
                    <strong>Debug Info:</strong><br>
                    <a href="/api/debug/test" target="_blank">/api/debug/test</a><br>
                    <button onclick="testEndpoint('/api/debug/test')">Test Now</button>
                </div>
            </div>
            
            <div id="results"></div>
            
            <div style="margin-top: 40px; opacity: 0.8;">
                <h3>✅ Next Steps</h3>
                <p>Now that basic deployment works, we can add:</p>
                <ul style="text-align: left; max-width: 400px; margin: 20px auto;">
                    <li>Express.js framework</li>
                    <li>SBC scraping functionality</li>
                    <li>FUT.GG and FUTBIN integration</li>
                    <li>Advanced dashboard features</li>
                </ul>
            </div>
        </div>
        
        <script>
            async function testEndpoint(endpoint) {
                const resultsDiv = document.getElementById('results');
                resultsDiv.style.display = 'block';
                resultsDiv.textContent = 'Testing ' + endpoint + '...\\n';
                
                try {
                    const response = await fetch(endpoint);
                    const data = await response.json();
                    resultsDiv.textContent = 'SUCCESS - ' + endpoint + ':\\n' + JSON.stringify(data, null, 2);
                } catch (error) {
                    resultsDiv.textContent = 'ERROR testing ' + endpoint + ':\\n' + error.message;
                }
            }
            
            // Auto-test health on load
            window.addEventListener('load', () => {
                setTimeout(() => testEndpoint('/api/health'), 1000);
            });
        </script>
    </body>
    </html>`;
    
    sendHTML(res, html);
    
  } else {
    // 404 Not Found
    sendJSON(res, 404, {
      error: 'Not Found',
      path: pathname,
      message: 'This endpoint does not exist',
      availableEndpoints: ['/api/health', '/api/sbc/live', '/api/debug/test']
    });
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 FC25 SBC Solver starting...');
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Health check: http://0.0.0.0:${PORT}/api/health`);
  console.log(`🎯 Ultra-minimal version - ZERO dependencies!`);
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

console.log('🎯 FC25 SBC Solver initialized - Ultra-minimal mode');
