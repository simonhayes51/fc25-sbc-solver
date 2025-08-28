#!/usr/bin/env node

// Test script for SBC scraper
const LiveSBCScraper = require('../src/live-sbc-scraper');

async function testScraper() {
  console.log('🧪 Testing Live SBC Scraper...\n');
  
  try {
    const scraper = new LiveSBCScraper({
      ttlMs: 1000, // Short cache for testing
      detailDelayMs: 500
    });
    
    console.log('📋 Step 1: Testing SBC list fetch...');
    const sbcs = await scraper.listAll();
    
    console.log(`✅ Found ${sbcs.length} SBCs`);
    
    if (sbcs.length > 0) {
      console.log('\n📊 Sample SBCs:');
      sbcs.slice(0, 3).forEach((sbc, i) => {
        console.log(`  ${i + 1}. ${sbc.name} (${sbc.source})`);
        console.log(`     URL: ${sbc.url}`);
        console.log(`     Expires: ${sbc.expiresText || 'Unknown'}`);
        console.log(`     Segments: ${sbc.segmentCount || 'Unknown'}`);
        console.log('');
      });
      
      // Test expansion if we have SBCs
      if (process.argv.includes('expand')) {
        const expandCount = process.argv.includes('10') ? 10 : 3;
        console.log(`🔍 Step 2: Testing detail expansion (${expandCount} SBCs)...`);
        
        const expanded = await scraper.getActiveSBCs({ 
          expand: true, 
          limit: expandCount 
        });
        
        console.log(`✅ Expanded ${expanded.filter(s => s.segments?.length > 0).length}/${expandCount} SBCs with details`);
        
        const withSegments = expanded.filter(s => s.segments?.length > 0);
        if (withSegments.length > 0) {
          console.log('\n📋 Sample expanded SBC:');
          const sample = withSegments[0];
          console.log(`  ${sample.name}:`);
          sample.segments.forEach((seg, i) => {
            console.log(`    Segment ${i + 1}: ${seg.name}`);
            console.log(`      Requirements: ${seg.requirements?.length || 0}`);
            console.log(`      Reward: ${seg.reward || 'None'}`);
            if (seg.requirements?.length > 0) {
              seg.requirements.slice(0, 3).forEach(req => {
                console.log(`        - ${req}`);
              });
            }
          });
        }
      } else {
        console.log('\n💡 Run with "expand" argument to test detail fetching');
        console.log('   Example: npm run test-scraper expand');
      }
    }
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

testScraper();
