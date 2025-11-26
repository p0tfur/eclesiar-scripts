// ==UserScript==
// @name         Eclesiar Builders Exporter by p0tfur
// @namespace    https://eclesiar.com/
// @version      1.1.0
// @description  Export donor ranking and available items from the building modal to a CSV file
// @author       p0tfur
// @match        https://eclesiar.com/*
// @match        https://www.eclesiar.com/*
// @match        https://*.eclesiar.com/*
// @grant        GM_download
// @run-at       document-idle
// @updateURL    https://24na7.info/eclesiar-scripts/Eclesiar_Builders_by_p0tfur.user.js
// @downloadURL  https://24na7.info/eclesiar-scripts/Eclesiar_Builders_by_p0tfur.user.js
// ==/UserScript==

(function () {
  "use strict";

  // API key
  const VER_API_KEY = "jakis-w-ch0l3r3-m0cny-kluczzzz";

  // Inject export buttons when the ranking toggle is present.
  // The buttons will export the donor ranking table (rank, player, points)
  // with support for lazy-loaded rows (auto-scroll until complete).

  const EXPORT_CSV_BTN_ID = "ec-export-ranking-csv-btn";
  const SEND_VER_BTN_ID = "ec-send-ranking-ver-btn";
  const IS_VIVALDI = /Vivaldi/i.test(navigator.userAgent || "");
  const IS_FIREFOX = /Firefox/i.test(navigator.userAgent || "");

  // Endpoint VER API (Verified Erection Report)
  const VER_SNAPSHOT_ENDPOINT = "https://ver.rpaby.pw/api/rankings/snapshots";

  const safeText = (el) => (el ? (el.textContent || "").trim() : "");

  // Extract basic context (region, building type, target level) from the page
  // before the modal is opened. We read visible elements near the building card.
  function getPreModalBuildingDetails(doc) {
    const root = doc || document;
    try {
      // Region name
      const regionSpan = root.querySelector(".building-item__region .building-item__region--name span");
      const region = safeText(regionSpan);

      // Building type name
      const typeSpan = root.querySelector(".building-item__type .building-item__type--name span");
      const buildingType = safeText(typeSpan);

      // Target level (e.g., text like "LVL 2")
      const levelSpan = root.querySelector(".target-level-area span");
      const levelRaw = safeText(levelSpan);
      const levelMatch = /(?:lvl\s*)?(\d+)/i.exec(levelRaw);
      const level = levelMatch ? levelMatch[1] : "";

      return { region, buildingType, level };
    } catch (_) {
      return { region: "", buildingType: "", level: "" };
    }
  }

  // Read current/required progress numbers from the building card and return null when unavailable.
  function getBuildingProgressStatus(doc) {
    const root = doc || document;
    const progressSpan = root.querySelector(".building-item__progression-bar .progress-text");
    if (!progressSpan) return null;
    const text = safeText(progressSpan);
    if (!text || !text.includes("/")) return null;

    const [currentRaw, totalRaw] = text.split("/").map((part) => part.replace(/[^0-9]/g, ""));
    const current = parseInt(currentRaw, 10);
    const total = parseInt(totalRaw, 10);

    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
      return null;
    }

    return { current, total };
  }

  // Ensure the build is finished before allowing VER submission.
  function assertBuildCompleted(doc) {
    const progress = getBuildingProgressStatus(doc);
    if (!progress || progress.current < progress.total) {
      alert("Budowa niezakończona, darmozjady weźcie się do pracy!");
      return false;
    }
    return true;
  }

  function parsePointsValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return 0;

    const sanitized = raw
      .replace(/\u00a0/g, "")
      .replace(/,/g, "")
      .replace(/[^0-9.\-]/g, "");
    const parsed = Number.parseFloat(sanitized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sumDonorPoints(donors) {
    if (!Array.isArray(donors) || !donors.length) return 0;
    return donors.reduce((sum, donor) => sum + parsePointsValue(donor && donor.points), 0);
  }

  function assertRankingCoverage(donors, doc) {
    const progress = getBuildingProgressStatus(doc);
    if (!progress) {
      console.warn("[Eclesiar Export] Progress status missing, skipping coverage check");
      return true;
    }

    const totalPoints = sumDonorPoints(donors);
    const tolerance = Math.max(Math.round(progress.current * 0.01), 200);
    const diff = Math.abs(progress.current - totalPoints);

    if (diff > tolerance) {
      alert(
        `Ranking wygląda na niekompletny.\n\nSuma punktów z tabeli: ${totalPoints.toLocaleString()}\nProgress na karcie: ${progress.current.toLocaleString()}\n\nPrzewiń ranking do końca i spróbuj ponownie.`
      );
      return false;
    }

    return true;
  }

  // Make a filesystem-friendly slug
  function slugify(v) {
    try {
      return String(v || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove diacritics
        .replace(/[^\w\s-]/g, "") // drop non-word
        .trim()
        .replace(/[\s]+/g, "_")
        .toLowerCase();
    } catch (_) {
      return String(v || "");
    }
  }

  async function ensureRankingVisible(scope) {
    const root = scope || document;
    const btn = root.getElementById("toggle-donor-ranking") || root.querySelector("#toggle-donor-ranking");
    if (!btn) return;
    const label = safeText(btn);
    const needsShow = /show|pokaż/i.test(label);
    if (needsShow) {
      try {
        btn.click();
      } catch (_) {}
      // wait briefly for rows to render
      await waitForRows(root, 1500);
    }
  }

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

    if (!document.getElementById(EXPORT_CSV_BTN_ID)) {
      const csvBtn = document.createElement("button");
      csvBtn.id = EXPORT_CSV_BTN_ID;
      csvBtn.type = "button";
      csvBtn.textContent = "Export CSV";
      csvBtn.className = "btn btn-outline-success mb-3";
      csvBtn.style.marginLeft = "8px";
      console.log("[Eclesiar Export] Creating CSV button next to #toggle-donor-ranking");
      csvBtn.addEventListener("click", async () => {
        try {
          console.log("[Eclesiar Export] CSV button clicked");
          await ensureRankingVisible(document);
          const donors = await collectAllDonors(document);
          if (!assertRankingCoverage(donors, document)) {
            return;
          }
          const csv = buildCsv(donors);
          const fileName = buildFileName("csv");
          console.log("[Eclesiar Export] CSV rows:", donors.length);
          await downloadCsv(csv, fileName);
        } catch (err) {
          console.error("[Eclesiar Export] CSV export failed:", err);
          alert("Eksport CSV nie powiódł się: " + (err && err.message ? err.message : err));
        }
      });
      rankingToggle.parentElement.insertBefore(csvBtn, rankingToggle.nextSibling);
    }

    if (!document.getElementById(SEND_VER_BTN_ID)) {
      const verBtn = document.createElement("button");
      verBtn.id = SEND_VER_BTN_ID;
      verBtn.type = "button";
      verBtn.textContent = "Send to VER";
      verBtn.className = "btn btn-outline-primary mb-3";
      verBtn.style.marginLeft = "8px";
      console.log("[Eclesiar Export] Creating VER button next to #toggle-donor-ranking");
      verBtn.addEventListener("click", async () => {
        try {
          console.log("[Eclesiar Export] VER button clicked");
          if (!assertBuildCompleted(document)) {
            return;
          }
          await ensureRankingVisible(document);
          const donors = await collectAllDonors(document);
          if (!assertRankingCoverage(donors, document)) {
            return;
          }
          console.log("[Eclesiar Export] VER donors rows:", donors.length);
          const result = await sendRankingToVer(donors);
          console.log("[Eclesiar Export] VER API response:", result);
          if (confirm("Ranking wysłany do VER.\n\nOtworzyć panel VER teraz?")) {
            window.open("https://ver.rpaby.pw/", "_blank");
          }
        } catch (err) {
          console.error("[Eclesiar Export] VER send failed:", err);
          alert("Wysyłka do VER nie powiodła się: " + (err && err.message ? err.message : err));
        }
      });

      rankingToggle.parentElement.insertBefore(verBtn, rankingToggle.nextSibling);
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

    // Try to read visible building details from the page before modal
    const { region, buildingType, level } = getPreModalBuildingDetails(document);
    const parts = [];
    if (region) parts.push(slugify(region));
    if (buildingType) parts.push(slugify(buildingType));
    if (level) parts.push(`lvl_${slugify(level)}`);

    const prefix = parts.length > 0 ? parts.join("_") + "_" : "";
    return `${prefix}${yyyy}-${MM}-${dd}_${hh}-${mm}-${ss}.${e}`;
  }

  function buildSnapshotPayload(donors) {
    const { region, buildingType, level } = getPreModalBuildingDetails(document);

    const capturedAt = new Date().toISOString();
    const pageUrl = window.location.href || "";
    const clientUserAgent = navigator.userAgent || "";

    const safeLevel = level ? parseInt(String(level), 10) || 0 : 0;

    const donorsPayload = (donors || []).map((d, idx) => ({
      rank: d.rank || idx + 1,
      player: d.player,
      points: d.points,
    }));

    return {
      source: "eclesiar-userscript",
      capturedAt,
      pageUrl,
      clientUserAgent,
      building: {
        region: region || "",
        type: buildingType || "",
        level: safeLevel,
      },
      donors: donorsPayload,
    };
  }

  async function sendRankingToVer(donors) {
    const payload = buildSnapshotPayload(donors || []);
    const headers = {
      "Content-Type": "application/json",
    };

    if (VER_API_KEY) {
      // Prosty mechanizm autoryzacji po stronie VER.
      headers["X-VER-API-KEY"] = VER_API_KEY;
    }

    const response = await fetch(VER_SNAPSHOT_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`VER API returned HTTP ${response.status}`);
    }

    return response.json().catch(() => null);
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
        const points = parsePointsValue(pointsRaw);

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
      const scrollable = scrollContainer.scrollHeight - scrollContainer.clientHeight > 5;
      if (!scrollable) {
        scrollContainer = null;
      }
    }

    const initialCount = getDonorRows(modalRoot).length;
    if (scrollContainer) {
      await autoScrollToEnd(scrollContainer, () => getDonorRows(modalRoot).length);
    }

    let count = getDonorRows(modalRoot).length;
    if (!scrollContainer || count === initialCount) {
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
        const points = parsePointsValue(pointsRaw);
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
    const maxAttempts = 80;
    const step = Math.max(120, Math.floor(container.clientHeight * 0.6));

    while (attempts < maxAttempts && stableSteps < 3) {
      attempts++;
      const prevTop = container.scrollTop;
      container.scrollTop = Math.min(container.scrollTop + step, container.scrollHeight);
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      if (container.scrollTop === prevTop) {
        container.scrollTop = container.scrollHeight;
        container.dispatchEvent(new Event("scroll", { bubbles: true }));
      }

      await sleep(250);
      const count = getCount();
      if (count === lastCount) {
        stableSteps++;
      } else {
        stableSteps = 0;
        lastCount = count;
      }

      const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      if (nearBottom) {
        stableSteps++;
      }
    }
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

  async function downloadCsv(csv, fileName) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const tryRevoke = () => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    };
    const useAnchor = () => {
      console.log("[Eclesiar Export] Using anchor fallback for download");
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
        } catch (_) {}
        tryRevoke();
      }, 0);
    };

    try {
      if (IS_FIREFOX && typeof GM_download === "function") {
        console.log("[Eclesiar Export] Detected Firefox, using GM_download");
        GM_download({
          url,
          name: fileName,
          saveAs: true,
          onload: function () {
            setTimeout(tryRevoke, 2000);
          },
          onerror: function () {
            console.warn("[Eclesiar Export] GM_download failed, falling back to anchor method.");
            useAnchor();
          },
          ontimeout: function () {
            console.warn("[Eclesiar Export] GM_download timed out, falling back to anchor method.");
            useAnchor();
          },
        });
      } else {
        console.log("[Eclesiar Export] Using anchor method (Chromium/Vivaldi/other)");
        useAnchor();
      }
    } catch (e) {
      console.error("[Eclesiar Export] GM_download threw, falling back to anchor method.", e);
      useAnchor();
    }
  }

  function tryInject() {
    const modalRoot = findModalRoot();
    ensureExportButtons(modalRoot);
  }

  // Initial attempt after idle.
  tryInject();

  // Observe DOM changes to catch when the modal appears.
  const observer = new MutationObserver(() => {
    try {
      tryInject();
    } catch (e) {
      console.error("[Eclesiar Export] tryInject in MutationObserver threw:", e);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
