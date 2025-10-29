// ==UserScript==
// @name         Eclesiar Market - Show Seller/holding Country Flag
// @namespace    https://eclesiar.com/
// @version      1.2.0
// @description  Show nationality flag next to seller name on /market (users and holdings via CEO), for auctions added indicators for average prices
// @author       p0tfur
// @match        https://eclesiar.com/market*
// @updateURL    https://24na7.info/eclesiar-scripts/Eclesiar Market & Auctions.user.js
// @downloadURL  https://24na7.info/eclesiar-scripts/Eclesiar Market & Auctions.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

/* Auctions indicators explanation:
Display depending on the situation:
1. Red arrow pointing up if the price is more than 10% higher than the 7-day average.
2. Green arrow pointing down if the price is more than 10% lower.
3. Horizontal yellow line if the price falls within +- 10% of the market price.
 */

;(function () {
  'use strict'

  const CACHE_KEY = 'ec_market_flags_cache_v1'
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
  const MAX_CONCURRENCY = 4

  const cache = loadCache()

  // Detect auction pages to disable certain UI injections (like [G]/[H] badges)
  const IS_AUCTION_PAGE =
    location.pathname.startsWith('/market/auction') ||
    (() => {
      const h1 = document.querySelector('h1[style*="line-height"]')
      if (!h1) return false
      const txt = (h1.textContent || '').trim().toLowerCase()
      return txt === 'dom aukcyjny' || txt === 'auction house'
    })()

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      const now = Date.now()
      for (const k of Object.keys(parsed)) {
        if (!parsed[k] || !parsed[k].ts || now - parsed[k].ts > CACHE_TTL_MS) {
          delete parsed[k]
        }
      }
      return parsed
    } catch {
      return {}
    }
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {}
  }

  function makeAbsoluteUrl(url) {
    try {
      return new URL(url, location.origin).href
    } catch {
      return url
    }
  }

  function findSellerAnchors(root = document) {
    // Desktop + Mobile: td.column-1 > a[href^="/user/"] lub /holding/
    return Array.from(
      root.querySelectorAll('td.column-1 a[href^="/user/"], td.column-1 a[href^="/holding/"]')
    )
  }

  // Insert motivational banner above the quality selection row
  function insertMotivationBanner(root = document) {
    if (root.querySelector('.ec-pl-banner')) return

    // Prefer placing at the very top of the main market list container when present
    const marketContainer = root.querySelector('.market_item_list_interface')

    // Fallback: locate the row that contains the "Select quality" label
    const qualityRow = root.querySelector('.row.mt-4 .font-15.capitalize')
      ? root.querySelector('.row.mt-4').closest('.row.mt-4')
      : root.querySelector('.row.mt-4')

    const container = marketContainer || qualityRow || root.querySelector('.row.mt-4') || root.body
    if (!container) return

    const banner = document.createElement('div')
    banner.className = 'ec-pl-banner'
    banner.textContent = ''
    banner.style.padding = '10px 14px'
    banner.style.margin = '10px 0 6px 0'
    banner.style.border = '1px solid #b91c1c'
    banner.style.borderRadius = '8px'
    // Polish flag style: white (top) and red (bottom)
    banner.style.background =
      'linear-gradient(to bottom, #ffffff 0%, #ffffff 50%, #DC143C 50%, #DC143C 100%)'
    banner.style.color = '#111'
    banner.style.fontWeight = '700'
    banner.style.fontSize = '16px'
    banner.style.display = 'flex'
    banner.style.alignItems = 'center'
    banner.style.justifyContent = 'center'
    banner.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)'

    // Add a pill with border for better text readability
    const bannerText = document.createElement('span')
    bannerText.textContent = 'Kupuj polskie, wspieraj lokalnych przedsiębiorców 🇵🇱'
    bannerText.style.padding = '4px 10px'
    bannerText.style.border = '2px solid rgba(0,0,0,0.35)'
    bannerText.style.borderRadius = '999px'
    bannerText.style.background = 'rgba(255,255,255,0.75)'
    bannerText.style.color = '#111'
    bannerText.style.backdropFilter = 'blur(2px)'
    bannerText.style.textShadow =
      '0 1px 1px rgba(255,255,255,0.6), 0 -1px 1px rgba(255,255,255,0.3)'
    banner.appendChild(bannerText)

    // If we found the market container, put the banner as its first child; else use qualityRow placement
    if (marketContainer) {
      marketContainer.prepend(banner)
    } else if (qualityRow && qualityRow.parentElement) {
      qualityRow.parentElement.insertBefore(banner, qualityRow)
    } else {
      container.prepend(banner)
    }
  }

  function alreadyInjected(anchor) {
    return anchor.querySelector('.ec-flag')
  }

  function insertFlag(anchor, flagSrc, altText) {
    // Prefer placing after the seller name span if present, else at the end of anchor
    const nameSpan = anchor.querySelector('span.bold.font-11')
    const img = document.createElement('img')
    img.className = 'ec-flag'
    img.src = flagSrc
    img.alt = altText || 'Country'
    img.width = 25
    img.height = 20
    // Enforce exact rendered size against site-wide CSS
    img.style.setProperty('width', '25px', 'important')
    img.style.setProperty('height', '20px', 'important')
    img.style.marginLeft = '6px'
    img.style.verticalAlign = 'middle'
    img.style.border = '1px solid #333'
    img.style.borderRadius = '2px'
    img.title = altText || ''

    // Insert type badge [G]/[H] (Gracz/Holding) once, between name and flag — but not on auction pages
    if (!IS_AUCTION_PAGE) {
      let badge = anchor.querySelector('.ec-type-badge')
      const hrefVal = anchor.getAttribute('href') || ''
      const isHoldingLink = hrefVal.startsWith('/holding/')
      const isUserLink = hrefVal.startsWith('/user/')
      if (!badge && (isHoldingLink || isUserLink)) {
        badge = document.createElement('span')
        badge.className = 'ec-type-badge'
        badge.textContent = isHoldingLink ? '🏙️' : '🧍'
        badge.title = isHoldingLink ? 'Holding' : 'Gracz'
        badge.style.marginLeft = '3px'
        badge.style.fontSize = '12px'
        badge.style.fontWeight = '700'
        badge.style.lineHeight = '1'
        badge.style.verticalAlign = 'middle'
        badge.style.display = 'inline-block'
        badge.style.padding = '0 3px'
        badge.style.border = '1px solid #222'
        badge.style.borderRadius = '3px'
        badge.style.background = 'transparent'
        badge.style.color = '#111'
        if (nameSpan) {
          nameSpan.after(badge)
        } else {
          anchor.appendChild(badge)
        }
      }
    }

    // Insert flag after the badge if present, else after the name, else at the end
    const insertAfterEl = anchor.querySelector('.ec-type-badge') || nameSpan
    if (insertAfterEl) {
      insertAfterEl.after(img)
    } else {
      anchor.appendChild(img)
    }

    // If not Poland, add a small poop indicator
    const isPolish = (altText || '').toLowerCase() === 'poland'
    if (!isPolish) {
      /* add indicator once
      if (!anchor.querySelector('.ec-non-pl-indicator')) {
        const mark = document.createElement('span')
        mark.className = 'ec-non-pl-indicator'
        mark.textContent = '💩'
        mark.title = altText ? `Kraj: ${altText}` : 'Inny kraj'
        mark.style.marginLeft = '4px'
        mark.style.fontSize = '26px'
        mark.style.lineHeight = '1'
        mark.style.verticalAlign = 'middle'
        img.after(mark)
      }
      */

      // color seller/holding name red once
      if (!anchor.classList.contains('ec-non-pl-colored')) {
        anchor.classList.add('ec-non-pl-colored')
        if (nameSpan) {
          nameSpan.style.setProperty('color', '#ef4444', 'important') // red-500
        } else {
          anchor.style.setProperty('color', '#ef4444', 'important')
        }
      }
    }

    // Decorate Buy/Bid buttons in the same listing (desktop row or mobile card)
    decorateOfferButtons(anchor, isPolish)
  }

  // Add a small indicator to Buy/Bid buttons within the same listing/table
  function decorateOfferButtons(anchor, isPolish) {
    // Desktop: limit to the same <tr>. Mobile: limit to the same .card (single offer)
    const row = anchor.closest('tr')
    const card = anchor.closest('.card')
    // For mobile, each offer is its own table inside a card; for desktop, many rows share one table
    const scope =
      row || card || anchor.closest('table.table-striped.mb-0') || anchor.closest('table')
    if (!scope) return
    if (IS_AUCTION_PAGE) {
      decorateAuctionBidButtons(scope)
      return
    }
    const buttons = scope.querySelectorAll('a.accept-offer')
    buttons.forEach(btn => {
      if (btn.querySelector('.ec-offer-ind')) return
      const badge = document.createElement('span')
      badge.className = 'ec-offer-ind'
      badge.textContent = isPolish ? ' \u2705' : ' \u26A0\uFE0F'
      badge.title = isPolish ? 'Polski sprzedawca' : 'Sprzedawca spoza Polski'
      badge.style.marginLeft = '6px'
      badge.style.fontSize = '16px'
      badge.style.verticalAlign = 'middle'
      btn.appendChild(badge)
    })
  }

  function parsePriceValue(text) {
    if (!text) return null
    const cleaned = text
      .replace(/\u00A0/g, ' ')
      .replace(/[^[0-9.,-]]/g, '')
      .trim()
    if (!cleaned) return null
    const hasComma = cleaned.includes(',')
    const hasDot = cleaned.includes('.')
    if (hasComma && hasDot) {
      if (cleaned.lastIndexOf('.') > cleaned.lastIndexOf(',')) {
        return parseFloat(cleaned.replace(/,/g, ''))
      }
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
    }
    if (hasComma) {
      const parts = cleaned.split(',')
      if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 3) {
        return parseFloat(cleaned.replace(',', '.'))
      }
      return parseFloat(cleaned.replace(/,/g, ''))
    }
    if (hasDot) {
      const segments = cleaned.split('.')
      if (segments.length === 2 && segments[1].length > 0 && segments[1].length <= 3) {
        return parseFloat(cleaned)
      }
      return parseFloat(cleaned.replace(/\./g, ''))
    }
    return parseFloat(cleaned)
  }

  function decorateAuctionBidButtons(scope) {
    const buttons = scope.querySelectorAll('a.accept-offer')
    if (!buttons.length) return

    buttons.forEach(btn => {
      btn.querySelectorAll('.ec-offer-ind').forEach(el => el.remove())
    })

    const currentBidEl = scope.querySelector('.current-best-offer')
    if (!currentBidEl) return
    const currentBid = parsePriceValue(currentBidEl.textContent)
    if (currentBid === null || Number.isNaN(currentBid)) return

    const tooltip = Array.from(scope.querySelectorAll('.tooltip-content')).find(el => {
      const header = el.querySelector('.c-tooltip-header')
      if (!header) return false
      const headerText = (header.textContent || '').trim().toLowerCase()
      return headerText.includes('average price') || headerText.includes('średnia cena')
    })
    if (!tooltip) return
    const averageTextEl = tooltip.querySelector('p')
    if (!averageTextEl) return
    const averagePrice = parsePriceValue(averageTextEl.textContent)
    if (averagePrice === null || Number.isNaN(averagePrice)) return

    const thresholdRatio = 0.1
    const ratio = averagePrice === 0 ? null : (currentBid - averagePrice) / averagePrice

    let symbol = '━'
    let color = '#facc15'
    let state = 'within'
    if (ratio === null) {
      symbol = '∅'
      color = '#9ca3af'
      state = 'no-data'
    } else if (ratio > thresholdRatio) {
      symbol = '▲'
      color = '#dc2626'
      state = 'above'
    } else if (ratio < -thresholdRatio) {
      symbol = '▼'
      color = '#16a34a'
      state = 'below'
    }

    const diffPercent = ratio === null ? null : (ratio * 100).toFixed(1)
    const titleParts = [
      `Current bid: ${currentBid.toFixed(3)}`,
      `Avg (7d): ${averagePrice.toFixed(3)}`
    ]
    if (diffPercent !== null) {
      titleParts.push(`Diff: ${diffPercent}%`)
    } else {
      titleParts.push('Diff: unavailable')
    }

    buttons.forEach(btn => {
      let indicator = btn.querySelector('.ec-auction-ind')
      if (!indicator) {
        indicator = document.createElement('span')
        indicator.className = 'ec-auction-ind'
        indicator.style.marginLeft = '6px'
        indicator.style.fontSize = '16px'
        indicator.style.fontWeight = '700'
        indicator.style.verticalAlign = 'middle'
        btn.appendChild(indicator)
      }
      indicator.textContent = ` ${symbol}`
      indicator.style.color = color
      indicator.dataset.state = state
      indicator.title = titleParts.join(' • ')
    })
  }

  async function fetchFlagForUser(userPath) {
    if (cache[userPath]?.url) {
      return { url: cache[userPath].url, alt: cache[userPath].alt }
    }

    const profileUrl = makeAbsoluteUrl(userPath)
    const res = await fetch(profileUrl, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const flagImg = doc.querySelector('a.link-nationality img')
    if (!flagImg) throw new Error('Flag not found')

    const src = makeAbsoluteUrl(flagImg.getAttribute('src'))
    const alt = flagImg.getAttribute('alt') || ''

    cache[userPath] = { url: src, alt, ts: Date.now() }
    saveCache()
    return { url: src, alt }
  }

  async function fetchOfficerFlagForHolding(holdingPath) {
    if (cache[holdingPath]?.url) {
      return { url: cache[holdingPath].url, alt: cache[holdingPath].alt }
    }

    const holdingUrl = makeAbsoluteUrl(holdingPath)
    const res = await fetch(holdingUrl, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const ceoLink = doc.querySelector('a.ceo-link[href^="/user/"]')
    if (!ceoLink) throw new Error('CEO link not found on holding page')

    const officerUserPath = ceoLink.getAttribute('href')
    if (!officerUserPath || !officerUserPath.startsWith('/user/')) {
      throw new Error('Invalid CEO user href on holding page')
    }

    const { url, alt } = await fetchFlagForUser(officerUserPath)

    cache[holdingPath] = { url, alt, ts: Date.now() }
    saveCache()
    return { url, alt }
  }

  function pLimit(limit) {
    let active = 0
    const queue = []
    const next = () => {
      if (active >= limit || queue.length === 0) return
      const { fn, resolve, reject } = queue.shift()
      active++
      Promise.resolve()
        .then(fn)
        .then(v => {
          active--
          resolve(v)
          next()
        })
        .catch(e => {
          active--
          reject(e)
          next()
        })
    }
    return fn =>
      new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject })
        next()
      })
  }

  const limit = pLimit(MAX_CONCURRENCY)

  function processAnchors(anchors) {
    anchors.forEach(anchor => {
      if (alreadyInjected(anchor)) return
      const href = anchor.getAttribute('href') || ''

      anchor.dataset.ecFlagPending = '1'

      const handleResult = ({ url, alt }) => {
        if (!document.contains(anchor) || alreadyInjected(anchor)) return
        insertFlag(anchor, url, alt)
      }
      const finalize = () => {
        anchor.dataset.ecFlagPending = ''
      }

      if (href.startsWith('/user/')) {
        if (cache[href]?.url) {
          handleResult({ url: cache[href].url, alt: cache[href].alt })
          finalize()
          return
        }
        limit(() => fetchFlagForUser(href))
          .then(handleResult)
          .catch(() => {})
          .finally(finalize)
        return
      }

      if (href.startsWith('/holding/')) {
        if (cache[href]?.url) {
          handleResult({ url: cache[href].url, alt: cache[href].alt })
          finalize()
          return
        }
        limit(() => fetchOfficerFlagForHolding(href))
          .then(handleResult)
          .catch(() => {})
          .finally(finalize)
        return
      }

      finalize()
    })
  }

  function scanAndInject(root = document) {
    const anchors = findSellerAnchors(root).filter(
      a => !alreadyInjected(a) && a.dataset.ecFlagPending !== '1'
    )
    if (anchors.length) {
      processAnchors(anchors)
    }
  }

  // Initial run
  scanAndInject()
  insertMotivationBanner()

  // Re-run on DOM changes (pagination, infinite loads, filters)
  const observer = new MutationObserver(mutations => {
    let shouldScan = false
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        shouldScan = true
        break
      }
    }
    if (shouldScan) {
      // Small debounce
      clearTimeout(observer._t)
      observer._t = setTimeout(() => {
        scanAndInject()
        insertMotivationBanner()
      }, 150)
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  // Also re-scan on pagination click events (site may re-render via JS)
  document.addEventListener('click', e => {
    const a = e.target.closest('.pagination_item')
    if (a) {
      setTimeout(() => {
        scanAndInject()
        insertMotivationBanner()
      }, 400)
    }
  })
})()
