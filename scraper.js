const axios = require('axios');

class LiveSBCScraper {
  constructor() {
    this.cache = new Map();
    this.cacheTime = 5 * 60 * 1000; // 5 minutes
  }

  async getActiveSBCs({ expand = false, limit = null } = {}) {
    const cacheKey = `sbcs_${expand}_${limit}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTime) {
      return cached.data;
    }

    try {
      // Simple fetch from FUT.GG (basic scraping)
      const response = await axios.get('https://www.fut.gg/sbc/', {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // Basic parsing - just find some SBC names
      const html = response.data;
      const sbcs = [];
      
      // Simple regex to find SBC patterns
      const sbcMatches = html.match(/sbc\/[^"]+/g) || [];
      const nameMatches = html.match(/>([^<]+(?:SBC|Challenge|Icon|POTM)[^<]*)</g) || [];
      
      for (let i = 0; i < Math.min(sbcMatches.length, nameMatches.length, limit || 10); i++) {
        const name = nameMatches[i]?.replace(/[><]/g, '').trim();
        const url = `https://www.fut.gg/${sbcMatches[i]}`;
        
        if (name && name.length > 3) {
          sbcs.push({
            name,
            source: 'FUT.GG',
            url,
            expiresText: 'Unknown',
            segmentCount: null,
            updatedAt: new Date().toISOString()
          });
        }
      }

      this.cache.set(cacheKey, {
        data: sbcs,
        timestamp: Date.now()
      });

      return sbcs;

    } catch (error) {
      console.error('Scraping failed:', error.message);
      
      // Return mock data on failure
      return [
        {
          name: 'Icon Moments Ronaldinho',
          source: 'Mock Data',
          url: 'https://www.fut.gg/sbc/example',
          expiresText: '14 days',
          segmentCount: 4,
          updatedAt: new Date().toISOString()
        },
        {
          name: 'POTM Challenge',
          source: 'Mock Data',
          url: 'https://www.fut.gg/sbc/example2', 
          expiresText: '7 days',
          segmentCount: 3,
          updatedAt: new Date().toISOString()
        }
      ];
    }
  }
}

module.exports = LiveSBCScraper;
