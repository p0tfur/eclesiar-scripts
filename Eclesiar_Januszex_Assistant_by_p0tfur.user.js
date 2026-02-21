// ==UserScript==
// @name         Eclesiar Janueszex Assistant by p0tfur
// @namespace    https://eclesiar.com/
// @version      1.5.1
// @description  Janueszex Assistant
// @author       p0tfur
// @match        https://eclesiar.com/*
// @match        https://apollo.eclesiar.com/*
// @updateURL    https://24na7.info/eclesiar-scripts/Eclesiar_Januszex_Assistant_by_p0tfur.user.js
// @downloadURL  https://24na7.info/eclesiar-scripts/Eclesiar_Januszex_Assistant_by_p0tfur.user.js
// ==/UserScript==

(() => {
  // USER CONFIG
  const EJA_ADD_HOLDINGS_TO_MENU = true; // Add holdings to global dropdown menu
  // USER CONFIG

  const SETTINGS_KEY = "eja_settings_v1";
  const DEFAULT_EJA_SETTINGS = {
    addHoldingsToMenu: EJA_ADD_HOLDINGS_TO_MENU,
    jobsEnhancements: true,
    dashboardEnabled: true,
    sellPageHelpers: true,
    hideMarketSaleNotifications: false,
    generateDailySalesSummaries: true,
    coinAdvancedQuickBuyHoldings: true,
  };

  const refreshAllCoinAdvancedQuickBuy = () => {
    const wrappers = Array.from(document.querySelectorAll('[data-eja="coin-quick-buy"]'));
    wrappers.forEach((wrap) => {
      const refs = wrap.__ejaQuickBuyRefs;
      if (!refs) return;
      renderCoinAdvancedFavorites(refs.favorites, refs.items, refreshAllCoinAdvancedQuickBuy);
      renderCoinAdvancedList(refs.listContainer, refs.items, refs.search.value, refreshAllCoinAdvancedQuickBuy);
    });
  };

  const isJobsMutationRelevant = (mutations) => {
    if (!Array.isArray(mutations) || mutations.length === 0) return true;
    const selectors = ".holdings-container, .employees_list, [data-employees], .holdings-description, .tab-content";
    return mutations.some((mutation) => {
      const target = mutation.target;
      if (target && target.matches && target.matches(selectors)) return true;
      if (target && target.closest && target.closest(".holdings-container")) return true;
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return nodes.some(
        (node) => node.nodeType === 1 && (node.matches?.(selectors) || node.querySelector?.(selectors)),
      );
    });
  };

  const resolveCoinAdvancedOfferRow = (list) =>
    list.closest("tr, .market-row, .market-offer, .offer-row, .coin-advanced-row, .row") || list.parentElement;

  let ejaSettings = null;

  const CACHE_KEY = "eja_holdings";
  const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48h
  const HOLDINGS_JOBS_CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48h
  let holdingsCacheWarned = false;
  let holdingsJobsCache = { updatedAt: 0, holdings: [], inFlight: null };

  const clearHoldingsCache = () => {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (e) {
      console.warn("[EJA] Failed to clear holdings cache:", e);
    }
    holdingsCacheWarned = false;
    holdingsJobsCache = { updatedAt: 0, holdings: [], inFlight: null };
  };

  // Business Dashboard Configuration
  const DASHBOARD_DB_NAME = "eja_business_dashboard";
  const DASHBOARD_DB_VERSION = 1;
  const DASHBOARD_STORE_NAME = "daily_snapshots";
  let dashboardDB = null;
  let dashboardOverlayOpen = false;

  // Sales Summary Configuration
  const SALES_DB_NAME = "eja_sales_summary";
  const SALES_DB_VERSION = 1;
  const SALES_STORE_NAME = "daily_sales";
  const SALES_HISTORY_DAYS = 7;
  const SALES_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
  const SALES_CACHE_VERSION = "v4";
  const TRANSACTIONS_ALL_FILTER = "all";
  let salesDB = null;
  let salesOverlayOpen = false;

  const onReady = (fn) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  };

  /* REMOVED CONSTANTS: SALES_FILTER_USER, SALES_FILTER_HOLDING - now resolved dynamically */

  const getSalesSummaryDateKeys = () =>
    Array.from({ length: SALES_HISTORY_DAYS }, (_, index) => getDateKeyDaysAgo(index));

  const formatSalesDateLabel = (dateKey) => {
    if (dateKey === getTodayDateKey()) return USER_LANG === "pl" ? "Dzisiaj" : "Today";
    if (dateKey === getDateKeyDaysAgo(1)) return USER_LANG === "pl" ? "Wczoraj" : "Yesterday";
    return dateKey.split("-").reverse().join(".");
  };

  const parseTransactionDateKey = (rawText) => {
    if (!rawText) return null;
    const text = String(rawText).trim().toLowerCase();
    if (!text) return null;
    if (text.includes("wczoraj") || text.includes("yesterday")) return getDateKeyDaysAgo(1);
    if (text.includes("dzisiaj") || text.includes("dziś") || text.includes("today")) return getTodayDateKey();
    if (
      text.includes("godzin") ||
      text.includes("hour") ||
      text.includes("minut") ||
      text.includes("minute") ||
      text.includes("sekund") ||
      text.includes("second")
    )
      return getTodayDateKey();
    const match = text.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return null;
  };

  const parseTransactionValue = (rawText) => {
    const text = String(rawText || "");
    const amount = parseNumberValue(text);
    const currencyMatch = text.match(/[A-Z]{2,6}/);
    const currency = currencyMatch ? currencyMatch[0] : "";
    return { amount, currency };
  };

  const openSalesDB = () => {
    return new Promise((resolve, reject) => {
      if (salesDB) return resolve(salesDB);
      try {
        const request = indexedDB.open(SALES_DB_NAME, SALES_DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          salesDB = request.result;
          resolve(salesDB);
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(SALES_STORE_NAME)) {
            db.createObjectStore(SALES_STORE_NAME, { keyPath: "key" });
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  };

  const getSalesSummaryCache = async (key) => {
    try {
      const db = await openSalesDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SALES_STORE_NAME, "readonly");
        const store = tx.objectStore(SALES_STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn("[EJA Sales] Failed to read cache:", e);
      return null;
    }
  };

  const saveSalesSummaryCache = async (payload) => {
    try {
      const db = await openSalesDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SALES_STORE_NAME, "readwrite");
        const store = tx.objectStore(SALES_STORE_NAME);
        const request = store.put(payload);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn("[EJA Sales] Failed to write cache:", e);
    }
  };

  const isMarketSaleNotification = (node) => {
    if (!node || !(node instanceof HTMLElement)) return false;
    if (!node.classList.contains("notification-popup")) return false;
    const title = node.querySelector("h3")?.textContent || "";
    return /Przedmioty sprzedane na rynku|Items sold in the market/i.test(title);
  };

  const closeMarketSaleNotification = (node) => {
    if (!isMarketSaleNotification(node)) return false;
    const closeBtn = node.querySelector(".close-notification");
    if (closeBtn) {
      closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    node.remove();
    return true;
  };

  const removeMarketSaleNotifications = (root = document) => {
    const nodes = Array.from(root.querySelectorAll(".notification-popup"));
    nodes.forEach((node) => {
      closeMarketSaleNotification(node);
    });
  };

  const initMarketSaleNotificationFilter = () => {
    if (!isSettingEnabled("hideMarketSaleNotifications")) return;
    removeMarketSaleNotifications(document);
    if (document.__ejaMarketSaleObserver) return;
    const observer = new MutationObserver((mutations) => {
      if (!isSettingEnabled("hideMarketSaleNotifications")) return;
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!node || !(node instanceof HTMLElement)) return;
          if (closeMarketSaleNotification(node)) return;
          const popup = node.querySelector && node.querySelector(".notification-popup");
          if (popup) closeMarketSaleNotification(popup);
        });
      });
    });
    const target = document.querySelector(".notifications-list") || document.body || document.documentElement;
    observer.observe(target, { childList: true, subtree: true });
    document.__ejaMarketSaleObserver = observer;
  };

  const resolveUserIdentityFromDocument = (doc) => {
    const root = doc || document;
    const backButton = root.querySelector('a.back-button[href^="/user/"]');
    const navLink =
      backButton ||
      root.querySelector(
        '.user-panel a[href^="/user/"], .navbar a[href^="/user/"], nav a[href^="/user/"], .dropdown-menu a[href^="/user/"]',
      );
    if (!navLink) return { id: null, name: "Gracz" };
    const href = navLink.getAttribute("href") || "";
    const idMatch = href.match(/\/user\/(\d+)/);
    const img = navLink.querySelector("img");
    const name = (img && img.getAttribute("alt")) || navLink.textContent.trim() || "Gracz";
    return { id: idMatch ? idMatch[1] : null, name };
  };

  const buildSalesCacheKey = (entity, dateKey) => `sales:${SALES_CACHE_VERSION}:${entity.type}:${entity.id}:${dateKey}`;

  const buildTransactionsUrlCandidates = (entity, page, filterId) => {
    const pageNum = page || 1;
    // filterId must be resolved from the select list.
    if (!filterId) return [];
    const fid = filterId;

    if (entity.type === "holding") {
      const base = `/holding/${entity.id}/transactions/${fid}`;
      if (pageNum > 1) return [`${base}/${pageNum}`];
      return [base];
    }
    const base = `/user/transactions/${fid}`;
    if (pageNum > 1) return [`${base}/${pageNum}`];
    return [base];
  };

  const fetchTransactionsDocument = async (entity, page, filterId) => {
    const candidates = buildTransactionsUrlCandidates(entity, page, filterId);
    for (const url of candidates) {
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) continue;
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const tableBody = doc.querySelector("table.table tbody");
        if (tableBody) return doc;
      } catch (e) {
        console.warn("[EJA Sales] Failed to fetch transactions:", e);
      }
    }
    return null;
  };

  const isMarketSaleRow = (row) => {
    const descCell = row.querySelector(".column-4") || row.querySelector("td:nth-child(5)");
    const text = descCell ? descCell.textContent || "" : "";
    return /Przedmioty kupione na rynku|Items bought in the market/i.test(text);
  };

  const resolveMarketFilterId = async (entity) => {
    const doc = await fetchTransactionsDocument(entity, 1, TRANSACTIONS_ALL_FILTER);
    if (!doc) {
      console.warn("[EJA] Could not load transaction page to resolve filter ID.");
      return null;
    }

    const select = doc.querySelector("select#description-filter");
    if (!select) {
      console.warn("[EJA] Filter select not found.");
      return null;
    }

    // Look for option text
    // "Przedmioty kupione na rynku" OR "Items bought in the market"
    const options = Array.from(select.options);

    const targetOption = options.find((opt) =>
      /Przedmioty kupione na rynku|Items bought in the market/i.test(opt.textContent),
    );

    if (targetOption) {
      console.log(`[EJA] Resolved dynamic filter ID for ${entity.name}: ${targetOption.value}`);
      return targetOption.value;
    }

    console.warn(`[EJA] Could not find 'Market' filter option for ${entity.name}. Skipping summary.`);
    return null;
  };

  const normalizeEntityLabel = (value) => (value || "").trim().toLowerCase();

  const doesCellMatchEntity = (cell, entity) => {
    if (!cell) return false;
    const link = cell.querySelector('a[href^="/user/"], a[href^="/holding/"]');
    if (link) {
      const href = link.getAttribute("href") || "";
      if (entity.type === "user" && entity.id && href.includes(`/user/${entity.id}`)) return true;
      if (entity.type === "holding" && entity.id && href.includes(`/holding/${entity.id}`)) return true;
    }
    const imgAlt = cell.querySelector("img")?.getAttribute("alt") || "";
    const entityName = normalizeEntityLabel(entity.name);
    if (imgAlt && entityName && normalizeEntityLabel(imgAlt) === entityName) return true;
    return false;
  };

  const isRowSellerMatch = (row, entity) => {
    // For market sales, we are always in column "Do" (column-2).
    const recipientCell = row.querySelector(".column-2") || row.querySelector("td:nth-child(3)");
    return doesCellMatchEntity(recipientCell, entity);
  };

  const collectSalesForEntity = async (entity, dateKeys) => {
    const summary = {};
    const dateKeySet = new Set(dateKeys);
    dateKeys.forEach((key) => {
      summary[key] = { totals: {}, count: 0 };
    });

    const filterId = await resolveMarketFilterId(entity);
    if (!filterId) return summary;

    const oldestKey = dateKeys[dateKeys.length - 1];
    let page = 1;
    let keepFetching = true;

    while (keepFetching && page <= 200) {
      if (!salesOverlayOpen) break;
      const doc = await fetchTransactionsDocument(entity, page, filterId);
      if (!doc) break;
      const rows = Array.from(doc.querySelectorAll("table.table tbody tr"));
      if (!rows.length) break;
      let reachedOld = false;
      let inRangeRows = 0;
      let marketRows = 0;
      let sellerMatches = 0;
      let countedRows = 0;
      rows.forEach((row) => {
        const dateCell = row.querySelector(".column-5") || row.querySelector("td:nth-child(6)");
        const dateKey = parseTransactionDateKey(dateCell ? dateCell.textContent : "");
        if (!dateKey) return;
        if (!dateKeySet.has(dateKey)) {
          if (oldestKey && dateKey < oldestKey) reachedOld = true;
          return;
        }
        inRangeRows += 1;
        if (!isMarketSaleRow(row)) return;
        marketRows += 1;
        if (!isRowSellerMatch(row, entity)) return;
        sellerMatches += 1;
        const valueCell = row.querySelector(".column-3") || row.querySelector("td:nth-child(4)");
        const { amount, currency } = parseTransactionValue(valueCell ? valueCell.textContent : "");
        if (!currency || amount === 0) return;
        const bucket = summary[dateKey];
        bucket.totals[currency] = (bucket.totals[currency] || 0) + amount;
        bucket.count += 1;
        countedRows += 1;
      });
      if (reachedOld) break;
      page += 1;
      if (page % 2 === 0) {
        await yieldToMainThread();
      }
    }
    return summary;
  };

  const getSalesSummaryForEntity = async (entity, dateKeys) => {
    const now = Date.now();
    const cacheEntries = await Promise.all(
      dateKeys.map((dateKey) => getSalesSummaryCache(buildSalesCacheKey(entity, dateKey))),
    );
    const allFresh = cacheEntries.every((entry) => entry && now - entry.updatedAt < SALES_CACHE_TTL_MS);
    if (allFresh) {
      const days = {};
      dateKeys.forEach((dateKey, index) => {
        const entry = cacheEntries[index];
        days[dateKey] = { totals: entry?.totals || {}, count: entry?.count || 0 };
      });
      return { entity, days };
    }
    const days = await collectSalesForEntity(entity, dateKeys);
    if (!salesOverlayOpen) return { entity, days };
    await Promise.all(
      dateKeys.map((dateKey) =>
        saveSalesSummaryCache({
          key: buildSalesCacheKey(entity, dateKey),
          entityId: entity.id,
          entityType: entity.type,
          entityName: entity.name,
          dateKey,
          totals: days[dateKey].totals,
          count: days[dateKey].count,
          updatedAt: now,
        }),
      ),
    );
    return { entity, days };
  };

  const resolveUserEntity = async () => {
    const initial = resolveUserIdentityFromDocument(document);
    if (initial.id) return { type: "user", id: initial.id, name: initial.name };
    const doc = await fetchTransactionsDocument({ type: "user" }, 1, TRANSACTIONS_ALL_FILTER);
    const resolved = resolveUserIdentityFromDocument(doc);
    return { type: "user", id: resolved.id, name: resolved.name };
  };

  const getSalesSummaryEntities = async () => {
    const entities = [];
    const userEntity = await resolveUserEntity();
    if (userEntity.id) entities.push(userEntity);
    const holdings = await getHoldingsFromJobs();
    holdings.forEach((holding) => {
      if (holding.id) {
        entities.push({ type: "holding", id: holding.id, name: holding.name || `Holding ${holding.id}` });
      }
    });
    return entities;
  };

  const buildSalesSummaryData = async () => {
    if (!isSettingEnabled("generateDailySalesSummaries") || !salesOverlayOpen) return [];
    const dateKeys = getSalesSummaryDateKeys();
    const entities = await getSalesSummaryEntities();
    const summaries = await Promise.all(entities.map((entity) => getSalesSummaryForEntity(entity, dateKeys)));
    return summaries;
  };

  const ensureSalesSummaryStyles = () => {
    if (document.getElementById("eja-sales-styles")) return;
    const style = document.createElement("style");
    style.id = "eja-sales-styles";
    style.textContent = `
      .eja-sales-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        z-index: 9998;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .eja-sales-backdrop.visible { opacity: 1; }
      .eja-sales-overlay {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.96);
        width: min(900px, 92vw);
        max-height: 85vh;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.2s ease;
        overflow: hidden;
      }
      .eja-sales-overlay.visible { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      .eja-sales-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.9);
      }
      .eja-sales-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .eja-sales-close {
        background: rgba(148, 163, 184, 0.2);
        border: none;
        color: #e2e8f0;
        padding: 6px 10px;
        border-radius: 8px;
        cursor: pointer;
      }
      .eja-sales-body {
        padding: 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .eja-sales-section {
        background: rgba(148, 163, 184, 0.08);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 12px;
        padding: 14px;
      }
      .eja-sales-section h3 {
        margin: 0 0 10px 0;
        font-size: 14px;
        font-weight: 700;
      }
      .eja-sales-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px dashed rgba(148, 163, 184, 0.2);
      }
      .eja-sales-row:last-child { border-bottom: none; }
      .eja-sales-row span { font-size: 13px; }
      .eja-sales-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: rgba(34, 197, 94, 0.12);
        border-radius: 999px;
        margin-left: 6px;
        font-size: 12px;
        font-weight: 600;
        color: #bbf7d0;
      }
      .eja-sales-muted { color: #94a3b8; }
      .eja-sales-loading { color: #cbd5f5; font-size: 14px; }
      @media (max-width: 600px) {
        .eja-sales-row { flex-direction: column; align-items: flex-start; gap: 6px; }
      }
    `;
    document.head.appendChild(style);
  };

  const buildSalesTotalsHTML = (totals) => {
    const entries = Object.entries(totals || {});
    if (!entries.length) return '<span class="eja-sales-muted">Brak sprzedaży</span>';
    return entries
      .map(([currency, amount]) => `<span class="eja-sales-chip">${formatNumericValue(amount)} ${currency}</span>`)
      .join(" ");
  };

  const buildSalesSummaryHTML = (summaries) => {
    const dateKeys = getSalesSummaryDateKeys();
    if (!summaries.length) {
      return '<div class="eja-sales-muted">Brak danych do podsumowania sprzedaży.</div>';
    }
    return summaries
      .map((summary) => {
        const rows = dateKeys
          .map((dateKey) => {
            const day = summary.days[dateKey] || { totals: {}, count: 0 };
            return `
              <div class="eja-sales-row">
                <span>${formatSalesDateLabel(dateKey)}</span>
                <span>
                  ${buildSalesTotalsHTML(day.totals)}
                  <span class="eja-sales-muted">(${day.count} transakcji)</span>
                </span>
              </div>
            `;
          })
          .join("");
        return `
          <div class="eja-sales-section">
            <h3>${summary.entity.name}</h3>
            ${rows}
          </div>
        `;
      })
      .join("");
  };

  const updateJobsOverlayPause = () => {
    document.__ejaJobsPause = dashboardOverlayOpen || salesOverlayOpen;
  };

  const yieldToMainThread = () => new Promise((resolve) => setTimeout(resolve, 0));

  const closeSalesSummaryOverlay = () => {
    salesOverlayOpen = false;
    updateJobsOverlayPause();
    const backdrop = document.getElementById("eja-sales-backdrop");
    const overlay = document.getElementById("eja-sales-overlay");
    if (backdrop) {
      backdrop.classList.remove("visible");
      setTimeout(() => backdrop.remove(), 200);
    }
    if (overlay) {
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 200);
    }
    if (document.__ejaSalesEscHandler) {
      document.removeEventListener("keydown", document.__ejaSalesEscHandler);
      document.__ejaSalesEscHandler = null;
    }
  };

  const setSalesButtonLoading = (button) => {
    if (!button || button.dataset.ejaLoading === "1") return;
    button.dataset.ejaLoading = "1";
    button.dataset.ejaOriginalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = "⏳ Ładowanie...";
  };

  const clearSalesButtonLoading = (button) => {
    if (!button || button.dataset.ejaLoading !== "1") return;
    button.disabled = false;
    button.innerHTML = button.dataset.ejaOriginalHtml || "💰 Podsumowanie sprzedaży";
    delete button.dataset.ejaLoading;
    delete button.dataset.ejaOriginalHtml;
  };

  const openSalesSummaryOverlay = async (triggerButton = null) => {
    if (salesOverlayOpen) {
      clearSalesButtonLoading(triggerButton);
      return;
    }
    salesOverlayOpen = true;
    updateJobsOverlayPause();
    ensureSalesSummaryStyles();
    const backdrop = document.createElement("div");
    backdrop.id = "eja-sales-backdrop";
    backdrop.className = "eja-sales-backdrop";
    const overlay = document.createElement("div");
    overlay.id = "eja-sales-overlay";
    overlay.className = "eja-sales-overlay";
    overlay.innerHTML = `
      <div class="eja-sales-header">
        <h2>💰 Podsumowanie sprzedaży</h2>
        <button class="eja-sales-close" type="button">Zamknij</button>
      </div>
      <div class="eja-sales-body">
        <div class="eja-sales-loading">Ładowanie danych sprzedaży...</div>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      backdrop.classList.add("visible");
      overlay.classList.add("visible");
      clearSalesButtonLoading(triggerButton);
    });
    const closeBtn = overlay.querySelector(".eja-sales-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeSalesSummaryOverlay);
      closeBtn.addEventListener("pointerdown", closeSalesSummaryOverlay);
    }
    backdrop.addEventListener("click", closeSalesSummaryOverlay);
    backdrop.addEventListener("pointerdown", closeSalesSummaryOverlay);
    document.__ejaSalesEscHandler = (event) => {
      if (event.key === "Escape") closeSalesSummaryOverlay();
    };
    document.addEventListener("keydown", document.__ejaSalesEscHandler);

    try {
      const summaries = await buildSalesSummaryData();
      if (!salesOverlayOpen) return;
      const body = overlay.querySelector(".eja-sales-body");
      if (body) body.innerHTML = buildSalesSummaryHTML(summaries);
    } catch (e) {
      const body = overlay.querySelector(".eja-sales-body");
      if (body) body.innerHTML = '<div class="eja-sales-muted">Nie udało się pobrać danych sprzedaży.</div>';
      console.warn("[EJA Sales] Failed to build summary:", e);
      clearSalesButtonLoading(triggerButton);
    }
  };

  const waitFor = (selector, root = document, timeout = 30000) => {
    return new Promise((resolve, reject) => {
      const found = root.querySelector(selector);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(root === document ? document.documentElement : root, { subtree: true, childList: true });
      if (timeout > 0) {
        setTimeout(() => {
          try {
            obs.disconnect();
          } catch {}
          reject(new Error("timeout"));
        }, timeout);
      }
    });
  };

  const debounce = (fn, ms = 100) => {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const isSellPage = () => location.pathname === "/market/sell";
  const isJobsPage = () => location.pathname.startsWith("/jobs");
  const isSettingsPage = () => location.pathname === "/user/settings";
  const isCoinAdvancedPage = () => /^\/market\/coin(?:\/\d+)?\/advanced(?:\/.*)?$/.test(location.pathname);

  const loadSettings = () => {
    if (ejaSettings) return ejaSettings;
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        ejaSettings = { ...DEFAULT_EJA_SETTINGS, ...(parsed || {}) };
        return ejaSettings;
      }
    } catch (e) {
      console.warn("[EJA] Failed to load settings:", e);
    }
    ejaSettings = { ...DEFAULT_EJA_SETTINGS };
    return ejaSettings;
  };

  const saveSettings = (nextSettings) => {
    ejaSettings = { ...DEFAULT_EJA_SETTINGS, ...(nextSettings || {}) };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(ejaSettings));
    } catch (e) {
      console.warn("[EJA] Failed to save settings:", e);
    }
    return ejaSettings;
  };

  const isSettingEnabled = (key) => {
    const settings = loadSettings();
    return Boolean(settings[key]);
  };

  const ACTION_ITEMS_STATE_KEY = "eja_action_items_state_v1";

  const loadActionItemsState = () => {
    try {
      const raw = localStorage.getItem(ACTION_ITEMS_STATE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      console.warn("[EJA] Failed to load action items state:", e);
      return {};
    }
  };

  const saveActionItemsState = (state) => {
    try {
      localStorage.setItem(ACTION_ITEMS_STATE_KEY, JSON.stringify(state || {}));
    } catch (e) {
      console.warn("[EJA] Failed to save action items state:", e);
    }
  };

  const setActionItemDone = (actionId, done) => {
    if (!actionId) return;
    const current = loadActionItemsState();
    if (done) {
      current[actionId] = { doneAt: Date.now() };
    } else {
      delete current[actionId];
    }
    saveActionItemsState(current);
  };

  // RAW Consumption Consts
  const RAW_CONSUMPTION_RATES = {
    1: 37,
    2: 75,
    3: 112,
    4: 150,
    5: 187,
  };

  const COMPANY_TYPE_TO_RAW = {
    "Fabryka broni": "Żelazo",
    "Weapons Factory": "Iron",
    "Fabryka samolotów": "Tytan",
    "Aerial Weapon Factory": "Titanium",
    "Piekarnia": "Zboże",
    "Food Factory": "Grain",
    "Airlines Company": "Oil",
    "Fabryka biletów lotniczych": "Paliwo"
  };
  const normalizeLookupKey = (value) => {
    const text = value == null ? "" : String(value);
    const normalized = typeof text.normalize === "function" ? text.normalize("NFKD") : text;
    return normalized
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  };

  const COMPANY_TYPE_RAW_ALIASES = {
    "weapon factory": "Iron",
    "weapons factory": "Iron",
    "fabryka broni": "Żelazo",
    "aircraft factory": "Titanium",
    "aerial weapon factory": "Titanium",
    "aerial weapons factory": "Titanium",
    "fabryka samolotow": "Tytan",
    "food factory": "Grain",
    bakery: "Grain",
    piekarnia: "Zboże",
    "airline company": "Oil",
    "airlines company": "Oil",
    "fabryka biletow lotniczych": "Paliwo",
  };

  const COMPANY_TYPE_TO_RAW_NORMALIZED = Object.entries(COMPANY_TYPE_TO_RAW).reduce(
    (acc, [type, raw]) => {
      const normalizedType = normalizeLookupKey(type);
      if (normalizedType) acc[normalizedType] = raw;
      return acc;
    },
    { ...COMPANY_TYPE_RAW_ALIASES },
  );

  const getRawForCompanyType = (companyType) => {
    const normalizedType = normalizeLookupKey(companyType);
    if (!normalizedType) return null;
    return COMPANY_TYPE_TO_RAW_NORMALIZED[normalizedType] || null;
  };

  const normalizeSectionName = (name) => normalizeLookupKey(name);

  const isPersonalSectionName = (name) => {
    const normalized = normalizeSectionName(name);
    return (
      normalized === "moje firmy" ||
      normalized === "my companies" ||
      normalized === "own companies" ||
      normalized === "sektor prywatny" ||
      normalized === "private sector"
    );
  };

  // Helper to map known raw names to unified Keys
  const UNIFIED_RAW_NAMES = {
    Żelazo: "Żelazo",
    Zelazo: "Żelazo",
    Iron: "Żelazo",
    Tytan: "Tytan",
    Titanium: "Tytan",
    Zboże: "Zboże",
    Zboze: "Zboże",
    Grain: "Zboże",
    Paliwo: "Paliwo",
    Fuel: "Paliwo",
    Oil: "Paliwo",
  };

  const RAW_ID_MAP = {
    1: "Zboże",
    7: "Żelazo",
    19: "Tytan",
    13: "Paliwo",
  };

  // Product ids (provided by game mapping / user notes)
  const PRODUCT_ID_TO_NAME = {
    // Aircraft Q1-Q5
    2: "Samolot",
    3: "Samolot",
    4: "Samolot",
    5: "Samolot",
    6: "Samolot",
    // Ticket Q1-Q5
    8: "Bilet",
    9: "Bilet",
    10: "Bilet",
    11: "Bilet",
    12: "Bilet",
    // Weapon Q1-Q5
    14: "Broń",
    15: "Broń",
    16: "Broń",
    17: "Broń",
    18: "Broń",
    // Food/Bread Q1-Q5
    20: "Jedzenie",
    21: "Jedzenie",
    22: "Jedzenie",
    23: "Jedzenie",
    24: "Jedzenie",
  };

  const USER_LANG = localStorage.getItem("ecPlus.language") === "pl" ? "pl" : "en";
  const PRODUCT_CANONICAL_PL = {
    zelazo: "Żelazo",
    żelazo: "Żelazo",
    iron: "Żelazo",
    tytan: "Tytan",
    titanium: "Tytan",
    zboze: "Zboże",
    zboże: "Zboże",
    grain: "Zboże",
    paliwo: "Paliwo",
    fuel: "Paliwo",
    oil: "Paliwo",
    ropa: "Paliwo",
    bron: "Broń",
    broń: "Broń",
    weapon: "Broń",
    samolot: "Samolot",
    aircraft: "Samolot",
    chleb: "Chleb",
    bread: "Chleb",
    bilet: "Bilet",
    ticket: "Bilet",
    jedzenie: "Jedzenie",
    food: "Jedzenie",
  };

  const PRODUCT_PL_TO_EN = {
    Żelazo: "Iron",
    Tytan: "Titanium",
    Zboże: "Grain",
    Paliwo: "Fuel",
    Broń: "Weapon",
    Samolot: "Aircraft",
    Chleb: "Bread",
    Bilet: "Ticket",
    Jedzenie: "Food",
  };

  const RAW_STOCK_NAME_ALIASES = {
    "Żelazo": ["Żelazo", "Zelazo", "Iron"],
    Tytan: ["Tytan", "Titanium"],
    "Zboże": ["Zboże", "Zboze", "Grain"],
    Paliwo: ["Paliwo", "Fuel", "Oil", "Ropa"],
  };

  const getRawStockCandidates = (rawName) => {
    const canonicalPl = PRODUCT_CANONICAL_PL[normalizeLookupKey(rawName)] || rawName;
    const localized = USER_LANG === "en" ? PRODUCT_PL_TO_EN[canonicalPl] || canonicalPl : canonicalPl;
    const aliases = RAW_STOCK_NAME_ALIASES[canonicalPl] || [canonicalPl];
    const all = [rawName, canonicalPl, localized, ...aliases].filter(Boolean);
    return Array.from(new Set(all));
  };

  const EJA_DEBUG_RAW = false;
  const debugRaw = (...args) => {
    if (!EJA_DEBUG_RAW) return;
    console.log("[EJA RAW]", ...args);
  };

  const RAW_CANONICAL_PL = new Set(["Żelazo", "Tytan", "Zboże", "Paliwo"]);

  const normalizeProductName = (name) => {
    const input = String(name || "").trim();
    if (!input) return "";

    // Accept normal spaces and NBSP before Q suffix.
    const match = input.match(/^(.*?)(?:[\s\u00A0]+Q(\d+))?$/i);
    const baseNameRaw = (match?.[1] || input).trim();
    const quality = match?.[2] ? ` Q${match[2]}` : "";
    const canonicalPl = PRODUCT_CANONICAL_PL[normalizeLookupKey(baseNameRaw)] || baseNameRaw;
    const localized = USER_LANG === "en" ? PRODUCT_PL_TO_EN[canonicalPl] || canonicalPl : canonicalPl;

    // Raws should never display Q suffix.
    if (RAW_CANONICAL_PL.has(canonicalPl)) return localized;
    return `${localized}${quality}`;
  };

  const getTodayDateKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };

  const getYesterdayDateKey = () => {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };

  const getDateKeyDaysAgo = (daysAgo) => {
    const now = new Date();
    now.setDate(now.getDate() - daysAgo);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };

  let worklogTodayDebugged = false;
  const parseWorklogRaw = (worklogRaw) => {
    if (!worklogRaw) return null;
    try {
      return JSON.parse(String(worklogRaw).replace(/&quot;/g, '"'));
    } catch {
      return null;
    }
  };

  const getWorklogEntryByDate = (worklogRaw, dateObj) => {
    const worklog = parseWorklogRaw(worklogRaw);
    if (!worklog) return null;
    const day = dateObj.getDate();
    const month = dateObj.getMonth() + 1;
    const year = dateObj.getFullYear();
    const entry = Object.entries(worklog).find(([k]) => {
      const parts = String(k).split("/");
      if (parts.length < 2) return false;
      const keyDay = parseInt(parts[0], 10);
      const keyMonth = parseInt(parts[1], 10);
      const keyYear = parts[2] ? parseInt(parts[2], 10) : null;
      if (!Number.isFinite(keyDay) || !Number.isFinite(keyMonth)) return false;
      if (keyYear && Number.isFinite(keyYear) && keyYear !== year) return false;
      return keyDay === day && keyMonth === month;
    });
    return entry || null;
  };

  const getTodayWorklogEntry = (worklogRaw) => {
    if (!worklogRaw) return null;
    try {
      const worklog = parseWorklogRaw(worklogRaw);
      if (!worklog) return null;
      const entry = getWorklogEntryByDate(worklogRaw, new Date());
      if (!entry && !worklogTodayDebugged) {
        worklogTodayDebugged = true;
        console.debug("[EJA] Brak wpisu worklog na dzisiaj", { worklogKeys: Object.keys(worklog).slice(0, 5) });
      }
      return entry || null;
    } catch {
      return null;
    }
  };

  const openDashboardDB = () => {
    return new Promise((resolve, reject) => {
      if (dashboardDB) return resolve(dashboardDB);
      try {
        const request = indexedDB.open(DASHBOARD_DB_NAME, DASHBOARD_DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          dashboardDB = request.result;
          resolve(dashboardDB);
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(DASHBOARD_STORE_NAME)) {
            db.createObjectStore(DASHBOARD_STORE_NAME, { keyPath: "date" });
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  };

  const saveDailySnapshot = async (data) => {
    try {
      const db = await openDashboardDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DASHBOARD_STORE_NAME, "readwrite");
        const store = tx.objectStore(DASHBOARD_STORE_NAME);
        const request = store.put({ date: getTodayDateKey(), ...data, savedAt: Date.now() });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn("[EJA Dashboard] Failed to save snapshot:", e);
    }
  };

  const getDailySnapshot = async (dateKey) => {
    try {
      const db = await openDashboardDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DASHBOARD_STORE_NAME, "readonly");
        const store = tx.objectStore(DASHBOARD_STORE_NAME);
        const request = store.get(dateKey);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn("[EJA Dashboard] Failed to get snapshot:", e);
      return null;
    }
  };

  const getSnapshotsRange = async (days = 7) => {
    try {
      const db = await openDashboardDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DASHBOARD_STORE_NAME, "readonly");
        const store = tx.objectStore(DASHBOARD_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
          const all = request.result || [];
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          const recent = all.filter((s) => s.savedAt && s.savedAt >= cutoff);
          resolve(recent);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn("[EJA Dashboard] Failed to get snapshots range:", e);
      return [];
    }
  };

  // ============================================
  // BUSINESS DASHBOARD - Data Collection
  // ============================================
  const parseUserCurrencies = () => {
    const currencies = {};
    // Try modal first
    const items = document.querySelectorAll(".currency-list .currency-item, #allCurrenciesModal .currency-item");
    items.forEach((item) => {
      const img = item.querySelector("img");
      const span = item.querySelector("span.ml-3, span.font-14");
      if (!span) return;
      const text = (span.textContent || "").trim();
      const match = text.match(/^([\d.,\s]+)\s*(\S+)$/);
      if (!match) return;
      const amount = parseFloat(match[1].replace(/\s/g, "").replace(",", ".")) || 0;
      const code = match[2].trim();
      currencies[code] = {
        amount,
        icon: img ? img.src : "",
        code,
      };
    });
    return currencies;
  };

    const collectDashboardCompanyData = (root = document, yesterday = null) => {
    const companies = [];
    const containers = root.querySelectorAll(".holdings-container");
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);

    const parseProductionEntry = (entryData, companyQuality, targetMap) => {
      if (!entryData || !entryData.production) return;
      try {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = entryData.production;
        tempDiv.querySelectorAll(".item.production").forEach((prodItem) => {
          const prodImg = prodItem.querySelector("img");
          const prodAmount = parseFloat(prodItem.querySelector(".item__amount-representation")?.textContent || "0") || 0;
          if (prodAmount <= 0) return;
          let prodName = prodImg ? prodImg.title || prodImg.alt || "Produkt" : "Produkt";
          const normalizedProdName = normalizeLookupKey(prodName);
          const isRawResource =
            normalizedProdName === "zelazo" ||
            normalizedProdName === "iron" ||
            normalizedProdName === "zboze" ||
            normalizedProdName === "grain" ||
            normalizedProdName === "tytan" ||
            normalizedProdName === "titanium" ||
            normalizedProdName === "paliwo" ||
            normalizedProdName === "fuel" ||
            normalizedProdName === "oil" ||
            normalizedProdName === "ropa";
          const hasQualitySuffix = /\sQ\d+\b/i.test(prodName);
          if (companyQuality > 0 && !isRawResource && !hasQualitySuffix) {
            prodName = `${prodName} Q${companyQuality}`;
          }
          const normalizedName = normalizeProductName(prodName);
          if (!targetMap[normalizedName]) targetMap[normalizedName] = { amount: 0, icon: prodImg?.src || "" };
          targetMap[normalizedName].amount += prodAmount;
          if (!targetMap[normalizedName].icon && prodImg?.src) targetMap[normalizedName].icon = prodImg.src;
        });
      } catch {}
    };

    containers.forEach((container) => {
      const headerRow = container.querySelector(".row.closeHoldings[data-target]");
      if (!headerRow) return;
      const label = headerRow.querySelector(".holdings-description span");
      let sectionName = label ? (label.dataset.ejaOriginalLabel || label.textContent || "").trim() : "Firmy";
      sectionName = sectionName.replace(/\(\d+.*$/, "").trim();

      const targetKey = (headerRow.getAttribute("data-target") || "").trim();
      if (!targetKey) return;
      const targetList = container.querySelector(`.${targetKey}`) || container.querySelector(`#${targetKey}`);
      if (!targetList) return;
      const companyRows = targetList.querySelectorAll(".hasBorder[data-id]");
      companyRows.forEach((row) => {
        const companyId = row.getAttribute("data-id") || "";
        const companyName = row.querySelector(".company-name-h5 span, .company-name, h5")?.textContent?.trim() || "Firma";
        const companyType = (row.getAttribute("data-type") || "").trim();
        const companyQuality = parseInt(row.getAttribute("data-quality"), 10) || 0;
        const employees = row.querySelectorAll(".employees_list .employee");
        const employeeCount = employees.length;
        const wages = {};
        const wagesUnpaidToday = {};
        const productions = {};
        const capacityFromEmployees = {};

        employees.forEach((emp) => {
          const wage = parseFloat(emp.getAttribute("data-wage") || "0") || 0;
          const currencyCode = emp.getAttribute("data-currencyname") || emp.getAttribute("data-currencycode") || "";
          const currencyIcon = emp.getAttribute("data-currencyavatar") || "";
          const worklogRaw = emp.getAttribute("data-worklog") || "";
          const todayEntry = getTodayWorklogEntry(worklogRaw);
          const workedToday = Boolean(todayEntry && todayEntry[1]);

          if (wage > 0 && currencyCode) {
            if (!wages[currencyCode]) wages[currencyCode] = { amount: 0, icon: currencyIcon };
            wages[currencyCode].amount += wage;
            if (!workedToday) {
              if (!wagesUnpaidToday[currencyCode]) wagesUnpaidToday[currencyCode] = { amount: 0, icon: currencyIcon };
              wagesUnpaidToday[currencyCode].amount += wage;
            }
          }

          if (todayEntry && todayEntry[1]) {
            parseProductionEntry(todayEntry[1], companyQuality, productions);
          }

          const employeeCapacity = {};
          if (todayEntry && todayEntry[1]) {
            parseProductionEntry(todayEntry[1], companyQuality, employeeCapacity);
          }
          if (Object.keys(employeeCapacity).length === 0) {
            const yEntry = getWorklogEntryByDate(worklogRaw, yesterdayDate);
            if (yEntry && yEntry[1]) {
              parseProductionEntry(yEntry[1], companyQuality, employeeCapacity);
            }
          }
          Object.entries(employeeCapacity).forEach(([name, data]) => {
            if (!capacityFromEmployees[name]) capacityFromEmployees[name] = { amount: 0, icon: data.icon || "" };
            capacityFromEmployees[name].amount += data.amount || 0;
            if (!capacityFromEmployees[name].icon && data.icon) capacityFromEmployees[name].icon = data.icon;
          });
        });

        Object.entries(capacityFromEmployees).forEach(([name, data]) => {
          if (!productions[name]) productions[name] = { amount: 0, icon: data.icon || "" };
          if (!productions[name].icon && data.icon) productions[name].icon = data.icon;
          productions[name].capacity = Math.max(productions[name].capacity || 0, data.amount || 0);
        });

        const yesterdayCompany = yesterday?.companies?.find((c) => c.id === companyId);
        if (yesterdayCompany && yesterdayCompany.productions) {
          Object.entries(yesterdayCompany.productions).forEach(([name, data]) => {
            const normalizedName = normalizeProductName(name);
            if (!productions[normalizedName]) productions[normalizedName] = { amount: 0, icon: data.icon };
            productions[normalizedName].capacity = Math.max(
              productions[normalizedName].capacity || 0,
              data.capacity || data.amount || 0,
            );
          });
        }

        Object.keys(productions).forEach((name) => {
          const todayAmt = productions[name].amount || 0;
          const capAmt = productions[name].capacity || 0;
          productions[name].capacity = Math.max(todayAmt, capAmt);
        });

        companies.push({
          id: companyId,
          name: companyName,
          type: companyType,
          quality: companyQuality,
          section: sectionName,
          employeeCount,
          wages,
          wagesUnpaidToday,
          productions,
        });
      });
    });
    return companies;
  };

  const parseStorageItems = (root) => {
    const items = {};
    const elements = root.querySelectorAll(".storage-item");

    elements.forEach((el) => {
      // Try data attributes first (User Storage)
      let name = el.getAttribute("data-itemname");
      const id = el.getAttribute("data-itemid");

      // Fallback: Check ID if name is empty
      if (!name) {
        if (id && RAW_ID_MAP[id]) name = RAW_ID_MAP[id];
      }

      // Try image alt (Holding Modal/Page)
      if (!name) {
        // Find all images with alt
        const imgs = el.querySelectorAll("img[alt]");
        for (const img of imgs) {
          const alt = img.getAttribute("alt");
          if (alt && alt.toLowerCase() !== "star" && alt.toLowerCase() !== "stars") {
            name = alt;
            break;
          }
        }
      }

      if (!name) return;
      // Clean name
      name = name.trim();

      // Amount: User Storage uses .ec-amount, Holding uses .item-amount direct text
      let amountEl = el.querySelector(".ec-amount");
      if (!amountEl) {
        amountEl = el.querySelector(".item-amount");
      }
      if (!amountEl) return;

      const amount = parseFloat(amountEl.textContent.replace(/[,.\s]/g, "")) || 0;

      // Quality
      let quality = parseInt(el.getAttribute("data-itemquality")) || 0;
      if (!quality) {
        // Count stars
        quality = el.querySelectorAll(".item-level img").length;
      }

      // Map to unified if possible, otherwise keep as is
      const unified = UNIFIED_RAW_NAMES[name] || name;

      // For non-raw items, distinguish by quality to avoid merging Q4 and Q5
      const isRaw = [
        "zelazo",
        "żelazo",
        "iron",
        "tytan",
        "titanium",
        "zboze",
        "zboże",
        "grain",
        "paliwo",
        "fuel",
        "ropa",
        "oil",
      ].includes(normalizeLookupKey(unified));
      const normalizedName = normalizeProductName(unified);
      const hasQualityInName = /\sQ\d+\b/i.test(normalizedName);
      const key = !isRaw && quality > 0 && !hasQualityInName ? `${normalizedName} Q${quality}` : normalizedName;

      if (!items[key]) items[key] = { amount: 0, quality: quality, rawName: name };
      items[key].amount += amount;
    });
    return items;
  };

  const fetchUserStorage = async () => {
    try {
      const resp = await fetch("/storage");
      if (!resp.ok) return {};
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      return parseStorageItems(doc);
    } catch (e) {
      console.warn("[EJA] Failed to fetch user storage", e);
      return {};
    }
  };
  const fetchHoldingData = async (holdingId, holdingName) => {
    try {
      const url = `${location.origin}/holding/${holdingId}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return null;
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Parse storage capacity from modal or page
      // Format: "(64,925/71,250)" or similar
      let storageUsed = 0,
        storageCapacity = 0;
      const storageText = doc.querySelector(".current-main-storage-capacity")?.parentElement?.textContent || "";
      const storageMatch = storageText.match(/\(([\d.,]+)\/([\d.,]+)\)/);
      if (storageMatch) {
        storageUsed = parseFloat(storageMatch[1].replace(/[,.\s]/g, "")) || 0;
        storageCapacity = parseFloat(storageMatch[2].replace(/[,.\s]/g, "")) || 0;
      }

      // Parse items BEFORE cleaning up garbage, to ensure we don't accidentally remove storage container
      const storageItems = parseStorageItems(doc);

      // Clean up doc to remove user's wallet info (sidebar, modals, navbar) to avoid false positives
      const garbageSelectors = [
        ".sidebar",
        ".main-sidebar",
        ".navbar",
        "#allCurrenciesModal",
        ".user-panel",
        ".dropdown-menu",
        ".main-header",
      ];
      garbageSelectors.forEach((sel) => doc.querySelectorAll(sel).forEach((el) => el.remove()));

      // Generic currency parser for holding bank
      const bank = {};

      // STRICT Strategy: Only look into specific holding containers.
      // Do NOT scan body or random divs to avoid catching global user wallet.
      const potentialContainers = [
        ...doc.querySelectorAll(".currencies-list .holding__currency"),
        ...doc.querySelectorAll(".holding-info"),
      ];

      // Helper to parse text node: "10.408 IEP" -> {amount: 10408, code: "IEP"}
      const parseText = (txt) => {
        // Matches: "10.408 IEP", "538.394 PLN", "123 GOLD"
        const m = txt.match(/([\d\s.,]+)\s+([A-Z]{3}|Zloto|Gold|Credits)/i);
        if (m) {
          const valStr = m[1].replace(/\s/g, "");
          let amount = 0;
          // Improved parsing logic for Eclesiar formats
          if (valStr.includes(",") && valStr.includes(".")) {
            amount = parseFloat(valStr.replace(/\./g, "").replace(",", "."));
          } else if (valStr.includes(",")) {
            amount = parseFloat(valStr.replace(",", "."));
          } else {
            amount = parseFloat(valStr);
          }

          const code = m[2].trim();
          // Blacklist global currencies that shouldn't appear in holding local bank (usually)
          // Or just user reported "Gem" / "eac" as noise.
          if (/Gem|eac/i.test(code)) return null;

          return { amount, code };
        }
        return null;
      };

      // Scan items - prioritize strict selector
      const items =
        potentialContainers.length > 0
          ? potentialContainers
          : doc.querySelectorAll(".currencies-list > *, .holding__currency"); // Fallback strictish

      items.forEach((el) => {
        const txt = el.innerText || el.textContent;
        if (!txt) return;

        const cleanTxt = txt.replace(/\n/g, " ").trim();
        if (cleanTxt.length > 50) return;

        const res = parseText(cleanTxt);
        if (res && res.code && !bank[res.code]) {
          const img = el.querySelector("img");
          bank[res.code] = { amount: res.amount, icon: img?.src || "" };
        }
      });

      return {
        id: holdingId,
        name: holdingName,
        storage: { used: storageUsed, capacity: storageCapacity, free: storageCapacity - storageUsed },
        bank,
        items: storageItems,
      };
    } catch (e) {
      console.warn(`[EJA] Failed to fetch holding ${holdingId}:`, e);
      return null;
    }
  };

  const fetchAllHoldingsData = async (holdings) => {
    const promises = holdings.map((h) => fetchHoldingData(h.id, h.name));
    const results = await Promise.all(promises);
    return results.filter(Boolean);
  };

  // Calculate wages ONLY for "My Companies" (personal wallet needs)
  const calculateWageNeeds = (companies) => {
    const needs = {};
    // Filter companies: only include personal section names (PL/EN variants)
    const myCompanies = companies.filter((c) => isPersonalSectionName(c.section));

    myCompanies.forEach((c) => {
      Object.entries(c.wages).forEach(([code, data]) => {
        if (!needs[code]) needs[code] = { amount: 0, icon: data.icon };
        needs[code].amount += data.amount;
      });
    });
    return needs;
  };

  const calculateCurrencyStatus = (have, need) => {
    const status = {};
    const allCodes = new Set([...Object.keys(have), ...Object.keys(need)]);
    allCodes.forEach((code) => {
      const haveAmt = have[code]?.amount || 0;
      const needAmt = need[code]?.amount || 0;
      const diff = haveAmt - needAmt;
      const daysLeft = needAmt > 0 ? haveAmt / needAmt : Infinity;
      const coverageStatus = needAmt <= 0 ? "ok" : daysLeft >= 2 ? "ok" : daysLeft >= 1 ? "warning" : "insufficient";
      status[code] = {
        have: haveAmt,
        need: needAmt,
        diff,
        daysLeft,
        icon: have[code]?.icon || need[code]?.icon || "",
        status: coverageStatus,
      };
    });
    return status;
  };

  const getCurrencyStatusColor = (status) => {
    if (status === "ok") return "#22c55e";
    if (status === "warning") return "#f59e0b";
    return "#ef4444";
  };

  const getWageCoverageLabel = (bankAmt, dailyWage, unpaidToday) => {
    const daysLeft = dailyWage > 0 ? bankAmt / dailyWage : 0;
    const remainingToday = Math.max(0, unpaidToday || 0);
    const todayCovered = dailyWage > 0 && bankAmt >= remainingToday;
    const label = todayCovered ? "Dzisiaj oplacone, brakuje" : "Brakuje juz na dzisiaj";
    return { daysLeft, label };
  };

  // ============================================
  // BUSINESS DASHBOARD - UI
  // ============================================
  const ensureDashboardStyles = () => {
    if (document.getElementById("eja-dashboard-styles")) return;
    const style = document.createElement("style");
    style.id = "eja-dashboard-styles";
    style.textContent = `
      .eja-dashboard-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 99998;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .eja-dashboard-backdrop.visible { opacity: 1; }
      .eja-dashboard-overlay {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 90%;
        max-width: 900px;
        max-height: 85vh;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        z-index: 99999;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        color: #e2e8f0;
        font-family: system-ui, -apple-system, sans-serif;
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .eja-dashboard-overlay.visible { opacity: 1; }
      .eja-dashboard-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
      }
      .eja-dashboard-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .eja-dashboard-close {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: #e2e8f0;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 18px;
        transition: background 0.15s;
      }
      .eja-dashboard-close:hover { background: rgba(255, 255, 255, 0.2); }
      .eja-dashboard-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      }
      .eja-dashboard-section {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
      }
      .eja-dashboard-section h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #94a3b8;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .eja-currency-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 10px;
      }
      .eja-currency-card {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        padding: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .eja-currency-card img {
        width: 28px;
        height: 28px;
        border-radius: 4px;
      }
      .eja-currency-info { flex: 1; }
      .eja-currency-code { font-weight: 600; font-size: 13px; }
      .eja-currency-values { font-size: 11px; color: #94a3b8; }
      .eja-currency-status {
        font-size: 18px;
        width: 28px;
        text-align: center;
      }
      .eja-status-ok { color: #22c55e; }
      .eja-status-warning { color: #f59e0b; }
      .eja-status-insufficient { color: #ef4444; }
      .eja-buy-link {
        font-size: 10px;
        color: #60a5fa;
        text-decoration: none;
        display: block;
        margin-top: 2px;
      }
      .eja-buy-link:hover { text-decoration: underline; }
      .eja-company-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .eja-company-table th {
        text-align: left;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        color: #94a3b8;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
      }
      .eja-company-table td {
        padding: 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        vertical-align: middle;
      }
      .eja-company-table tr:hover td {
        background: rgba(255, 255, 255, 0.03);
      }
      .eja-trend-up { color: #22c55e; }
      .eja-trend-down { color: #ef4444; }
      .eja-trend-same { color: #94a3b8; }
      .eja-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        font-size: 11px;
        margin: 2px 4px 2px 0; /* Added margin-right to separate chips */
      }
      .eja-chip img { width: 14px; height: 14px; }
      .eja-dashboard-footer {
        padding: 12px 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        color: #64748b;
      }
      .eja-dashboard-btn {
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        border: none;
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        font-size: 13px;
        transition: transform 0.1s, box-shadow 0.1s;
      }
      .eja-dashboard-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
      }
      .eja-empty-state {
        text-align: center;
        padding: 30px;
        color: #64748b;
      }
      .eja-holdings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
      }
      .eja-holding-card {
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .eja-holding-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: #e2e8f0;
        margin-bottom: 4px;
      }
      .eja-holding-row {
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      @media (max-width: 600px) {
        .eja-dashboard-overlay { width: 95%; max-height: 90vh; }
        .eja-currency-grid { grid-template-columns: 1fr; }
        .eja-company-table { font-size: 11px; }
        .eja-company-table th, .eja-company-table td { padding: 6px; }
      }
      .eja-currency-compact-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        gap: 8px;
      }
      .eja-currency-compact-item {
        background: rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 6px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
      }
      .eja-currency-compact-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
        color: #e2e8f0;
      }
      .eja-holding-alert {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #fca5a5;
        font-size: 10px;
        padding: 4px 6px;
        border-radius: 4px;
        margin-top: 4px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .eja-action-list { display: flex; flex-direction: column; gap: 8px; }
      .eja-action-item {
        background: rgba(0,0,0,0.2);
        padding: 10px;
        border-radius: 6px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        border-left: 3px solid #64748b;
      }
      .eja-action-item.critical { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
      .eja-action-item.warning { border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.1); }
      .eja-action-item.high { border-left-color: #f59e0b; }
      .eja-action-item.is-done {
        opacity: 0.45;
        filter: saturate(0.7);
        border-left-color: #64748b !important;
        background: rgba(100, 116, 139, 0.12) !important;
      }
      .eja-action-item__main {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .eja-action-item__check {
        margin-top: 2px;
        width: 16px;
        height: 16px;
        cursor: pointer;
      }
      .eja-action-btn {
        font-size: 11px;
        padding: 4px 8px;
        background: rgba(255,255,255,0.1);
        border-radius: 4px;
        text-decoration: none;
        color: #e2e8f0;
        white-space: nowrap;
        margin-left: 10px;
      }
      .eja-action-btn:hover { background: rgba(255,255,255,0.2); }
    `;
    document.head.appendChild(style);
  };

  const closeDashboardOverlay = () => {
    dashboardOverlayOpen = false;
    updateJobsOverlayPause();
    const backdrop = document.getElementById("eja-dashboard-backdrop");
    const overlay = document.getElementById("eja-dashboard-overlay");
    if (backdrop) {
      backdrop.classList.remove("visible");
      setTimeout(() => backdrop.remove(), 200);
    }
    if (overlay) {
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 200);
    }
    if (document.__ejaDashboardEscHandler) {
      document.removeEventListener("keydown", document.__ejaDashboardEscHandler);
      document.__ejaDashboardEscHandler = null;
    }
  };

  const openDashboardOverlay = async () => {
    if (dashboardOverlayOpen) return;
    dashboardOverlayOpen = true;
    updateJobsOverlayPause();
    ensureDashboardStyles();
    const backdrop = document.createElement("div");
    backdrop.id = "eja-dashboard-backdrop";
    backdrop.className = "eja-dashboard-backdrop";
    document.body.appendChild(backdrop);

    const overlay = document.createElement("div");
    overlay.id = "eja-dashboard-overlay";
    overlay.className = "eja-dashboard-overlay";
    overlay.innerHTML = `
      <div class="eja-dashboard-header">
        <h2>📊 Centrum Przedsiębiorcy</h2>
        <button class="eja-dashboard-close" title="Zamknij">✕</button>
      </div>
      <div class="eja-dashboard-body">
        <div class="eja-dashboard-loading">⏳ Ładowanie danych...</div>
      </div>
      <div class="eja-dashboard-footer">
        <span>Trwa ładowanie...</span>
        <button class="eja-dashboard-btn eja-refresh-btn" disabled>⏳</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const bindDashboardEvents = () => {
      const closeBtn = overlay.querySelector(".eja-dashboard-close");
      if (closeBtn) {
        closeBtn.addEventListener("click", closeDashboardOverlay);
        closeBtn.addEventListener("pointerdown", closeDashboardOverlay);
      }
      backdrop.addEventListener("click", closeDashboardOverlay);
      backdrop.addEventListener("pointerdown", closeDashboardOverlay);
      overlay.querySelector(".eja-refresh-btn")?.addEventListener("click", async () => {
        closeDashboardOverlay();
        setTimeout(() => openDashboardOverlay(), 100);
      });
      document.__ejaDashboardEscHandler = (e) => {
        if (e.key === "Escape" && dashboardOverlayOpen) {
          closeDashboardOverlay();
        }
      };
      document.addEventListener("keydown", document.__ejaDashboardEscHandler);

      if (!overlay.__ejaActionDoneBound) {
        overlay.__ejaActionDoneBound = true;
        overlay.addEventListener("change", (event) => {
          const target = event.target;
          if (!target || !target.matches || !target.matches("input[data-eja-action-done]")) return;
          const actionId = target.getAttribute("data-eja-action-done") || "";
          const isDone = Boolean(target.checked);
          setActionItemDone(actionId, isDone);
          const row = target.closest(".eja-action-item");
          if (row) row.classList.toggle("is-done", isDone);
        });
      }
    };

    bindDashboardEvents();

    // Animate in
    requestAnimationFrame(() => {
      backdrop.classList.add("visible");
      overlay.classList.add("visible");
    });

    try {
      // Collect initial data
      const yesterday = await getDailySnapshot(getYesterdayDateKey());
      if (!dashboardOverlayOpen) return;
      const companies = collectDashboardCompanyData(document, yesterday);
      const userCurrencies = parseUserCurrencies();
      let userStorage = {};
      try {
        userStorage = await fetchUserStorage();
      } catch (e) {
        console.warn("Failed to fetch user storage", e);
      }

      // Fetch holdings data (bank, storage) from /jobs list (no "Moje miejsca" cache)
      // This allows us to subtract holding bank balance from wage needs
      const cachedHoldings = await getHoldingsFromJobs();
      let holdingsData = [];
      if (cachedHoldings.length > 0) {
        try {
          holdingsData = await fetchAllHoldingsData(cachedHoldings);
        } catch (e) {
          console.warn("[EJA] Error fetching holdings:", e);
        }
      }

      if (!dashboardOverlayOpen) return;

      // Calculate needs (Reverted to simple calculation)
      const wageNeeds = calculateWageNeeds(companies);
      const currencyStatus = calculateCurrencyStatus(userCurrencies, wageNeeds);

      // Save today's snapshot
      await saveDailySnapshot({ companies, currencies: userCurrencies, holdings: holdingsData });
      if (!dashboardOverlayOpen) return;

      overlay.innerHTML = buildDashboardHTML(companies, currencyStatus, yesterday, holdingsData, userStorage);
      bindDashboardEvents();
    } catch (e) {
      const body = overlay.querySelector(".eja-dashboard-body");
      if (body)
        body.innerHTML = '<div class="eja-sales-muted">Nie udało się załadować danych Centrum Przedsiębiorcy.</div>';
      console.warn("[EJA Dashboard] Failed to build overlay:", e);
    }
  };

  const buildDashboardHTML = (companies, currencyStatus, yesterday, holdingsData = [], userStorage = {}) => {
    // --- RAW MATERIAL CALCULATIONS HELPER ---
    function renderRawMaterialsSection(sectionName, sectionCompanies, holdings, userStorage) {
      // 1. Calculate Needs
      const needs = {};
      sectionCompanies.forEach((c) => {
        const rawName = getRawForCompanyType(c.type);
        // Normalize to unified key (e.g. "Iron" -> "Zelazo")
        const mappedRaw = UNIFIED_RAW_NAMES[rawName] || rawName;

        if (mappedRaw && c.quality) {
          const daily = RAW_CONSUMPTION_RATES[c.quality] || 0;
          if (daily > 0 && c.employeeCount > 0) {
            if (!needs[mappedRaw]) needs[mappedRaw] = 0;
            needs[mappedRaw] += daily * c.employeeCount;
          }
        }
      });

      if (Object.keys(needs).length === 0) return "";

      // 2. Find Available Stock
      let stocks = {};

      // Case-insensitive matching for Holding
      const holding = holdings.find((h) => normalizeSectionName(h.name) === normalizeSectionName(sectionName));

      if (holding) {
        // Holding Section -> Use Holding Storage ONLY
        stocks = holding.items || {};
      } else if (isPersonalSectionName(sectionName)) {
        // Private Section -> Use User Storage
        stocks = userStorage;
      } else {
        // Other sections (e.g. generic Summary?) -> No detailed storage view, or maybe agg?
        // Leaving empty to avoid confusion with zeros.
        return "";
      }

      // 3. Render
      debugRaw("Section snapshot", {
        sectionName,
        needs,
        stocksKeys: Object.keys(stocks || {}),
      });
      const rows = Object.entries(needs)
        .map(([rawName, dailyNeed]) => {
          const candidates = getRawStockCandidates(rawName);
          const stockItem = candidates.map((name) => stocks[name]).find(Boolean) || { amount: 0 };
          const have = stockItem.amount || 0;
          const daysLeft = dailyNeed > 0 ? have / dailyNeed : 0;
          const statusColor = daysLeft >= 1 ? "#22c55e" : daysLeft > 0.2 ? "#f59e0b" : "#ef4444";
          debugRaw("Raw row", {
            sectionName,
            rawName,
            candidates,
            matchedKey: candidates.find((name) => Boolean(stocks[name])) || null,
            have,
            dailyNeed,
          });

          return `
               <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-bottom:2px;">
                 <span>${rawName}</span>
                 <span>
                    <span style="color:${statusColor};font-weight:600;">${have.toLocaleString()}</span> 
                    <span style="color:#64748b;"> / ${dailyNeed.toLocaleString()}</span>
                    ${dailyNeed > 0 ? `<span style="color:${statusColor};margin-left:4px;">(${daysLeft.toFixed(1)}d)</span>` : ""}
                 </span>
               </div>
             `;
        })
        .join("");

      return `
           <div style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);">
             <strong style="color:#94a3b8;font-size:11px;display:block;margin-bottom:4px;">MAGAZYN SUROWCÓW (Wymagane na 1 dzień):</strong>
             ${rows}
           </div>
         `;
    }

    // Group companies by section
    const sections = {};
    companies.forEach((c) => {
      if (!sections[c.section])
        sections[c.section] = { name: c.section, companies: [], wages: {}, wagesUnpaidToday: {}, productions: {} };
      sections[c.section].companies.push(c);
      // Aggregate wages per section
      Object.entries(c.wages).forEach(([code, data]) => {
        if (!sections[c.section].wages[code]) sections[c.section].wages[code] = { amount: 0, icon: data.icon };
        sections[c.section].wages[code].amount += data.amount;
      });
      Object.entries(c.wagesUnpaidToday).forEach(([code, data]) => {
        if (!sections[c.section].wagesUnpaidToday[code])
          sections[c.section].wagesUnpaidToday[code] = { amount: 0, icon: data.icon };
        sections[c.section].wagesUnpaidToday[code].amount += data.amount;
      });
      // Aggregate productions per section
      Object.entries(c.productions).forEach(([name, data]) => {
        const normName = normalizeProductName(name);
        if (!sections[c.section].productions[normName])
          sections[c.section].productions[normName] = { amount: 0, capacity: 0, icon: data.icon };
        sections[c.section].productions[normName].amount += data.amount;
        // Aggregate capacity (potential production)
        sections[c.section].productions[normName].capacity += data.capacity || data.amount;
      });
    });

    // Ensure holdings without companies are still visible in 'Centrum Przedsiębiorcy'
    const sectionKeys = new Set(Object.keys(sections).map((name) => normalizeSectionName(name)));
    holdingsData.forEach((holding) => {
      const key = normalizeSectionName(holding?.name);
      if (!key || sectionKeys.has(key)) return;
      sections[holding.name] = { name: holding.name, companies: [], wages: {}, wagesUnpaidToday: {}, productions: {} };
      sectionKeys.add(key);
    });

    // Total production summary
    const totalProductions = {};
    companies.forEach((c) => {
      Object.entries(c.productions).forEach(([name, data]) => {
        const normName = normalizeProductName(name);
        if (!totalProductions[normName]) totalProductions[normName] = { amount: 0, icon: data.icon };
        totalProductions[normName].amount += data.amount;
      });
    });
    const totalEmployees = companies.reduce((sum, c) => sum + c.employeeCount, 0);
    const yesterdayTotalEmployees = yesterday?.companies?.reduce((sum, c) => sum + (c.employeeCount || 0), 0) || null;
    const totalEmpTrend = yesterdayTotalEmployees !== null ? totalEmployees - yesterdayTotalEmployees : null;
    const totalWages = {};
    companies.forEach((c) => {
      Object.entries(c.wages).forEach(([code, data]) => {
        if (!totalWages[code]) totalWages[code] = { amount: 0, icon: data.icon };
        totalWages[code].amount += data.amount;
      });
    });

    // Build employee display with yesterday comparison
    const buildEmployeeDisplay = (current, yesterdayCount, trendDiff) => {
      if (yesterdayCount === null) return `${current}`;
      const trendClass = trendDiff > 0 ? "eja-trend-up" : trendDiff < 0 ? "eja-trend-down" : "eja-trend-same";
      const trendSign = trendDiff > 0 ? "+" : "";
      return `${current} <span style="font-size:14px;color:#64748b;">(Wczoraj: ${yesterdayCount}, <span class="${trendClass}">${trendSign}${trendDiff}</span>)</span>`;
    };

    // Build total production chips
    const totalProdChips =
      Object.entries(totalProductions)
        .map(
          ([name, data]) =>
            `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount} ${name}</span>`,
        )
        .join("") || '<span style="color:#64748b">—</span>';

    const totalWagesChips =
      Object.entries(totalWages)
        .map(
          ([code, data]) =>
            `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toFixed(3)} ${code}</span>`,
        )
        .join("") || '<span style="color:#64748b">—</span>';

    const buildCurrencyBankChips = (entries) =>
      entries
        .map((entry) => {
          const color = getCurrencyStatusColor(entry.status);
          const daysBadge =
            Number.isFinite(entry.daysLeft) && entry.daysLeft >= 0
              ? `<span style="margin-left:4px;color:${color};font-size:10px;">(${entry.daysLeft.toFixed(1)}d)</span>`
              : "";
          return `<span class="eja-chip" style="border-left:3px solid ${color};padding-left:6px;">${entry.icon ? `<img src="${entry.icon}">` : ""}${entry.amount.toLocaleString()} ${entry.code}${daysBadge}</span>`;
        })
        .join("") || '<span style="color:#64748b">—</span>';

    // Build section HTML
    const buildSectionHTML = (sectionData, sectionName, yesterday, holdingsData) => {
      const sectionCompanies = sectionData.companies;
      const sectionEmployees = sectionCompanies.reduce((sum, c) => sum + c.employeeCount, 0);
      const yesterdaySectionCompanies = yesterday?.companies?.filter((c) => c.section === sectionName) || [];
      const yesterdayEmployees = yesterdaySectionCompanies.reduce((sum, c) => sum + (c.employeeCount || 0), 0);
      const empTrend = yesterday ? sectionEmployees - yesterdayEmployees : null;

      // Find matching holding for this section
      const holding = holdingsData.find((h) => normalizeSectionName(h.name) === normalizeSectionName(sectionName));
      const isPersonalSection = isPersonalSectionName(sectionName);

      // Build Holding Info (Merged View)
      let holdingInfoHTML = "";
      if (holding) {
        // Bank
        const bankChips =
          Object.entries(holding.bank || {})
            .map(([curr, data]) => {
              const dailyWage = sectionData.wages?.[curr]?.amount || 0;
              const daysLeft = dailyWage > 0 ? data.amount / dailyWage : Infinity;
              const status = dailyWage <= 0 ? "ok" : daysLeft >= 2 ? "ok" : daysLeft >= 1 ? "warning" : "insufficient";
              const color = getCurrencyStatusColor(status);
              const daysBadge =
                Number.isFinite(daysLeft) && daysLeft >= 0
                  ? `<span style="margin-left:4px;color:${color};font-size:10px;">(${daysLeft.toFixed(1)}d)</span>`
                  : "";
              return `<span class="eja-chip" style="border-left:3px solid ${color};padding-left:6px;">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toLocaleString()} ${curr}${daysBadge}</span>`;
            })
            .join("") || '<span style="color:#64748b">—</span>';

        // Storage
        const storageItems =
          Object.entries(holding.items || {})
            .map(([name, data]) => {
              const normalizedName = normalizeProductName(name);
              const hasQualityInName = /\sQ\d+\b/i.test(normalizedName);
              const qText = data.quality && !hasQualityInName ? ` Q${data.quality}` : "";
              return `<span class="eja-chip">${data.amount.toLocaleString()} ${normalizedName}${qText}</span>`;
            })
            .join("") || '<span style="color:#64748b;margin-left:4px;">Pusty</span>';

        let storageInfoHTML = "";
        if (holding.storage) {
          const free = holding.storage.free;
          const capColor = free < 500 ? "#ef4444" : free < 1000 ? "#f59e0b" : "#22c55e";
          // User requested explicit "Free Space" info
          const capText = `(Wolne: ${free.toLocaleString()} | ${holding.storage.used.toLocaleString()} / ${holding.storage.capacity.toLocaleString()})`;
          storageInfoHTML = `<strong style="color:${capColor};font-size:11px;margin-left:4px;">${capText}</strong>`;
        }

        holdingInfoHTML = `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);">
                <div style="margin-bottom:8px;">
                     <strong style="color:#94a3b8;font-size:11px;">STAN BANKU:</strong>
                     <div style="margin-top:4px;">${bankChips}</div>
                </div>
                <div style="display:flex;align-items:center;">
                     <strong style="color:#94a3b8;font-size:11px;">STAN MAGAZYNU ${storageInfoHTML}:</strong>
                     <div style="margin-left:8px;display:flex;flex-wrap:wrap;gap:4px;">${storageItems}</div>
                </div>
            </div>
          `;
      }
      if (!holding && isPersonalSection) {
        const bankEntries = Object.entries(currencyStatus)
          .filter(([, data]) => data.have > 0 || data.need > 0)
          .map(([code, data]) => ({
            code,
            amount: data.have || 0,
            icon: data.icon || "",
            status: data.status || "ok",
            daysLeft: data.daysLeft,
          }));
        const bankChips = buildCurrencyBankChips(bankEntries);
        holdingInfoHTML = `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);">
                <div style="margin-bottom:8px;">
                     <strong style="color:#94a3b8;font-size:11px;">STAN BANKU (MOJE FIRMY):</strong>
                     <div style="margin-top:4px;">${bankChips}</div>
                </div>
            </div>
          `;
      }

      // Section wages chips
      const sectionWagesChips =
        Object.entries(sectionData.wages)
          .map(
            ([code, data]) =>
              `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toFixed(3)} ${code}</span>`,
          )
          .join("") || "—";

      // Section production chips (Now showing CAPACITY/POTENTIAL)
      const sectionProdChips =
        Object.entries(sectionData.productions)
          .map(
            ([name, data]) =>
              `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.capacity.toLocaleString()} ${name}</span>`,
          )
          .join("") || '<span style="color:#64748b">—</span>';

      // Company rows for this section
      const companyRows = sectionCompanies
        .map((c) => {
          const yesterdayCompany = yesterday?.companies?.find((yc) => yc.id === c.id);
          const empYesterday = yesterdayCompany?.employeeCount || null;
          const empDiff = empYesterday !== null ? c.employeeCount - empYesterday : null;
          const trendClass =
            empDiff === null ? "" : empDiff > 0 ? "eja-trend-up" : empDiff < 0 ? "eja-trend-down" : "eja-trend-same";
          const trendText =
            empDiff === null ? "" : empDiff > 0 ? ` (+${empDiff})` : empDiff < 0 ? ` (${empDiff})` : " (=)";
          const wagesChips =
            Object.entries(c.wages)
              .map(
                ([code, data]) =>
                  `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toFixed(3)} ${code}</span>`,
              )
              .join("") || "—";
          const prodChips =
            Object.entries(c.productions)
              .map(([name, data]) => {
                const normName = normalizeProductName(name);
                const cap = data.capacity || data.amount;
                // Show "Amount / Cap" if strictly less, otherwise just Amount
                const valText = data.amount < cap ? `${data.amount}/${cap}` : `${data.amount}`;
                return `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${valText} ${normName}</span>`;
              })
              .join("") || '<span style="color:#64748b">—</span>';
          return `<tr>
            <td><strong>${c.name}</strong>${c.quality ? ` Q${c.quality}` : ""}<br><small style="color:#64748b">${c.type}</small></td>
            <td><span class="${trendClass}">👥 ${c.employeeCount}${trendText}</span></td>
            <td>${wagesChips}</td>
            <td>${prodChips}</td>
          </tr>`;
        })
        .join("");

      const sectionIcon = isPersonalSectionName(sectionName) ? "👤" : "🏢";
      const empDisplay = yesterday
        ? `${sectionEmployees} <span style="font-size:11px;color:#64748b;">(Wczoraj: ${yesterdayEmployees}, <span class="${empTrend > 0 ? "eja-trend-up" : empTrend < 0 ? "eja-trend-down" : "eja-trend-same"}">${empTrend > 0 ? "+" : ""}${empTrend}</span>)</span>`
        : `${sectionEmployees}`;

      return `
        <div class="eja-dashboard-section">
          <h3>${sectionIcon} ${sectionName}</h3>
          <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:12px;">
            <div><strong style="color:#94a3b8;font-size:11px;">PRACOWNICY:</strong> ${empDisplay}</div>
            <div><strong style="color:#94a3b8;font-size:11px;">KOSZTY/DZIEN:</strong> ${sectionWagesChips}</div>
            <div><strong style="color:#94a3b8;font-size:11px;">PRODUKCJA (MOZLIWOSCI):</strong> ${sectionProdChips}</div>
          </div>

          <details style="margin-top:8px;">
            <summary style="cursor:pointer;font-size:12px;color:#60a5fa;">Pokaz firmy (${sectionCompanies.length})</summary>
            <table class="eja-company-table" style="margin-top:8px;">
              <thead>
                <tr><th>Firma</th><th>Pracownicy</th><th>Koszty</th><th>Produkcja</th></tr>
              </thead>
              <tbody>${companyRows}</tbody>
            </table>
          </details>
          ${renderRawMaterialsSection(sectionName, sectionCompanies, holdingsData, userStorage)}
          ${holdingInfoHTML}
        </div>
      `;
    };

    const sectionsHTML = Object.entries(sections)
      .map(([name, data]) => buildSectionHTML(data, name, yesterday, holdingsData))
      .join("");

    // Build holdings bank & storage display
    const buildHoldingsDataHTML = (holdingsData, sections) => {
      if (!holdingsData || holdingsData.length === 0) return "";
      const holdingCards = holdingsData
        .filter((h) => (h.bank && Object.keys(h.bank).length > 0) || h.storage)
        .map((h) => {
          // Bank currencies
          const bankChips =
            Object.entries(h.bank || {})
              .filter(([, data]) => data.amount > 0)
              // Removed slice(0, 6) limit to show all currencies
              .map(
                ([code, data]) =>
                  `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toFixed(3)} ${code}</span>`,
              )
              .join("") || '<span style="color:#64748b">—</span>';

          // Storage info
          const storageInfo = h.storage
            ? `<span style="color:${h.storage.free < 100 ? "#ef4444" : "#22c55e"};">📦 ${h.storage.used.toLocaleString()} / ${h.storage.capacity.toLocaleString()} (Wolne: ${h.storage.free.toLocaleString()})</span>`
            : '<span style="color:#64748b">—</span>';

          // Alerts: Check if funds < 2 * daily wages
          let alerts = "";
          const section = sections[h.name]; // Match holding name with section name
          if (section) {
            Object.entries(section.wages).forEach(([curr, wageData]) => {
              const dailyWage = wageData.amount;
              const bankAmt = h.bank?.[curr]?.amount || 0;
              if (dailyWage > 0 && bankAmt < dailyWage * 2) {
                const unpaidToday = section.wagesUnpaidToday?.[curr]?.amount || 0;
                const { daysLeft, label } = getWageCoverageLabel(bankAmt, dailyWage, unpaidToday);
                alerts += `<div class="eja-holding-alert">⚠️ ${curr}: ${label}. Zapas: ${daysLeft.toFixed(1)} dnia (Potrzeba: ${dailyWage.toFixed(1)}/d)</div>`;
              }
            });
          }

          return `
            <div class="eja-holding-card">
              <div class="eja-holding-header">
                ${h.icon ? `<img src="${h.icon}" alt="${h.name}" style="width:24px;height:24px;border-radius:4px;">` : "🏢"}
                <strong>${h.name}</strong>
              </div>
              ${alerts}
              <div class="eja-holding-row"><span style="color:#94a3b8;font-size:11px;">BANK:</span> ${bankChips}</div>
              <div class="eja-holding-row"><span style="color:#94a3b8;font-size:11px;">MAGAZYN:</span> ${storageInfo}</div>
            </div>
          `;
        })
        .join("");
      if (!holdingCards) return "";
      return `
        <div class="eja-dashboard-section">
          <h3>🏠 Stan Holdingów</h3>
          <div class="eja-holdings-grid">${holdingCards}</div>
        </div>
      `;
    };

    // const holdingsDataHTML = buildHoldingsDataHTML(holdingsData, sections); // REMOVED (Merged into Sections)
    const holdingsDataHTML = "";

    // --- ACTION ITEMS COLLECTION ---
    const actionItems = [];

    // 1. Employee departures
    if (yesterday) {
      companies.forEach((c) => {
        const yestC = yesterday.companies?.find((yc) => yc.id === c.id);
        if (yestC && c.employeeCount < yestC.employeeCount) {
          const diff = yestC.employeeCount - c.employeeCount;
          actionItems.push({
            type: "employee",
            priority: "high",
            text: `<b>${c.name}</b> (${c.section}): Odeszło <b>${diff}</b> pracow.`,
            link: `/business/${c.id}`,
            actionId: `employee:${c.id}`,
          });
        }
      });
    }

    // 2. User Currency Shortages
    Object.entries(currencyStatus).forEach(([code, data]) => {
      if (data.status === "insufficient") {
        actionItems.push({
          type: "currency",
          priority: "critical",
          text: `Brakuje <b>${Math.abs(data.diff).toFixed(3)} ${code}</b> na koncie prywatnym.`,
          link: "https://eclesiar.com/market/coin/advanced",
          actionId: `currency:${code}`,
        });
      }
    });

    // 3. Holding Low Funds
    holdingsData.forEach((h) => {
      const section = sections[h.name];
      if (!section) return;
      Object.entries(section.wages).forEach(([curr, wageData]) => {
        const dailyWage = wageData.amount;
        const bankAmt = h.bank?.[curr]?.amount || 0;
        if (dailyWage > 0 && bankAmt < dailyWage * 2) {
          const unpaidToday = section.wagesUnpaidToday?.[curr]?.amount || 0;
          const { daysLeft, label } = getWageCoverageLabel(bankAmt, dailyWage, unpaidToday);
          actionItems.push({
            type: "holding",
            priority: "warning",
            text: `<b>${h.name}</b>: ${label} - <b>${curr}</b> na ${daysLeft.toFixed(1)} dnia. (<b>Zapotrzebowanie/dzień:</b> ${dailyWage.toFixed(3)} ${curr})`,
            link: `/holding/${h.id}`,
            marketLink: "https://eclesiar.com/market/coin/advanced",
            actionId: `holding-funds:${h.id}:${curr}`,
          });
        }
      });
    });

    // 4. Holding Low Free Storage
    holdingsData.forEach((h) => {
      const free = h?.storage?.free;
      const used = h?.storage?.used;
      const capacity = h?.storage?.capacity;
      if (!Number.isFinite(free) || !Number.isFinite(used) || !Number.isFinite(capacity) || capacity <= 0) return;
      if (free >= 1000) return;

      const priority = free < 500 ? "critical" : "warning";
      actionItems.push({
        type: "storage",
        priority,
        text: `<b>${h.name}</b>: niski wolny magazyn - <b>${Math.round(free).toLocaleString("pl-PL")}</b> wolne (${Math.round(used).toLocaleString("pl-PL")} / ${Math.round(capacity).toLocaleString("pl-PL")}).`,
        link: `/holding/${h.id}`,
        actionId: `storage-free:${h.id}`,
      });
    });

    const buildActionSection = () => {
      if (actionItems.length === 0) return "";
      const actionState = loadActionItemsState();

      const itemsHtml = actionItems
        .sort((a, b) => (a.priority === "critical" ? -1 : 1)) // Critical first
        .map((item) => {
          const actionId = item.actionId || `${item.type}:${item.link}:${item.text}`;
          const isDone = Boolean(actionState[actionId]);
          return `
                <div class="eja-action-item ${item.priority}${isDone ? " is-done" : ""}" data-eja-action-item="${actionId}">
                    <div class="eja-action-item__main">
                      <input class="eja-action-item__check" type="checkbox" data-eja-action-done="${actionId}" ${isDone ? "checked" : ""} title="Oznacz jako zrobione / pomiń">
                      <span>${item.text}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                      <a href="${item.link}" target="_blank" class="eja-action-btn">Zarzadzaj -></a>
                      ${item.marketLink ? `<a href="${item.marketLink}" target="_blank" class="eja-action-btn">Rynek walut -></a>` : ""}
                    </div>
                </div>
            `;
        })
        .join("");

      return `
            <div class="eja-dashboard-section" style="border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.05);">
                <h3 style="color: #f59e0b;">🚨 Wymagane Akcje (${actionItems.length})</h3>
                <div class="eja-action-list">
                    ${itemsHtml}
                </div>
            </div>
        `;
    };

    // --- SPLIT SUMMARY LOGIC ---
    const STATE_HOLDINGS = [
      "Polska Kompania Naftowa",
      "Polska Grupa Zywieniowa",
      "Polska Grupa Zbrojeniowa",
      "Ministerstwo Edukacji Narodowej",
      "Polska Grupa Lotnicza",
      "Publiczne Firmy",
      "Public Companies",
    ];

    const stateCompanies = companies.filter((c) =>
      STATE_HOLDINGS.some((h) => normalizeSectionName(h) === normalizeSectionName(c.section)),
    );
    const privateCompanies = companies.filter(
      (c) => !STATE_HOLDINGS.some((h) => normalizeSectionName(h) === normalizeSectionName(c.section)),
    );

    const calculateStats = (companyList) => {
      const totalEmps = companyList.reduce((sum, c) => sum + c.employeeCount, 0);
      const yestEmps =
        yesterday?.companies
          ?.filter((yc) => companyList.find((c) => c.id === yc.id))
          .reduce((sum, c) => sum + (c.employeeCount || 0), 0) || null;
      const trend = yestEmps !== null ? totalEmps - yestEmps : null;

      const wages = {};
      const productions = {};
      const uniqueSections = new Set();

      companyList.forEach((c) => {
        uniqueSections.add(c.section);
        Object.entries(c.wages).forEach(([code, data]) => {
          if (!wages[code]) wages[code] = { amount: 0, icon: data.icon };
          wages[code].amount += data.amount;
        });
        Object.entries(c.productions).forEach(([name, data]) => {
          const normName = normalizeProductName(name);
          if (!productions[normName]) productions[normName] = { amount: 0, icon: data.icon };
          productions[normName].amount += data.amount;
        });
      });

      const wageChips =
        Object.entries(wages)
          .map(
            ([code, data]) =>
              `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toFixed(3)} ${code}</span>`,
          )
          .join("") || '<span style="color:#64748b">—</span>';

      const prodChips =
        Object.entries(productions)
          .map(
            ([name, data]) =>
              `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount} ${name}</span>`,
          )
          .join("") || '<span style="color:#64748b">—</span>';

      return {
        totalEmps,
        yestEmps,
        trend,
        wageChips,
        prodChips,
        sectionCount: uniqueSections.size,
        companyCount: companyList.length,
      };
    };

    const stateStats = calculateStats(stateCompanies);
    const privateStats = calculateStats(privateCompanies);

    const renderSummaryCard = (title, stats, bgColor, icon) => `
        <div class="eja-dashboard-section" style="background:${bgColor};">
          <h3>${icon} ${title}</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;">
            <div><strong style="color:#94a3b8;font-size:11px;display:block;">PRACOWNICY</strong><span style="font-size:20px;font-weight:700;">${buildEmployeeDisplay(stats.totalEmps, stats.yestEmps, stats.trend)}</span></div>
            <div><strong style="color:#94a3b8;font-size:11px;display:block;">HOLDINGI</strong><span style="font-size:20px;font-weight:700;">${stats.sectionCount}</span></div>
            <div><strong style="color:#94a3b8;font-size:11px;display:block;">FIRMY</strong><span style="font-size:20px;font-weight:700;">${stats.companyCount}</span></div>
          </div>
          <div style="margin-top:12px;">
            <div><strong style="color:#94a3b8;font-size:11px;">KOSZTY/DZIEN:</strong> ${stats.wageChips}</div>
            <div style="margin-top:6px;"><strong style="color:#94a3b8;font-size:11px;">PRODUKCJA:</strong> ${stats.prodChips}</div>
          </div>
        </div>
    `;

    // Conditional rendering: Show State Sector only if it has companies
    const showState = stateCompanies.length > 0;

    // If only one card (Private), it will naturally fill the grid thanks to auto-fit + minmax
    const summariesHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px;">
            ${showState ? renderSummaryCard("Sektor Państwowy", stateStats, "rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.2)", "🏛️") : ""}
            ${renderSummaryCard("Sektor Prywatny", privateStats, "rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.2)", "💼")}
        </div>
    `;

    return `
      <div class="eja-dashboard-header">
        <h2>📊 Centrum Przedsiębiorcy</h2>
        <button class="eja-dashboard-close" title="Zamknij">✕</button>
      </div>
      <div class="eja-dashboard-body">
        
        ${buildActionSection()}

        ${summariesHTML}

        ${holdingsDataHTML}

        ${sectionsHTML}
      </div>
      <div class="eja-dashboard-footer">
        <span>Aktualizacja: ${new Date().toLocaleTimeString("pl-PL")}</span>
        <button class="eja-dashboard-btn eja-refresh-btn">🔄 Odśwież</button>
      </div>
    `;
  };

  const parseEntity = (val) => {
    if (!val || val === "account") return { scope: "self" };
    if (val === "public") return { scope: "public" };
    if (val === "mu" || val.startsWith("mu")) return { scope: "mu" };
    if (val.startsWith("holding-")) {
      const parts = val.split("-");
      const id = parts[1];
      if (id && /^\d+$/.test(id)) return { scope: "holding", holdingid: id };
    }
    return { scope: "self" };
  };

  // Inner versions use CACHE_TTL_MS directly (no false expiry)
  function cacheHoldings(root) {
    try {
      const select = (root || document).querySelector("#inventory_selector");
      if (!select) return;
      const options = Array.from(select.querySelectorAll("option"))
        .map((o) => ({
          value: o.value,
          text: (o.textContent || "").trim(),
          icon: o.getAttribute("data-iconurl") || "",
        }))
        .filter((o) => o.value && o.value.startsWith("holding-"))
        .map((o) => ({
          id: o.value.split("-")[1],
          name: o.text.replace(/\s*ekwipunek\s*$/i, ""),
          icon: o.icon,
        }));
      if (options.length) {
        const payload = { updatedAt: Date.now(), holdings: options };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
        try {
          console.debug("[EJA] cached holdings", payload);
        } catch {}
      }
    } catch {}
  }

  const parseHoldingsFromJobsDocument = (doc) => {
    const holdings = [];
    const containers = doc.querySelectorAll(".holdings-container");
    containers.forEach((container) => {
      const label = container.querySelector(".holdings-description span");
      let name = label ? (label.dataset.ejaOriginalLabel || label.textContent || "").trim() : "";
      if (name) name = name.replace(/\(\d+.*$/, "").trim();
      if (!name) return;

      const link = container.querySelector('a[href^="/holding/"], a[href*="/holding/"]');
      const href = link ? link.getAttribute("href") || "" : "";
      const idMatch = href.match(/\/holding\/(\d+)/);
      if (!idMatch) return;

      holdings.push({ id: idMatch[1], name, icon: "" });
    });
    const unique = new Map();
    holdings.forEach((h) => {
      if (!unique.has(h.id)) unique.set(h.id, h);
    });
    return Array.from(unique.values());
  };

  const updateHoldingsJobsCache = (holdings) => {
    holdingsJobsCache = {
      updatedAt: Date.now(),
      holdings,
      inFlight: null,
    };
  };

  const updateHoldingsJobsCacheFromDocument = (root) => {
    try {
      const doc = root || document;
      if (!doc) return;
      const parsed = parseHoldingsFromJobsDocument(doc);
      if (parsed.length) updateHoldingsJobsCache(parsed);
    } catch (e) {
      console.warn("[EJA] Failed to parse holdings from /jobs document:", e);
    }
  };

  const fetchHoldingsFromJobs = async () => {
    try {
      const response = await fetch("/jobs", { credentials: "include" });
      if (!response.ok) return [];
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      return parseHoldingsFromJobsDocument(doc);
    } catch (e) {
      console.warn("[EJA] Failed to fetch holdings from /jobs:", e);
      return [];
    }
  };

  const getHoldingsFromJobs = async ({ forceRefresh = false } = {}) => {
    const now = Date.now();
    const age = now - (holdingsJobsCache.updatedAt || 0);
    if (!forceRefresh && holdingsJobsCache.holdings.length && age < HOLDINGS_JOBS_CACHE_TTL_MS) {
      return holdingsJobsCache.holdings;
    }
    if (!forceRefresh && isJobsPage()) {
      updateHoldingsJobsCacheFromDocument(document);
      if (holdingsJobsCache.holdings.length) return holdingsJobsCache.holdings;
    }
    if (holdingsJobsCache.inFlight) return holdingsJobsCache.inFlight;

    holdingsJobsCache.inFlight = (async () => {
      const holdings = await fetchHoldingsFromJobs();
      if (holdings.length) {
        updateHoldingsJobsCache(holdings);
        return holdings;
      }
      return holdingsJobsCache.holdings || [];
    })();

    const result = await holdingsJobsCache.inFlight;
    holdingsJobsCache.inFlight = null;
    return result;
  };

  function ensureMenuIconStyle(doc) {
    const d = doc || document;
    if (d.__ejaIconStyleApplied) return;
    d.__ejaIconStyleApplied = true;
    const style = d.createElement("style");
    style.setAttribute("data-eja", "icon-style");
    style.textContent = `
        .dropdown-menu .eja-holding-icon,
        .dropdown-menu .dropdown-item:hover .eja-holding-icon,
        .dropdown-menu .dropdown-item:focus .eja-holding-icon {
          filter: none !important;
          -webkit-filter: none !important;
          mix-blend-mode: normal !important;
          opacity: 1 !important;
          background: transparent !important;
          pointer-events: none !important;
          display: inline-block !important;
        }
      `;
    (d.head || d.documentElement).appendChild(style);
  }

  async function injectMenuHoldings(root) {
    if (!isSettingEnabled("addHoldingsToMenu")) return;
    const doc = root || document;
    const holdings = await getHoldingsFromJobs();
    ensureMenuIconStyle(doc);
    // Only inject into currently opened dropdowns to avoid redundant work
    // Note: Menu open is detected via class change (.show), not element creation
    let menus = Array.from(doc.querySelectorAll(".dropdown-menu.px-1.show"));
    if (!menus.length) menus = Array.from(doc.querySelectorAll(".dropdown-menu.show"));
    if (!menus.length) return;
    // Filter to only menus that have the storage link (i.e., "Moje miejsca" dropdown)
    const targets = menus.filter((m) => m.querySelector('a.dropdown-item[href="/storage"]'));
    if (!targets.length) return; // only 'Moje miejsca'
    targets.forEach((menu) => {
      // Cleanup previous injected group
      menu.querySelectorAll('[data-eja="holding-link"]').forEach((n) => n.remove());
      menu.querySelectorAll('[data-eja="holdings-divider"]').forEach((n) => n.remove());
      if (!holdings.length) return; // no links if no holdings
      const divider = document.createElement("div");
      divider.className = "dropdown-divider";
      divider.setAttribute("data-eja", "holdings-divider");
      menu.appendChild(divider);
      holdings.forEach((h) => {
        const a = document.createElement("a");
        a.className = "dropdown-item";
        a.href = `${location.origin}/holding/${h.id}`;
        a.setAttribute("data-eja", "holding-link");
        // icon (if available)
        if (h.icon) {
          const img = document.createElement("img");
          img.src = h.icon;
          img.alt = h.name;
          img.className = "eja-holding-icon";
          img.width = 16;
          img.height = 16;
          img.style.objectFit = "cover";
          img.style.borderRadius = "3px";
          img.style.marginRight = "6px";
          img.referrerPolicy = "no-referrer";
          img.style.filter = "none";
          img.style.webkitFilter = "none";
          img.style.mixBlendMode = "normal";
          img.style.pointerEvents = "none";
          a.appendChild(img);
        }
        // label
        const label = document.createElement("span");
        label.textContent = `${h.name}`;
        a.appendChild(label);
        a.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.location.href = a.href;
          },
          { capture: true },
        );
        menu.appendChild(a);
      });
    });
  }

  const getCurrentEntityValue = (contextRoot) => {
    const visible = contextRoot.querySelector(".storage-container-for-entity:not(.d-none)");
    const val = visible && visible.getAttribute("data-entity");
    if (val) return val;
    const sel = contextRoot.querySelector("#inventory_selector");
    return sel ? sel.value : "account";
  };

  const updateButton = (selectEl, contextRoot) => {
    const val = getCurrentEntityValue(contextRoot);
    const entity = parseEntity(val);

    const buttons = Array.from(contextRoot.querySelectorAll("a.create-offer-btn")).filter(
      (a) => !a.closest(".extra-buy-options"),
    );
    if (buttons.length === 0) return;
    for (const btn of buttons) {
      if (entity.scope === "holding") {
        btn.setAttribute("data-scope", "holding");
        if (entity.holdingid) {
          btn.setAttribute("data-holdingid", entity.holdingid);
        } else {
          btn.removeAttribute("data-holdingid");
        }
      } else if (entity.scope === "public") {
        btn.setAttribute("data-scope", "public");
        btn.removeAttribute("data-holdingid");
      } else if (entity.scope === "mu") {
        btn.setAttribute("data-scope", "mu");
        btn.removeAttribute("data-holdingid");
      } else {
        btn.setAttribute("data-scope", "self");
        btn.removeAttribute("data-holdingid");
      }
    }
  };

  const removeExtraButtons = (contextRoot) => {
    const toggle = contextRoot.querySelector(".extra-buy-toggle");
    if (toggle && toggle.parentElement) toggle.parentElement.removeChild(toggle);
    const extra = contextRoot.querySelector(".extra-buy-options");
    if (extra && extra.parentElement) extra.parentElement.removeChild(extra);
  };

  const COIN_ADVANCED_RECENT_KEY = "eja_coin_adv_recent_holdings";
  const COIN_ADVANCED_PINNED_KEY = "eja_coin_adv_pinned_holdings";
  const COIN_ADVANCED_RECENT_LIMIT = 5;

  const normalizeCoinAdvancedQuery = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const getCoinAdvancedRecentHoldings = () => {
    try {
      const raw = localStorage.getItem(COIN_ADVANCED_RECENT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => id && /^\d+$/.test(String(id)));
    } catch (e) {
      console.warn("[EJA] Failed to read recent holdings:", e);
      return [];
    }
  };

  const saveCoinAdvancedRecentHoldings = (items) => {
    try {
      localStorage.setItem(COIN_ADVANCED_RECENT_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn("[EJA] Failed to save recent holdings:", e);
    }
  };

  const getCoinAdvancedPinnedHoldings = () => {
    try {
      const raw = localStorage.getItem(COIN_ADVANCED_PINNED_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => id && /^\d+$/.test(String(id)));
    } catch (e) {
      console.warn("[EJA] Failed to read pinned holdings:", e);
      return [];
    }
  };

  const saveCoinAdvancedPinnedHoldings = (items) => {
    try {
      localStorage.setItem(COIN_ADVANCED_PINNED_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn("[EJA] Failed to save pinned holdings:", e);
    }
  };

  const toggleCoinAdvancedPinnedHolding = (holdingId) => {
    if (!holdingId) return [];
    const list = getCoinAdvancedPinnedHoldings();
    const next = list.includes(String(holdingId))
      ? list.filter((id) => String(id) !== String(holdingId))
      : [...list, String(holdingId)];
    saveCoinAdvancedPinnedHoldings(next);
    return next;
  };

  const bumpCoinAdvancedRecentHolding = (holdingId) => {
    if (!holdingId) return;
    const list = getCoinAdvancedRecentHoldings().filter((id) => String(id) !== String(holdingId));
    list.unshift(String(holdingId));
    saveCoinAdvancedRecentHoldings(list.slice(0, COIN_ADVANCED_RECENT_LIMIT));
  };

  const ensureCoinAdvancedQuickBuyStyles = (doc = document) => {
    if (doc.__ejaCoinAdvancedStylesApplied) return;
    doc.__ejaCoinAdvancedStylesApplied = true;
    const style = doc.createElement("style");
    style.setAttribute("data-eja", "coin-advanced-quick-buy");
    style.textContent = `
      .eja-coin-quick-buy {
        border: none;
        background: transparent;
        border-radius: 0;
        padding: 0;
        margin: 2px 0 8px;
        color: inherit;
        max-width: none;
        width: auto;
        position: relative;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
      }
      .eja-coin-quick-buy-row {
        width: 100%;
      }
      .eja-coin-quick-buy-row td {
        padding: 6px 0 6px;
        border-top: 1px solid rgba(148, 163, 184, 0.35);
        border-bottom: none;
        background: transparent;
      }
      .eja-coin-quick-buy-row + tr td {
        border-top: none !important;
      }
      .eja-coin-offer-row td {
        border-top: none !important;
      }
      .eja-coin-quick-buy__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .eja-coin-quick-buy__title {
        font-weight: 700;
        font-size: 12px;
        color: inherit;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .eja-coin-quick-buy__title span {
        color: #e2e8f0;
        background: #0f172a;
      }
      .eja-coin-quick-buy__all-btn {
        background: #e2e8f0;
        border: 1px solid #94a3b8;
        color: #0f172a;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 6px;
        white-space: nowrap;
      }
      .eja-coin-quick-buy__favorites {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      .eja-coin-quick-buy__favorites > * {
        max-width: 100%;
      }
      .eja-coin-quick-buy__favorites-label {
        font-size: 10px;
        font-weight: 600;
        color: inherit;
        margin-right: 4px;
        opacity: 0.7;
      }
      .eja-coin-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
      }
      .eja-coin-chip__buy {
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 999px;
        white-space: nowrap;
        line-height: 1.3;
        background: #2563eb;
        border: 1px solid #1d4ed8;
        color: #ffffff;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .eja-coin-chip__buy.is-pinned {
        font-weight: 700;
      }
      .eja-coin-chip__pin {
        font-size: 12px;
        width: 26px;
        height: 22px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        background: #1f2937;
        border: 1px solid #334155;
        color: #ffffff;
      }
      .eja-coin-chip__pin.is-pinned {
        font-weight: 700;
      }
      .eja-coin-quick-buy__popover {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        background: #0b1220;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 6px;
        min-width: 260px;
        max-width: 360px;
        z-index: 50;
        display: none;
      }
      .eja-coin-quick-buy__popover.is-open {
        display: grid;
        gap: 6px;
      }
      .eja-coin-quick-buy__popover-search {
        height: 26px;
        font-size: 11px;
        padding: 2px 6px;
        background: #111827;
        color: #e2e8f0;
        border: 1px solid #334155;
      }
      .eja-coin-quick-buy__popover-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        max-height: 180px;
        overflow: auto;
        padding-right: 4px;
      }
      .eja-coin-quick-buy__popover .eja-coin-chip__buy.is-pinned {
        font-weight: 700;
      }
      .eja-coin-quick-buy input::placeholder {
        color: rgba(226, 232, 240, 0.7);
      }
      @media (max-width: 600px) {
        .eja-coin-quick-buy {
          width: 100%;
        }
        .eja-coin-quick-buy__header {
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .eja-coin-quick-buy__favorites {
          width: 100%;
        }
        .eja-coin-quick-buy__all-btn {
          width: 100%;
          justify-content: center;
        }
        .eja-coin-quick-buy__popover {
          left: 0;
          right: auto;
          width: min(92vw, 360px);
          max-width: 92vw;
        }
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  };

  const extractCoinAdvancedBuyItems = (extraList) =>
    Array.from(extraList.querySelectorAll("a.accept-offer"))
      .map((link) => {
        const label = (link.textContent || "").replace(/^\s*Kup jako\s*/i, "").trim();
        return {
          link,
          label: label || link.textContent || "",
          scope: link.getAttribute("data-scope") || "",
          holdingId: link.getAttribute("data-holdingid") || "",
          offerId: link.getAttribute("data-offerid") || "",
        };
      })
      .filter((item) => item.label);

  const triggerCoinAdvancedBuy = (item) => {
    if (!item?.link) return;
    try {
      item.link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    } catch (e) {
      console.warn("[EJA] Failed to trigger buy action:", e);
      try {
        item.link.click();
      } catch {}
    }
    if (item.scope === "holding" && item.holdingId) {
      bumpCoinAdvancedRecentHolding(item.holdingId);
    }
  };

  const buildCoinAdvancedChip = (item, { onPinToggle, onBuy, showPin = false } = {}) => {
    const wrapper = document.createElement("div");
    wrapper.className = "eja-coin-chip";
    const pinnedIds = getCoinAdvancedPinnedHoldings();
    const isPinned = item.holdingId && pinnedIds.includes(String(item.holdingId));

    const buyBtn = document.createElement("button");
    buyBtn.type = "button";
    buyBtn.className = `btn-action-blue eja-coin-chip__buy${isPinned ? " is-pinned" : ""}`;
    buyBtn.textContent = item.label;
    buyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onBuy) onBuy(item);
    });
    wrapper.appendChild(buyBtn);

    if (showPin && item.holdingId) {
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = `btn-action-blue eja-coin-chip__pin${isPinned ? " is-pinned" : ""}`;
      pinBtn.title = isPinned ? "Odepnij" : "Przypnij";
      pinBtn.textContent = isPinned ? "?" : "?";
      pinBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCoinAdvancedPinnedHolding(item.holdingId);
        if (onPinToggle) onPinToggle();
      });
      wrapper.appendChild(pinBtn);
    }
    return wrapper;
  };

  const renderCoinAdvancedFavorites = (container, items, refreshAll) => {
    const pinnedIds = getCoinAdvancedPinnedHoldings();
    container.innerHTML = "";
    if (!pinnedIds.length) {
      container.style.display = "none";
      return;
    }
    const label = document.createElement("span");
    label.className = "eja-coin-quick-buy__favorites-label";
    label.textContent = "Przypiete:";
    container.appendChild(label);
    pinnedIds
      .map((id) => items.find((item) => item.holdingId === id))
      .filter(Boolean)
      .forEach((item) => {
        const chip = buildCoinAdvancedChip(item, {
          onPinToggle: refreshAll,
          onBuy: triggerCoinAdvancedBuy,
          showPin: false,
        });
        container.appendChild(chip);
      });
    container.style.display = "flex";
  };

  const renderCoinAdvancedList = (container, items, query, refreshAll) => {
    const normalizedQuery = normalizeCoinAdvancedQuery(query);
    const entries = items.filter((item) =>
      normalizedQuery ? normalizeCoinAdvancedQuery(item.label).includes(normalizedQuery) : true,
    );
    container.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.style.fontSize = "11px";
      empty.style.color = "#64748b";
      empty.textContent = "Brak dopasowan.";
      container.appendChild(empty);
      return;
    }
    entries.forEach((item) => {
      container.appendChild(
        buildCoinAdvancedChip(item, {
          onPinToggle: refreshAll,
          onBuy: triggerCoinAdvancedBuy,
          showPin: true,
        }),
      );
    });
  };

  const enhanceCoinAdvancedQuickBuy = (root = document) => {
    if (!isCoinAdvancedPage() || !isSettingEnabled("coinAdvancedQuickBuyHoldings")) return;
    ensureCoinAdvancedQuickBuyStyles(root);
    const lists = Array.from(root.querySelectorAll(".extra-buy-options"));
    const renderForList = (list) => {
      if (list.__ejaQuickBuyReady) return;
      const items = extractCoinAdvancedBuyItems(list);
      if (!items.length) return;
      list.__ejaQuickBuyReady = true;
      const wrapper = document.createElement("div");
      wrapper.className = "eja-coin-quick-buy";
      wrapper.setAttribute("data-eja", "coin-quick-buy");

      const header = document.createElement("div");
      header.className = "eja-coin-quick-buy__header";
      wrapper.appendChild(header);

      const title = document.createElement("div");
      title.className = "eja-coin-quick-buy__title";
      title.innerHTML = "?";
      header.appendChild(title);

      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "eja-coin-quick-buy__all-btn";
      allBtn.textContent = "Pokaz wszystkie";
      header.appendChild(allBtn);

      const favorites = document.createElement("div");
      favorites.className = "eja-coin-quick-buy__favorites";
      wrapper.appendChild(favorites);

      const popover = document.createElement("div");
      popover.className = "eja-coin-quick-buy__popover";
      wrapper.appendChild(popover);

      const search = document.createElement("input");
      search.type = "text";
      search.className = "form-control form-control-sm eja-coin-quick-buy__popover-search";
      search.placeholder = "Szukaj holdingu";
      popover.appendChild(search);

      const listContainer = document.createElement("div");
      listContainer.className = "eja-coin-quick-buy__popover-list";
      popover.appendChild(listContainer);

      wrapper.__ejaQuickBuyRefs = {
        items,
        favorites,
        listContainer,
        search,
      };

      const refreshAll = () => {
        refreshAllCoinAdvancedQuickBuy();
      };

      allBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        popover.classList.toggle("is-open");
        if (popover.classList.contains("is-open")) {
          search.focus();
        }
      });

      search.addEventListener("input", () => {
        renderCoinAdvancedList(listContainer, items, search.value, refreshAll);
      });

      if (!document.__ejaCoinQuickBuyPopoverHandler) {
        document.__ejaCoinQuickBuyPopoverHandler = true;
        document.addEventListener(
          "click",
          (e) => {
            const target = e.target;
            const wrappers = Array.from(document.querySelectorAll('[data-eja="coin-quick-buy"]'));
            wrappers.forEach((wrap) => {
              const pop = wrap.querySelector(".eja-coin-quick-buy__popover");
              if (!pop || !pop.classList.contains("is-open")) return;
              if (target && wrap.contains(target)) return;
              pop.classList.remove("is-open");
            });
          },
          { capture: true },
        );
      }

      refreshAll();

      const toggle = list.parentElement?.querySelector(".extra-buy-toggle");
      if (toggle) toggle.style.display = "none";
      list.style.display = "none";

      const offerRow = resolveCoinAdvancedOfferRow(list);
      if (offerRow && offerRow.tagName === "TR" && offerRow.parentElement) {
        offerRow.classList.add("eja-coin-offer-row");
        const row = document.createElement("tr");
        row.className = "eja-coin-quick-buy-row";
        const cell = document.createElement("td");
        cell.colSpan = offerRow.children.length || 1;
        cell.appendChild(wrapper);
        row.appendChild(cell);
        offerRow.parentElement.insertBefore(row, offerRow);
      } else if (offerRow && offerRow.parentElement) {
        wrapper.classList.add("eja-coin-quick-buy-row");
        offerRow.parentElement.insertBefore(wrapper, offerRow);
      } else if (list.parentElement) {
        wrapper.classList.add("eja-coin-quick-buy-row");
        list.parentElement.insertBefore(wrapper, list);
      }
    };

    const immediate = lists.slice(0, 3);
    const deferred = lists.slice(3);
    immediate.forEach(renderForList);
    if (deferred.length) {
      requestAnimationFrame(() => deferred.forEach(renderForList));
    }
  };

  const initCoinAdvancedQuickBuy = () => {
    if (!isCoinAdvancedPage() || !isSettingEnabled("coinAdvancedQuickBuyHoldings")) return;
    if (document.__ejaCoinAdvancedObserver) return;
    const apply = debounce(() => enhanceCoinAdvancedQuickBuy(document), 30);
    apply();
    const target =
      document.querySelector(".table") ||
      document.querySelector(".table-responsive") ||
      document.querySelector("main") ||
      document.body;
    const observer = new MutationObserver(apply);
    observer.observe(target, { childList: true, subtree: true });
    document.__ejaCoinAdvancedObserver = observer;
  };

  const parseNumberValue = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (!value) return 0;
    const normalized = String(value)
      .replace(/[^0-9,.-]/g, "")
      .replace(/,(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatNumericValue = (value, options = {}) => {
    const absVal = Math.abs(value);
    const needsFraction = absVal % 1 !== 0;
    const minimumFractionDigits =
      typeof options.minFractionDigits === "number" ? options.minFractionDigits : needsFraction ? 2 : 0;
    const maximumFractionDigits =
      typeof options.maxFractionDigits === "number" ? options.maxFractionDigits : needsFraction ? 2 : 0;
    return new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  };

  const accumulateEntry = (map, key, amount, meta = {}) => {
    if (!key || !Number.isFinite(amount) || amount === 0) return;
    const computedKey = meta.qualityKey ? `${key}-${meta.qualityKey}` : key;
    if (!map.has(computedKey)) {
      map.set(computedKey, {
        key: computedKey,
        amount: 0,
        icon: meta.icon || "",
        label: meta.label || "",
      });
    }
    const entry = map.get(computedKey);
    entry.amount += amount;
    if (!entry.icon && meta.icon) entry.icon = meta.icon;
    if (!entry.label && meta.label) entry.label = meta.label;
  };

  const RAW_RESOURCE_TYPES = new Set(
    [
      "Farma",
      "Farm",
      "Kopalnia zelaza",
      "Iron Mine",
      "Kopalnia tytanu",
      "Titanium Mine",
      "Szyb naftowy",
      "Oil Well",
    ].map((name) => (name || "").trim().toLowerCase()),
  );

  const decodeHtmlEntities = (() => {
    const textarea = document.createElement("textarea");
    return (str) => {
      if (!str) return "";
      textarea.innerHTML = str;
      return textarea.value;
    };
  })();

  const getTodayKey = (() => {
    let cached = null;
    return () => {
      if (cached) return cached;
      const now = new Date();
      const pad = (val) => String(val).padStart(2, "0");
      cached = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
      return cached;
    };
  })();

  const parseWorklogData = (raw) => {
    if (!raw) return null;
    try {
      return JSON.parse(decodeHtmlEntities(raw));
    } catch {
      return null;
    }
  };

  // Reusable container for HTML parsing (performance optimization)
  const extractItemsFromHtml = (() => {
    const reusableContainer = document.createElement("div");
    return (html, selector) => {
      if (!html) return [];
      reusableContainer.innerHTML = html;
      const baseSelector = selector || ".item";
      let nodes = Array.from(reusableContainer.querySelectorAll(baseSelector));
      if (!nodes.length && reusableContainer.matches(baseSelector)) {
        nodes = [reusableContainer];
      }
      const results = nodes
        .map((node) => {
          const amountText = node.querySelector(".item__amount-representation")?.textContent || node.textContent;
          const amount = parseNumberValue(amountText);
          const img = node.querySelector("img");
          return {
            amount,
            icon: img ? img.src : "",
            label: img ? img.getAttribute("title") || img.getAttribute("alt") || "" : "",
          };
        })
        .filter((item) => item.amount !== 0);
      reusableContainer.innerHTML = ""; // Clear for next use
      return results;
    };
  })();

  const getActiveHoldingsContainers = (root = document) => {
    const activeTab = root.querySelector(".tab-pane.show.active");
    const scope = activeTab || root;
    return Array.from(scope.querySelectorAll(".holdings-container")).filter((container) => {
      // Check visibility via CSS classes (avoids reflow from offsetParent)
      if (container.classList.contains("d-none") || container.classList.contains("hidden")) return false;
      // Check inline display style (site uses style="display: none;" for collapsed sections)
      if (container.style.display === "none" || container.style.visibility === "hidden") return false;
      // Check if inside hidden parent tab (tab-pane without .active or .show)
      const parentTab = container.closest(".tab-pane");
      if (parentTab && !(parentTab.classList.contains("active") && parentTab.classList.contains("show"))) return false;
      return true;
    });
  };

  const injectJobsActionButtons = (root = document) => {
    const existing = root.querySelector('[data-eja="jobs-action-buttons"]');
    const dashboardEnabled = isSettingEnabled("dashboardEnabled");
    const salesEnabled = isSettingEnabled("generateDailySalesSummaries");
    if (!dashboardEnabled && !salesEnabled) {
      if (existing) existing.remove();
      return;
    }
    const containers = getActiveHoldingsContainers(root);
    if (!containers.length) return;
    const firstContainer = containers[0];
    if (!firstContainer?.parentElement) return;
    if (existing) {
      if (existing.parentElement !== firstContainer.parentElement) {
        firstContainer.parentElement.insertBefore(existing, firstContainer);
      }
      existing.innerHTML = "";
    }
    const wrapper = existing || document.createElement("div");
    if (!existing) {
      wrapper.setAttribute("data-eja", "jobs-action-buttons");
      wrapper.className = "d-flex align-items-center justify-content-end flex-wrap gap-2 mb-3";
    }
    if (salesEnabled) {
      const salesBtn = document.createElement("button");
      salesBtn.type = "button";
      salesBtn.className = "btn btn-primary btn-sm mr-2";
      salesBtn.innerHTML = "💰 Podsumowanie sprzedaży";
      salesBtn.style.cssText = "background: linear-gradient(135deg, #22c55e, #16a34a); border: none; font-weight: 600;";
      salesBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setSalesButtonLoading(salesBtn);
        openSalesSummaryOverlay(salesBtn);
      });
      wrapper.appendChild(salesBtn);
    }
    if (dashboardEnabled) {
      const dashboardBtn = document.createElement("button");
      dashboardBtn.type = "button";
      dashboardBtn.className = "btn btn-primary btn-sm";
      dashboardBtn.innerHTML = "📊 Otwórz Centrum Przedsiębiorcy";
      dashboardBtn.style.cssText =
        "background: linear-gradient(135deg, #3b82f6, #2563eb); border: none; font-weight: 600;";
      dashboardBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDashboardOverlay();
      });
      wrapper.appendChild(dashboardBtn);
    }
    if (!existing) {
      firstContainer.parentElement.insertBefore(wrapper, firstContainer);
    }
  };

  const refreshJobsWidgets = (root = document) => {
    if (isSettingEnabled("jobsEnhancements")) {
      updateHoldingsEmployeeCounts(root);
    } else {
      updateHoldingsEmployeeCounts(root, { forceReset: true });
    }
    injectJobsActionButtons(root);
  };

  const formatEmployeesLabel = (count) => {
    const pretty = count.toLocaleString("pl-PL");
    return `${pretty} ${count === 1 ? "pracownik" : "pracowników"}`;
  };

  const mergeLabelWithEmployees = (baseLabel, employeesText) => {
    if (!employeesText) return baseLabel;
    if (/\([^)]*\)/.test(baseLabel)) {
      return baseLabel.replace(/\(([^)]*)\)/, (_, inner) => `(${inner.trim()} | ${employeesText})`);
    }
    return `${baseLabel.trim()} (${employeesText})`;
  };

  const updateHoldingsEmployeeCounts = (root = document, options = {}) => {
    const containers = root.querySelectorAll(".holdings-container");
    containers.forEach((container) => {
      const headerRow = container.querySelector(".row.closeHoldings[data-target]");
      const label = headerRow && headerRow.querySelector(".holdings-description span");
      if (!headerRow || !label) return;
      if (!label.dataset.ejaOriginalLabel) {
        label.dataset.ejaOriginalLabel = (label.textContent || "").trim();
      }
      const baseLabel = label.dataset.ejaOriginalLabel;
      if (options.forceReset) {
        label.textContent = baseLabel;
        return;
      }
      const targetKey = (headerRow.getAttribute("data-target") || "").trim();
      if (!targetKey) {
        label.textContent = baseLabel;
        return;
      }
      const targetList = container.querySelector(`.${targetKey}`) || container.querySelector(`#${targetKey}`);
      if (!targetList) {
        label.textContent = baseLabel;
        return;
      }
      const companyNodes = targetList.querySelectorAll("[data-employees]");
      let total = 0;
      let hasData = false;
      companyNodes.forEach((node) => {
        const val = parseInt(node.getAttribute("data-employees"), 10);
        if (!Number.isNaN(val)) {
          total += val;
          hasData = true;
        }
      });
      if (!hasData) {
        label.textContent = baseLabel;
        return;
      }
      label.textContent = mergeLabelWithEmployees(baseLabel, formatEmployeesLabel(total));
    });
  };

  const initJobsPageEnhancements = () => {
    if (document.__ejaJobsEnhancementsInit) return;
    document.__ejaJobsEnhancementsInit = true;
    waitFor(".holdings-container")
      .then(() => {
        const scheduleUpdate = debounce((mutations) => {
          if (!isJobsMutationRelevant(mutations)) return;
          if (document.__ejaJobsUpdatePending) return;
          document.__ejaJobsUpdatePending = true;
          const runner = () => {
            document.__ejaJobsUpdatePending = false;
            updateHoldingsJobsCacheFromDocument(document);
            refreshJobsWidgets(document);
          };
          if ("requestIdleCallback" in window) {
            requestIdleCallback(runner, { timeout: 2000 });
          } else {
            setTimeout(runner, 350);
          }
        }, 600);
        scheduleUpdate();
        // Observe only the holdings area, not the entire page (performance optimization)
        const holdingsArea =
          document.querySelector(".tab-content") ||
          document.querySelector(".holdings-container")?.parentElement ||
          document.querySelector(".page-info") ||
          document.body;
        const observer = new MutationObserver((mutations) => scheduleUpdate(mutations));
        observer.observe(holdingsArea, { childList: true, subtree: true });
        document.__ejaJobsObserver = observer;
      })
      .catch(() => {});
  };

  const bind = (root) => {
    const contextRoot = root || document;
    const select = contextRoot.querySelector("#inventory_selector");
    if (!select) return;
    removeExtraButtons(contextRoot);
    updateButton(select, contextRoot);
    cacheHoldings(contextRoot);
    if (!select.__ejaBound) {
      select.__ejaBound = true;
      select.addEventListener("change", () => updateButton(select, contextRoot));
    }
    const s2 = contextRoot.querySelector("#select2-inventory_selector-container");
    if (s2 && !s2.__ejaObserved) {
      s2.__ejaObserved = true;
      const moSel = new MutationObserver(() => updateButton(select, contextRoot));
      moSel.observe(s2.parentElement || s2, { attributes: true, attributeFilter: ["aria-activedescendant"] });
    }
    const containers = contextRoot.querySelectorAll(".storage-container-for-entity");
    containers.forEach((c) => {
      if (!c.__ejaObserved) {
        c.__ejaObserved = true;
        const moCont = new MutationObserver(() => updateButton(select, contextRoot));
        moCont.observe(c, { attributes: true, attributeFilter: ["class"] });
      }
    });
    const buttons = Array.from(contextRoot.querySelectorAll("a.create-offer-btn")).filter(
      (a) => !a.closest(".extra-buy-options"),
    );
    buttons.forEach((btn) => {
      if (!btn.__ejaClickBound) {
        btn.__ejaClickBound = true;
        btn.addEventListener("click", () => updateButton(select, contextRoot), { capture: true });
      }
    });
  };

  const start = () => {
    initMarketSaleNotificationFilter();
    injectSettingsPanel();
    if (isCoinAdvancedPage()) {
      initCoinAdvancedQuickBuy();
    }
    if (isSellPage() && isSettingEnabled("sellPageHelpers")) {
      waitFor("#inventory_selector")
        .then(() => bind(document))
        .catch(() => {});
      const scheduleBind = debounce(() => {
        if (!isSellPage()) return;
        bind(document);
        cacheHoldings(document);
      }, 150);
      const mo = new MutationObserver(scheduleBind);
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
    if (isSettingEnabled("addHoldingsToMenu")) {
      // Inject into global dropdown menu on all pages
      const injectMenus = debounce(() => injectMenuHoldings(document), 50);
      injectMenus();
      // Observe navbar area for dropdown changes
      const navbarArea = document.querySelector(".navbar") || document.querySelector("nav") || document.body;
      const moMenu = new MutationObserver(injectMenus);
      // FIX: Must observe attributes because dropdown open adds class "show" instead of creating new elements
      moMenu.observe(navbarArea, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

      // Delegated handlers for injected holding links
      // Use mousedown with capture to intercept before any site handlers can block
      if (!document.__ejaDelegatedNav) {
        document.__ejaDelegatedNav = true;
        const handler = (e) => {
          const a = e.target && e.target.closest ? e.target.closest('a[data-eja="holding-link"]') : null;
          if (a && a.href) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.location.href = a.href;
          }
        };
        // Use both mousedown and click to ensure capture on desktop
        document.addEventListener("mousedown", handler, { capture: true });
        document.addEventListener("click", handler, { capture: true });
      }
    }
    if (
      isJobsPage() &&
      (isSettingEnabled("jobsEnhancements") ||
        isSettingEnabled("dashboardEnabled") ||
        isSettingEnabled("generateDailySalesSummaries"))
    ) {
      initJobsPageEnhancements();
    }
  };

  const injectSettingsPanel = () => {
    if (!isSettingsPage()) return;
    const host = document.querySelector(".d-flex.flex-wrap.mb-4");
    if (!host || host.querySelector('[data-eja="settings-panel"]')) return;
    const panel = document.createElement("div");
    panel.className = "col-12 col-lg-6";
    panel.setAttribute("data-eja", "settings-panel");
    panel.innerHTML = `
      <div class="d-flex flex-column alert alert-info">
        <label class="mb-2" style="font-weight:600;">EJA - Ustawienia skryptu</label>
        <div class="custom-control custom-switch mb-2">
          <input type="checkbox" class="custom-control-input" id="eja-setting-menu" data-eja-setting="addHoldingsToMenu">
          <label class="custom-control-label" for="eja-setting-menu">Holdingi w menu Moje miejsca</label>
        </div>
        <div class="custom-control custom-switch mb-2">
          <input type="checkbox" class="custom-control-input" id="eja-setting-jobs" data-eja-setting="jobsEnhancements">
          <label class="custom-control-label" for="eja-setting-jobs">Liczba pracowników po nazwie holdingu, w widoku Firmy</label>
        </div>
        <div class="custom-control custom-switch mb-2">
          <input type="checkbox" class="custom-control-input" id="eja-setting-dashboard" data-eja-setting="dashboardEnabled">
          <label class="custom-control-label" for="eja-setting-dashboard">Centrum Przedsiębiorcy</label>
        </div>
        <div class="custom-control custom-switch mb-3">
          <input type="checkbox" class="custom-control-input" id="eja-setting-sell" data-eja-setting="sellPageHelpers">
          <label class="custom-control-label" for="eja-setting-sell">Proste sprzedawanie z wybranego magazynu na Głównym Rynku</label>
        </div>
        <div class="custom-control custom-switch mb-3">
          <input type="checkbox" class="custom-control-input" id="eja-setting-coin-quick-buy" data-eja-setting="coinAdvancedQuickBuyHoldings">
          <label class="custom-control-label" for="eja-setting-coin-quick-buy">Szybki zakup dla holdingów na rynku walut</label>
        </div>
        <div class="custom-control custom-switch mb-2">
          <input type="checkbox" class="custom-control-input" id="eja-setting-hide-sales" data-eja-setting="hideMarketSaleNotifications">
          <label class="custom-control-label" for="eja-setting-hide-sales">Ukryj powiadomienia o sprzedaży na rynku</label>
        </div>
        <div class="custom-control custom-switch mb-3">
          <input type="checkbox" class="custom-control-input" id="eja-setting-sales-summary" data-eja-setting="generateDailySalesSummaries">
          <label class="custom-control-label" for="eja-setting-sales-summary">Generuj dzienne podsumowania sprzedaży</label>
        </div>
        <div class="d-flex flex-wrap justify-content-end gap-2">
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm"
            data-eja-clear-holdings-cache
            title="Użyj po dodaniu nowego holdingu, aby odświeżyć listę bez czekania 48h."
          >Wyczyść cache holdingów</button>
          <button type="button" class="btn btn-primary ml-auto" data-eja-save>Zapamiętaj</button>
        </div>
        <small class="text-muted mt-2" data-eja-status>Po zmianie odśwież stronę, aby zastosować ustawienia.</small>
      </div>
    `;
    host.appendChild(panel);
    const settings = loadSettings();
    panel.querySelectorAll("input[data-eja-setting]").forEach((input) => {
      const key = input.getAttribute("data-eja-setting");
      input.checked = Boolean(settings[key]);
    });
    const status = panel.querySelector("[data-eja-status]");
    const saveBtn = panel.querySelector("button[data-eja-save]");
    const clearCacheBtn = panel.querySelector("button[data-eja-clear-holdings-cache]");
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener("click", () => {
        clearHoldingsCache();
        if (status) status.textContent = "Wyczyszczono cache holdingów. Odśwież /jobs, aby pobrać nową listę.";
      });
    }
    saveBtn.addEventListener("click", () => {
      const next = { ...loadSettings() };
      panel.querySelectorAll("input[data-eja-setting]").forEach((input) => {
        const key = input.getAttribute("data-eja-setting");
        next[key] = input.checked;
      });
      saveSettings(next);
      if (status) status.textContent = "Zapisano. Odśwież stronę, aby zastosować ustawienia.";
    });
  };

  onReady(start);
})();




