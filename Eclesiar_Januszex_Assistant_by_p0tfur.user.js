// ==UserScript==
// @name         Eclesiar Janueszex Assistant by p0tfur
// @namespace    https://eclesiar.com/
// @version      1.2.5
// @description  Janueszex Assistant
// @author       p0tfur
// @match        https://eclesiar.com/*
// @updateURL    https://24na7.info/eclesiar-scripts/Eclesiar_Januszex_Assistant_by_p0tfur.user.js
// @downloadURL  https://24na7.info/eclesiar-scripts/Eclesiar_Januszex_Assistant_by_p0tfur.user.js
// ==/UserScript==

(() => {
  // USER CONFIG
  const EJA_ADD_HOLDINGS_TO_MENU = true; // Add holdings to global dropdown menu
  // USER CONFIG

  const CACHE_KEY = "eja_holdings";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  const SUMMARY_COLLAPSE_KEY = "eja_holdings_summary_collapsed";
  let holdingsCacheWarned = false;
  let lastSectionStatsHash = null; // Cache hash to skip redundant renders

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

  const isSellPage = () => location.href.startsWith("https://eclesiar.com/market/sell");
  const isJobsPage = () => location.pathname.startsWith("/jobs");

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
    let menus = Array.from(doc.querySelectorAll(".dropdown-menu.px-1.show"));
    if (!menus.length) menus = Array.from(doc.querySelectorAll(".dropdown-menu.show"));
    if (!menus.length) return;
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
        a.addEventListener("click", () => {
          try {
            setTimeout(() => window.location.assign(a.href), 0);
          } catch {}
        });
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
    if (!sections.length || !containers.length) {
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
    summaryBox.innerHTML = "";
    const header = document.createElement("div");
    header.className = "d-flex align-items-center justify-content-between mb-3";
    const title = document.createElement("p");
    title.className = "font-12 weight-600 mb-0";
    title.textContent = "Podsumowanie dzienne";
    header.appendChild(title);
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn btn-link p-0 font-12 text-uppercase weight-600";
    let tableRef = null;
    const applyCollapsedState = (state) => {
      toggleBtn.textContent = state ? "Rozwiń" : "Zwiń";
      summaryBox.classList.toggle("collapsed", state);
      if (tableRef) {
        tableRef.style.display = state ? "none" : "table";
      }
    };
    const collapsedState = isSummaryCollapsed();
    toggleBtn.addEventListener("click", () => {
      const nextState = !isSummaryCollapsed();
      setSummaryCollapsed(nextState);
      applyCollapsedState(nextState);
    });
    header.appendChild(toggleBtn);
    summaryBox.appendChild(header);

    const table = document.createElement("table");
    table.className = "table table-sm table-borderless eja-summary-table";
    tableRef = table;
    applyCollapsedState(collapsedState);
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Sekcja", "Produkcja", "Koszty"].forEach((label) => {
      const th = document.createElement("th");
      th.className = "font-12 text-uppercase text-muted";
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    sections.forEach((section) => {
      const tr = document.createElement("tr");
      const nameTd = document.createElement("td");
      nameTd.className = "align-middle font-12 weight-600";
      nameTd.textContent = section.name;

      const prodTd = document.createElement("td");
      appendLabeledGroup(prodTd, "Produkty", section.productions, "Brak danych");
      appendLabeledGroup(prodTd, "Koszt surowców", section.rawCosts, "Brak surowców");

      const costTd = document.createElement("td");
      appendLabeledGroup(costTd, "Poniesione", section.wagesSpent, "Brak wynagrodzeń", {
        numberFormat: { minFractionDigits: 3, maxFractionDigits: 3 },
      });
      appendLabeledGroup(costTd, "Do poniesienia", section.wagesPending, "Brak wynagrodzeń", {
        numberFormat: { minFractionDigits: 3, maxFractionDigits: 3 },
      });

      tr.appendChild(nameTd);
      tr.appendChild(prodTd);
      tr.appendChild(costTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    summaryBox.appendChild(table);
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
      // Observe only navbar area for dropdown changes (more efficient than full document)
      const navbarArea = document.querySelector(".navbar") || document.querySelector("nav") || document.body;
      const moMenu = new MutationObserver(injectMenus);
      moMenu.observe(navbarArea, { childList: true, subtree: true });

      // Delegated handlers for injected holding links (capture to override site handlers)
      // Single click handler works for desktop and mobile (touchend can cause double-fire issues)
      if (!document.__ejaDelegatedNav) {
        document.__ejaDelegatedNav = true;
        const handler = (e) => {
          const a = e.target && (e.target.closest ? e.target.closest('a[data-eja="holding-link"]') : null);
          if (a) {
            e.preventDefault();
            e.stopPropagation();
            // Use location.href for better mobile compatibility
            window.location.href = a.href;
          }
        };
        document.addEventListener("click", handler, { capture: true });
      }
    }
    if (isJobsPage()) {
      initJobsPageEnhancements();
    }
  };

  onReady(start);
})();
