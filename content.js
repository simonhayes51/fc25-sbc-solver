// content.js — Record & Clear using tradepile JSON + DOM merge (CORS-free)
(function () {
  if (!/ea\.com$/i.test(location.hostname)) return;

  // Inject page-context hook for tradepile capture
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch {}

  // ---- cache ----
  let latestTradepile = null;
  const processedTradeIds = new Set();

  window.addEventListener('message', (event) => {
    const { type, payload } = event?.data || {};
    if (type === 'FUT_TRADEPILE' && payload) {
      latestTradepile = payload;
      if (processedTradeIds.size > 3000) processedTradeIds.clear();
    }
  });

  // ---- DOM helpers to grab name/version/bought-for from visible list ----
  function parseCoins(text) {
    if (!text) return 0;
    const m = String(text).replace(/[,.\s]/g, '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function scrapeSoldRows() {
    // Supports both classic and React-ish FUT webapp layouts:
    // - rows: .listFUTItem, [data-state="won"] / .won
    // fields: name elements often .name, .player-name, .ut-item-player-name
    // prices: .currency-coins / .coins etc
    const rows = Array.from(document.querySelectorAll(
      '.listFUTItem.won, .listFUTItem[data-state="won"], .ut-item-list .won, .won'
    ));

    const items = [];

    for (const el of rows) {
      try {
        // Visible "Sold for" (current/highest bid shown in the row)
        const priceEl = el.querySelector('.currency-coins, .coins, .price, [class*="coin"]');
        const sellPrice = parseCoins(priceEl?.textContent || '');

        // Name / title
        const nameEl = el.querySelector('.name, .player-name, .ut-item-player-name, [class*="name"]');
        const playerName = (nameEl?.textContent || '').trim() || 'Unknown';

        // Card version / variant label (best-effort)
        let cardVersion = 'Standard';
        const badge = el.querySelector('[class*="rarity"], [class*="version"], [class*="flag"], .badge');
        if (badge && badge.textContent) {
          const v = badge.textContent.trim();
          if (v) cardVersion = v;
        }
        // some UIs expose attributes that hint version
        if (el.getAttribute('data-item-type')) {
          cardVersion = el.getAttribute('data-item-type');
        }

        // Bought For (if the UI shows it)
        // FUT often renders as a secondary label near price, e.g. "Bought For 20,750"
        let boughtFor = 0;
        const boughtLabel = Array.from(el.querySelectorAll('*')).find(n =>
          /bought\s*for/i.test(n.textContent || '')
        );
        if (boughtLabel) {
          // look for a number next to or inside the same node
          const coins = parseCoins(boughtLabel.textContent);
          if (coins > 0) boughtFor = coins;
          else {
            // try a sibling with coins
            const siblingCoins = boughtLabel.parentElement?.querySelector('.currency-coins, .coins, [class*="coin"]');
            if (siblingCoins) boughtFor = parseCoins(siblingCoins.textContent);
          }
        }

        items.push({
          el,
          playerName,
          cardVersion,
          sellPrice,
          boughtFor
        });
      } catch {}
    }

    return items;
  }

  // match DOM row objects to tradepile auctions; we match by sell price first, then fallback to order
  function buildMergedClosedRecords() {
    if (!latestTradepile?.auctionInfo) return [];

    const closed = latestTradepile.auctionInfo
      .filter(a => String(a?.tradeState).toLowerCase() === 'closed');

    const domRows = scrapeSoldRows();

    // Build a multimap by sold price for rough matching
    const byPrice = new Map();
    for (const a of closed) {
      const soldFor = (typeof a.currentBid === 'number' && a.currentBid > 0) ? a.currentBid
                   : (typeof a.buyNowPrice === 'number' && a.buyNowPrice > 0) ? a.buyNowPrice
                   : 0;
      const key = String(soldFor);
      if (!byPrice.has(key)) byPrice.set(key, []);
      byPrice.get(key).push(a);
    }

    const records = [];
    const usedTradeIds = new Set();

    // 1) Try price-based matching
    for (const row of domRows) {
      const list = byPrice.get(String(row.sellPrice)) || [];
      let matched = null;
      for (const a of list) {
        if (usedTradeIds.has(a.tradeId)) continue;
        matched = a; break;
      }
      if (matched) {
        usedTradeIds.add(matched.tradeId);
        records.push({ auction: matched, dom: row });
      }
    }

    // 2) Any auctions not matched by price → append in order with remaining DOM rows
    const remainingAuctions = closed.filter(a => !usedTradeIds.has(a.tradeId));
    const remainingRows = domRows.filter(r => !records.some(x => x.dom === r));
    const len = Math.min(remainingAuctions.length, remainingRows.length);
    for (let i = 0; i < len; i++) {
      records.push({ auction: remainingAuctions[i], dom: remainingRows[i] });
      usedTradeIds.add(remainingAuctions[i].tradeId);
    }

    // Build final sale records
    return records.map(({ auction: a, dom }) => {
      const item = a?.itemData || {};
      const soldFor = (typeof a.currentBid === 'number' && a.currentBid > 0) ? a.currentBid
                    : (typeof a.buyNowPrice === 'number' && a.buyNowPrice > 0) ? a.buyNowPrice
                    : dom.sellPrice || 0;

      // Bought for preference: DOM (if shown) → JSON purchasedPrice/lastSalePrice → 0
      const jsonBought =
        (typeof item.purchasedPrice === 'number' && item.purchasedPrice > 0) ? item.purchasedPrice :
        (typeof item.lastSalePrice === 'number' && item.lastSalePrice > 0) ? item.lastSalePrice : 0;

      const boughtFor = dom.boughtFor > 0 ? dom.boughtFor : jsonBought;

      const afterTax = Math.floor(soldFor * 0.95);
      const profit = afterTax - (boughtFor || 0);

      return {
        trade_id: a?.tradeId,
        player_name: dom.playerName || 'Unknown',
        rating: item.rating,
        card_version: dom.cardVersion || item.itemType || 'Standard',
        buy_price: boughtFor || 0,
        sell_price: soldFor || 0,
        after_tax: afterTax,
        profit,
        timestamp_ms: Date.now()
      };
    });
  }

  function sendItem(record) {
    try { chrome.runtime.sendMessage({ type: 'SOLD_ITEM_DATA', data: record }, () => {}); }
    catch (e) { console.error('[FUT Content] Send error:', e); }
  }

  async function recordAllClosedMerged() {
    if (!latestTradepile?.auctionInfo) return 0;

    const merged = buildMergedClosedRecords();
    if (!merged.length) return 0;

    // De-dupe by tradeId
    const toSend = merged.filter(r => r.trade_id && !processedTradeIds.has(r.trade_id));
    for (const r of toSend) processedTradeIds.add(r.trade_id);

    if (!toSend.length) return 0;

    try { console.table(toSend.map(r => ({id:r.trade_id, name:r.player_name, ver:r.card_version, buy:r.buy_price, sell:r.sell_price, profit:r.profit}))); } catch {}
    for (const rec of toSend) sendItem(rec);
    return toSend.length;
  }

  // ---- UI ----
  function toast(msg) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;top:20px;right:20px;z-index:10000;
      background:linear-gradient(135deg,#6f3cf6,#8f5cff);color:#fff;
      padding:10px 14px;border-radius:10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35)
    `;
    el.textContent = `FUT Trader Hub — ${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  function createRecordAndClear(nativeBtn) {
    if (!nativeBtn || nativeBtn.dataset.futRecordAttached === '1') return;
    const container = nativeBtn.parentElement || document.body;
    if (container.querySelector('[data-fut-record="1"]')) { nativeBtn.dataset.futRecordAttached = '1'; return; }

    const btn = nativeBtn.cloneNode(true);
    nativeBtn.dataset.futRecordAttached = '1';
    btn.dataset.futRecord = '1';
    btn.textContent = 'Record & Clear';
    btn.style.background = 'linear-gradient(90deg,#6f3cf6,#8f5cff)';
    btn.style.border = 'none';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const count = await recordAllClosedMerged();

      // Click the native Clear Sold after logging
      setTimeout(() => { try { nativeBtn.click(); } catch {} }, 200);

      toast(count ? `Logged ${count} sale${count === 1 ? '' : 's'}` : 'No closed items');
    }, { capture: true });

    try { container.insertBefore(btn, nativeBtn.nextSibling); }
    catch {
      document.body.appendChild(btn);
      btn.style.position='fixed'; btn.style.bottom='20px'; btn.style.right='20px'; btn.style.zIndex='9999';
    }
  }

  function watchForClearSold() {
    let scheduled = false;
    const scan = () => {
      scheduled = false;
      const btn = Array.from(document.querySelectorAll('button,a'))
        .find(b => /clear\s*sold/i.test(b.textContent || ''));
      if (btn) createRecordAndClear(btn);
    };
    const mo = new MutationObserver(() => {
      if (scheduled) return; scheduled = true; requestAnimationFrame(scan);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    requestAnimationFrame(scan);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchForClearSold);
  else watchForClearSold();
})();
