// ==UserScript==
// @name         Eclesiar Builders Exporter by p0tfur
// @namespace    https://eclesiar.com/
// @version      1.0.0
// @description  Export donor ranking and available items from the building modal to a TXT file
// @author       p0tfur
// @match        https://eclesiar.com/*
// @match        https://www.eclesiar.com/*
// @match        https://*.eclesiar.com/*
// @updateURL    https://24na7.info/eclesiar-scripts/Eclesiar Builders by p0tfur.js
// @downloadURL  https://24na7.info/eclesiar-scripts/Eclesiar Builders by p0tfur.js
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // Inject export buttons when the ranking toggle is present.
  // The buttons will export the donor ranking table (rank, player, points)
  // with support for lazy-loaded rows (auto-scroll until complete).

  const EXPORT_TXT_BTN_ID = "ec-export-ranking-txt-btn";
  const EXPORT_CSV_BTN_ID = "ec-export-ranking-csv-btn";

  const safeText = (el) => (el ? (el.textContent || "").trim() : "");

  function findModalRoot() {
    // Locate the modal, but we will place buttons near the global toggle by ID.
    const modal = document.querySelector(".modal-dialog .modal-content");
    return modal || document;
  }

  async function waitForRows(scope, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < (timeoutMs || 1000)) {
      const n = getDonorRows(scope).length;
      if (n > 0) return n;
      await sleep(100);
    }
    return 0;
  }
  async function autoScrollWindowTowards(targetEl, getCount) {
    if (!targetEl) return;
    let lastCount = -1;
    let stableSteps = 0;
    let attempts = 0;
    const maxAttempts = 40;
    const rect = () => targetEl.getBoundingClientRect();

    while (attempts < maxAttempts && stableSteps < 2) {
      attempts++;
      window.scrollBy({ top: 400, left: 0, behavior: "auto" });
      // if element below, scroll to it
      const r = rect();
      if (r.bottom > window.innerHeight) {
        targetEl.scrollIntoView({ block: "end" });
      }
      await sleep(300);
      const count = getCount();
      if (count === lastCount) {
        stableSteps++;
      } else {
        stableSteps = 0;
        lastCount = count;
      }
    }
  }

  function ensureExportButtons(modalRoot) {
    if (!modalRoot) return;

    const rankingToggle =
      document.getElementById("toggle-donor-ranking") || modalRoot.querySelector("#toggle-donor-ranking");
    if (!rankingToggle || !rankingToggle.parentElement) return;

    if (!document.getElementById(EXPORT_TXT_BTN_ID)) {
      const txtBtn = document.createElement("button");
      txtBtn.id = EXPORT_TXT_BTN_ID;
      txtBtn.type = "button";
      txtBtn.textContent = "Export TXT";
      txtBtn.className = "btn btn-outline-info mb-3";
      txtBtn.style.marginLeft = "8px";
      txtBtn.addEventListener("click", async () => {
        try {
          const donors = await collectAllDonors(document);
          const txt = buildTxt(donors);
          const fileName = buildFileName("txt");
          console.debug("[Eclesiar Export] TXT rows:", donors.length);
          GM_download({
            url: "data:text/plain;charset=utf-8," + encodeURIComponent(txt),
            name: fileName,
            saveAs: false,
          });
        } catch (err) {
          console.error("[Eclesiar Export] TXT export failed:", err);
          alert("Export TXT failed: " + (err && err.message ? err.message : err));
        }
      });
      rankingToggle.parentElement.insertBefore(txtBtn, rankingToggle.nextSibling);
    }

    if (!document.getElementById(EXPORT_CSV_BTN_ID)) {
      const csvBtn = document.createElement("button");
      csvBtn.id = EXPORT_CSV_BTN_ID;
      csvBtn.type = "button";
      csvBtn.textContent = "Export CSV";
      csvBtn.className = "btn btn-outline-success mb-3";
      csvBtn.style.marginLeft = "8px";
      csvBtn.addEventListener("click", async () => {
        try {
          const donors = await collectAllDonors(document);
          const csv = buildCsv(donors);
          const fileName = buildFileName("csv");
          console.debug("[Eclesiar Export] CSV rows:", donors.length);
          GM_download({
            url: "data:text/csv;charset=utf-8," + encodeURIComponent(csv),
            name: fileName,
            saveAs: false,
          });
        } catch (err) {
          console.error("[Eclesiar Export] CSV export failed:", err);
          alert("Export CSV failed: " + (err && err.message ? err.message : err));
        }
      });
      rankingToggle.parentElement.insertBefore(csvBtn, rankingToggle.nextSibling);
    }
  }

  function buildFileName(ext) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = now.getFullYear();
    const MM = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    const e = ext || "txt";
    return `eclesiar_building_ranking_${yyyy}-${MM}-${dd}_${hh}-${mm}-${ss}.${e}`;
  }

  function getDonorRows(scope) {
    const root = scope || document;
    // Try specific then generic selectors
    const rows = root.querySelectorAll("#donor-ranking-list .donor-table tbody tr, .donor-table tbody tr");
    return rows;
  }

  function parseDonorRanking(modalRoot) {
    const rows = getDonorRows(modalRoot);
    const donors = [];
    rows.forEach((tr) => {
      try {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 3) return;

        const rank = safeText(tds[0]);
        const playerAnchor = tds[1].querySelector("a");
        const player = safeText(playerAnchor || tds[1]);
        const pointsRaw = safeText(tds[2]);
        const points = pointsRaw.replace(/[^0-9.,]/g, "");

        donors.push({ rank, player, points });
      } catch (e) {
        // skip faulty row
      }
    });
    return donors;
  }

  async function collectAllDonors(modalRoot) {
    const donorTable = (modalRoot || document).querySelector(".donor-table");
    if (!donorTable) return [];

    // First, wait briefly for initial rows to render
    await waitForRows(modalRoot, 1500);

    // Try to find a scrollable container around the table
    let scrollContainer = donorTable.closest(".donor-ranking");
    if (!scrollContainer) {
      // fallback to the first scrollable ancestor
      let p = donorTable.parentElement;
      while (p && p !== document.body) {
        const style = getComputedStyle(p);
        const overflowY = style.overflowY;
        if (overflowY === "auto" || overflowY === "scroll" || p.scrollHeight > p.clientHeight) {
          scrollContainer = p;
          break;
        }
        p = p.parentElement;
      }
    }

    if (scrollContainer) {
      await autoScrollToEnd(scrollContainer, () => getDonorRows(modalRoot).length);
    }

    // Fallback: if still no rows, try scroll whole window
    let count = getDonorRows(modalRoot).length;
    if (count === 0) {
      const box = scrollContainer || donorTable;
      await autoScrollWindowTowards(box, () => getDonorRows(modalRoot).length);
      count = getDonorRows(modalRoot).length;
    }

    if (count === 0) {
      console.warn("[Eclesiar Export] No donor rows found after scrolling. Check selectors or loading behavior.");
    } else {
      console.debug("[Eclesiar Export] Donor rows collected:", count);
    }

    let donors = parseDonorRanking(modalRoot);
    if (donors.length === 0) {
      // Ultra-fallback: parse by td triplets inside the table body
      const tds = donorTable.querySelectorAll("tbody td");
      const tmp = [];
      for (let i = 0; i + 2 < tds.length; i += 3) {
        const rank = safeText(tds[i]);
        const player = safeText(tds[i + 1]);
        const pointsRaw = safeText(tds[i + 2]);
        const points = pointsRaw.replace(/[^0-9.,]/g, "");
        if (rank || player || points) tmp.push({ rank, player, points });
      }
      if (tmp.length > 0) {
        console.debug("[Eclesiar Export] Fallback td-triplet parse used:", tmp.length);
        donors = tmp;
      }
    }

    return donors;
  }

  function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async function autoScrollToEnd(container, getCount) {
    let lastCount = -1;
    let stableSteps = 0;
    let attempts = 0;
    const maxAttempts = 40; // ~12s at 300ms

    while (attempts < maxAttempts && stableSteps < 2) {
      attempts++;
      container.scrollTop = container.scrollHeight;
      await sleep(300);
      const count = getCount();
      if (count === lastCount) {
        stableSteps++;
      } else {
        stableSteps = 0;
        lastCount = count;
      }
    }
  }

  function buildTxt(donors) {
    const lines = [];
    lines.push("[Eclesiar Building Ranking]");
    lines.push(`Page: ${location.href}`);
    lines.push(`Timestamp: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("Rank\tPlayer\tPoints");
    donors.forEach((d) => {
      lines.push(`${d.rank}\t${d.player}\t${d.points}`);
    });
    return lines.join("\n");
  }

  function csvEscape(val) {
    const s = String(val ?? "");
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv(donors) {
    const rows = [];
    rows.push("Rank,Player,Points");
    donors.forEach((d) => {
      rows.push([csvEscape(d.rank), csvEscape(d.player), csvEscape(d.points)].join(","));
    });
    return rows.join("\n");
  }

  function tryInject() {
    const modalRoot = findModalRoot();
    ensureExportButtons(modalRoot);
  }

  // Initial attempt after idle.
  tryInject();

  // Observe DOM changes to catch when the modal appears.
  const observer = new MutationObserver(() => {
    tryInject();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
