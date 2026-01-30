// ==UserScript==
// @name         Eclesiar - Export NPC Workers to CSV
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Eksportuje NPC zatrudnionych w firmach z kraju (region, pracownicy, pensje, lokacje)
// @author       p0tfur
// @match        https://eclesiar.com/country/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ============================================
  // KONFIGURACJA
  // ============================================
  const CONFIG = {
    // Opóźnienie między requestami (ms) - żeby nie przeciążyć serwera
    REQUEST_DELAY: 1000,
    // Bazowy URL
    BASE_URL: location.origin,
  };

  // ============================================
  // GŁÓWNE FUNKCJE
  // ============================================

  /**
   * Funkcja pomocnicza do opóźnienia
   * @param {number} ms - milisekundy
   * @returns {Promise}
   */
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Pobiera HTML strony
   * @param {string} url - URL do pobrania
   * @returns {Promise<string>} - HTML strony
   */
  async function fetchPage(url) {
    try {
      const response = await fetch(url, {
        credentials: "include", // Ważne dla zalogowanych sesji
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      console.error(`Błąd pobierania strony ${url}:`, error);
      return null;
    }
  }

  /**
   * Parsuje HTML i zwraca DOM
   * @param {string} html - HTML do sparsowania
   * @returns {Document}
   */
  function parseHTML(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, "text/html");
  }

  /**
   * Aktualizuje status w UI
   * @param {string} message - wiadomość
   */
  function updateStatus(message) {
    const statusEl = document.getElementById("npc-export-status");
    if (statusEl) {
      statusEl.textContent = message;
    }
    console.log(`[Export] ${message}`);
  }

  /**
   * Konwertuje dane do formatu CSV
   * @param {Array} data - dane do konwersji
   * @returns {string} - CSV string
   */
  function convertToCSV(data) {
    if (data.length === 0) return "";

    // Nagłówki
    const headers = [
      "Company ID",
      "Company Name",
      "Company URL",
      "Region",
      "NPC ID",
      "NPC Name",
      "NPC URL",
      "Salary",
      "Current Location",
    ];

    // Wiersze
    const rows = data.map((item) => {
      return [
        item.companyId,
        `"${item.companyName.replace(/"/g, '""')}"`,
        item.companyUrl,
        `"${item.region.replace(/"/g, '""')}"`,
        item.npcId,
        `"${item.npcName.replace(/"/g, '""')}"`,
        item.npcUrl,
        `"${item.salary.replace(/"/g, '""')}"`,
        `"${item.currentLocation.replace(/"/g, '""')}"`,
      ].join(",");
    });

    return [headers.join(","), ...rows].join("\n");
  }

  /**
   * Pobiera plik CSV
   * @param {string} csv - zawartość CSV
   * @param {string} filename - nazwa pliku
   */
  function downloadCSV(csv, filename) {
    // Dodaj BOM dla poprawnego kodowania UTF-8 w Excelu
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");

    if (navigator.msSaveBlob) {
      // IE 10+
      navigator.msSaveBlob(blob, filename);
    } else {
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  /**
   * Bezpiecznie pobiera tekst z elementu
   * @param {Element|null} element - element DOM
   * @returns {string}
   */
  function getText(element) {
    return element ? element.textContent.trim() : "";
  }

  /**
   * Pobiera wartość z bloku "fake-input" na podstawie etykiety <small>
   * @param {Document} doc - dokument DOM
   * @param {string} label - tekst etykiety
   * @returns {string}
   */
  function getFakeInputValueByLabel(doc, label) {
    const blocks = Array.from(doc.querySelectorAll(".fake-input"));
    for (const block of blocks) {
      const small = block.querySelector("small");
      if (small && small.textContent.trim() === label) {
        const span = block.querySelector("span");
        return getText(span);
      }
    }
    return "";
  }

  /**
   * Pobiera listę firm z aktualnej strony kraju
   * @returns {Array<{id: string, name: string, url: string}>}
   */
  function getCompaniesFromCountryPage() {
    const companies = [];
    const companyImages = document.querySelectorAll("img.company_avatar_img[data-companyid]");

    companyImages.forEach((img) => {
      try {
        const companyId = img.getAttribute("data-companyid");
        if (!companyId) return;

        const nameElement = document.querySelector(`.company-name-h5-${companyId} span`);
        const companyName = getText(nameElement);
        const companyUrl = `${CONFIG.BASE_URL}/business/${companyId}`;

        companies.push({
          id: companyId,
          name: companyName,
          url: companyUrl,
        });
      } catch (error) {
        console.error("Błąd parsowania firmy:", error);
      }
    });

    return companies;
  }

  /**
   * Pobiera dane regionu z strony firmy
   * @param {Document} doc - dokument DOM
   * @returns {string}
   */
  function getRegionFromCompanyPage(doc) {
    const regionValue = getFakeInputValueByLabel(doc, "Region");
    return regionValue;
  }

  /**
   * Pobiera NPC z tabeli "Aktualni pracownicy" na stronie firmy
   * @param {Document} doc - dokument DOM
   * @returns {Array<{id: string, name: string, url: string}>}
   */
  function getWorkersFromCompanyPage(doc) {
    const npcLinks = Array.from(doc.querySelectorAll('a[href^="/npc/"]'));
    const workers = [];
    const seen = new Set();

    npcLinks.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("/npc/")) return;

      const npcId = href.replace("/npc/", "");
      if (!npcId || seen.has(npcId)) return;
      seen.add(npcId);

      const npcName = getText(link);
      const npcUrl = `${CONFIG.BASE_URL}${href}`;

      workers.push({
        id: npcId,
        name: npcName,
        url: npcUrl,
      });
    });

    return workers;
  }

  /**
   * Pobiera szczegóły NPC (pensja, lokacja)
   * @param {Document} doc - dokument DOM
   * @returns {{salary: string, currentLocation: string}}
   */
  function getNpcDetails(doc) {
    const currentLocation = getFakeInputValueByLabel(doc, "Aktualna lokacja");
    const salary = getFakeInputValueByLabel(doc, "Aktualna wypłata");

    return {
      salary: salary,
      currentLocation: currentLocation,
    };
  }

  /**
   * Główna funkcja eksportu
   */
  async function exportNpcWorkers() {
    const allData = [];

    try {
      updateStatus("Szukanie firm na stronie kraju...");
      const companies = getCompaniesFromCountryPage();
      updateStatus(`Znaleziono firm: ${companies.length}`);

      if (companies.length === 0) {
        updateStatus("Brak firm do eksportu. Sprawdź selektory.");
        return;
      }

      for (let i = 0; i < companies.length; i++) {
        const company = companies[i];
        updateStatus(`Firma ${i + 1}/${companies.length}: ${company.name || company.id}`);

        await delay(CONFIG.REQUEST_DELAY);
        const companyHtml = await fetchPage(company.url);
        if (!companyHtml) {
          console.error(`Nie można pobrać firmy ${company.id}`);
          continue;
        }

        const companyDoc = parseHTML(companyHtml);
        const region = getRegionFromCompanyPage(companyDoc);
        const workers = getWorkersFromCompanyPage(companyDoc);

        if (workers.length === 0) {
          allData.push({
            companyId: company.id,
            companyName: company.name,
            companyUrl: company.url,
            region: region,
            npcId: "",
            npcName: "",
            npcUrl: "",
            salary: "",
            currentLocation: "",
          });
          continue;
        }

        for (let j = 0; j < workers.length; j++) {
          const worker = workers[j];
          updateStatus(`Firma ${i + 1}/${companies.length} - NPC ${j + 1}/${workers.length}: ${worker.name}`);

          await delay(CONFIG.REQUEST_DELAY);
          const npcHtml = await fetchPage(worker.url);
          if (!npcHtml) {
            console.error(`Nie można pobrać NPC ${worker.id}`);
            continue;
          }

          const npcDoc = parseHTML(npcHtml);
          const npcDetails = getNpcDetails(npcDoc);

          allData.push({
            companyId: company.id,
            companyName: company.name,
            companyUrl: company.url,
            region: region,
            npcId: worker.id,
            npcName: worker.name,
            npcUrl: worker.url,
            salary: npcDetails.salary,
            currentLocation: npcDetails.currentLocation,
          });
        }
      }

      updateStatus(`Generowanie CSV z ${allData.length} wpisami...`);
      const csv = convertToCSV(allData);
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `eclesiar_npc_workers_${timestamp}.csv`);

      updateStatus(`Zakończono! Wyeksportowano ${allData.length} wpisów.`);
    } catch (error) {
      console.error("Błąd podczas eksportu:", error);
      updateStatus(`Błąd: ${error.message}`);
    }
  }

  // ============================================
  // UI - PRZYCISK EKSPORTU
  // ============================================

  function createExportButton() {
    // Kontener
    const container = document.createElement("div");
    container.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 9999;
            background: #1d242b;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif;
            color: #fff;
            min-width: 260px;
        `;

    // Tytuł
    const title = document.createElement("h4");
    title.textContent = "📊 Export NPC Workers";
    title.style.cssText = "margin: 0 0 10px 0; font-size: 14px;";
    container.appendChild(title);

    // Status
    const status = document.createElement("div");
    status.id = "npc-export-status";
    status.textContent = "Gotowy do eksportu";
    status.style.cssText = `
            font-size: 12px;
            margin-bottom: 10px;
            padding: 8px;
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
            word-wrap: break-word;
        `;
    container.appendChild(status);

    // Przycisk
    const button = document.createElement("button");
    button.textContent = "🚀 Rozpocznij eksport";
    button.style.cssText = `
            width: 100%;
            padding: 10px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
        `;
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "⏳ Eksportowanie...";
      button.style.background = "#666";
      exportNpcWorkers().finally(() => {
        button.disabled = false;
        button.textContent = "🚀 Rozpocznij eksport";
        button.style.background = "#4CAF50";
      });
    });
    container.appendChild(button);

    // Info
    const info = document.createElement("div");
    info.innerHTML = `
            <small style="color: #888; display: block; margin-top: 10px;">
                Opóźnienie: ${CONFIG.REQUEST_DELAY}ms<br>
                Strona: tylko aktualny kraj
            </small>
        `;
    container.appendChild(info);

    document.body.appendChild(container);
  }

  // ============================================
  // INICJALIZACJA
  // ============================================

  // Poczekaj na załadowanie strony
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createExportButton);
  } else {
    createExportButton();
  }
})();
