// ==UserScript==
// @name Eclesiar Misc Additions
// @namespace http://tampermonkey.net/
// @version 1.2.9
// @description Fixed mission indicator, improved UX for energy and food indicators, added auto language detection and Polish translation, added EQ presets to build/mine views
// @author p0tfur, based on script by ms05 + SirManiek
// @match https://eclesiar.com/*
// @updateURL    https://24na7.info/eclesiar-scripts/Eclesiar Misc Additions.user.js
// @downloadURL  https://24na7.info/eclesiar-scripts/Eclesiar Misc Additions.user.js
// @grant none
// ==/UserScript==

////////// USER CONFIG //////////
// Change to false to disable
const DISPLAY_BOTH_RANKS = true;
const CENTER_HEADLINES_IN_SIDEBAR = false;
const DISPLAY_DAILY_TASKS_INDICATOR = true;
const DISPLAY_MISSIONS_INDICATOR = true;
const DISPLAY_ENERGY_FULL_TIME = true;
// Optional: background image for the extra 'Cedruj' button. Leave empty to disable.
const CEDRUJ_BG_IMAGE = "https://24na7.info/cedru.png";
// Optional: overlay color to improve contrast over the image
const CEDRUJ_BG_OVERLAY = "rgba(0,0,0,0.35)";
// Cedru mode toggle: when true -> header uses alternate phrase and original MERGE buttons are hidden
// When false (normal) -> original header stays and both MERGE and CEDRUJ buttons are shown
const CEDRU_VERSION = true;
/////////////////////////////////
////////// USER CONFIG //////////

(function () {
  "use strict";

  // Declare AUTH_BEARER at the top of IIFE scope so all functions can access it
  let AUTH_BEARER = null;
  let energyFoodTickerId = null;
  let energyFoodObserver = null;
  let energyFoodObserverUpdate = null;
  let energyFoodObservedTarget = null;
  let energyFoodWarnedMissing = false;
  let energyFoodRetryTimeout = null;
  let energyTimerElRef = null;
  let foodTimerElRef = null;
  let compactTimeFormatters = {};
  let lastEnergySeconds = null;
  let lastFoodSeconds = null;
  let lastEnergyShownSec = null;
  let lastFoodShownSec = null;

  // Apply preset: try direct API first, fallback to quick redirect on failure
  function applyPreset(num, buildId) {
    try {
      const p = applyPresetDirect(num, buildId);
      if (p && typeof p.then === "function") {
        return p.catch(() => quickApplyPreset(num, buildId));
      }
    } catch {}
    return quickApplyPreset(num, buildId);
  }

  function ensurePartyButtonsUX() {
    try {
      addPartyButtonsStyles();
    } catch {}
  }

  function observePartyTargets() {
    try {
      const target = document.body || document.documentElement || document;
      const onMut = debounce(() => {
        ensurePartyButtonsUX();
      }, 200);
      const obs = new MutationObserver(onMut);
      obs.observe(target, { childList: true, subtree: true });
      ensurePartyButtonsUX();
    } catch (e) {
      warn("Failed to observe party targets: " + e);
    }
  }

  function addPartyButtonsStyles() {
    try {
      const styleId = "ecplus-party-buttons-style";
      if (document.getElementById(styleId)) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        /* Clarify party signup buttons: inactive vs active */
        .member-action-icons .militant-row__icon-btn.signup-red {
          border-width: 1px !important;
          border-style: solid !important;
          transition: filter 120ms ease, opacity 120ms ease, transform 120ms ease;
        }
        /* Inactive: neutral gray look */
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red.inactive,
        .member-action-icons .militant-row__icon-btn.signup-red.inactive {
          background-color: #e5e7eb !important; /* gray-200 */
          border-color: #d1d5db !important;     /* gray-300 */
          color: #9ca3af !important;            /* gray-400 icons */
          background-image: none !important;
          box-shadow: none !important;
          filter: grayscale(100%);
        }
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red.inactive i,
        .member-action-icons .militant-row__icon-btn.signup-red.inactive i {
          color: #9ca3af !important;
        }
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red.inactive:hover,
        .member-action-icons .militant-row__icon-btn.signup-red.inactive:hover {
          filter: grayscale(100%) brightness(0.95);
          cursor: default;
        }
        /* Active (clickable): vivid green with white icon */
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red.active,
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red:not(.inactive),
        .member-action-icons .militant-row__icon-btn.signup-red.active,
        .member-action-icons .militant-row__icon-btn.signup-red:not(.inactive) {
          background-color: #058743 !important; /* green-600 */
          border-color: #004d24 !important;     /* green-700 */
          background-image: none !important;
          box-shadow: none !important;
          color: #ffffff !important;
        }
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red.active i,
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red:not(.inactive) i,
        .member-action-icons .militant-row__icon-btn.signup-red.active i,
        .member-action-icons .militant-row__icon-btn.signup-red:not(.inactive) i {
          color: #ffffff !important;
        }
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red.active:hover,
        .party__members-section .member-action-icons .militant-row__icon-btn.signup-red:not(.inactive):hover,
        .member-action-icons .militant-row__icon-btn.signup-red.active:hover,
        .member-action-icons .militant-row__icon-btn.signup-red:not(.inactive):hover {
          filter: brightness(1.07);
        }
        .member-action-icons .militant-row__icon-btn.signup-red:focus {
          outline: 2px solid #fca5a5 !important; /* red-300 */
          outline-offset: 2px;
        }
      `;
      document.head.appendChild(style);
    } catch {}
  }

  function clearEnergyFoodTicker() {
    if (energyFoodTickerId) {
      clearInterval(energyFoodTickerId);
      energyFoodTickerId = null;
    }
  }

  function clearEnergyFoodObserver() {
    try {
      if (energyFoodObserver) {
        energyFoodObserver.disconnect();
        energyFoodObserver = null;
      }
    } catch {}
    energyFoodObserverUpdate = null;
    energyFoodObservedTarget = null;
    if (energyFoodRetryTimeout) {
      clearTimeout(energyFoodRetryTimeout);
      energyFoodRetryTimeout = null;
    }
  }

  function scheduleEnergyFoodTicker(updateFn) {
    clearEnergyFoodTicker();
    try {
      energyFoodTickerId = setInterval(() => {
        try {
          updateFn();
        } catch {}
      }, 1000);
    } catch {}
  }

  function scheduleEnergyFoodRetry(wait = 1000) {
    if (energyFoodRetryTimeout) return;
    try {
      energyFoodRetryTimeout = setTimeout(() => {
        energyFoodRetryTimeout = null;
        try {
          displayEnergyFullTime();
        } catch {}
      }, wait);
    } catch {}
  }

  function ensureEnergyFoodObserver(handler) {
    if (!handler) return;
    const container = document.querySelector(SELECTORS.energyAndFoodBars);
    const target = container || document.body || document.documentElement || document;
    if (!target) return;

    if (energyFoodObservedTarget && energyFoodObservedTarget !== target) {
      try {
        if (energyFoodObserver) energyFoodObserver.disconnect();
      } catch {}
      energyFoodObserver = null;
      energyFoodObservedTarget = null;
    }

    if (!energyFoodObserver) {
      try {
        const debounced =
          energyFoodObserverUpdate ||
          debounce(() => {
            try {
              handler();
            } catch {}
          }, 500);
        energyFoodObserverUpdate = debounced;
        energyFoodObserver = new MutationObserver(debounced);
        energyFoodObserver.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-seconds"],
        });
        energyFoodObservedTarget = target;
      } catch {}
    }
  }

  // Expose global helper for inline onclick fallback
  function exposeGlobalApply() {
    try {
      window.ecApplyPreset = function (num, buildId) {
        try {
          applyPreset(num, buildId);
        } catch {}
      };
    } catch {}
  }

  // Capture bearer token from WebSocket URL query (?bearer=...) and reuse as Authorization
  function installWebSocketSniffer() {
    try {
      if (window.__ecWsPatched) return;
      const OrigWS = window.WebSocket;
      if (!OrigWS) return;
      window.WebSocket = function (url, protocols) {
        try {
          const u = String(url);
          const m = u.match(/[?&]bearer=([^&]+)/);
          if (m && m[1]) {
            const token = decodeURIComponent(m[1]);
            if (token) AUTH_BEARER = "Bearer " + token;
          }
        } catch {}
        return new OrigWS(url, protocols);
      };
      // carry static props
      Object.keys(OrigWS).forEach((k) => {
        try {
          window.WebSocket[k] = OrigWS[k];
        } catch {}
      });
      window.WebSocket.prototype = OrigWS.prototype;
      window.__ecWsPatched = true;
    } catch {}
  }

  // Global delegated click (capture) to ensure clicks are caught even if parents stop propagation
  function installPresetClickDelegation() {
    try {
      if (window.__ecPresetDelegationInstalled) return;
      document.addEventListener(
        "click",
        function (ev) {
          try {
            const btn = ev.target && (ev.target.closest ? ev.target.closest(".ec-preset-btn") : null);
            if (!btn) return;
            ev.preventDefault();
            ev.stopPropagation();
            const num = btn.getAttribute("data-build");
            const buildId = btn.getAttribute("data-buildid");
            applyPreset(num, buildId);
          } catch {}
        },
        true
      );
      window.__ecPresetDelegationInstalled = true;
    } catch {}
  }

  function applyPresetDirect(num, buildId) {
    try {
      const bid = buildId ? String(buildId) : num ? String(num) : "";
      if (!bid) return quickApplyPreset(num, buildId);
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "*/*",
      };
      if (AUTH_BEARER) headers["Authorization"] = AUTH_BEARER;
      return fetch("https://api.eclesiar.com/account/equips/build", {
        method: "POST",
        credentials: "include",
        headers,
        body: "build_id=" + encodeURIComponent(bid),
      }).then((res) => {
        if (res && res.ok) {
          try {
            document.querySelectorAll(".ec-preset-btn").forEach((b) => b.classList.remove("active"));
            const sel = `.ec-preset-btn[data-buildid="${bid}"]` + `, .ec-preset-btn[data-build="${bid}"]`;
            const btnEl = document.querySelector(sel);
            if (btnEl) btnEl.classList.add("active");
          } catch {}
        }
        return res;
      });
    } catch {}
  }

  function quickApplyPreset(num, buildId) {
    try {
      const pending = num ? String(num) : buildId ? String(buildId) : "";
      if (!pending) return;
      setPendingBuild(pending);
      setPrevUrl(window.location.href);
      window.location.href = "/training?ec-apply=1";
    } catch {}
  }

  ////////// LANGUAGE //////////
  // Persist user language; auto-detect on first run if not set
  let LANGUAGE = (function () {
    try {
      return localStorage.getItem("ecPlus.language") || "pl";
    } catch {
      return "pl";
    }
  })();
  const TRANSLATIONS = {
    en: {
      myTransactions: "My transactions",
      energyFullAt: "",
      foodFullAt: "",
      inWord: "in",
      energyShort: "Full at:",
      foodShort: "Full at:",
      mergeButton: "CEDRUJ!",
      storageMenu: "Pawlacz",
    },
    pl: {
      myTransactions: "Moje transakcje",
      energyFullAt: "",
      foodFullAt: "",
      inWord: "za",
      energyShort: "Pełna o:",
      foodShort: "Pełne o:",
      mergeButton: "CEDRUJ!",
      storageMenu: "Pawlacz",
    },
  };
  function setLanguage(lang) {
    LANGUAGE = lang === "en" ? "en" : "pl";
    try {
      localStorage.setItem("ecPlus.language", LANGUAGE);
    } catch {}
  }

  // Capture Authorization header from any fetch/XHR on the current page
  function installAuthSniffer() {
    try {
      if (!window.__ecAuthPatchedFetch) {
        const origFetch = window.fetch;
        if (origFetch) {
          window.fetch = function () {
            try {
              let headers = null;
              const input = arguments[0];
              const init = arguments[1] || {};
              if (input && input.headers && input.headers.entries) {
                headers = Object.fromEntries(input.headers.entries());
              }
              if (init.headers) {
                const ent = init.headers.entries ? Array.from(init.headers.entries()) : Object.entries(init.headers);
                headers = headers || {};
                ent.forEach(([k, v]) => {
                  headers[String(k).toLowerCase()] = v;
                });
              }
              if (headers && headers["authorization"]) AUTH_BEARER = headers["authorization"];
            } catch {}
            return origFetch.apply(this, arguments);
          };
          window.__ecAuthPatchedFetch = true;
        }
      }
      if (!window.__ecAuthPatchedXhr) {
        const X = XMLHttpRequest;
        if (X && X.prototype) {
          const origSet = X.prototype.setRequestHeader;
          X.prototype.setRequestHeader = function (k, v) {
            try {
              if (String(k).toLowerCase() === "authorization") AUTH_BEARER = v;
            } catch {}
            return origSet.apply(this, arguments);
          };
          window.__ecAuthPatchedXhr = true;
        }
      }
    } catch {}
  }
  function detectLanguageHeuristic() {
    // Mirrors robust heuristic from tampertraining.md
    try {
      const score = { pl: 0, en: 0 };
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

      // 1) document lang
      const docLang = (document.documentElement.lang || "").toLowerCase();
      if (docLang.startsWith("pl")) score.pl += 2;
      if (docLang.startsWith("en")) score.en += 2;

      // 2) Header text cue (Dzień/Day)
      const headerEl = document.querySelector(".pl-3.ellipsis .header-text") || document.querySelector(".header-text");
      const headerText = norm(headerEl?.textContent || "");
      if (headerText.includes("dzień")) score.pl += 2;
      if (headerText.includes("day")) score.en += 2;

      // 3) Premium finances: Złoto/Gold cue
      const goldText = norm(
        document.querySelector(".premium-finances .text")?.textContent || document.body.textContent || ""
      );
      if (goldText.includes("złoto")) score.pl += 2;
      if (goldText.includes("gold")) score.en += 2;

      // 4) Account level sidebar title: Poziom/Account level
      const accTitle = norm(document.querySelector("#account_level_sidebar .title")?.textContent || "");
      if (accTitle.includes("poziom")) score.pl += 2;
      if (accTitle.includes("account level")) score.en += 2;

      if (score.pl === 0 && score.en === 0) return null;
      return score.pl >= score.en ? "pl" : "en";
    } catch {
      return null;
    }
  }
  function detectLanguageFromDocument() {
    try {
      if (localStorage.getItem("ecPlus.language")) return; // honor persisted choice
      let guess = detectLanguageHeuristic();
      if (guess) {
        // Always persist on first detection so both EN and PL create ecPlus.language
        setLanguage(guess);
      } else {
        // Fallback: persist PL by default so key is created on first run
        setLanguage("pl");
      }
    } catch {}
  }
  function observeLanguageChanges() {
    try {
      if (localStorage.getItem("ecPlus.language")) return; // persisted -> skip live detection
      const target = document.body || document.documentElement || document;
      const onMut = debounce(() => {
        detectLanguageFromDocument();
      }, 250);
      const obs = new MutationObserver(onMut);
      obs.observe(target, { childList: true, subtree: true });
    } catch {}
  }
  // Simple debounce helper
  function debounce(fn, wait) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }
  /////////////////////////////////

  ////////// PARAMETERS //////////
  const CONSOLE_LOG_PREFIX = "[Eclesiar Misc Additions]";
  const SELECTORS = {
    menuMyPlaces: "ul.navbar-nav > li.nav-item.dropdown:first-child > div.dropdown-menu",
    menuItemContracts: "a.dropdown-item.contracts-menu-item",
    ranksSidebar: "#military_rank_sidebar div.ranks-slider",
    ranksSwitchBtn: "img.purple-arrow-ranks",
    accountLevelSidebar: "#account_level_sidebar",
    missionsSidebar: "#missions",
    militaryRankSidebar: "div.ranks-slider div.w-100:first-of-type",
    constructionRankSidebar: "div.ranks-slider div.w-100:nth-of-type(2)",
    dailyTasksSidebar: "div.tutorials",
    energyAndFoodBars: "div.game-stats",
    foodTimer: "span.foodlimit-value span.full-in-timer",
    energyTimer: "span.health-value span.full-in-timer",
  };
  /////////////////////////////////

  function log(message) {
    console.log(`${CONSOLE_LOG_PREFIX} ${message}`);
  }

  function warn(message) {
    console.warn(`${CONSOLE_LOG_PREFIX} ${message}`);
  }

  function extendMainMenu() {
    log("Extending main menu");

    const myPlacesElement = document.querySelector(SELECTORS.menuMyPlaces);

    if (!myPlacesElement) {
      warn("My Places - menu not found");
      return;
    }

    const contractsMenuItem = myPlacesElement.querySelector(SELECTORS.menuItemContracts);

    if (!contractsMenuItem) {
      warn("Contracts menu item not found");
      return;
    }

    const myTransactionsMenuItem = document.createElement("a");
    myTransactionsMenuItem.className = "dropdown-item";
    myTransactionsMenuItem.href = "https://eclesiar.com/user/transactions";
    myTransactionsMenuItem.textContent = TRANSLATIONS[LANGUAGE]?.myTransactions || "My transactions";

    if (contractsMenuItem.nextSibling) {
      myPlacesElement.insertBefore(myTransactionsMenuItem, contractsMenuItem.nextSibling);
    } else {
      myPlacesElement.appendChild(myTransactionsMenuItem);
    }

    log("Main menu extended");
  }

  function updateStorageMenuLabel(retry = 0) {
    try {
      const myPlacesElement = document.querySelector(SELECTORS.menuMyPlaces);

      if (!myPlacesElement) {
        if (retry < 5) {
          setTimeout(() => {
            updateStorageMenuLabel(retry + 1);
          }, 500);
        }
        return;
      }

      const storageMenuItem = myPlacesElement.querySelector('a.dropdown-item[href="/storage"]');

      if (!storageMenuItem) {
        if (retry < 5) {
          setTimeout(() => {
            updateStorageMenuLabel(retry + 1);
          }, 500);
        }
        return;
      }

      const desiredLabel =
        TRANSLATIONS[LANGUAGE]?.storageMenu || (LANGUAGE === "pl" ? "Pawlacz" : storageMenuItem.textContent);

      if (desiredLabel && storageMenuItem.textContent.trim() !== desiredLabel) {
        storageMenuItem.textContent = desiredLabel;
      }
    } catch (error) {
      warn(`Failed to update storage menu label: ${error}`);
    }
  }

  function updateMergeButtonLabel(retry = 0) {
    try {
      // Only add the extra button for Polish and English UI
      if (LANGUAGE !== "pl" && LANGUAGE !== "en") return;

      const mergeButtons = document.querySelectorAll("button.merge-button");

      if (!mergeButtons.length) {
        if (retry < 5) {
          setTimeout(() => {
            updateMergeButtonLabel(retry + 1);
          }, 500);
        }
        return;
      }

      const line1 = TRANSLATIONS[LANGUAGE]?.mergeButton || "CEDRUJ";

      mergeButtons.forEach((origBtn) => {
        // Avoid adding duplicates
        const next = origBtn.nextElementSibling;
        if (next && next.classList && next.classList.contains("ec-cedruj-button")) return;

        const clone = document.createElement("button");
        clone.className = `${origBtn.className} ec-cedruj-button`;
        clone.type = origBtn.type || "button";
        clone.textContent = line1;
        clone.style.marginLeft = "0px";
        clone.style.minWidth = "60px";
        clone.style.whiteSpace = "normal";
        clone.style.lineHeight = "1.15";
        clone.style.padding = "1px 5px 3px 5px";
        // Move text to the bottom of the button area
        clone.style.display = "flex";
        clone.style.alignItems = "flex-end";
        clone.style.justifyContent = "center";

        // Apply custom background image if configured
        try {
          if (typeof CEDRUJ_BG_IMAGE !== "undefined" && CEDRUJ_BG_IMAGE) {
            clone.style.backgroundImage = `url('${CEDRUJ_BG_IMAGE}')`;
            clone.style.backgroundSize = "cover";
            clone.style.backgroundPosition = "center";
            clone.style.backgroundRepeat = "no-repeat";
            // Overlay for readability
            if (typeof CEDRUJ_BG_OVERLAY !== "undefined" && CEDRUJ_BG_OVERLAY) {
              clone.style.backgroundColor = CEDRUJ_BG_OVERLAY;
              clone.style.backgroundBlendMode = "multiply";
            }
            clone.style.color = "#fff";
            clone.style.textShadow = "0 1px 2px rgba(0,0,0,0.8)";
            // Slightly stronger border for contrast on various backgrounds
            clone.style.borderColor = "rgba(255,255,255,0.6)";
          }
        } catch {}

        // Make it perform the same action as the original
        clone.addEventListener("click", (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch {}
          try {
            origBtn.click();
          } catch {}
        });

        origBtn.insertAdjacentElement("afterend", clone);
      });
    } catch (error) {
      warn(`Failed to add Cedruj button: ${error}`);
    }
  }

  function localizeMergePanelAndHideOriginal(retry = 0) {
    try {
      if (LANGUAGE !== "pl" && LANGUAGE !== "en") return;

      // Set phrases based on language
      const phrases = {
        pl: {
          target: "Centrum Łączenia Ekwipunku",
          new: "Centrum Łączenia Kibli",
        },
        en: {
          target: "Merge factory",
          new: "Centrum Łączenia Kibli", //Merge kibble? xD
        },
      };

      const targetPhrase = phrases[LANGUAGE].target;
      const newPhrase = phrases[LANGUAGE].new;

      // 1) Localize heading text conditionally based on CEDRU_VERSION
      const headingSpan = document.querySelector(".training-panel h5 span");
      if (!headingSpan) {
        if (retry < 5) setTimeout(() => localizeMergePanelAndHideOriginal(retry + 1), 500);
      } else {
        if (CEDRU_VERSION) {
          // Replace to cedru phrase, preserving icon element
          let replaced = false;
          headingSpan.childNodes.forEach((n) => {
            if (n.nodeType === 3) {
              const txt = (n.nodeValue || "").trim();
              if (txt.includes(targetPhrase)) {
                n.nodeValue = n.nodeValue.replace(targetPhrase, newPhrase);
                replaced = true;
              }
            }
          });
          if (!replaced) {
            const full = headingSpan.textContent || "";
            if (full.includes(targetPhrase)) {
              Array.from(headingSpan.childNodes).forEach((n) => {
                if (n.nodeType === 3) headingSpan.removeChild(n);
              });
              headingSpan.appendChild(document.createTextNode(" " + newPhrase));
            }
          }
        } else {
          // Ensure original phrase is shown (in case it was previously replaced)
          const originalPhrase = targetPhrase;
          let changedBack = false;
          headingSpan.childNodes.forEach((n) => {
            if (n.nodeType === 3) {
              const txt = (n.nodeValue || "").trim();
              if (txt.includes(newPhrase)) {
                n.nodeValue = n.nodeValue.replace(newPhrase, originalPhrase);
                changedBack = true;
              }
            }
          });
          if (!changedBack) {
            const full = headingSpan.textContent || "";
            if (full.includes(newPhrase)) {
              Array.from(headingSpan.childNodes).forEach((n) => {
                if (n.nodeType === 3) headingSpan.removeChild(n);
              });
              headingSpan.appendChild(document.createTextNode(" " + originalPhrase));
            }
          }
        }
      }

      // 2) Show/hide original MERGE buttons based on mode
      const mergeButtons = document.querySelectorAll("button.merge-button");
      mergeButtons.forEach((btn) => {
        if (!btn.classList.contains("ec-cedruj-button")) {
          if (CEDRU_VERSION) {
            btn.style.display = "none";
            btn.setAttribute("aria-hidden", "true");
          } else {
            btn.style.display = "";
            btn.removeAttribute("aria-hidden");
          }
        }
      });
    } catch (error) {
      warn(`Failed to localize merge panel / hide MERGE: ${error}`);
    }
  }

  function displayBothRanks() {
    log("Displaying both military and builder ranks");

    const ranksSidebarElement = document.querySelector(SELECTORS.ranksSidebar);

    if (!ranksSidebarElement) {
      warn("Ranks sidebar not found");
      return;
    }

    ranksSidebarElement.style.setProperty("display", "grid", "important");
    document.querySelector(SELECTORS.ranksSwitchBtn)?.remove();

    // When Polish is active, localize the builder rank title
    try {
      if (LANGUAGE === "pl") {
        const builderTitle = ranksSidebarElement.querySelector("div.w-100:nth-of-type(2) .title");
        if (builderTitle) builderTitle.textContent = "Ranga budowniczego";
      }
    } catch {}

    log("Both military and builder ranks are displayed");
  }

  function updateSidebarElement(sidebarSelector, iconClass) {
    const sidebarElement = document.querySelector(sidebarSelector);

    if (!sidebarElement) {
      warn("Sidebar element not found");
      return;
    }

    const imgDivElement = sidebarElement.querySelector("div.col-2");
    const labelElement = sidebarElement.querySelector("div.col-10");

    if (labelElement) {
      labelElement.classList.remove("col-10");
      labelElement.classList.add("col-12");
      labelElement.style.textAlign = "center";

      if (iconClass) {
        const iconSpan = document.createElement("span");
        iconSpan.className = `glyphicon ${iconClass}`;
        iconSpan.style.width = "18px";
        labelElement.insertBefore(iconSpan, labelElement.firstChild);
      } else {
        if (imgDivElement) {
          const imgElement = imgDivElement.querySelector("img");
          if (imgElement) {
            labelElement.insertBefore(imgElement, labelElement.firstChild);
          }
        }
      }
    }

    if (imgDivElement) {
      imgDivElement.remove();
    }
  }

  // Extra styles for improved time indicators (chips)
  function addIndicatorChipStyles() {
    if (!document.querySelector("#ecplus-indicator-chips-style")) {
      const style = document.createElement("style");
      style.id = "ecplus-indicator-chips-style";
      style.textContent = `
            .ec-chips-wrapper { display:flex; flex-direction:column; align-items:stretch; gap:4px; margin: 0 0 4px 0; width:100%; }
            .ec-chip { display:inline-flex; flex-direction:column; align-items:flex-start; gap:2px; padding:2px 6px; border-radius:10px; font-size:11px; line-height:1.25; width:100%; box-sizing:border-box; }
            .ec-chip .row1 { display:flex; align-items:center; gap:6px; }
            .ec-chip .row2 { display:flex; align-items:center; gap:6px; width:100%; justify-content:flex-end; text-align:right; }
            .ec-chip .ico { font-size:13px; opacity:.95; }
            .ec-chip .lbl { font-weight:600; opacity:.95; }
            .ec-chip .dt { opacity:.95; font-weight:600; }
            .ec-chip .rel { opacity:.8; font-style:italic; }
            .ec-chip-energy {}
            .ec-chip-food {}
            .ec-chip.ok { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.35); }
            .ec-chip.warn { background: rgba(234,179,8,0.12); border: 1px solid rgba(234,179,8,0.35); }
            .ec-chip.crit { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35); }
            `;
      document.head.appendChild(style);
    }
  }

  // Extra styles for integrated full-time display in energy and food bars
  function addFullTimeStyles() {
    if (!document.querySelector("#ecplus-full-time-style")) {
      const style = document.createElement("style");
      style.id = "ecplus-full-time-style";
      style.textContent = `
            .ec-full-time {
                font-size: 12px !important;
                font-weight: 700 !important;
                opacity: 0.95 !important;
                line-height: 1.1 !important;
                text-shadow: 0 1px 3px rgba(0,0,0,0.7), 0 0 4px rgba(0,0,0,0.3) !important;
                background: rgba(0,0,0,0.15) !important;
                padding: 1px 2px !important;
                border-radius: 4px !important;
                margin-top: 1px !important;
                display: block !important;
                text-align: center !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            .ec-full-time.ok { color: #22c55e !important; }
            .ec-full-time.warn { color: #eab308 !important; }
            .ec-full-time.crit { color: #ef4444 !important; }
            .health-value, .foodlimit-value {
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 80px !important;
            }
            .health-bar, .foodlimit-bar {
                height: 44px !important;
                align-items: center !important;
            }
            .health-value .display, .foodlimit-value .display {
                margin-bottom: 1px !important;
                font-size: 14px !important;
                font-weight: bold !important;
            }
            .ec-full-time {
                font-size: 11px !important;
                padding: 1px 2px !important;
                margin-top: 1px !important;
            }
            .health-bar img, .foodlimit-bar img {
                align-self: center !important;
                margin-top: auto !important;
                margin-bottom: auto !important;
                vertical-align: middle !important;
            }
            .foodlimit-bar img {
                margin-top: 12px !important;
            }
            @media (max-width: 767px) {
                .health-value, .foodlimit-value {
                    min-width: 60px !important;
                }
                .ec-full-time {
                    font-size: 9px !important;
                    padding: 1px 2px !important;
                }
                .health-value .display, .foodlimit-value .display {
                    font-size: 11px !important;
                }
            }
            `;
      document.head.appendChild(style);
    }
  }

  // Styles for compact preset toolbar used in various panels
  function addPresetToolbarStyles() {
    if (document.getElementById("ecplus-preset-toolbar-style")) return;
    const style = document.createElement("style");
    style.id = "ecplus-preset-toolbar-style";
    style.textContent = `
      .ec-preset-toolbar { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin: 6px 0; position: relative; z-index: 9999; pointer-events: auto; }
      .ec-preset-btn { position:relative; width:28px; height:28px; border-radius:6px; border:1px solid rgba(0,0,0,0.25); display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden; background: rgba(0,0,0,0.15); pointer-events: auto; z-index: 10000; }
      .ec-preset-btn img { width:22px; height:22px; object-fit:cover; filter: drop-shadow(0 0 1px rgba(0,0,0,.35)); }
      .ec-preset-btn span { position:absolute; right:2px; bottom:1px; font-size:10px; font-weight:700; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.8); }
      .ec-preset-btn.active { outline:2px solid #22c55e; border-color:#22c55e; box-shadow:0 0 0 2px rgba(34,197,94,0.2); }
      .dark-mode .ec-preset-btn { border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); }
    `;
    document.head.appendChild(style);
  }

  // Persist desired build to apply on /training
  const PENDING_BUILD_KEY = "ecPlus.pendingBuild";
  const PREV_URL_KEY = "ecPlus.prevUrl";
  function setPendingBuild(num) {
    try {
      localStorage.setItem(PENDING_BUILD_KEY, String(num));
    } catch {}
  }
  function popPendingBuild() {
    try {
      const v = localStorage.getItem(PENDING_BUILD_KEY);
      if (v != null) localStorage.removeItem(PENDING_BUILD_KEY);
      return v;
    } catch {
      return null;
    }
  }

  function setPrevUrl(u) {
    try {
      localStorage.setItem(PREV_URL_KEY, u);
    } catch {}
  }
  function popPrevUrl() {
    try {
      const v = localStorage.getItem(PREV_URL_KEY);
      if (v != null) localStorage.removeItem(PREV_URL_KEY);
      return v;
    } catch {
      return null;
    }
  }

  // On /training: auto-click pending build if requested elsewhere, then go back
  function handlePendingBuildOnTraining(retry = 0) {
    try {
      if (!location.pathname.startsWith("/training")) return;
      const pending = popPendingBuild();
      if (!pending) return;
      const btn = document.querySelector(`.build-slot-btn[data-build="${pending}"]`);
      if (!btn) {
        if (retry < 8) setTimeout(() => handlePendingBuildOnTraining(retry + 1), 250);
        return;
      }
      try {
        btn.click();
      } catch {}
      // Return to previous page
      const prev = popPrevUrl();
      setTimeout(() => {
        try {
          if (prev) window.location.href = prev;
          else if (document.referrer && !/\/training(\b|$)/.test(document.referrer)) window.history.back();
        } catch {}
      }, 200);
    } catch {}
  }

  // Fetch presets from /training and build a toolbar
  function fetchTrainingToolbar(callback) {
    try {
      fetch("/training", { credentials: "include" })
        .then((r) => r.text())
        .then((html) => {
          const dp = new DOMParser();
          const doc = dp.parseFromString(html, "text/html");
          const buttons = Array.from(doc.querySelectorAll(".build-slot-btn"));
          if (!buttons.length) return;
          const toolbar = document.createElement("div");
          toolbar.className = "ec-preset-toolbar";
          const seen = new Set();
          // stable sort by numeric build number
          buttons.sort(
            (a, b) =>
              Number((a.getAttribute("data-build") || "0").replace(/\s+/g, "")) -
              Number((b.getAttribute("data-build") || "0").replace(/\s+/g, ""))
          );
          buttons.forEach((b) => {
            const numRaw = b.getAttribute("data-build") || "";
            const num = numRaw.replace(/\s+/g, "");
            const buildId = (b.getAttribute("data-buildid") || "").trim();
            const key = buildId ? `id:${buildId}` : `n:${num}`;
            if (!num || seen.has(key)) return;
            seen.add(key);
            const active = b.classList.contains("active");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ec-preset-btn" + (active ? " active" : "");
            btn.setAttribute("data-build", String(num));
            if (buildId) btn.setAttribute("data-buildid", buildId);
            const span = document.createElement("span");
            span.textContent = String(num);
            btn.appendChild(span);
            // inline fallback to guarantee handler execution
            try {
              btn.setAttribute(
                "onclick",
                'window.ecApplyPreset && window.ecApplyPreset(this.getAttribute("data-build"), this.getAttribute("data-buildid"))'
              );
            } catch {}
            toolbar.appendChild(btn);
            btn.addEventListener("click", (e) => {
              try {
                e.preventDefault();
                e.stopPropagation();
              } catch {}
              applyPreset(String(num), buildId);
            });
          });
          dedupeToolbar(toolbar);
          callback && callback(toolbar);
        })
        .catch(() => {});
    } catch {}
  }

  function dedupeToolbar(toolbar) {
    try {
      const seen = new Set();
      toolbar.querySelectorAll(".ec-preset-btn").forEach((btn) => {
        const num = (btn.getAttribute("data-build") || "").trim();
        const buildId = (btn.getAttribute("data-buildid") || "").trim();
        const key = buildId ? `id:${buildId}` : `n:${num}`;
        if (!num) {
          btn.remove();
          return;
        }
        if (seen.has(key)) btn.remove();
        else seen.add(key);
      });
    } catch {}
  }

  // Inject toolbar into Building donation modal (Donacje/Donations)
  function ensurePresetToolbarInBuildingModal() {
    try {
      const modal = Array.from(document.querySelectorAll(".modal-dialog, .modal-dialog.modal-lg"))
        .map((m) => ({ m, title: m.querySelector(".modal-title")?.textContent?.trim() || "" }))
        .find((x) => /(donacje|donations)/i.test(x.title))?.m;
      if (!modal) return;
      if (modal.querySelector("#ec-toolbar-building") || modal.dataset.ecToolbarBuilding === "pending") return;
      modal.dataset.ecToolbarBuilding = "pending";
      addPresetToolbarStyles();
      // Place to the right of the "Pokaż ranking budowy" button (#toggle-donor-ranking)
      const toggleBtn = modal.querySelector("#toggle-donor-ranking");
      if (!toggleBtn || !toggleBtn.parentElement) return;
      fetchTrainingToolbar((toolbar) => {
        if (!toolbar) return;
        if (modal.querySelector("#ec-toolbar-building")) return;
        toolbar.id = "ec-toolbar-building";
        toolbar.style.display = "inline-flex";
        toolbar.style.marginLeft = "12px";
        toggleBtn.insertAdjacentElement("afterend", toolbar);
        try {
          delete modal.dataset.ecToolbarBuilding;
        } catch {}
      });
    } catch (e) {
      warn("Failed to inject preset toolbar in building modal: " + e);
    }
  }

  // Inject toolbar into Mining panel paragraph under miner-info
  function ensurePresetToolbarInMining() {
    try {
      const paragraph = document.querySelector(".miner-info p.m-0");
      if (!paragraph) return;
      const parent = paragraph.parentElement;
      if (!parent) return;
      if (parent.querySelector("#ec-toolbar-mining") || parent.dataset.ecToolbarMining === "pending") return;
      parent.dataset.ecToolbarMining = "pending";
      addPresetToolbarStyles();
      fetchTrainingToolbar((toolbar) => {
        if (!toolbar) return;
        if (parent.querySelector("#ec-toolbar-mining")) return;
        toolbar.id = "ec-toolbar-mining";
        paragraph.insertAdjacentElement("afterend", toolbar);
        try {
          delete parent.dataset.ecToolbarMining;
        } catch {}
      });
    } catch (e) {
      warn("Failed to inject preset toolbar in mining: " + e);
    }
  }

  // Observe DOM for modal open or mining panel render
  function observePresetTargets() {
    try {
      const target = document.body || document.documentElement || document;
      const onMut = debounce(() => {
        ensurePresetToolbarInBuildingModal();
        ensurePresetToolbarInMining();
      }, 200);
      const obs = new MutationObserver(onMut);
      obs.observe(target, { childList: true, subtree: true });
      // initial attempt
      ensurePresetToolbarInBuildingModal();
      ensurePresetToolbarInMining();
    } catch (e) {
      warn("Failed to observe preset targets: " + e);
    }
  }

  function formatRelative(targetDate) {
    try {
      const now = new Date();
      let diff = Math.max(0, targetDate.getTime() - now.getTime());
      const sec = Math.floor(diff / 1000);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h > 0) return `${h}h ${m}m ${s}s`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    } catch {
      return "";
    }
  }

  function getLocale() {
    try {
      return LANGUAGE === "pl" ? "pl-PL" : "en-US";
    } catch {
      return "en-US";
    }
  }

  function formatCompactDate(dt) {
    try {
      const locale = getLocale();
      // Cache formatter per-locale to avoid recreating every tick
      let fmt = compactTimeFormatters[locale];
      if (!fmt) {
        fmt = new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          //second: "2-digit",
          hour12: false,
        });
        compactTimeFormatters[locale] = fmt;
      }
      return fmt.format(dt);
    } catch {
      return dt.toLocaleTimeString();
    }
  }

  function updateSidebarLayout() {
    log("Updating sidebar alignment");

    updateSidebarElement(SELECTORS.accountLevelSidebar, "glyphicon-user");
    updateSidebarElement(SELECTORS.missionsSidebar, "glyphicon-flag");
    updateSidebarElement(SELECTORS.militaryRankSidebar);
    updateSidebarElement(SELECTORS.constructionRankSidebar);

    log("Updating sidebar alignment done");
  }

  function adjustTopSideUserHeight() {
    try {
      const styleId = "ecplus-top-side-user-style";
      if (document.getElementById(styleId)) return;

      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
            div.top-side-content div.top-side-user {
                height: 150px !important;
            }
            `;

      document.head.appendChild(style);
    } catch (error) {
      warn(`Failed to adjust top-side-user height: ${error}`);
    }
  }

  function addBlinkingIndicatorStyle() {
    if (!document.querySelector("#blinking-dot-style")) {
      const style = document.createElement("style");
      style.id = "blinking-dot-style";
      style.textContent = `
            @keyframes blink {
                0% {
                    opacity: 0.3;
                    transform: scale(0.8);
                }
                100% {
                    opacity: 1;
                    transform: scale(1);
                }
            }

            .dot-base {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                display: inline-block;
            }

            .red-blinking-dot {
                background-color: #ff0000;
                box-shadow:
                    0 0 10px rgba(255, 0, 0, 0.8),
                    0 0 20px rgba(255, 0, 0, 0.6),
                    0 0 30px rgba(255, 0, 0, 0.4);
                animation: blink 1s infinite alternate;
            }

            .green-static-dot {
                background-color: green;
                box-shadow:
                    0 0 10px rgba(0, 128, 0, 0.8),
                    0 0 20px rgba(0, 128, 0, 0.6),
                    0 0 30px rgba(0, 128, 0, 0.4);
                opacity: 1;
                transform: scale(1);
            }
        `;

      document.head.appendChild(style);
    }
  }

  function addDailyTaskIndicator() {
    log("Adding daily tasks indicator");

    addBlinkingIndicatorStyle();
    const dailyTasksHeadingElement = document.querySelector("div.list-info").parentElement;

    if (!dailyTasksHeadingElement) {
      warn("Daily task heading element not found");
      return;
    }

    const arrowImg = dailyTasksHeadingElement.querySelector(":scope > img:first-of-type");

    if (arrowImg) {
      arrowImg.remove();
    }

    const dailyTasksElement = document.querySelector(SELECTORS.dailyTasksSidebar);

    const taskElements = dailyTasksElement.querySelectorAll("div.list-lin.task-container");
    const allDone = Array.from(taskElements).every((task) => task.classList.contains("task-done"));

    const indicator = document.createElement("div");

    if (allDone) {
      log("All daily tasks done");
      indicator.className = "dot-base green-static-dot";
    } else {
      log("Daily tasks in progress");
      indicator.className = "dot-base red-blinking-dot";
    }

    dailyTasksHeadingElement.appendChild(indicator);

    log("Daily tasks indicator added");
  }

  function addMissionsIndicator() {
    log("Adding mission indicator");

    addBlinkingIndicatorStyle();
    const missionsSidebarElement = document.querySelector(SELECTORS.missionsSidebar);

    if (!missionsSidebarElement) {
      warn("Missions sidebar element not found");
      return;
    }

    const missionsSpanElement = missionsSidebarElement.querySelector("span.title");

    if (!missionsSpanElement) {
      warn("Missions title span element not found");
      return;
    }

    // Funkcja aktualizująca wskaźnik
    const updateIndicator = () => {
      // Usuń poprzedni wskaźnik jeśli istnieje
      const existingIndicator = missionsSpanElement.parentElement.querySelector(".dot-base");
      if (existingIndicator) {
        existingIndicator.remove();
      }

      const missionElements = missionsSidebarElement.querySelectorAll("div.mission-container.setup");

      if (missionElements.length === 0) {
        log("No missions found yet, will retry");
        return false;
      }

      log(`Found ${missionElements.length} missions`);

      const allDone = Array.from(missionElements).every((mission) => {
        const isDone = mission.classList.contains("quest-done");
        return isDone;
      });

      log(`All missions done: ${allDone}`);

      const indicator = document.createElement("div");
      indicator.style.marginLeft = "8px";

      if (allDone) {
        log("Setting green indicator");
        indicator.className = "dot-base green-static-dot";
      } else {
        log("Setting red indicator");
        indicator.className = "dot-base red-blinking-dot";
      }

      missionsSpanElement.insertAdjacentElement("afterend", indicator);
      log("Mission indicator added");
      return true;
    };

    // Spróbuj zaktualizować od razu
    if (!updateIndicator()) {
      // Jeśli nie znaleziono misji, spróbuj ponownie po 500ms
      setTimeout(() => {
        if (!updateIndicator()) {
          // Ostatnia próba po 1500ms
          setTimeout(updateIndicator, 1000);
        }
      }, 500);
    }
  }

  function displayEnergyFullTime() {
    log("Adding energy and food time info");

    const gameStatsElement = document.querySelector(SELECTORS.energyAndFoodBars);

    const energyTimerElement = gameStatsElement.querySelector(SELECTORS.energyTimer);
    const foodTimerElement = gameStatsElement.querySelector(SELECTORS.foodTimer);

    if (!energyTimerElement || !foodTimerElement) {
      warn("Energy or food timer element not found");
      if (!energyFoodWarnedMissing) {
        energyFoodWarnedMissing = true;
        scheduleEnergyFoodRetry(2000);
      }
      return;
    }
    energyFoodWarnedMissing = false;

    energyTimerElRef = energyTimerElement;
    foodTimerElRef = foodTimerElement;

    const energyTimeLeft = parseInt(energyTimerElement.getAttribute("data-seconds")) || 0;
    const foodTimeLeft = parseInt(foodTimerElement.getAttribute("data-seconds")) || 0;
    lastEnergySeconds = energyTimeLeft;
    lastFoodSeconds = foodTimeLeft;

    let energyEndAtMs = Date.now() + energyTimeLeft * 1000;
    let foodEndAtMs = Date.now() + foodTimeLeft * 1000;
    const energyTimeFull = new Date(energyEndAtMs);
    const foodTimeFull = new Date(foodEndAtMs);

    // Styles for integrated display
    addFullTimeStyles();

    // Read current fill percent for threshold colors
    function parseDisplayFraction(selector) {
      try {
        const el = gameStatsElement.querySelector(selector);
        if (!el) return null;
        const txt = (el.textContent || "").trim(); // e.g. "505/600"
        const m = txt.match(/(\d+[\.,]?\d*)\s*\/\s*(\d+[\.,]?\d*)/);
        if (!m) return null;
        const cur = parseFloat(m[1].replace(",", "."));
        const max = parseFloat(m[2].replace(",", "."));
        if (!max) return null;
        return Math.max(0, Math.min(100, Math.round((cur / max) * 100)));
      } catch {
        return null;
      }
    }
    const energyPct = parseDisplayFraction(".health-value .display");
    const foodPct = parseDisplayFraction(".foodlimit-value .display");
    function classForPct(p) {
      if (p == null) return "";
      if (p >= 75) return "ok";
      if (p >= 40) return "warn";
      return "crit";
    }

    // Function to update existing full-time displays
    function updateFullTimeDisplays() {
      try {
        const energySpan = gameStatsElement.querySelector(".health-value .ec-full-time");
        const foodSpan = gameStatsElement.querySelector(".foodlimit-value .ec-full-time");
        const nowMs = Date.now();
        if (energySpan) {
          const newEnergyTimeFull = new Date(energyEndAtMs);
          const nextText = `${TRANSLATIONS[LANGUAGE]?.energyShort || ""} ${formatCompactDate(
            newEnergyTimeFull
          )} (${formatRelative(newEnergyTimeFull)})`;
          if (energySpan.textContent !== nextText) energySpan.textContent = nextText;
        }
        if (foodSpan) {
          const newFoodTimeFull = new Date(foodEndAtMs);
          const nextText = `${TRANSLATIONS[LANGUAGE]?.foodShort || ""} ${formatCompactDate(
            newFoodTimeFull
          )} (${formatRelative(newFoodTimeFull)})`;
          if (foodSpan.textContent !== nextText) foodSpan.textContent = nextText;
        }
      } catch {}
    }

    // Integrate into energy bar
    const energyBar = gameStatsElement.querySelector(".health-bar");
    if (energyBar) {
      const energyValue = energyBar.querySelector(".health-value");
      if (energyValue) {
        // Remove existing full-time display if present
        const existingFull = energyValue.querySelector(".ec-full-time");
        if (existingFull) existingFull.remove();

        const fullTimeSpan = document.createElement("span");
        fullTimeSpan.className = `ec-full-time ${classForPct(energyPct)}`;
        fullTimeSpan.textContent = `${TRANSLATIONS[LANGUAGE]?.energyShort || ""} ${formatCompactDate(
          energyTimeFull
        )} (${formatRelative(energyTimeFull)})`;

        energyValue.appendChild(fullTimeSpan);
      }
    }

    // Integrate into food bar
    const foodBar = gameStatsElement.querySelector(".foodlimit-bar");
    if (foodBar) {
      const foodValue = foodBar.querySelector(".foodlimit-value");
      if (foodValue) {
        // Remove existing full-time display if present
        const existingFull = foodValue.querySelector(".ec-full-time");
        if (existingFull) existingFull.remove();

        const fullTimeSpan = document.createElement("span");
        fullTimeSpan.className = `ec-full-time ${classForPct(foodPct)}`;
        fullTimeSpan.textContent = `${TRANSLATIONS[LANGUAGE]?.foodShort || ""} ${formatCompactDate(
          foodTimeFull
        )} (${formatRelative(foodTimeFull)})`;

        foodValue.appendChild(fullTimeSpan);
      }
    }

    // Start live updates
    const updateEnergyFoodTimes = () => {
      const nowMs = Date.now();
      const currEnergy = parseInt(energyTimerElement.getAttribute("data-seconds")) || 0;
      const currFood = parseInt(foodTimerElement.getAttribute("data-seconds")) || 0;
      // Recompute end only when counters increased (reset after game tick/interaction)
      if (lastEnergySeconds == null || currEnergy > lastEnergySeconds) {
        energyEndAtMs = nowMs + currEnergy * 1000;
        lastEnergySeconds = currEnergy;
      }
      if (lastFoodSeconds == null || currFood > lastFoodSeconds) {
        foodEndAtMs = nowMs + currFood * 1000;
        lastFoodSeconds = currFood;
      }
    };
    const updateFullTimeDisplaysFromTimes = () => {
      try {
        const energySpan = gameStatsElement.querySelector(".health-value .ec-full-time");
        const foodSpan = gameStatsElement.querySelector(".foodlimit-value .ec-full-time");
        const fmtFixedTime = (ms) => formatCompactDate(new Date(ms));
        const fmtRelFromSec = (sec) => {
          const s = Math.max(0, Math.floor(sec));
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const ss = s % 60;
          if (h > 0) return `${h}h ${m}m ${ss}s`;
          if (m > 0) return `${m}m ${ss}s`;
          return `${ss}s`;
        };
        const nowMs = Date.now();
        let energyLeftSec = Math.max(0, Math.floor((energyEndAtMs - nowMs) / 1000));
        let foodLeftSec = Math.max(0, Math.floor((foodEndAtMs - nowMs) / 1000));
        if (lastEnergyShownSec != null && energyLeftSec > lastEnergyShownSec) energyLeftSec = lastEnergyShownSec;
        if (lastFoodShownSec != null && foodLeftSec > lastFoodShownSec) foodLeftSec = lastFoodShownSec;
        lastEnergyShownSec = energyLeftSec;
        lastFoodShownSec = foodLeftSec;

        if (energySpan) {
          const nextText = `${TRANSLATIONS[LANGUAGE]?.energyShort || ""} ${fmtFixedTime(
            energyEndAtMs
          )} (${fmtRelFromSec(energyLeftSec)})`;
          if (energySpan.textContent !== nextText) energySpan.textContent = nextText;
        }
        if (foodSpan) {
          const nextText = `${TRANSLATIONS[LANGUAGE]?.foodShort || ""} ${fmtFixedTime(foodEndAtMs)} (${fmtRelFromSec(
            foodLeftSec
          )})`;
          if (foodSpan.textContent !== nextText) foodSpan.textContent = nextText;
        }
      } catch {}
    };
    scheduleEnergyFoodTicker(() => {
      updateFullTimeDisplaysFromTimes();
    });
    ensureEnergyFoodObserver(() => {
      updateEnergyFoodTimes();
      updateFullTimeDisplaysFromTimes();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      // Auto-detect language on first run and observe SPA changes
      detectLanguageFromDocument();
      observeLanguageChanges();
      installAuthSniffer();
      installWebSocketSniffer();
      exposeGlobalApply();
      installPresetClickDelegation();
      handlePendingBuildOnTraining();
      extendMainMenu();
      updateStorageMenuLabel();
      updateMergeButtonLabel();
      localizeMergePanelAndHideOriginal();
      observePresetTargets();
      observePartyTargets();

      if (DISPLAY_BOTH_RANKS) {
        displayBothRanks();
      }

      if (CENTER_HEADLINES_IN_SIDEBAR) {
        updateSidebarLayout();
      }

      if (DISPLAY_DAILY_TASKS_INDICATOR) {
        addDailyTaskIndicator();
      }

      if (DISPLAY_MISSIONS_INDICATOR) {
        addMissionsIndicator();
      }

      if (DISPLAY_ENERGY_FULL_TIME) {
        displayEnergyFullTime();
      }

      adjustTopSideUserHeight();
    });
  } else {
    // Auto-detect language on first run and observe SPA changes
    detectLanguageFromDocument();
    observeLanguageChanges();
    installAuthSniffer();
    installWebSocketSniffer();
    exposeGlobalApply();
    installPresetClickDelegation();
    handlePendingBuildOnTraining();
    extendMainMenu();
    updateStorageMenuLabel();
    updateMergeButtonLabel();
    localizeMergePanelAndHideOriginal();
    observePresetTargets();
    observePartyTargets();

    if (DISPLAY_BOTH_RANKS) {
      displayBothRanks();
    }

    if (CENTER_HEADLINES_IN_SIDEBAR) {
      updateSidebarLayout();
    }

    if (DISPLAY_DAILY_TASKS_INDICATOR) {
      addDailyTaskIndicator();
    }

    if (DISPLAY_MISSIONS_INDICATOR) {
      addMissionsIndicator();
    }

    if (DISPLAY_ENERGY_FULL_TIME) {
      displayEnergyFullTime();
    }

    adjustTopSideUserHeight();
  }
})();
