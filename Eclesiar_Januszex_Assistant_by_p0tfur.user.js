// ==UserScript==
// @name         Eclesiar Janueszex Assistant by p0tfur
// @namespace    https://eclesiar.com/
// @version      1.3.2
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

  const CACHE_KEY = "eja_holdings";
  const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48h
  const SUMMARY_COLLAPSE_KEY = "eja_holdings_summary_collapsed";
  let holdingsCacheWarned = false;
  let lastSectionStatsHash = null; // Cache hash to skip redundant renders

  // Business Dashboard Configuration
  const DASHBOARD_DB_NAME = "eja_business_dashboard";
  const DASHBOARD_DB_VERSION = 1;
  const DASHBOARD_STORE_NAME = "daily_snapshots";
  let dashboardDB = null;
  let dashboardOverlayOpen = false;

  const onReady = (fn) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
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

  // ============================================
  // BUSINESS DASHBOARD - IndexedDB Functions
  // ============================================
  const getTodayDateKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };

  const getYesterdayDateKey = () => {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
    containers.forEach((container) => {
      const headerRow = container.querySelector(".row.closeHoldings[data-target]");
      if (!headerRow) return;
      const label = headerRow.querySelector(".holdings-description span");
      let sectionName = label ? (label.dataset.ejaOriginalLabel || label.textContent || "").trim() : "Firmy";
      // Clean section name (remove count in parens e.g. "Moje firmy (12)")
      sectionName = sectionName.replace(/\(\d+.*$/, "").trim();
      
      const targetKey = (headerRow.getAttribute("data-target") || "").trim();
      if (!targetKey) return;
      const targetList = container.querySelector(`.${targetKey}`) || container.querySelector(`#${targetKey}`);
      if (!targetList) return;
      const companyRows = targetList.querySelectorAll(".hasBorder[data-id]");
      companyRows.forEach((row) => {
        const companyId = row.getAttribute("data-id") || "";
        const companyName = row.querySelector(".company-name-h5 span, .company-name, h5")?.textContent?.trim() || "Firma";
        const companyType = row.getAttribute("data-type") || "";
        const companyQuality = parseInt(row.getAttribute("data-quality"), 10) || 0;
        const employees = row.querySelectorAll(".employees_list .employee");
        const employeeCount = employees.length;
        const wages = {};
        const productions = {};
        employees.forEach((emp) => {
          const wage = parseFloat(emp.getAttribute("data-wage") || "0") || 0;
          const currencyCode = emp.getAttribute("data-currencyname") || emp.getAttribute("data-currencycode") || "";
          const currencyIcon = emp.getAttribute("data-currencyavatar") || "";
          if (wage > 0 && currencyCode) {
            if (!wages[currencyCode]) wages[currencyCode] = { amount: 0, icon: currencyIcon };
            wages[currencyCode].amount += wage;
          }
          // Parse today's production from worklog
          const worklogRaw = emp.getAttribute("data-worklog") || "";
          if (worklogRaw) {
            try {
              const worklog = JSON.parse(worklogRaw.replace(/&quot;/g, '"'));
              const todayKey = getTodayDateKey().split("-").reverse().slice(0, 2).join("/");
              const entry = Object.entries(worklog).find(([k]) => k.startsWith(todayKey.split("/")[0] + "/" + todayKey.split("/")[1]));
              if (entry && entry[1] && entry[1].production) {
                const prodHtml = entry[1].production;
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = prodHtml;
                tempDiv.querySelectorAll(".item.production").forEach((prodItem) => {
                  const prodImg = prodItem.querySelector("img");
                  const prodAmount = parseFloat(prodItem.querySelector(".item__amount-representation")?.textContent || "0") || 0;
                  let prodName = prodImg ? (prodImg.title || prodImg.alt || "Produkt") : "Produkt";
                  // Add quality suffix if company has quality and product isn't raw resource
                  const isRawResource = /żelazo|iron|zboże|grain|tytan|titanium|paliwo|oil|ropa/i.test(prodName);
                  if (companyQuality > 0 && !isRawResource) {
                    prodName = `${prodName} Q${companyQuality}`;
                  }
                  if (!productions[prodName]) productions[prodName] = { amount: 0, icon: prodImg?.src || "" };
                  productions[prodName].amount += prodAmount;
                });
              }
            } catch {}
          }
        });

        // Calculate Capacity based on Yesterday
        const yesterdayCompany = yesterday?.companies?.find((c) => c.id === companyId);
        if (yesterdayCompany && yesterdayCompany.productions) {
          // Check for products produced yesterday but not today
          Object.entries(yesterdayCompany.productions).forEach(([name, data]) => {
            if (!productions[name]) productions[name] = { amount: 0, icon: data.icon };
          });
        }
        // Set capacity for all products
        Object.keys(productions).forEach((name) => {
          const todayAmt = productions[name].amount;
          const yestAmt = yesterdayCompany?.productions?.[name]?.amount || 0;
          // If we produced more today, that's the new proven capacity. If we produced more yesterday, that's the potential.
          productions[name].capacity = Math.max(todayAmt, yestAmt);
        });

        companies.push({
          id: companyId,
          name: companyName,
          type: companyType,
          quality: companyQuality,
          section: sectionName,
          employeeCount,
          wages,
          productions,
        });
      });
    });
    return companies;
  };

  // Fetch holding data (bank balance, storage) from holding page
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
      let storageUsed = 0, storageCapacity = 0;
      const storageText = doc.querySelector(".current-main-storage-capacity")?.parentElement?.textContent || "";
      const storageMatch = storageText.match(/\(([\d.,]+)\/([\d.,]+)\)/);
      if (storageMatch) {
        storageUsed = parseFloat(storageMatch[1].replace(/[,.\s]/g, "")) || 0;
        storageCapacity = parseFloat(storageMatch[2].replace(/[,.\s]/g, "")) || 0;
      }

      // Clean up doc to remove user's wallet info (sidebar, modals, navbar) to avoid false positives
      const garbageSelectors = [
          ".sidebar", 
          ".main-sidebar", 
          ".navbar", 
          "#allCurrenciesModal", 
          ".user-panel",
          ".dropdown-menu",
          ".main-header"
      ];
      garbageSelectors.forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));

      // Generic currency parser for holding bank
      const bank = {};
      
      // STRICT Strategy: Only look into specific holding containers.
      // Do NOT scan body or random divs to avoid catching global user wallet.
      const potentialContainers = [
        ...doc.querySelectorAll(".currencies-list .holding__currency"), 
        ...doc.querySelectorAll(".holding-info")
      ];
      
      // Helper to parse text node: "10.408 IEP" -> {amount: 10408, code: "IEP"}
      const parseText = (txt) => {
        // Matches: "10.408 IEP", "538.394 PLN", "123 GOLD"
        const m = txt.match(/([\d\s.,]+)\s+([A-Z]{3}|Złoto|Gold|Credits)/i);
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
      const items = potentialContainers.length > 0 
          ? potentialContainers 
          : doc.querySelectorAll(".currencies-list > *, .holding__currency"); // Fallback strictish

      items.forEach(el => {
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
    // Filter companies: only include those in "Moje firmy" / "My companies" section
    const myCompanies = companies.filter(c => /moje firmy|my companies/i.test(c.section));
    
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
      status[code] = {
        have: haveAmt,
        need: needAmt,
        diff,
        icon: have[code]?.icon || need[code]?.icon || "",
        status: needAmt === 0 ? "ok" : diff >= 0 ? "ok" : diff >= -needAmt * 0.2 ? "warning" : "insufficient",
      };
    });
    return status;
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
    `;
    document.head.appendChild(style);
  };

  const closeDashboardOverlay = () => {
    dashboardOverlayOpen = false;
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
  };

  const openDashboardOverlay = async () => {
    if (dashboardOverlayOpen) return;
    dashboardOverlayOpen = true;
    ensureDashboardStyles();

    // Collect initial data
    const yesterday = await getDailySnapshot(getYesterdayDateKey());
    const companies = collectDashboardCompanyData(document, yesterday);
    const userCurrencies = parseUserCurrencies();

    // Fetch holdings data (bank, storage) from cached holdings list FIRST
    // This allows us to subtract holding bank balance from wage needs
    const cachedHoldings = getCachedHoldings();
    let holdingsData = [];
    if (cachedHoldings.length > 0) {
      // Show loading overlay first
      const loadingBackdrop = document.createElement("div");
      loadingBackdrop.className = "eja-dashboard-backdrop visible";
      loadingBackdrop.innerHTML = '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font-size:18px;">⏳ Pobieranie danych holdingów...</div>';
      document.body.appendChild(loadingBackdrop);
      try {
        holdingsData = await fetchAllHoldingsData(cachedHoldings);
      } catch (e) {
        console.warn("[EJA] Error fetching holdings:", e);
      }
      loadingBackdrop.remove();
    }

    // Calculate needs (Reverted to simple calculation)
    const wageNeeds = calculateWageNeeds(companies);
    const currencyStatus = calculateCurrencyStatus(userCurrencies, wageNeeds);

    // Save today's snapshot
    await saveDailySnapshot({ companies, currencies: userCurrencies, holdings: holdingsData });

    // Create UI
    const backdrop = document.createElement("div");
    backdrop.id = "eja-dashboard-backdrop";
    backdrop.className = "eja-dashboard-backdrop";
    backdrop.addEventListener("click", closeDashboardOverlay);
    document.body.appendChild(backdrop);

    const overlay = document.createElement("div");
    overlay.id = "eja-dashboard-overlay";
    overlay.className = "eja-dashboard-overlay";
    overlay.innerHTML = buildDashboardHTML(companies, currencyStatus, yesterday, holdingsData);
    document.body.appendChild(overlay);

    // Bind events
    overlay.querySelector(".eja-dashboard-close").addEventListener("click", closeDashboardOverlay);
    overlay.querySelector(".eja-refresh-btn")?.addEventListener("click", async () => {
      closeDashboardOverlay();
      setTimeout(() => openDashboardOverlay(), 100);
    });

    // Animate in
    requestAnimationFrame(() => {
      backdrop.classList.add("visible");
      overlay.classList.add("visible");
    });

    // ESC to close
    const escHandler = (e) => {
      if (e.key === "Escape" && dashboardOverlayOpen) {
        closeDashboardOverlay();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  };

  const buildDashboardHTML = (companies, currencyStatus, yesterday, holdingsData = []) => {
    // Group companies by section
    const sections = {};
    companies.forEach((c) => {
      if (!sections[c.section]) sections[c.section] = { name: c.section, companies: [], wages: {}, productions: {} };
      sections[c.section].companies.push(c);
      // Aggregate wages per section
      Object.entries(c.wages).forEach(([code, data]) => {
        if (!sections[c.section].wages[code]) sections[c.section].wages[code] = { amount: 0, icon: data.icon };
        sections[c.section].wages[code].amount += data.amount;
      });
      // Aggregate productions per section
      Object.entries(c.productions).forEach(([name, data]) => {
        if (!sections[c.section].productions[name]) sections[c.section].productions[name] = { amount: 0, icon: data.icon };
        sections[c.section].productions[name].amount += data.amount;
      });
    });

    // Total production summary
    const totalProductions = {};
    companies.forEach((c) => {
      Object.entries(c.productions).forEach(([name, data]) => {
        if (!totalProductions[name]) totalProductions[name] = { amount: 0, icon: data.icon };
        totalProductions[name].amount += data.amount;
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
    const totalProdChips = Object.entries(totalProductions)
      .map(([name, data]) => `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount} ${name}</span>`)
      .join("") || '<span style="color:#64748b">Brak produkcji</span>';

    const totalWagesChips = Object.entries(totalWages)
      .map(([code, data]) => `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toFixed(1)} ${code}</span>`)
      .join("") || '<span style="color:#64748b">—</span>';

    // Build section HTML
    const buildSectionHTML = (sectionData, sectionName, yesterday) => {
      const sectionCompanies = sectionData.companies;
      const sectionEmployees = sectionCompanies.reduce((sum, c) => sum + c.employeeCount, 0);
      const yesterdaySectionCompanies = yesterday?.companies?.filter((c) => c.section === sectionName) || [];
      const yesterdayEmployees = yesterdaySectionCompanies.reduce((sum, c) => sum + (c.employeeCount || 0), 0);
      const empTrend = yesterday ? sectionEmployees - yesterdayEmployees : null;

      // Section wages chips
      const sectionWagesChips = Object.entries(sectionData.wages)
        .map(([code, data]) => `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toFixed(1)} ${code}</span>`)
        .join("") || "—";

      // Section production chips
      const sectionProdChips = Object.entries(sectionData.productions)
        .map(([name, data]) => `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount} ${name}</span>`)
        .join("") || '<span style="color:#64748b">—</span>';

      // Company rows for this section
      const companyRows = sectionCompanies
        .map((c) => {
          const yesterdayCompany = yesterday?.companies?.find((yc) => yc.id === c.id);
          const empYesterday = yesterdayCompany?.employeeCount || null;
          const empDiff = empYesterday !== null ? c.employeeCount - empYesterday : null;
          const trendClass = empDiff === null ? "" : empDiff > 0 ? "eja-trend-up" : empDiff < 0 ? "eja-trend-down" : "eja-trend-same";
          const trendText = empDiff === null ? "" : empDiff > 0 ? ` (+${empDiff})` : empDiff < 0 ? ` (${empDiff})` : " (=)";
          const wagesChips = Object.entries(c.wages)
            .map(([code, data]) => `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${data.amount.toFixed(1)} ${code}</span>`)
            .join("") || "—";
          const prodChips = Object.entries(c.productions)
            .map(([name, data]) => {
              const cap = data.capacity || data.amount;
              // Show "Amount / Cap" if strictly less, otherwise just Amount
              const valText = data.amount < cap ? `${data.amount}/${cap}` : `${data.amount}`;
              return `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ""}${valText} ${name}</span>`;
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

      const sectionIcon = sectionName.toLowerCase().includes("moje") || sectionName.toLowerCase().includes("own") ? "👤" : "🏢";
      const empDisplay = yesterday 
        ? `${sectionEmployees} <span style="font-size:11px;color:#64748b;">(Wczoraj: ${yesterdayEmployees}, <span class="${empTrend > 0 ? "eja-trend-up" : empTrend < 0 ? "eja-trend-down" : "eja-trend-same"}">${empTrend > 0 ? "+" : ""}${empTrend}</span>)</span>`
        : `${sectionEmployees}`;

      return `
        <div class="eja-dashboard-section">
          <h3>${sectionIcon} ${sectionName}</h3>
          <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:12px;">
            <div><strong style="color:#94a3b8;font-size:11px;">PRACOWNICY:</strong> ${empDisplay}</div>
            <div><strong style="color:#94a3b8;font-size:11px;">KOSZTY/DZIEŃ:</strong> ${sectionWagesChips}</div>
            <div><strong style="color:#94a3b8;font-size:11px;">PRODUKCJA:</strong> ${sectionProdChips}</div>
          </div>
          <details style="margin-top:8px;">
            <summary style="cursor:pointer;font-size:12px;color:#60a5fa;">Pokaż firmy (${sectionCompanies.length})</summary>
            <table class="eja-company-table" style="margin-top:8px;">
              <thead>
                <tr><th>Firma</th><th>Pracownicy</th><th>Koszty</th><th>Produkcja</th></tr>
              </thead>
              <tbody>${companyRows}</tbody>
            </table>
          </details>
        </div>
      `;
    };

    const sectionsHTML = Object.entries(sections)
      .map(([name, data]) => buildSectionHTML(data, name, yesterday))
      .join("");

    // Build holdings bank & storage display
    const buildHoldingsDataHTML = (holdingsData, sections) => {
      if (!holdingsData || holdingsData.length === 0) return '';
      const holdingCards = holdingsData
        .filter(h => h.bank && Object.keys(h.bank).length > 0 || h.storage)
        .map(h => {
          // Bank currencies
          const bankChips = Object.entries(h.bank || {})
            .filter(([, data]) => data.amount > 0)
            // Removed slice(0, 6) limit to show all currencies
            .map(([code, data]) => `<span class="eja-chip">${data.icon ? `<img src="${data.icon}">` : ''}${data.amount.toFixed(2)} ${code}</span>`)
            .join('') || '<span style="color:#64748b">Brak środków</span>';
          
          // Storage info
          const storageInfo = h.storage
            ? `<span style="color:${h.storage.free < 100 ? '#ef4444' : '#22c55e'};">📦 ${h.storage.used.toLocaleString()} / ${h.storage.capacity.toLocaleString()} (Wolne: ${h.storage.free.toLocaleString()})</span>`
            : '<span style="color:#64748b">Brak danych</span>';

          // Alerts: Check if funds < 2 * daily wages
          let alerts = "";
          const section = sections[h.name]; // Match holding name with section name
          if (section) {
            Object.entries(section.wages).forEach(([curr, wageData]) => {
              const dailyWage = wageData.amount;
              const bankAmt = h.bank?.[curr]?.amount || 0;
              if (dailyWage > 0 && bankAmt < dailyWage * 2) {
                const daysLeft = bankAmt / dailyWage;
                alerts += `<div class="eja-holding-alert">⚠️ ${curr}: wystarczy na ${daysLeft.toFixed(1)} dni (Potrzeba: ${dailyWage.toFixed(1)}/d)</div>`;
              }
            });
          }

          return `
            <div class="eja-holding-card">
              <div class="eja-holding-header">
                ${h.icon ? `<img src="${h.icon}" alt="${h.name}" style="width:24px;height:24px;border-radius:4px;">` : '🏢'}
                <strong>${h.name}</strong>
              </div>
              ${alerts}
              <div class="eja-holding-row"><span style="color:#94a3b8;font-size:11px;">BANK:</span> ${bankChips}</div>
              <div class="eja-holding-row"><span style="color:#94a3b8;font-size:11px;">MAGAZYN:</span> ${storageInfo}</div>
            </div>
          `;
        })
        .join('');
      if (!holdingCards) return '';
      return `
        <div class="eja-dashboard-section">
          <h3>🏠 Stan Holdingów</h3>
          <div class="eja-holdings-grid">${holdingCards}</div>
        </div>
      `;
    };

    const holdingsDataHTML = buildHoldingsDataHTML(holdingsData, sections);

    // Global currency status (compact grid)
    const currencyCards = Object.entries(currencyStatus)
      .filter(([, data]) => data.need > 0)
      .sort((a, b) => b[1].need - a[1].need)
      .map(([code, data]) => {
        const color = data.status === "ok" ? "#22c55e" : data.status === "warning" ? "#f59e0b" : "#ef4444";
        const diffInt = Math.floor(data.diff);
        const diffText = diffInt >= 0 ? "OK" : diffInt;
        return `
          <div class="eja-currency-compact-item" style="border-left: 3px solid ${color}">
            <div class="eja-currency-compact-header">
               <span style="display:flex;align-items:center;gap:4px;">
                 ${data.icon ? `<img src="${data.icon}" style="width:14px;height:14px;">` : ""} ${code}
               </span>
               <span style="color:${color}">${diffText}</span>
            </div>
            <div style="display:flex;justify-content:space-between;color:#94a3b8;margin-top:2px;">
               <span>Potrzeba:</span>
               <strong>${Math.round(data.need)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;color:#94a3b8;">
               <span>Masz:</span>
               <span>${Math.round(data.have)}</span>
            </div>
            ${data.diff < 0 ? `<a href="https://eclesiar.com/market/coin/advanced" target="_blank" class="eja-buy-link" style="text-align:right;margin-top:4px;">Kup braki →</a>` : ""}
          </div>
        `;
      })
      .join("");

    return `
      <div class="eja-dashboard-header">
        <h2>📊 Centrum Statystyki Przedsiębiorcy</h2>
        <button class="eja-dashboard-close" title="Zamknij">✕</button>
      </div>
      <div class="eja-dashboard-body">
        <div class="eja-dashboard-section" style="background:linear-gradient(135deg,rgba(59,130,246,0.15),rgba(37,99,235,0.1));">
          <h3>📈 Podsumowanie Ogólne</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
            <div><strong style="color:#94a3b8;font-size:11px;display:block;">PRACOWNICY</strong><span style="font-size:24px;font-weight:700;">${buildEmployeeDisplay(totalEmployees, yesterdayTotalEmployees, totalEmpTrend)}</span></div>
            <div><strong style="color:#94a3b8;font-size:11px;display:block;">HOLDINGI</strong><span style="font-size:24px;font-weight:700;">${Object.keys(sections).length}</span></div>
            <div><strong style="color:#94a3b8;font-size:11px;display:block;">FIRMY</strong><span style="font-size:24px;font-weight:700;">${companies.length}</span></div>
          </div>
          <div style="margin-top:12px;">
            <div><strong style="color:#94a3b8;font-size:11px;">ŁĄCZNE KOSZTY/DZIEŃ:</strong> ${totalWagesChips}</div>
            <div style="margin-top:6px;"><strong style="color:#94a3b8;font-size:11px;">ŁĄCZNA PRODUKCJA:</strong> ${totalProdChips}</div>
          </div>
        </div>


        ${currencyCards.length ? `
        <div class="eja-dashboard-section">
          <h3>💰 Bilans Walut (Twoje Konto)</h3>
          <div class="eja-currency-compact-grid">${currencyCards}</div>
        </div>
        ` : ""}

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

  function getCachedHoldings() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.holdings)) return [];
      const age = Date.now() - (parsed.updatedAt || 0);
      if (age > CACHE_TTL_MS) {
        if (!holdingsCacheWarned) {
          holdingsCacheWarned = true;
          try {
            console.debug("[EJA] holdings cache expired");
          } catch {}
        }
        return [];
      }
      holdingsCacheWarned = false;
      return parsed.holdings;
    } catch {}
    return [];
  }

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

  function injectMenuHoldings(root) {
    if (!EJA_ADD_HOLDINGS_TO_MENU) return;
    const doc = root || document;
    const holdings = getCachedHoldings();
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
      if (!holdings.length) return; // no links if no fresh cache
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
        a.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          window.location.href = a.href;
        }, { capture: true });
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
      (a) => !a.closest(".extra-buy-options")
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
      "Kopalnia żelaza",
      "Iron Mine",
      "Kopalnia tytanu",
      "Titanium Mine",
      "Szyb naftowy",
      "Oil Well",
    ].map((name) => (name || "").trim().toLowerCase())
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

  const getEmployeeTodayData = (employee) => {
    const worklogRaw = employee.getAttribute("data-worklog") || "";
    const worklogData = parseWorklogData(worklogRaw);
    const fallbackWorked = !!employee.querySelector(".fa-check");
    const todayEntry = worklogData ? worklogData[getTodayKey()] : null;
    if (!todayEntry) {
      return {
        worked: fallbackWorked,
        productionItems: [],
        consumptionItems: [],
      };
    }
    return {
      worked: typeof todayEntry.worked === "boolean" ? todayEntry.worked : fallbackWorked,
      productionItems: extractItemsFromHtml(todayEntry.production, ".item.production"),
      consumptionItems: extractItemsFromHtml(todayEntry.consumption, ".item.consumption"),
    };
  };

  const resolveRowProductMeta = (row, overrides = {}) => {
    const overrideLabel = overrides.label || "";
    const overrideIcon = overrides.icon || "";
    let iconUrl = overrideIcon;
    let baseLabel = overrideLabel;
    const productionImage =
      row.querySelector(".production-mobile img:last-of-type") || row.querySelector(".production-mobile img");
    if (productionImage) {
      if (!iconUrl) iconUrl = productionImage.currentSrc || productionImage.src;
      if (!baseLabel) baseLabel = productionImage.getAttribute("title") || productionImage.getAttribute("alt") || "";
    }
    if (!baseLabel) {
      baseLabel =
        row.getAttribute("data-type") ||
        row.getAttribute("data-name") ||
        overrides.fallbackName ||
        row.querySelector(".company-name-h5 span")?.textContent ||
        "Produkt";
    }
    const companyType = row.getAttribute("data-type") || "";
    const qualityVal = parseInt(row.getAttribute("data-quality"), 10);
    const normalizedType = (companyType || "").trim().toLowerCase();
    const isRaw = RAW_RESOURCE_TYPES.has(normalizedType);
    const qualitySuffix = qualityVal && qualityVal > 0 && !isRaw ? `Q${qualityVal}` : "";
    const displayLabel = qualitySuffix ? `${baseLabel} ${qualitySuffix}` : baseLabel;
    return {
      icon: iconUrl || overrideIcon || "",
      label: displayLabel,
      rawLabel: baseLabel,
      companyType,
      qualitySuffix,
    };
  };

  const resolveEmployeeCurrencyDisplay = (employee) => ({
    icon: employee.getAttribute("data-currencyavatar") || "",
    label: employee.getAttribute("data-currencyname") || employee.getAttribute("data-currencycode") || "",
  });

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

  const ensureSummaryStyles = () => {
    if (document.__ejaSummaryStylesApplied) return;
    document.__ejaSummaryStylesApplied = true;
    const style = document.createElement("style");
    style.setAttribute("data-eja", "summary-style");
    style.textContent = `
      .eja-holdings-summary {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.15);
      }
      .dark-mode .eja-holdings-summary {
        background: rgba(255, 255, 255, 0.04);
        border-color: rgba(255, 255, 255, 0.08);
      }
      .eja-summary-table {
        margin-bottom: 0;
      }
      .eja-summary-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        margin: 2px;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.08);
        font-size: 12px;
        font-weight: 600;
        color: inherit;
      }
      .dark-mode .eja-summary-chip {
        background: rgba(255, 255, 255, 0.06);
      }
      .eja-summary-chip img {
        width: 18px;
        height: 18px;
        object-fit: contain;
      }
      .eja-holdings-summary .font-12 {
        font-size: 12px !important;
        line-height: 1.2;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const createEntryGroupElement = (entries, emptyLabel, options = {}) => {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-wrap align-items-center";
    if (!entries.length) {
      const empty = document.createElement("span");
      empty.className = "text-muted font-12";
      empty.textContent = emptyLabel;
      wrapper.appendChild(empty);
      return wrapper;
    }
    entries.forEach((entry) => {
      const chip = document.createElement("div");
      chip.className = "eja-summary-chip";
      chip.title = entry.label || entry.key || "";
      if (entry.icon) {
        const img = document.createElement("img");
        img.src = entry.icon;
        img.alt = entry.label || entry.key || "Ikona";
        img.referrerPolicy = "no-referrer";
        chip.appendChild(img);
      }
      const text = document.createElement("span");
      const formattedValue = formatNumericValue(entry.amount, options.numberFormat || {});
      text.textContent = entry.label ? `${formattedValue} ${entry.label}` : formattedValue;
      chip.appendChild(text);
      wrapper.appendChild(chip);
    });
    return wrapper;
  };

  const appendLabeledGroup = (container, title, entries, emptyLabel, options = {}) => {
    const group = document.createElement("div");
    group.className = "mb-2";
    const heading = document.createElement("div");
    heading.className = "text-muted font-12 text-uppercase mb-1";
    heading.textContent = title;
    group.appendChild(heading);
    group.appendChild(createEntryGroupElement(entries, emptyLabel, options));
    container.appendChild(group);
  };

  const isSummaryCollapsed = () => localStorage.getItem(SUMMARY_COLLAPSE_KEY) === "1";

  const setSummaryCollapsed = (collapsed) => {
    localStorage.setItem(SUMMARY_COLLAPSE_KEY, collapsed ? "1" : "0");
  };

  const renderSectionSummaryTable = (sections, root = document) => {
    const containers = getActiveHoldingsContainers(root);
    const existing = root.querySelector('[data-eja="holdings-summary"]');
    if (!containers.length) {
      if (existing) existing.remove();
      return;
    }
    ensureSummaryStyles();
    const firstContainer = containers[0];
    let summaryBox = existing;
    if (!summaryBox) {
      summaryBox = document.createElement("div");
      summaryBox.setAttribute("data-eja", "holdings-summary");
      summaryBox.className = "eja-holdings-summary p-3 mb-3";
      firstContainer.parentElement.insertBefore(summaryBox, firstContainer);
    } else if (summaryBox.parentElement !== firstContainer.parentElement) {
      firstContainer.parentElement.insertBefore(summaryBox, firstContainer);
    }
    // Check if button already exists
    if (summaryBox.querySelector(".eja-open-dashboard-btn")) return;
    summaryBox.innerHTML = "";
    const header = document.createElement("div");
    header.className = "d-flex align-items-center justify-content-between";
    const title = document.createElement("p");
    title.className = "font-12 weight-600 mb-0";
    header.appendChild(title);
    const dashboardBtn = document.createElement("button");
    dashboardBtn.type = "button";
    dashboardBtn.className = "btn btn-primary btn-sm eja-open-dashboard-btn";
    dashboardBtn.innerHTML = "📊 Otwórz Centrum Przedsiębiorcy";
    dashboardBtn.style.cssText = "background: linear-gradient(135deg, #3b82f6, #2563eb); border: none; font-weight: 600;";
    dashboardBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDashboardOverlay();
    });
    header.appendChild(dashboardBtn);
    summaryBox.appendChild(header);
    // Quick stats summary
    const totalEmployees = sections.reduce((sum, s) => {
      const spent = s.wagesSpent?.length || 0;
      const pending = s.wagesPending?.length || 0;
      return sum + spent + pending;
    }, 0);
    const statsLine = document.createElement("div");
    statsLine.className = "font-12 text-muted mt-2";
    summaryBox.appendChild(statsLine);
  };

  const RAW_RESOURCE_ITEM_NAMES = new Set(["grain", "zboże", "iron", "żelazo", "titanium", "tytan", "oil", "paliwo"]);

  const normalizeLabelKey = (label, fallback = "") => (label || fallback || "").trim().toLowerCase();

  const collectSectionStats = (root = document) => {
    const sections = [];
    const containers = getActiveHoldingsContainers(root);
    containers.forEach((container) => {
      const headerRow = container.querySelector(".row.closeHoldings[data-target]");
      const label = headerRow && headerRow.querySelector(".holdings-description span");
      if (!headerRow || !label) return;
      const baseLabel = (label.dataset.ejaOriginalLabel || label.textContent || "").trim();
      const targetKey = (headerRow.getAttribute("data-target") || "").trim();
      if (!targetKey) return;
      const targetList = container.querySelector(`.${targetKey}`) || container.querySelector(`#${targetKey}`);
      if (!targetList) return;
      const productions = new Map();
      const rawCosts = new Map();
      const wagesSpent = new Map();
      const wagesPending = new Map();
      const companyRows = targetList.querySelectorAll(".hasBorder[data-id]");
      companyRows.forEach((row) => {
        const employees = row.querySelectorAll(".employees_list .employee");
        employees.forEach((employee) => {
          const wage = parseNumberValue(employee.getAttribute("data-wage") || employee.dataset.wage);
          const currencyKey =
            employee.getAttribute("data-currencyid") ||
            employee.getAttribute("data-currency") ||
            employee.getAttribute("data-currencyname") ||
            "";
          const todayData = getEmployeeTodayData(employee);
          if (wage > 0 && currencyKey) {
            const currencyDisplay = resolveEmployeeCurrencyDisplay(employee);
            const targetMap = todayData.worked ? wagesSpent : wagesPending;
            accumulateEntry(targetMap, currencyKey, wage, currencyDisplay);
          }
          todayData.productionItems.forEach((productionItem) => {
            if (!productionItem || productionItem.amount === 0) return;
            const combinedMeta = resolveRowProductMeta(row, {
              label: productionItem.label,
              icon: productionItem.icon,
            });
            const productKey = normalizeLabelKey(combinedMeta.rawLabel || combinedMeta.label || "produkt");
            accumulateEntry(productions, productKey, productionItem.amount, {
              icon: combinedMeta.icon || productionItem.icon,
              label: combinedMeta.label || productionItem.label,
              qualityKey: combinedMeta.qualitySuffix,
            });
          });
          todayData.consumptionItems.forEach((consumptionItem) => {
            if (!consumptionItem || consumptionItem.amount === 0) return;
            const labelKey = normalizeLabelKey(consumptionItem.label, "surowiec");
            const isRaw =
              RAW_RESOURCE_ITEM_NAMES.has(labelKey) || labelKey.includes("grain") || labelKey.includes("iron");
            if (!isRaw) return;
            accumulateEntry(rawCosts, labelKey, -Math.abs(consumptionItem.amount), {
              icon: consumptionItem.icon || "",
              label: consumptionItem.label || "Surowiec",
            });
          });
        });
      });
      if (!productions.size && !rawCosts.size && !wagesSpent.size && !wagesPending.size) return;
      sections.push({
        name: baseLabel,
        productions: Array.from(productions.values()),
        rawCosts: Array.from(rawCosts.values()),
        wagesSpent: Array.from(wagesSpent.values()),
        wagesPending: Array.from(wagesPending.values()),
      });
    });
    return sections;
  };

  // Simple hash for section stats to detect changes
  const hashSectionStats = (sections) => {
    if (!sections.length) return "empty";
    return sections
      .map((s) => {
        const prodSum = s.productions.reduce((acc, p) => acc + p.amount, 0);
        const rawSum = s.rawCosts.reduce((acc, r) => acc + r.amount, 0);
        const wageSpentSum = s.wagesSpent.reduce((acc, w) => acc + w.amount, 0);
        const wagePendSum = s.wagesPending.reduce((acc, w) => acc + w.amount, 0);
        return `${s.name}:${prodSum}:${rawSum}:${wageSpentSum}:${wagePendSum}`;
      })
      .join("|");
  };

  const updateHoldingsSectionSummaries = (root = document) => {
    const sections = collectSectionStats(root);
    const newHash = hashSectionStats(sections);
    // Skip render if data hasn't changed
    if (newHash === lastSectionStatsHash) return;
    lastSectionStatsHash = newHash;
    renderSectionSummaryTable(sections, root);
  };

  const refreshJobsWidgets = (root = document) => {
    updateHoldingsEmployeeCounts(root);
    updateHoldingsSectionSummaries(root);
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

  const updateHoldingsEmployeeCounts = (root = document) => {
    const containers = root.querySelectorAll(".holdings-container");
    containers.forEach((container) => {
      const headerRow = container.querySelector(".row.closeHoldings[data-target]");
      const label = headerRow && headerRow.querySelector(".holdings-description span");
      if (!headerRow || !label) return;
      if (!label.dataset.ejaOriginalLabel) {
        label.dataset.ejaOriginalLabel = (label.textContent || "").trim();
      }
      const baseLabel = label.dataset.ejaOriginalLabel;
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
        const scheduleUpdate = debounce(() => refreshJobsWidgets(document), 150);
        scheduleUpdate();
        // Observe only the holdings area, not the entire page (performance optimization)
        const holdingsArea =
          document.querySelector(".tab-content") ||
          document.querySelector(".holdings-container")?.parentElement ||
          document.querySelector(".page-info") ||
          document.body;
        const observer = new MutationObserver(scheduleUpdate);
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
      (a) => !a.closest(".extra-buy-options")
    );
    buttons.forEach((btn) => {
      if (!btn.__ejaClickBound) {
        btn.__ejaClickBound = true;
        btn.addEventListener("click", () => updateButton(select, contextRoot), { capture: true });
      }
    });
  };

  const start = () => {
    if (isSellPage()) {
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
    if (EJA_ADD_HOLDINGS_TO_MENU) {
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
    if (isJobsPage()) {
      initJobsPageEnhancements();
    }
  };

  onReady(start);
})();
