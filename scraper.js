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
      console.log('🔄 Using cached SBC data');
      return cached.data;
    }

    console.log('🔍 Fetching fresh SBC data...');

    try {
      // Try multiple approaches to get SBC data
      let sbcs = [];
      
      // Method 1: Try FUT.GG API endpoints (if they exist)
      try {
        console.log('📡 Trying FUT.GG API approach...');
        const apiResponse = await axios.get('https://www.fut.gg/api/sbc', {
          timeout: 8000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://www.fut.gg/'
          }
        });
        
        if (apiResponse.data && Array.isArray(apiResponse.data)) {
          sbcs = this.parseFutGGAPI(apiResponse.data, limit);
        }
      } catch (apiError) {
        console.log('⚠️ FUT.GG API failed:', apiError.message);
      }

      // Method 2: Try FUTBIN as fallback
      if (sbcs.length === 0) {
        try {
          console.log('📡 Trying FUTBIN fallback...');
          sbcs = await this.scrapeFutbin(limit);
        } catch (futbinError) {
          console.log('⚠️ FUTBIN scraping failed:', futbinError.message);
        }
      }

      // Method 3: Enhanced mock data if all else fails
      if (sbcs.length === 0) {
        console.log('📋 Using enhanced mock data');
        sbcs = this.getEnhancedMockData(limit);
      }

      // Cache the results
      this.cache.set(cacheKey, {
        data: sbcs,
        timestamp: Date.now()
      });

      console.log(`✅ Retrieved ${sbcs.length} SBCs`);
      return sbcs;

    } catch (error) {
      console.error('❌ All SBC fetching methods failed:', error.message);
      return this.getEnhancedMockData(limit);
    }
  }

  parseFutGGAPI(data, limit) {
    try {
      return data
        .filter(sbc => sbc && sbc.name)
        .slice(0, limit || 20)
        .map(sbc => ({
          name: sbc.name || sbc.title || 'Unknown SBC',
          source: 'FUT.GG API',
          url: `https://www.fut.gg/sbc/${sbc.slug || sbc.id}`,
          expiresText: sbc.expires_at || sbc.expiry || 'Unknown',
          segmentCount: sbc.segments?.length || sbc.segment_count || null,
          updatedAt: new Date().toISOString(),
          difficulty: sbc.difficulty || 'Unknown',
          estimatedCost: sbc.estimated_cost || null
        }));
    } catch (error) {
      console.error('Error parsing FUT.GG API data:', error);
      return [];
    }
  }

  async scrapeFutbin(limit) {
    try {
      const response = await axios.get('https://www.futbin.com/25/squad-building-challenges', {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      const html = response.data;
      const sbcs = [];

      // Look for SBC patterns in FUTBIN HTML
      const sbcMatches = html.match(/href="\/25\/sbc\/[^"]+"/g) || [];
      const nameMatches = html.match(/>([^<]{3,50}(?:SBC|Challenge|Icon|POTM|Squad)[^<]*)</g) || [];

      console.log(`🔍 Found ${sbcMatches.length} FUTBIN SBC links, ${nameMatches.length} names`);

      for (let i = 0; i < Math.min(sbcMatches.length, limit || 10); i++) {
        const urlMatch = sbcMatches[i];
        let name = nameMatches[i] ? nameMatches[i].replace(/[><]/g, '').trim() : `SBC ${i + 1}`;
        
        // Clean up the name
        name = name.replace(/^\s*-\s*/, '').trim();
        
        if (name.length > 3 && name.length < 100) {
          const url = `https://www.futbin.com${urlMatch.match(/href="([^"]+)"/)[1]}`;
          
          sbcs.push({
            name: name,
            source: 'FUTBIN',
            url: url,
            expiresText: 'Check site for details',
            segmentCount: null,
            updatedAt: new Date().toISOString()
          });
        }
      }

      return sbcs;
    } catch (error) {
      console.error('FUTBIN scraping failed:', error);
      return [];
    }
  }

  getEnhancedMockData(limit) {
    const mockSBCs = [
      {
        name: 'Icon Moments Ronaldinho',
        source: 'Mock Data',
        url: 'https://www.fut.gg/sbc/icon-moments-ronaldinho',
        expiresText: '14 days remaining',
        segmentCount: 4,
        updatedAt: new Date().toISOString(),
        difficulty: 'Expert',
        estimatedCost: 2500000
      },
      {
        name: 'POTM Mbappé',
        source: 'Mock Data',
        url: 'https://www.fut.gg/sbc/potm-mbappe',
        expiresText: '7 days remaining',
        segmentCount: 3,
        updatedAt: new Date().toISOString(),
        difficulty: 'Advanced',
        estimatedCost: 850000
      },
      {
        name: 'Team of the Week Challenge',
        source: 'Mock Data',
        url: 'https://www.fut.gg/sbc/totw-challenge',
        expiresText: '3 days remaining',
        segmentCount: 1,
        updatedAt: new Date().toISOString(),
        difficulty: 'Intermediate',
        estimatedCost: 45000
      },
      {
        name: 'League and Nation Hybrid',
        source: 'Mock Data',
        url: 'https://www.fut.gg/sbc/league-nation-hybrid',
        expiresText: '21 days remaining',
        segmentCount: 4,
        updatedAt: new Date().toISOString(),
        difficulty: 'Beginner',
        estimatedCost: 25000
      },
      {
        name: 'Icon Upgrade Pack',
        source: 'Mock Data',
        url: 'https://www.fut.gg/sbc/icon-upgrade',
        expiresText: '10 days remaining',
        segmentCount: 2,
        updatedAt: new Date().toISOString(),
        difficulty: 'Advanced',
        estimatedCost: 650000
      },
      {
        name: 'Premium League Upgrade',
        source: 'Mock Data',
        url: 'https://www.fut.gg/sbc/premium-league-upgrade',
        expiresText: 'Repeatable',
        segmentCount: 1,
        updatedAt: new Date().toISOString(),
        difficulty: 'Beginner',
        estimatedCost: 8500
      }
    ];

    const limitedSBCs = limit ? mockSBCs.slice(0, limit) : mockSBCs;
    console.log(`📋 Returning ${limitedSBCs.length} enhanced mock SBCs`);
    
    return limitedSBCs;
  }

  // Method to test the scraper
  async testConnection() {
    try {
      console.log('🧪 Testing scraper connections...');
      
      const results = {
        futgg: false,
        futbin: false,
        timestamp: new Date().toISOString()
      };

      // Test FUT.GG
      try {
        const futggResponse = await axios.get('https://www.fut.gg/', { 
          timeout: 5000,
          maxRedirects: 5
        });
        results.futgg = futggResponse.status === 200;
        console.log(`✅ FUT.GG: ${results.futgg ? 'OK' : 'Failed'}`);
      } catch (error) {
        console.log(`❌ FUT.GG: ${error.message}`);
      }

      // Test FUTBIN
      try {
        const futbinResponse = await axios.get('https://www.futbin.com/', { 
          timeout: 5000,
          maxRedirects: 5
        });
        results.futbin = futbinResponse.status === 200;
        console.log(`✅ FUTBIN: ${results.futbin ? 'OK' : 'Failed'}`);
      } catch (error) {
        console.log(`❌ FUTBIN: ${error.message}`);
      }

      return results;
    } catch (error) {
      console.error('Test connection failed:', error);
      return {
        futgg: false,
        futbin: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = LiveSBCScraper;
