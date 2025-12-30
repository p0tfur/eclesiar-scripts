// ==UserScript==
// @name         Eclesiar - Export Holdings to CSV
// @namespace    http://tampermonkey.net/
// @version      1.2.2
// @description  Pobiera dane holdingów (1-769) i ich firmy, zapisuje do CSV
// @author       p0tfur
// @match        https://eclesiar.com/holding/*
// @updateURL    https://24na7.info/eclesiar-scripts/holdings.user.js
// @downloadURL  https://24na7.info/eclesiar-scripts/holdings.user.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    BASE_URL: "https://eclesiar.com/holding",
    START_ID: 1,
    END_ID: 769,
    REQUEST_DELAY: 1000,
  };
  const BASE_SITE = CONFIG.BASE_URL.replace(/\/holding.*$/, "");

  const TEXT_NODES_SELECTOR = "div,span,p,li,td,th,strong,b";

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchPage(url) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      console.error("[HoldingExport] fetch error", url, error);
      return null;
    }
  }

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function sanitizeField(value, max = 180) {
    const cleaned = normalizeText(value || "").slice(0, max);
    if (!cleaned) return "";
    if (/[{}<>]/.test(cleaned)) return ""; // odetnij potencjalne CSS/HTML/JS
    return cleaned;
  }

  function csvEscape(value) {
    return (value || "").replace(/"/g, '""');
  }

  async function fetchPageDoc(url) {
    const html = await fetchPage(url);
    return html ? parseHTML(html) : null;
  }

  function parseHoldingMeta(doc) {
    const infoRoot =
      doc.querySelector(".holding, .holding-container, .holding__summary, .holding__details, .holding__info") ||
      doc.querySelector(".page-content") ||
      doc.body ||
      doc;
    const clone = infoRoot.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,template").forEach((n) => n.remove());

    const labelNodes = clone.querySelectorAll("small,strong,span,label");

    const pickByLabel = (labels, extractor) => {
      const normalized = labels.map((l) => l.toLowerCase());
      for (const node of labelNodes) {
        const labelText = normalizeText(node.textContent || "").toLowerCase();
        if (!normalized.includes(labelText)) continue;
        const val = extractor(node);
        if (val) return sanitizeField(val, 80);
      }
      return "";
    };

    const createdAt = pickByLabel(["created at", "created"], (node) => {
      const p = node.parentElement?.querySelector("p");
      if (p) return p.textContent;
      const sib = node.nextElementSibling;
      if (sib) return sib.textContent;
      return "";
    });

    const decisionOfficer = pickByLabel(["oficer decyzyjny", "decision officer"], (node) => {
      const link = node.parentElement?.querySelector("a.ceo-link");
      if (link) return link.textContent;
      const p = node.parentElement?.querySelector("p");
      if (p) return p.textContent;
      const sib = node.nextElementSibling;
      if (sib) return sib.textContent;
      return "";
    });

    const originCountry = pickByLabel(["od", "from", "country", "kraj"], (node) => {
      const link = node.parentElement?.querySelector("a[href^='/country']");
      if (link) return link.textContent;
      const flag = node.parentElement?.querySelector("img[alt]");
      if (flag && flag.getAttribute("alt")) return flag.getAttribute("alt");
      const span = node.parentElement?.querySelector("span, p");
      if (span) return span.textContent;
      const sib = node.nextElementSibling;
      if (sib) return sib.textContent;
      return "";
    });

    return {
      createdAt,
      decisionOfficer,
      originCountry,
    };
  }

  function extractCompanies(doc) {
    const companies = [];
    const tableRows = doc.querySelectorAll(".companies-list .hasBorder, .companies-list tbody tr, .companies-list tr");
    const seen = new Set();

    const processRow = (row) => {
      const link = row.querySelector('a[href^="/business/"], a[href^="/company/"]');
      if (!link) return;
      const name = sanitizeField(link.textContent, 100);
      if (!name) return;
      const id = link.getAttribute("href") || "";
      const key = `${id}-${name}`;
      if (seen.has(key)) return;
      seen.add(key);

      const rowText = sanitizeField(row.textContent || "", 240);
      let level = "";
      const levelMatch = rowText.match(/Q[1-5]/i);
      if (levelMatch) {
        level = levelMatch[0].toUpperCase();
      } else {
        const stars = row.querySelectorAll(".company-level img[alt='star'], .company-level img[src*='star']");
        if (stars.length >= 1 && stars.length <= 5) {
          level = `Q${stars.length}`;
        }
      }

      let location = "";
      const builtMatch = rowText.match(/Wybudowano w:\)?\s*([^\)]+)\)/i);
      if (builtMatch && builtMatch[1]) {
        location = sanitizeField(builtMatch[1], 80);
      }
      if (!location) {
        const flag = row.querySelector("img[alt]");
        if (flag && flag.getAttribute("alt") && flag.getAttribute("alt").toLowerCase() !== "star") {
          location = sanitizeField(flag.getAttribute("alt"), 60);
        }
      }
      if (!location) {
        const locCell = row.querySelector(
          '[class*="region"], [class*="country"], td:nth-child(3), td:last-child, span, small, p'
        );
        if (locCell) {
          const txt = sanitizeField(locCell.textContent, 80);
          if (txt && !txt.toLowerCase().includes(name.toLowerCase())) location = txt;
        }
      }

      companies.push({ name, level, location });
    };

    if (tableRows.length) {
      tableRows.forEach(processRow);
    } else {
      const scopedLinks = Array.from(doc.querySelectorAll('.companies-list a[href^="/company/"]'));
      const companyLinks = scopedLinks.length ? scopedLinks : Array.from(doc.querySelectorAll('a[href^="/company/"]'));
      companyLinks.forEach((link) => processRow(link.closest("tr") || link.parentElement || link));
    }

    return companies;
  }

  function getCeoLinkInfo(doc) {
    const ceoLink = doc.querySelector(".ceo-link");
    if (!ceoLink) {
      return { href: "", name: "" };
    }
    return { href: ceoLink.getAttribute("href") || "", name: sanitizeField(ceoLink.textContent, 120) };
  }

  const nationalityCache = new Map();

  async function resolveCeoNationality(ceoHref, fallbackFlagAlt, originCountry) {
    if (!ceoHref) return sanitizeField(fallbackFlagAlt || originCountry, 80);
    if (nationalityCache.has(ceoHref)) return nationalityCache.get(ceoHref);

    if (ceoHref.startsWith("/user/")) {
      const doc = await fetchPageDoc(`${BASE_SITE}${ceoHref}`);
      if (!doc) return sanitizeField(fallbackFlagAlt || originCountry, 80);
      const nat =
        doc.querySelector(".link-nationality img[alt]")?.getAttribute("alt") ||
        doc.querySelector(".link-nationality span")?.textContent ||
        doc.querySelector(".link-nationality")?.textContent;
      let cleaned = sanitizeField(nat || "", 80);
      if (!cleaned) {
        const txt = doc.body?.textContent || "";
        const match = txt.match(/Narodowość:\s*([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż\s-]{2,50})/i);
        if (match && match[1]) cleaned = sanitizeField(match[1], 80);
      }
      if (!cleaned) cleaned = sanitizeField(fallbackFlagAlt || originCountry, 80);
      nationalityCache.set(ceoHref, cleaned);
      return cleaned;
    }
    if (ceoHref.startsWith("/militaryunit/")) {
      const doc = await fetchPageDoc(`${BASE_SITE}${ceoHref}`);
      if (!doc) return sanitizeField(fallbackFlagAlt || originCountry, 80);
      const nat =
        doc.querySelector(".mu-country img[alt]")?.getAttribute("alt") ||
        doc.querySelector(".mu-country h5 small")?.textContent ||
        doc.querySelector(".mu-country h5")?.textContent;
      let cleaned = sanitizeField(nat || "", 80);
      if (!cleaned && fallbackFlagAlt) cleaned = sanitizeField(fallbackFlagAlt, 80);
      if (!cleaned && originCountry) cleaned = sanitizeField(originCountry, 80);
      nationalityCache.set(ceoHref, cleaned);
      return cleaned;
    }
    if (ceoHref.startsWith("/country/")) {
      const cleaned = sanitizeField(originCountry || fallbackFlagAlt, 80);
      nationalityCache.set(ceoHref, cleaned);
      return cleaned;
    }
    const cleaned = sanitizeField(fallbackFlagAlt || originCountry, 80);
    nationalityCache.set(ceoHref, cleaned);
    return cleaned;
  }

  async function extractHoldingData(doc, holdingId) {
    const name =
      sanitizeField(doc.querySelector(".holding-name-input")?.textContent) ||
      sanitizeField(doc.querySelector(".holding-name-input-modal")?.value) ||
      sanitizeField(doc.querySelector("h1.holding-name")?.textContent) ||
      sanitizeField(doc.querySelector(".page-title h1")?.textContent) ||
      sanitizeField(doc.querySelector("h1")?.textContent) ||
      "";

    const meta = parseHoldingMeta(doc);
    const { createdAt, decisionOfficer, originCountry } = meta;
    const ceoLink = getCeoLinkInfo(doc);
    const ceoFlagAlt =
      doc.querySelector(".ceo-link")?.closest(".d-flex")?.querySelector("img[alt]")?.getAttribute("alt") || "";
    const decisionOfficerNationality = await resolveCeoNationality(ceoLink.href, ceoFlagAlt, originCountry);

    const companies = extractCompanies(doc);

    return {
      holdingId,
      name,
      createdAt,
      decisionOfficer: ceoLink.name || decisionOfficer,
      originCountry,
      decisionOfficerNationality,
      companies,
    };
  }

  function toCSV(data) {
    if (!data.length) return "";
    const headers = [
      "Holding ID",
      "Holding Name",
      "Created At",
      "Decision Officer",
      "Decision Officer Nationality",
      "Origin Country",
      "Company Name",
      "Company Level",
      "Company Location",
    ];
    const rows = data.map((row) =>
      [
        row.holdingId,
        `"${csvEscape(sanitizeField(row.name))}"`,
        `"${csvEscape(sanitizeField(row.createdAt))}"`,
        `"${csvEscape(sanitizeField(row.decisionOfficer))}"`,
        `"${csvEscape(sanitizeField(row.decisionOfficerNationality))}"`,
        `"${csvEscape(sanitizeField(row.originCountry))}"`,
        `"${csvEscape(sanitizeField(row.companyName))}"`,
        sanitizeField(row.companyLevel, 12),
        `"${csvEscape(sanitizeField(row.companyLocation))}"`,
      ].join(",")
    );
    return [headers.join(","), ...rows].join("\n");
  }

  function downloadCSV(csv, filename) {
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function updateStatus(msg) {
    const el = document.getElementById("holding-export-status");
    if (el) el.textContent = msg;
    console.log("[HoldingExport]", msg);
  }

  async function exportHoldings() {
    const rows = [];
    for (let id = CONFIG.START_ID; id <= CONFIG.END_ID; id++) {
      updateStatus(`Pobieranie holding ${id}/${CONFIG.END_ID}...`);
      await delay(CONFIG.REQUEST_DELAY);
      const html = await fetchPage(`${CONFIG.BASE_URL}/${id}`);
      if (!html) {
        console.warn(`[HoldingExport] pomijam ${id} (brak strony)`);
        continue;
      }
      const doc = parseHTML(html);
      const holding = await extractHoldingData(doc, id);

      if (!holding.name) {
        console.warn(`[HoldingExport] brak nazwy dla ${id}, pomijam`);
        continue;
      }

      if (!holding.companies.length) {
        rows.push({
          holdingId: holding.holdingId,
          name: holding.name,
          createdAt: holding.createdAt,
          decisionOfficer: holding.decisionOfficer,
          decisionOfficerNationality: holding.decisionOfficerNationality,
          originCountry: holding.originCountry,
          companyName: "",
          companyLevel: "",
          companyLocation: "",
        });
      } else {
        holding.companies.forEach((c) => {
          rows.push({
            holdingId: holding.holdingId,
            name: holding.name,
            createdAt: holding.createdAt,
            decisionOfficer: holding.decisionOfficer,
            decisionOfficerNationality: holding.decisionOfficerNationality,
            originCountry: holding.originCountry,
            companyName: c.name,
            companyLevel: c.level,
            companyLocation: c.location || "",
          });
        });
      }
    }

    updateStatus(`Generowanie CSV (${rows.length} wierszy)...`);
    const csv = toCSV(rows);
    const ts = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `eclesiar_holdings_${ts}.csv`);
    updateStatus("Zakończono eksport.");
  }

  function createUI() {
    const box = document.createElement("div");
    box.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 9999;
      background: #1d242b;
      color: #fff;
      padding: 14px;
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      font-family: Arial, sans-serif;
      min-width: 240px;
    `;

    const title = document.createElement("div");
    title.textContent = "📦 Export Holdings";
    title.style.cssText = "font-weight: bold; margin-bottom: 8px;";
    box.appendChild(title);

    const status = document.createElement("div");
    status.id = "holding-export-status";
    status.textContent = "Gotowy";
    status.style.cssText =
      "font-size: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.1); padding: 6px; border-radius: 4px;";
    box.appendChild(status);

    const btn = document.createElement("button");
    btn.textContent = "🚀 Start";
    btn.style.cssText =
      "width: 100%; padding: 10px; background: #4CAF50; color: #fff; border: none; border-radius: 4px; cursor: pointer;";
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "⏳...";
      btn.style.background = "#666";
      try {
        await exportHoldings();
      } finally {
        btn.disabled = false;
        btn.textContent = "🚀 Start";
        btn.style.background = "#4CAF50";
      }
    };
    box.appendChild(btn);

    const meta = document.createElement("div");
    meta.innerHTML = `<small style="color:#aaa;">Zakres ID: ${CONFIG.START_ID}-${CONFIG.END_ID}<br>Delay: ${CONFIG.REQUEST_DELAY}ms</small>`;
    box.appendChild(meta);

    document.body.appendChild(box);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createUI);
  } else {
    createUI();
  }
})();
