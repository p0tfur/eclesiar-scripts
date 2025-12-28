// ==UserScript==
// @name         Eclesiar - Export Player Companies to CSV
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Pobiera wszystkich graczy z rankingu ekonomicznego i ich firmy, eksportuje do CSV
// @author       You
// @match        https://eclesiar.com/statistics/*
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
    BASE_URL: "https://eclesiar.com",
    // Maksymalna liczba stron do pobrania (0 = wszystkie)
    MAX_PAGES: 0,
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
   * Pobiera maksymalną liczbę stron z paginacji
   * @param {Document} doc - dokument DOM
   * @returns {number}
   */
  function getMaxPages(doc) {
    const paginationLinks = doc.querySelectorAll(".pagination .pagination_item");
    let maxPage = 1;

    paginationLinks.forEach((link) => {
      // Wyciągnij numer strony z href (np. /statistics/citizen/18/economicskill/12)
      const href = link.getAttribute("href");
      if (href) {
        const match = href.match(/\/(\d+)$/);
        if (match) {
          const pageNum = parseInt(match[1]);
          if (!isNaN(pageNum) && pageNum > maxPage) {
            maxPage = pageNum;
          }
        }
      }
    });

    console.log(`[Export] Wykryto maksymalną stronę: ${maxPage}`);
    return maxPage;
  }

  /**
   * Pobiera listę graczy ze strony rankingu
   * @param {Document} doc - dokument DOM
   * @returns {Array<{id: string, name: string, country: string, productivity: string}>}
   */
  function getPlayersFromPage(doc) {
    const players = [];

    // Tabela desktop z graczami - próbujemy różne selektory
    let rows = doc.querySelectorAll("table.table.table-striped.desktop-only tbody tr.data-row");

    // Fallback - może klasy są inaczej
    if (rows.length === 0) {
      rows = doc.querySelectorAll("table.desktop-only tbody tr.data-row");
    }
    if (rows.length === 0) {
      rows = doc.querySelectorAll("table tbody tr.data-row");
    }

    console.log(`[Export] Znaleziono ${rows.length} wierszy w tabeli`);

    rows.forEach((row) => {
      try {
        // Link do gracza (kolumna 2 - avatar lub kolumna 3 - nazwa)
        const playerLink = row.querySelector('td.column-2 a[href^="/user/"]');
        if (!playerLink) return;

        const href = playerLink.getAttribute("href");
        const playerId = href.replace("/user/", "");
        const playerName = playerLink.textContent.trim();

        // Kraj (kolumna 3)
        const countryCell = row.querySelector("td.column-3 a p");
        const country = countryCell ? countryCell.textContent.trim() : "";

        // Produktywność (kolumna 4)
        const productivityCell = row.querySelector("td.column-4 div");
        const productivity = productivityCell ? productivityCell.textContent.trim() : "";

        players.push({
          id: playerId,
          name: playerName,
          country: country,
          productivity: productivity,
        });
      } catch (error) {
        console.error("Błąd parsowania gracza:", error);
      }
    });

    return players;
  }

  /**
   * Pobiera firmy gracza z jego strony profilu
   * @param {Document} doc - dokument DOM strony gracza
   * @returns {Array<{name: string, type: string, level: string, region: string}>}
   */
  function getCompaniesFromPlayerPage(doc) {
    const companies = [];

    // Szukamy tabeli z firmami w sekcji companies-list
    const companiesTable = doc.querySelector(".companies-list table.table tbody");
    if (!companiesTable) {
      return companies;
    }

    const rows = companiesTable.querySelectorAll("tr");

    rows.forEach((row) => {
      try {
        // Kolumna z danymi firmy (column-1)
        const dataCell = row.querySelector("td.column-1");
        if (!dataCell) return;

        // Nazwa firmy
        const nameElement = dataCell.querySelector("p.company-name-h5");
        const name = nameElement ? nameElement.textContent.trim() : "";

        // Div z typem, poziomem i regionem
        const infoDiv = dataCell.querySelector('div[style*="gap: 5px"]');
        if (!infoDiv) return;

        const infoParagraphs = infoDiv.querySelectorAll("p");

        // Typ firmy (pierwszy p)
        const type = infoParagraphs[0] ? infoParagraphs[0].textContent.trim() : "";

        // Poziom (drugi p)
        const level = infoParagraphs[1] ? infoParagraphs[1].textContent.trim() : "";

        // Region (trzeci p) - usuwa " - " z początku
        let region = infoParagraphs[2] ? infoParagraphs[2].textContent.trim() : "";
        region = region.replace(/^\s*-\s*/, "");

        if (name) {
          companies.push({
            name: name,
            type: type,
            level: level,
            region: region,
          });
        }
      } catch (error) {
        console.error("Błąd parsowania firmy:", error);
      }
    });

    return companies;
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
      "Player ID",
      "Player Name",
      "Player Country",
      "Player Productivity",
      "Company Name",
      "Company Type",
      "Company Level",
      "Company Region",
    ];

    // Wiersze
    const rows = data.map((item) => {
      return [
        item.playerId,
        `"${item.playerName.replace(/"/g, '""')}"`,
        `"${item.playerCountry.replace(/"/g, '""')}"`,
        item.playerProductivity,
        `"${item.companyName.replace(/"/g, '""')}"`,
        `"${item.companyType.replace(/"/g, '""')}"`,
        item.companyLevel,
        `"${item.companyRegion.replace(/"/g, '""')}"`,
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
   * Aktualizuje status w UI
   * @param {string} message - wiadomość
   */
  function updateStatus(message) {
    const statusEl = document.getElementById("export-status");
    if (statusEl) {
      statusEl.textContent = message;
    }
    console.log(`[Export] ${message}`);
  }

  /**
   * Główna funkcja eksportu
   */
  async function exportCompanies() {
    const allData = [];
    let currentPage = 1;
    const processedPages = new Set(); // Zabezpieczenie przed nieskończoną pętlą

    try {
      // Pobierz pierwszą stronę żeby określić liczbę stron
      updateStatus("Pobieranie pierwszej strony...");
      const firstPageHtml = await fetchPage(`${CONFIG.BASE_URL}/statistics/citizen/18/economicskill/1`);

      if (!firstPageHtml) {
        updateStatus("Błąd: Nie można pobrać pierwszej strony");
        return;
      }

      const firstPageDoc = parseHTML(firstPageHtml);
      let maxPages = getMaxPages(firstPageDoc);

      if (CONFIG.MAX_PAGES > 0 && CONFIG.MAX_PAGES < maxPages) {
        maxPages = CONFIG.MAX_PAGES;
      }

      updateStatus(`Znaleziono ${maxPages} stron z graczami`);

      // Iteruj przez wszystkie strony
      while (currentPage <= maxPages) {
        // Zabezpieczenie przed nieskończoną pętlą
        if (processedPages.has(currentPage)) {
          console.error(`[Export] Strona ${currentPage} już była przetworzona! Przerywam.`);
          break;
        }
        processedPages.add(currentPage);

        updateStatus(`Przetwarzanie strony ${currentPage}/${maxPages}...`);

        let pageDoc;
        if (currentPage === 1) {
          pageDoc = firstPageDoc;
        } else {
          await delay(CONFIG.REQUEST_DELAY);
          const pageHtml = await fetchPage(`${CONFIG.BASE_URL}/statistics/citizen/18/economicskill/${currentPage}`);
          if (!pageHtml) {
            console.error(`Nie można pobrać strony ${currentPage}`);
            currentPage++;
            continue;
          }
          pageDoc = parseHTML(pageHtml);
        }

        // Pobierz graczy z tej strony
        const players = getPlayersFromPage(pageDoc);
        console.log(`[Export] Strona ${currentPage}: graczy = ${players.length}`);
        updateStatus(`Strona ${currentPage}: Znaleziono ${players.length} graczy`);

        // Jeśli nie ma graczy, coś jest nie tak - przerwij
        if (players.length === 0) {
          console.error(`[Export] Brak graczy na stronie ${currentPage}! Sprawdź selektory.`);
        }

        // Dla każdego gracza pobierz jego firmy
        for (let i = 0; i < players.length; i++) {
          const player = players[i];
          updateStatus(`Strona ${currentPage}/${maxPages} - Gracz ${i + 1}/${players.length}: ${player.name}`);

          await delay(CONFIG.REQUEST_DELAY);

          const playerPageHtml = await fetchPage(`${CONFIG.BASE_URL}/user/${player.id}`);
          if (!playerPageHtml) {
            console.error(`Nie można pobrać profilu gracza ${player.name}`);
            continue;
          }

          const playerPageDoc = parseHTML(playerPageHtml);
          const companies = getCompaniesFromPlayerPage(playerPageDoc);

          if (companies.length === 0) {
            // Gracz bez firm - dodaj wpis z pustymi danymi firmy
            allData.push({
              playerId: player.id,
              playerName: player.name,
              playerCountry: player.country,
              playerProductivity: player.productivity,
              companyName: "",
              companyType: "",
              companyLevel: "",
              companyRegion: "",
            });
          } else {
            // Dodaj wpis dla każdej firmy gracza
            companies.forEach((company) => {
              allData.push({
                playerId: player.id,
                playerName: player.name,
                playerCountry: player.country,
                playerProductivity: player.productivity,
                companyName: company.name,
                companyType: company.type,
                companyLevel: company.level,
                companyRegion: company.region,
              });
            });
          }
        }

        currentPage++;
        console.log(`[Export] Przechodzę do strony ${currentPage}, maxPages=${maxPages}`);
      }

      console.log(`[Export] Pętla zakończona. currentPage=${currentPage}, maxPages=${maxPages}`);
      console.log(`[Export] Zebrano ${allData.length} wpisów`);

      // Generuj i pobierz CSV
      updateStatus(`Generowanie CSV z ${allData.length} wpisami...`);
      const csv = convertToCSV(allData);
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `eclesiar_companies_${timestamp}.csv`);

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
            min-width: 250px;
        `;

    // Tytuł
    const title = document.createElement("h4");
    title.textContent = "📊 Export Companies";
    title.style.cssText = "margin: 0 0 10px 0; font-size: 14px;";
    container.appendChild(title);

    // Status
    const status = document.createElement("div");
    status.id = "export-status";
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
      exportCompanies().finally(() => {
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
                Strony: ${CONFIG.MAX_PAGES === 0 ? "wszystkie" : CONFIG.MAX_PAGES}
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
