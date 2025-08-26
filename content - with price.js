// content.js - Enhanced with better data handling, profit calculation, and name extraction
(function () {
  if (!/ea\.com$/i.test(location.hostname)) return;

  // Inject enhanced network collector
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
    console.log('[FUT Content] Enhanced inject script loaded');
  } catch (e) {
    console.error('[FUT Content] Failed to load inject script:', e);
  }

  // Enhanced persistent cache with better data structure
  const LS_KEY = '__fut_purchase_cache_v4';
  let cache = { 
    byItemId: {}, 
    byAssetId: {}, 
    byTradeId: {},
    playerNames: {},
    cardTypes: {}
  };

  // Cache for storing asset ID -> player name mappings
  const playerNameCache = new Map();

  function loadCache() {
    try { 
      const stored = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      cache = {
        byItemId: stored.byItemId || {},
        byAssetId: stored.byAssetId || {},
        byTradeId: stored.byTradeId || {},
        playerNames: stored.playerNames || {},
        cardTypes: stored.cardTypes || {}
      };
      console.log('[FUT Content] Cache loaded:', Object.keys(cache.byItemId).length, 'buy prices cached');
    } catch (e) {
      console.error('[FUT Content] Cache load error:', e);
    }
  }

  function saveCache() { 
    try { 
      localStorage.setItem(LS_KEY, JSON.stringify(cache));
      console.log('[FUT Content] Cache saved');
    } catch (e) {
      console.error('[FUT Content] Cache save error:', e);
    }
  }

  // Enhanced price setting with multiple ID types
  const setBought = (itemId, assetId, tradeId, price) => {
    if (!(price > 0)) return;
    
    const priceNum = Number(price);
    if (itemId != null) cache.byItemId[String(itemId)] = priceNum;
    if (assetId != null) cache.byAssetId[String(assetId)] = priceNum;
    if (tradeId != null) cache.byTradeId[String(tradeId)] = priceNum;
    
    console.log(`[FUT Content] Buy price cached: ${priceNum} for IDs: ${itemId}/${assetId}/${tradeId}`);
  };

  // Enhanced price getting with fallback logic
  const getBought = (itemId, assetId, tradeId) => {
    const sources = [
      tradeId != null ? cache.byTradeId[String(tradeId)] : null,
      itemId != null ? cache.byItemId[String(itemId)] : null,
      assetId != null ? cache.byAssetId[String(assetId)] : null
    ].filter(Boolean);
    
    const price = sources[0] || 0;
    if (price > 0) {
      console.log(`[FUT Content] Buy price found: ${price} for IDs: ${itemId}/${assetId}/${tradeId}`);
    }
    return price;
  };

  // Enhanced player name and card type caching
  const setPlayerInfo = (itemId, assetId, tradeId, playerName, cardType) => {
    if (playerName && playerName !== 'Unknown Player') {
      if (itemId != null) cache.playerNames[String(itemId)] = playerName;
      if (assetId != null) cache.playerNames[String(assetId)] = playerName;
      if (tradeId != null) cache.playerNames[String(tradeId)] = playerName;
    }
    
    if (cardType && cardType !== 'Standard') {
      if (itemId != null) cache.cardTypes[String(itemId)] = cardType;
      if (assetId != null) cache.cardTypes[String(assetId)] = cardType;
      if (tradeId != null) cache.cardTypes[String(tradeId)] = cardType;
    }
  };

  const getPlayerInfo = (itemId, assetId, tradeId) => {
    const nameKey = [
      tradeId != null ? String(tradeId) : null,
      itemId != null ? String(itemId) : null,
      assetId != null ? String(assetId) : null
    ].find(key => key && cache.playerNames[key]);
    
    const typeKey = [
      tradeId != null ? String(tradeId) : null,
      itemId != null ? String(itemId) : null,
      assetId != null ? String(assetId) : null
    ].find(key => key && cache.cardTypes[key]);
    
    return {
      playerName: nameKey ? cache.playerNames[nameKey] : null,
      cardType: typeKey ? cache.cardTypes[typeKey] : null
    };
  };

  loadCache();

  // Enhanced card type normalization
  function normalizeCardType(typeStr, rating) {
    if (!typeStr || typeof typeStr !== 'string') {
      // Rating-based fallback
      const r = Number(rating || 0);
      return r >= 75 ? 'Gold' : r >= 65 ? 'Silver' : r > 0 ? 'Bronze' : 'Standard';
    }
    
    const t = typeStr.toLowerCase();
    if (t.includes('totw') || /team\s*of\s*the\s*week|if_/.test(t)) return 'TOTW';
    if (t.includes('icon')) return 'Icon';
    if (t.includes('hero')) return 'Hero';
    if (t.includes('ucl') || t.includes('ucl_')) return 'UCL';
    if (t.includes('special')) return 'Special';
    if (t.includes('rare') && t.includes('gold')) return 'Rare Gold';
    if (t.includes('gold')) return 'Gold';
    if (t.includes('silver')) return 'Silver';
    if (t.includes('bronze')) return 'Bronze';
    if (t.includes('rare')) return 'Rare';
    
    return typeStr.length > 20 ? 'Special' : typeStr;
  }

  // Enhanced name extraction that tries multiple sources
  function enhancedNameFromItem(item = {}, auction = {}) {
    console.log('[FUT] Attempting name extraction for:', { item, auction });
    
    // Try standard name fields first
    if (item.preferredName && item.preferredName.trim()) return item.preferredName.trim();
    if (item.commonName && item.commonName.trim()) return item.commonName.trim();
    
    const first = item.firstName ? item.firstName.trim() : '';
    const last = item.lastName ? item.lastName.trim() : '';
    if (first && last) return `${first} ${last}`;
    if (last) return last;
    if (first) return first;
    
    if (item.name && item.name.trim()) return item.name.trim();
    if (item.displayName && item.displayName.trim()) return item.displayName.trim();
    
    // Check cached names by asset ID
    if (item.assetId && playerNameCache.has(item.assetId)) {
      const cachedName = playerNameCache.get(item.assetId);
      console.log('[FUT] Found cached name for assetId', item.assetId, ':', cachedName);
      return cachedName;
    }
    
    // Try to extract from any nested player data
    if (item.player) {
      return enhancedNameFromItem(item.player);
    }
    
    // Check if auction has additional data
    if (auction && auction.itemData && auction.itemData !== item) {
      return enhancedNameFromItem(auction.itemData);
    }
    
    // Last resort - try to get name from DOM if we have identifying info
    if (item.assetId) {
      const domName = extractNameFromDOM(item.assetId, item.rating);
      if (domName && domName !== 'Unknown Player') {
        playerNameCache.set(item.assetId, domName);
        return domName;
      }
    }
    
    console.warn('[FUT] Could not extract player name from:', item);
    return 'Unknown Player';
  }

  // Try to extract player name from DOM elements - IMPROVED with stat filtering
  function extractNameFromDOM(assetId, rating) {
    try {
      // Common stat abbreviations to filter out
      const statAbbrevs = [
        'DRI', 'SHO', 'PAS', 'DEF', 'PHY', 'PAC', 'OVR', 'DIV', 'HAN', 'KIC', 'REF', 'SPD', 'POS',
        'ATT', 'MID', 'DEF', 'GK', 'ST', 'CF', 'LW', 'RW', 'CAM', 'CM', 'CDM', 'LB', 'RB', 'CB',
        'LWB', 'RWB', 'RM', 'LM', 'RF', 'LF', 'ACC', 'AGI', 'BAL', 'JUM', 'STA', 'STR', 'AGG',
        'INT', 'POS', 'VIS', 'CRO', 'CUR', 'FKA', 'LOB', 'PEN', 'FIN', 'HEA', 'VOL', 'POW',
        'LON', 'SHO', 'TEC', 'TRA', 'MAR', 'SLI', 'STA', 'INT', 'HEA', 'STR'
      ];

      // Look for elements that might contain player names
      const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.textContent;
        if (!text || text.length < 3 || text.length > 50) return false;
        
        // Skip obviously non-name text
        if (/^\d+$/.test(text) || text.includes('coins') || text.includes('€') || text.includes('$')) return false;
        
        // Look for elements that might be player names
        const classList = el.className.toLowerCase();
        if (classList.includes('name') || classList.includes('player')) return true;
        
        // Check if text looks like a player name (contains letters, might have spaces)
        return /^[a-zA-Z\s\-\.\']+$/.test(text) && text.split(' ').length <= 4;
      });
      
      // If we have rating info, try to match with elements near rating displays
      if (rating && candidates.length > 0) {
        const ratingElements = Array.from(document.querySelectorAll('*')).filter(el => 
          el.textContent && el.textContent.trim() === String(rating)
        );
        
        for (const ratingEl of ratingElements) {
          // Look for name elements near the rating
          const nearbyElements = [
            ratingEl.previousElementSibling,
            ratingEl.nextElementSibling,
            ratingEl.parentElement?.previousElementSibling,
            ratingEl.parentElement?.nextElementSibling,
            ratingEl.parentElement?.parentElement?.querySelector('[class*="name"]'),
            ratingEl.parentElement?.parentElement?.querySelector('[class*="player"]')
          ].filter(Boolean);
          
          for (const nearby of nearbyElements) {
            const nameCandidate = nearby.textContent?.trim();
            if (nameCandidate && nameCandidate.length > 2 && nameCandidate.length < 50) {
              // IMPROVED FILTERING - Filter out stat abbreviations
              const upperCase = nameCandidate.toUpperCase();
              
              // Skip if it's a known stat abbreviation
              if (statAbbrevs.includes(upperCase)) {
                console.log('[FUT] Skipping stat abbreviation:', nameCandidate);
                continue;
              }
              
              // Skip if it's all caps and 3 characters or less (likely a stat)
              if (nameCandidate === upperCase && nameCandidate.length <= 3) {
                console.log('[FUT] Skipping short caps text:', nameCandidate);
                continue;
              }
              
              // Skip if it's just numbers or contains numbers prominently
              if (/^\d+$/.test(nameCandidate) || nameCandidate.split('').filter(c => /\d/.test(c)).length > 2) {
                console.log('[FUT] Skipping numeric text:', nameCandidate);
                continue;
              }
              
              // Only accept if it looks like a name
              if (/^[a-zA-Z\s\-\.\']+$/.test(nameCandidate) && 
                  /[a-z]/.test(nameCandidate) && // Contains lowercase letters
                  nameCandidate.split(' ').length <= 3) { // Not too many words
                console.log('[FUT] Found valid name candidate:', nameCandidate);
                return nameCandidate;
              }
            }
          }
        }
      }
      
      return null;
    } catch (e) {
      console.error('[FUT] DOM name extraction error:', e);
      return null;
    }
  }

  // Storage variables
  let latestTradepile = null;
  const processedTradeIds = new Set();

  // Enhanced message handler with better logging
  window.addEventListener('message', (event) => {
    const { type, payload } = event?.data || {};
    
    if (type === 'FUT_TRADEPILE' && payload) {
      console.log('[FUT Content] Tradepile data received:', payload);
      latestTradepile = payload;
    }

    if (type === 'FUT_CACHE_ITEMS' && payload?.items?.length) {
      console.log(`[FUT Content] Caching ${payload.items.length} items from API`);
      
      let cacheUpdates = 0;
      for (const item of payload.items) {
        const itemId = item?.id != null ? String(item.id) : null;
        const assetId = item?.assetId != null ? String(item.assetId) : null;
        const tradeId = item?.tradeId != null ? String(item.tradeId) : null;
        
        // Store buy price from multiple possible sources
        let buyPrice = 0;
        if (typeof item.purchasedPrice === 'number' && item.purchasedPrice > 0) {
          buyPrice = item.purchasedPrice;
        } else if (typeof item.lastSalePrice === 'number' && item.lastSalePrice > 0) {
          buyPrice = item.lastSalePrice;
        } else if (typeof item.startingBid === 'number' && item.startingBid > 0) {
          buyPrice = item.startingBid;
        }
        
        if (buyPrice > 0) {
          setBought(itemId, assetId, tradeId, buyPrice);
          cacheUpdates++;
        }
        
        // Store player name and card type
        const playerName = item.player_name || 'Unknown Player';
        const cardType = normalizeCardType(item.card_version, item.rating);
        
        setPlayerInfo(itemId, assetId, tradeId, playerName, cardType);
      }
      
      if (cacheUpdates > 0) {
        console.log(`[FUT Content] Cached ${cacheUpdates} buy prices`);
        saveCache();
      }
    }
  });

  // Helper functions
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isClosedAuction(auction = {}) {
    const state = String(auction?.tradeState || auction?.state || '').toLowerCase();
    return /closed|complete|won/.test(state);
  }

  // Enhanced final price calculation
  function finalSoldPrice(auction = {}) {
    // Priority: current bid > buy now price > starting bid
    if (typeof auction.currentBid === 'number' && auction.currentBid > 0) {
      return auction.currentBid;
    }
    if (typeof auction.buyNowPrice === 'number' && auction.buyNowPrice > 0) {
      return auction.buyNowPrice;  
    }
    if (typeof auction.startingBid === 'number' && auction.startingBid > 0) {
      return auction.startingBid;
    }
    return 0;
  }

  function nameFromItem(item = {}) {
    // Enhanced name extraction
    if (item.preferredName) return item.preferredName.trim();
    if (item.commonName) return item.commonName.trim();
    
    const first = item.firstName ? item.firstName.trim() : '';
    const last = item.lastName ? item.lastName.trim() : '';
    
    if (first && last) return `${first} ${last}`;
    if (last) return last;
    if (first) return first;
    
    return item.name?.trim() || 'Unknown Player';
  }

  const parseCoins = s => { 
    const match = String(s || '').replace(/[^\d]/g, '').match(/\d+/); 
    return match ? parseInt(match[0], 10) : 0; 
  };

  function soldRows() {
    const candidates = Array.from(document.querySelectorAll(
      '.listFUTItem, .listItem, .ut-item-row, [class*="list"], [class*="item"]'
    ));
    
    return candidates.filter(el => {
      const txt = (el.textContent || '').toLowerCase();
      const stateAttr = (el.getAttribute('data-state') || '').toLowerCase();
      const hasWonClass = el.className.toLowerCase().includes('won');
      
      return /won|sold|closed/.test(txt) || /won|sold|closed/.test(stateAttr) || hasWonClass;
    });
  }

  // UI interaction functions with better error handling
  async function openDetailsForRow(row) {
    try {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await sleep(160);

      const panel = document.querySelector('[class*="Detail"], [class*="detail"], [class*="panel"], [class*="sidebar"]') || document;
      const candidates = Array.from(panel.querySelectorAll('button, a')).filter(b => {
        const t = (b.textContent || '').toLowerCase();
        const a = (b.getAttribute('aria-label') || '').toLowerCase();
        return /player\s*bio|item\s*details|details|bio/.test(t) || /bio|detail/.test(a);
      });

      if (candidates.length) {
        try { 
          candidates[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); 
          await sleep(280);
          try { window.history.back(); } catch {}
          return true;
        } catch {}
      }

      // Context menu fallback
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
      await sleep(120);
      
      const ctx = document.querySelector('[role="menu"], [class*="context"], [class*="menu"]') || document;
      const entry = Array.from(ctx.querySelectorAll('button, a, [role="menuitem"]')).find(el => {
        const t = (el.textContent || '').toLowerCase();
        return /player\s*bio|item\s*details|details|bio/.test(t);
      });
      
      if (entry) {
        try { 
          entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); 
          await sleep(280);
          try { window.history.back(); } catch {}
          return true;
        } catch {}
      }

      return false;
    } catch (e) {
      console.error('[FUT Content] Error in openDetailsForRow:', e);
      return false;
    }
  }

  async function waitForBuyFill(itemId, assetId, tradeId, timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const price = getBought(itemId, assetId, tradeId);
      if (price > 0) return true;
      await sleep(120);
    }
    return false;
  }

  // Enhanced cache warming with better matching
  async function warmCacheViaUI(auctions) {
    const rows = soldRows();
    if (!rows.length) return;

    console.log(`[FUT Content] Warming cache for ${auctions.length} auctions using ${rows.length} DOM rows`);

    // Create price-based auction mapping
    const byPrice = new Map();
    for (const auction of auctions) {
      const price = finalSoldPrice(auction);
      const key = String(price);
      if (!byPrice.has(key)) byPrice.set(key, []);
      byPrice.get(key).push(auction);
    }

    let warmedCount = 0;
    for (const row of rows) {
      const sellPrice = parseCoins(
        row.querySelector('.currency-coins, .coins, .price, [class*="coin"]')?.textContent ||
        (row.textContent || '')
      );
      
      const matchingAuctions = byPrice.get(String(sellPrice)) || [];
      const auction = matchingAuctions.shift?.() || matchingAuctions[0] || null;
      
      if (!auction) continue;

      const item = auction.itemData || {};
      const itemId = item?.id != null ? String(item.id) : null;
      const assetId = item?.assetId != null ? String(item.assetId) : null;
      const tradeId = auction.tradeId != null ? String(auction.tradeId) : null;
      
      if (getBought(itemId, assetId, tradeId) > 0) continue;

      console.log(`[FUT Content] Warming cache for ${nameFromItem(item)} (sell: ${sellPrice})`);
      await openDetailsForRow(row);
      const filled = await waitForBuyFill(itemId, assetId, tradeId, 3000);
      
      if (filled) {
        warmedCount++;
        console.log(`[FUT Content] Cache warmed successfully for ${nameFromItem(item)}`);
      }
      
      await sleep(120);
    }
    
    console.log(`[FUT Content] Cache warming complete: ${warmedCount}/${auctions.length} items`);
  }

  async function ensureTradepileSnapshot(timeoutMs = 1500) {
    if (latestTradepile?.auctionInfo?.length) return true;

    try {
      const tab = Array.from(document.querySelectorAll('a, button, [role="tab"]'))
        .find(el => /transfer\s*list/i.test(el.textContent || el.getAttribute('aria-label') || ''));
      if (tab) { tab.click(); }
    } catch {}

    const start = Date.now();
    return await new Promise(resolve => {
      const onMessage = (ev) => {
        if (ev?.data?.type === 'FUT_TRADEPILE') {
          window.removeEventListener('message', onMessage);
          resolve(true);
        }
      };
      
      window.addEventListener('message', onMessage);
      
      const checkTimeout = () => {
        if (Date.now() - start >= timeoutMs) {
          window.removeEventListener('message', onMessage);
          resolve(!!latestTradepile?.auctionInfo?.length);
        } else {
          setTimeout(checkTimeout, 100);
        }
      };
      
      checkTimeout();
    });
  }

  // Enhanced record building with proper profit calculation and name extraction
  function buildRecordsFromTradepile() {
    const auctions = latestTradepile?.auctionInfo || [];
    const closedAuctions = auctions.filter(isClosedAuction);
    const records = [];

    console.log(`[FUT Content] Building records from ${closedAuctions.length} closed auctions`);

    for (const auction of closedAuctions) {
      const item = auction.itemData || {};
      const itemId = item?.id != null ? String(item.id) : null;
      const assetId = item?.assetId != null ? String(item.assetId) : null;
      const tradeId = auction.tradeId != null ? String(auction.tradeId) : null;

      const sellPrice = finalSoldPrice(auction);
      const buyPrice = getBought(itemId, assetId, tradeId) || 0;
      const cachedInfo = getPlayerInfo(itemId, assetId, tradeId);

      // ENHANCED: Use the new name extraction function
      const playerName = cachedInfo.playerName || enhancedNameFromItem(item, auction);
      
      let cardVersion = cachedInfo.cardType || normalizeCardType(item?.itemType, item?.rating);
      if (!cardVersion || cardVersion.length > 20) {
        const rating = Number(item?.rating || 0);
        cardVersion = rating >= 75 ? 'Gold' : rating >= 65 ? 'Silver' : rating > 0 ? 'Bronze' : 'Standard';
      }

      // FIXED: Correct tax and profit calculation
      const eaTax = Math.floor(sellPrice * 0.05);
      const afterTax = sellPrice - eaTax;
      const profit = afterTax - buyPrice;

      const record = {
        trade_id: auction.tradeId,
        player_name: playerName,
        rating: item.rating || null,
        card_version: cardVersion,
        buy_price: buyPrice,
        sell_price: sellPrice,
        after_tax: afterTax,
        profit: profit,
        timestamp_ms: Date.now()
      };

      console.log(`[FUT Content] Enhanced record: ${playerName} | Buy: ${buyPrice} | Sell: ${sellPrice} | Profit: ${profit}`);
      records.push(record);
    }

    return records;
  }

  function sendItem(record) {
    try { 
      chrome.runtime.sendMessage({ type: 'SOLD_ITEM_DATA', data: record }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[FUT Content] Send error:', chrome.runtime.lastError);
        } else if (response?.success) {
          console.log(`[FUT Content] Successfully sent: ${record.player_name}`);
        } else {
          console.warn('[FUT Content] Send failed:', response?.error);
        }
      }); 
    } catch (e) { 
      console.error('[FUT Content] Send error:', e); 
    }
  }

  async function recordAndClear(nativeBtn) {
    console.log('[FUT Content] Record and clear initiated');
    
    const ok = await ensureTradepileSnapshot();
    if (!ok) {
      toast('Could not read tradepile data. Try refreshing the page.');
      return 0;
    }

    const auctions = latestTradepile?.auctionInfo || [];
    const closedAuctions = auctions.filter(isClosedAuction);
    
    if (!closedAuctions.length) {
      toast('No sold items found in tradepile.');
      return 0;
    }

    console.log(`[FUT Content] Found ${closedAuctions.length} sold items`);

    // Warm cache where possible
    await warmCacheViaUI(closedAuctions);
    saveCache();

    // Build final records
    const records = buildRecordsFromTradepile();
    const newRecords = records.filter(r => r.trade_id && !processedTradeIds.has(r.trade_id));
    
    // Mark as processed
    newRecords.forEach(r => processedTradeIds.add(r.trade_id));

    if (newRecords.length) {
      console.log(`[FUT Content] Sending ${newRecords.length} new records`);
      console.table(newRecords.map(r => ({
        player: r.player_name,
        version: r.card_version,
        buy: r.buy_price,
        sell: r.sell_price,
        profit: r.profit
      })));
      
      for (const record of newRecords) {
        sendItem(record);
      }
    }

    // Click native clear button
    setTimeout(() => { 
      try { nativeBtn.click(); } catch (e) { console.error('Clear button click failed:', e); }
    }, 200);

    return newRecords.length;
  }

  // UI functions
  function toast(msg) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;top:20px;right:20px;z-index:10000;
      background:linear-gradient(135deg,#6f3cf6,#8f5cff);color:#fff;
      padding:12px 16px;border-radius:12px;
      font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.35);
      animation: slideInRight 0.3s ease-out;
    `;
    
    // Add CSS animation
    if (!document.querySelector('#fut-toast-styles')) {
      const style = document.createElement('style');
      style.id = 'fut-toast-styles';
      style.textContent = `
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    el.textContent = `FUT Trader Hub - ${msg}`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'slideInRight 0.3s ease-in reverse';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  function createRecordAndClear(nativeBtn) {
    if (!nativeBtn || nativeBtn.dataset.futRecordAttached === '1') return;
    
    const container = nativeBtn.parentElement || document.body;
    if (container.querySelector('[data-fut-record="1"]')) { 
      nativeBtn.dataset.futRecordAttached = '1'; 
      return; 
    }

    const btn = nativeBtn.cloneNode(true);
    nativeBtn.dataset.futRecordAttached = '1';
    btn.dataset.futRecord = '1';
    btn.textContent = 'Record & Clear';
    btn.style.cssText = `
      background: linear-gradient(90deg,#6f3cf6,#8f5cff);
      border: none;
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
      margin-left: 8px;
    `;
    
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-1px)';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      btn.textContent = 'Processing...';
      btn.disabled = true;
      
      try {
        const count = await recordAndClear(nativeBtn);
        
        if (count > 0) {
          toast(`Logged ${count} sale${count === 1 ? '' : 's'} successfully`);
          btn.textContent = `Logged ${count}`;
          btn.style.background = 'linear-gradient(90deg,#22c55e,#16a34a)';
        } else {
          toast('No new sold items found');
          btn.textContent = 'No items';
          btn.style.background = 'linear-gradient(90deg,#f59e0b,#d97706)';
        }
        
        setTimeout(() => {
          btn.textContent = 'Record & Clear';
          btn.style.background = 'linear-gradient(90deg,#6f3cf6,#8f5cff)';
          btn.disabled = false;
        }, 2000);
        
      } catch (error) {
        console.error('[FUT Content] Record and clear error:', error);
        toast('Error occurred. Check console for details.');
        btn.textContent = 'Error';
        btn.style.background = 'linear-gradient(90deg,#ef4444,#dc2626)';
        
        setTimeout(() => {
          btn.textContent = 'Record & Clear';
          btn.style.background = 'linear-gradient(90deg,#6f3cf6,#8f5cff)';
          btn.disabled = false;
        }, 3000);
      }
    }, { capture: true });

    try { 
      container.insertBefore(btn, nativeBtn.nextSibling); 
    } catch {
      document.body.appendChild(btn);
      btn.style.position = 'fixed'; 
      btn.style.bottom = '20px'; 
      btn.style.right = '20px'; 
      btn.style.zIndex = '9999';
    }
  }

  function watchForClearSold() {
    let scheduled = false;
    
    const scan = () => {
      scheduled = false;
      const clearBtn = Array.from(document.querySelectorAll('button, a'))
        .find(b => /clear\s*sold/i.test(b.textContent || ''));
      
      if (clearBtn) {
        console.log('[FUT Content] Found Clear Sold button, adding Record & Clear');
        createRecordAndClear(clearBtn);
      }
    };
    
    const observer = new MutationObserver(() => { 
      if (!scheduled) { 
        scheduled = true; 
        requestAnimationFrame(scan); 
      } 
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    requestAnimationFrame(scan);
    
    console.log('[FUT Content] Watching for Clear Sold button');
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForClearSold);
  } else {
    watchForClearSold();
  }

  console.log('[FUT Content] Enhanced FUT Trader Hub content script loaded');
})();