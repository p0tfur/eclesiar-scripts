// ==UserScript==
// @name         Eclesiar Janueszex Assistant by p0tfur
// @namespace    https://eclesiar.com/
// @version      1.0.2
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
  let holdingsCacheWarned = false;

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
      const moMenu = new MutationObserver(injectMenus);
      moMenu.observe(document.documentElement, { childList: true, subtree: true });
      // Also inject right after any click (dropdowns often toggle on click)
      document.addEventListener("click", injectMenus, { capture: true });

      // Delegated handlers for injected holding links (capture to override site handlers)
      if (!document.__ejaDelegatedNav) {
        document.__ejaDelegatedNav = true;
        const handler = (e) => {
          const a = e.target && (e.target.closest ? e.target.closest('a[data-eja="holding-link"]') : null);
          if (a) {
            try {
              e.preventDefault();
              e.stopPropagation();
            } catch {}
            try {
              setTimeout(() => window.location.assign(a.href), 0);
            } catch {}
          }
        };
        document.addEventListener("click", handler, { capture: true });
        document.addEventListener("mousedown", handler, { capture: true });
        document.addEventListener("touchend", handler, { capture: true });
      }
    }
  };

  onReady(start);
})();
