// ==UserScript==
// @name Eclesiar Training Center Plus
// @namespace http://tampermonkey.net/
// @version 1.2.1
// @description Settings panel, alternative table view, fixed mining eq stats for PL, performance optimizations, tabel view stats refresh bug fixed, perf colors better contrast
// @author p0tfur, based on script by ms05 + SirManiek
// @match https://eclesiar.com/training
// @match https://eclesiar.com/market/auction*
// @updateURL    https://24na7.info/eclesiar-scripts/Eclesiar Training Center.user.js
// @downloadURL  https://24na7.info/eclesiar-scripts/Eclesiar Training Center.user.js
// @grant GM_addStyle
// @run-at document-idle
// @noframes
// ==/UserScript==

;(function () {
  'use strict'

  ////////// USER CONFIG //////////
  let LANGUAGE = localStorage.getItem('ecPlus.language') || 'pl' // pl for Polish, en for English
  const DEBUG = false // toggle verbose logs
  /////////////////////////////////

  ////////// PARAMETERS //////////
  // Feature flags (overridable by localStorage key 'ecPlus.features')
  const DEFAULT_FEATURES = {
    perfColors: true,
    filters: true,
    stats: true,
    relocateButton: true,
    statsTable: true
  }
  function readFeatures() {
    try {
      const raw = localStorage.getItem('ecPlus.features')
      if (!raw) return { ...DEFAULT_FEATURES }
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_FEATURES, ...parsed }
    } catch {
      return { ...DEFAULT_FEATURES }
    }
  }
  const FEATURES = readFeatures()
  // Short display labels for table/cards (separate from TEXT_TRANSLATIONS used for detection)
  const DISPLAY_LABELS = {
    en: {
      // base
      power: 'Power',
      baseDamage: 'Base damage',
      critChance: 'Crit chance',
      bonusDamage: 'Bonus damage',
      critDamage: 'Crit damage',
      accuracy: 'Accuracy',
      // additional
      itemDropChance: 'Drop',
      damageForest: 'Forest',
      damageMountains: 'Mountains',
      damageFlatlands: 'Flatlands',
      damageDesert: 'Desert',
      bonusBuilding: 'Building',
      bonusHospital: 'Hospital',
      bonusMilitaryBase: 'Military Base',
      bonusProductionFields: 'Production Fields',
      bonusIndustrialZone: 'Industrial Zone',
      bonusDonations: 'Donations',
      bonusGold: 'Gold from mining'
    },
    pl: {
      // base
      power: 'Moc',
      baseDamage: 'Obrażenia bazowe',
      critChance: 'Szansa na krytyka',
      bonusDamage: 'Obrażenia dodatkowe',
      critDamage: 'Obrażenia krytyczne',
      accuracy: 'Celność',
      // additional
      itemDropChance: 'Drop',
      damageForest: 'Las',
      damageMountains: 'Góry',
      damageFlatlands: 'Równiny',
      damageDesert: 'Pustynia',
      bonusBuilding: 'Budowa',
      bonusHospital: 'Szpital',
      bonusMilitaryBase: 'Baza Wojsk.',
      bonusProductionFields: 'Pole Prod.',
      bonusIndustrialZone: 'Strefa Przem.',
      bonusDonations: 'Darowizny',
      bonusGold: 'Złoto z kopalni'
    }
  }
  // Icons for base/additional rows
  const ICONS = {
    // base
    power: 'fas fa-bolt',
    baseDamage: 'fas fa-bolt',
    critChance: 'fas fa-star',
    bonusDamage: 'fas fa-minus-circle',
    critDamage: 'fas fa-crosshairs',
    accuracy: 'fas fa-bullseye',
    // additional (fallbacks, we also use stat.icon if present)
    itemDropChance: 'fas fa-gift',
    damageForest: 'fas fa-tree',
    damageMountains: 'fas fa-mountain',
    damageFlatlands: 'fas fa-grip-lines',
    damageDesert: 'fas fa-sun',
    bonusBuilding: 'fas fa-hammer',
    bonusHospital: 'fas fa-hospital',
    bonusMilitaryBase: 'fas fa-warehouse',
    bonusProductionFields: 'fas fa-tractor',
    bonusIndustrialZone: 'fas fa-industry',
    bonusDonations: 'fas fa-dollar-sign',
    bonusGold: 'fas fa-screwdriver'
  }
  const TEXT_TRANSLATIONS = {
    en: {
      itemDropChance: 'Item drop chance',
      damageForest: 'Damage on forest regions',
      damageMountains: 'Damage on mountains regions',
      damageFlatlands: 'Damage on flat land regions',
      damageDesert: 'Damage on desert regions',
      bonusBuilding: 'Bonus progress when building',
      bonusHospital: 'Bonus progress when building Hospital',
      bonusMilitaryBase: 'Bonus progress when building Military Base',
      bonusProductionFields: 'Bonus progress when building Production Fields',
      bonusIndustrialZone: 'Bonus progress when building Industrial Zone',
      bonusDonations: 'Bonus progress when building through item donation',
      bonusGold: 'Bonus gold from mining activity'
    },
    pl: {
      itemDropChance: 'Szansa na drop przedmiotu',
      damageForest: 'Obrażenia na leśnym terenie',
      damageMountains: 'Obrażenia na górskim terenie',
      damageFlatlands: 'Obrażenia na płaskim terenie',
      damageDesert: 'Obrażenia na pustynnym terenie',
      bonusBuilding: 'Ogólny postęp budowy',
      bonusHospital: 'Dodatkowy postęp podczas budowy Szpitala',
      bonusMilitaryBase: 'Dodatkowy postęp podczas budowy Bazy Wojskowej',
      bonusProductionFields: 'Dodatkowy postęp podczas budowy Pola Produkcyjnego',
      bonusIndustrialZone: 'Dodatkowy postęp podczas budowy Strefy Przemysłowej',
      bonusDonations: 'Dodatkowy postęp podczas przekazywania przedmiotów',
      bonusGold: 'Dodatkowe złoto za pracę w kopalni'
    }
  }
  const statsList = [
    {
      name: 'Drop chance:',
      value: 0,
      icon: 'fas fa-gift',
      textKey: 'itemDropChance',
      displayAlways: true
    },
    { name: 'Forest:', value: 0, icon: 'fas fa-tree', textKey: 'damageForest' },
    { name: 'Mountains:', value: 0, icon: 'fas fa-mountain', textKey: 'damageMountains' },
    { name: 'Flatlands:', value: 0, icon: 'fas fa-grip-lines', textKey: 'damageFlatlands' },
    { name: 'Desert:', value: 0, icon: 'fas fa-sun', textKey: 'damageDesert' },
    {
      name: 'Building:',
      value: 0,
      icon: 'fas fa-hammer',
      textKey: 'bonusBuilding',
      isConstructionStat: true
    },
    {
      name: 'Military Base:',
      value: 0,
      icon: 'fas fa-warehouse',
      textKey: 'bonusMilitaryBase',
      isConstructionStat: true
    },
    {
      name: 'Hospital',
      value: 0,
      icon: 'fas fa-hospital',
      textKey: 'bonusHospital',
      isConstructionStat: true
    },
    {
      name: 'Production Fields:',
      value: 0,
      icon: 'fas fa-tractor',
      textKey: 'bonusProductionFields',
      isConstructionStat: true
    },
    {
      name: 'Industrial Zone:',
      value: 0,
      icon: 'fas fa-industry',
      textKey: 'bonusIndustrialZone',
      isConstructionStat: true
    },
    {
      name: 'Donations:',
      value: 0,
      icon: 'fas fa-dollar-sign',
      textKey: 'bonusDonations',
      isConstructionStat: true
    },
    {
      name: 'Gold mining',
      value: 0,
      icon: 'fas fa-screwdriver',
      textKey: 'bonusGold',
      isConstructionStat: true
    }
  ]
  const CONSOLE_LOG_PREFIX = '[Eclesiar Training Center Plus]'
  const SELECTORS = {
    trainButton: 'button.training-button.training-action-btn',
    trainingPanel: 'div.training-panel',
    presetArea: 'div.equipped-area--avatar',
    equipmentSlot: 'div.dropzone.equip-slot',
    equipmentPanel: 'div.my-equipment-list',
    equipmentListSlot: 'div[data-equipid][data-type]',
    scrapperDiv: 'div.d-flex.ml-auto',
    dropzone: 'div.multiple-dropzone',
    items: 'div.equipment-item'
  }
  // Cached DOM references
  const CACHED = { trainingPanel: null, presetArea: null, equipmentPanel: null }
  function getTrainingPanel() {
    if (!CACHED.trainingPanel)
      CACHED.trainingPanel = document.querySelector(SELECTORS.trainingPanel)
    return CACHED.trainingPanel
  }
  function getPresetArea() {
    if (!CACHED.presetArea) CACHED.presetArea = document.querySelector(SELECTORS.presetArea)
    return CACHED.presetArea || document
  }
  function getEquipmentPanel() {
    if (!CACHED.equipmentPanel)
      CACHED.equipmentPanel = document.querySelector(SELECTORS.equipmentPanel)
    return CACHED.equipmentPanel
  }
  const perfsList = {
    CONSTRUCTION: [],
    MILITAR: [
      1, 21, 31, 46, 61, 81, 2, 22, 32, 47, 62, 82, 3, 23, 33, 48, 63, 83, 4, 24, 34, 49, 64, 84, 5,
      25, 35, 50, 65, 85
    ],
    MILITAR_DESERT: [
      242, 247, 252, 257, 262, 267, 243, 248, 253, 258, 263, 268, 244, 249, 254, 259, 264, 269, 245,
      250, 255, 260, 265, 270, 246, 251, 256, 261, 266, 271
    ],
    MILITAR_FLATLAND: [
      332, 337, 342, 347, 352, 327, 333, 338, 343, 348, 353, 328, 334, 339, 344, 349, 354, 329, 335,
      340, 345, 350, 355, 330, 336, 341, 346, 351, 356, 331
    ],
    MILITAR_FOREST: [
      512, 517, 492, 527, 532, 537, 513, 518, 493, 528, 533, 538, 514, 519, 494, 529, 534, 539, 515,
      520, 495, 530, 535, 540, 516, 521, 496, 531, 536, 541
    ],
    MILITAR_MOUNTAINS: [
      422, 427, 432, 437, 442, 447, 423, 428, 433, 438, 443, 448, 424, 429, 434, 439, 444, 449, 425,
      430, 435, 440, 445, 450, 426, 431, 436, 441, 446, 451
    ],
    MINING: []
  }
  const perfsColors = {
    CONSTRUCTION: '',
    MILITAR: '#ffffff',
    MILITAR_DESERT: '#ffd700',
    MILITAR_FLATLAND: '#ff8c00',
    MILITAR_FOREST: '#22c55e',
    MILITAR_MOUNTAINS: '#00e5ff',
    MINING: ''
  }
  /////////////////////////////////
  // Centralized styles instead of inline where possible
  if (typeof GM_addStyle === 'function') {
    GM_addStyle(`
          #stats-switch-wrapper { display:flex; align-items:stretch; gap:10px; justify-content:flex-end; padding:2px; margin-top:10px; }
          #custom-switch { width:40px; height:20px; background:#ccc; border-radius:10px; position:relative; display:inline-block; vertical-align:middle; transition:background .2s; }
          #switch-knob { position:absolute; left:2px; top:2px; width:16px; height:16px; background:#fff; border-radius:50%; transition:left .2s; transition:left .2s; }
          .stat-box { display:flex; flex-direction:row; align-items:center; justify-content:space-between; padding:4px 6px; min-height:36px; gap:8px; }
          .stat-box > div { text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .stat-box > strong { font-size:.9em; line-height:1; margin-left:8px; }
          .stat-label { display:inline-flex; align-items:center; gap:6px; }
          .stat-label i { margin-right:0; }
          /* Slightly larger cards for construction stats to fit longer labels */
          .stat-construction .stat-box { min-height:40px; padding:6px 8px; }
          #ecplus-settings { padding:6px 8px; border:1px dashed #9ca3af; border-radius:6px; margin-bottom:6px; }
          #ecplus-settings .ecplus-settings__title { display:flex; align-items:center; justify-content:space-between; font-weight:600; margin-bottom:4px; cursor:pointer; user-select:none; font-size:12px; }
          #ecplus-settings .ecplus-settings__title .chev { font-weight:700; opacity:.8; }
          #ecplus-settings.is-collapsed .ecplus-settings__controls { display:none; }
          #ecplus-settings .ecplus-settings__controls { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:6px 12px; align-items:center; }
          #ecplus-settings .ecplus-settings__controls label { display:flex; align-items:center; gap:6px; font-size:11px; line-height:1.2; }
          #ecplus-settings .ecplus-settings__controls input[type="checkbox"] { transform: translateY(0); }
          #ecplus-settings .ecplus-settings__controls select { font-size:12px; padding:2px 6px; }
          /* Compact stats table */
          .ec-stats-table { width:100%; max-width:100%; margin:0; border-collapse:collapse; font-size:12px; }
          .ec-stats-table tbody tr { border-bottom:1px dashed rgba(255,255,255,0.08); }
          .ec-stats-table td { padding:4px 6px; vertical-align:middle; }
          .ec-stats-table td.ec-label { opacity:.9; text-align:left; }
          .ec-stats-table td.ec-val { text-align:right; font-weight:600; }
          .ec-stats-table .ec-section { opacity:.8; font-weight:600; padding-top:6px; }
          .ec-label .ico { width:14px; display:inline-block; text-align:center; margin-right:6px; opacity:.9; }
        `)
  }

  // Precompute Sets and reverse map for faster lookups
  const PERF_SETS = Object.fromEntries(
    Object.entries(perfsList).map(([k, arr]) => [k, new Set(arr)])
  )
  const ITEMID_TO_TYPE = (() => {
    const m = new Map()
    for (const [type, ids] of Object.entries(perfsList)) {
      for (const id of ids) m.set(id, type)
    }
    return m
  })()

  function perfFindTypeByItemId(itemId) {
    return ITEMID_TO_TYPE.get(itemId)
  }
  function perfFormatItem(item, type) {
    if (!item || !type) {
      return
    }
    item.style.borderStyle = 'dotted'
    if (FEATURES.perfColors) {
      const col = perfsColors[type] || ''
      if (col) {
        item.style.borderColor = col
        item.style.borderWidth = '2px'
        item.style.boxShadow = `0 0 0 1px ${col}, 0 0 6px ${col}`
      }
    }
  }
  function perfItems() {
    const itemsList = document.querySelectorAll(SELECTORS.items)
    itemsList.forEach(item => {
      let isPerf = false
      //Training page elements
      let equipmentId = parseInt(item.getAttribute('data-equipment-type-id'))
      let type = item.getAttribute('data-type')
      if (equipmentId && type) {
        isPerf = PERF_SETS[type]?.has(equipmentId) === true
      } else {
        //Auctions page elements
        let itemId = parseInt(item.getAttribute('data-itemid'))
        let itemIdType = item.getAttribute('data-itemtype')
        if (itemId && itemIdType === 'equipment') {
          type = perfFindTypeByItemId(itemId)
          isPerf = Boolean(type)
        }
      }
      if (isPerf) {
        perfFormatItem(item, type)
      }
    })
  }

  function log(message) {
    if (DEBUG) console.log(`${CONSOLE_LOG_PREFIX} ${message}`)
  }

  function warn(message) {
    console.warn(`${CONSOLE_LOG_PREFIX} ${message}`)
  }

  function relocateTrainButton() {
    log('Relocating Train button')
    const button = document.querySelector(SELECTORS.trainButton)

    if (!button) {
      warn('Train button not found')
      return
    }

    const trainingPanel = getTrainingPanel()

    if (!trainingPanel) {
      warn('Training panel not found')
      return
    }

    // Find the header row containing avatar and Power Level
    const headerRow = trainingPanel.querySelector('div.d-flex.align-items-center.mb-3')
    if (!headerRow) {
      warn('Header row not found')
      return
    }

    // Append the Train button into the header row and align it to the right
    if (button.parentElement !== headerRow) {
      headerRow.appendChild(button)
    }

    headerRow.style.display = 'flex'
    headerRow.style.alignItems = 'center'

    // Hide power block (strong+h2) when table view is enabled, since table shows Power
    if (FEATURES.statsTable) {
      const blocks = headerRow.querySelectorAll('div')
      blocks.forEach(div => {
        if (div.querySelector('h2') && div.querySelector('strong')) {
          div.style.display = 'none'
        }
      })
    }

    button.style.marginLeft = 'auto'
    button.style.height = '44px'
    button.style.minWidth = '144px'
    button.style.marginLeft = '16px'
    button.style.padding = '8px 12px'
    button.style.alignSelf = 'center'

    const powerLevel = trainingPanel.querySelector('h2')
    if (powerLevel) {
      powerLevel.style.textAlign = 'center'

      if (powerLevel.parentElement) {
        powerLevel.parentElement.style.margin = '0px 6px'
      }
    }

    trainingPanel.style.width = '100%'

    log('Train button relocated')
  }

  function createStatDiv(name, value, icon, isConstructionStat, displayAlways) {
    const colDiv = document.createElement('div')
    colDiv.className = 'col-6 p-0'
    if (isConstructionStat) {
      colDiv.classList.add('stat-construction')
    }

    colDiv.setAttribute('displayAlways', displayAlways)
    colDiv.setAttribute('customStat', true)

    if (displayAlways != true) {
      const displayMilitaryStats = !statsSwitch ? true : !statsSwitch.checked
      if (
        (displayMilitaryStats && isConstructionStat == true) ||
        (!displayMilitaryStats && isConstructionStat != true)
      ) {
        colDiv.style.display = 'none'
      }
    }

    const statBoxDiv = document.createElement('div')
    statBoxDiv.className = 'stat-box'

    const innerDiv = document.createElement('div')
    innerDiv.className = 'stat-label'
    innerDiv.innerHTML = `<i class="${icon}"></i>${name}`

    const strongElem = document.createElement('strong')
    strongElem.className = 'accuracy-input'
    strongElem.textContent = `+${value}%`

    statBoxDiv.appendChild(innerDiv)
    statBoxDiv.appendChild(strongElem)
    colDiv.appendChild(statBoxDiv)

    return colDiv
  }

  const TRANSLATION_CACHE = new Map()
  function getTranslatedText(key, language = 'en') {
    const cacheKey = `${language}:${key}`
    if (TRANSLATION_CACHE.has(cacheKey)) return TRANSLATION_CACHE.get(cacheKey)
    const val =
      TEXT_TRANSLATIONS[language] && TEXT_TRANSLATIONS[language][key]
        ? TEXT_TRANSLATIONS[language][key]
        : key
    TRANSLATION_CACHE.set(cacheKey, val)
    return val
  }

  function fetchActivePresetStats() {
    const presetArea = getPresetArea()
    if (!presetArea) {
      warn('Preset Area not found')
      return statsList
    }

    const equipSlots = Array.from(presetArea.querySelectorAll(SELECTORS.equipmentSlot))
    statsList.forEach(stat => {
      for (const slot of equipSlots) {
        const pElems = slot.querySelectorAll('p')
        pElems.forEach(pElem => {
          const spanElem = pElem.querySelector('span')
          if (spanElem) {
            const spanText = spanElem.textContent.trim()
            let pText = pElem.textContent.trim()

            if (pText.startsWith(spanText)) {
              pText = pText.slice(spanText.length).trim()
            }

            if (pText === getTranslatedText(stat.textKey, LANGUAGE)) {
              const val = parsePercent(spanText)
              if (val !== null) {
                stat.value += val
              }
            }
          }
        })
      }
    })

    return statsList
  }

  // Extract base/original stats from the native Training panel
  function getPowerLevel() {
    try {
      const trainingPanel = document.querySelector(SELECTORS.trainingPanel)
      const h2 = trainingPanel?.querySelector('div.d-flex.align-items-center.mb-3 h2')
      if (!h2) return null
      const val = h2.textContent.trim()
      return val || null
    } catch {
      return null
    }
  }

  function extractBaseStats() {
    const base = []
    const t = document.querySelector(SELECTORS.trainingPanel)
    if (!t) return base
    // Power level
    const p = getPowerLevel()
    if (p) base.push({ key: 'power', value: p })

    // Prefer exact selectors first
    const bySel = [
      { cls: '.base-damage-input', key: 'baseDamage' },
      { cls: '.critical-chance-input', key: 'critChance' },
      { cls: '.bonus-damage-input', key: 'bonusDamage' },
      { cls: '.critical-hit-input', key: 'critDamage' },
      { cls: '.accuracy-input', key: 'accuracy' }
    ]
    bySel.forEach(x => {
      const el = t.querySelector(x.cls)
      if (el) {
        base.push({ key: x.key, value: el.textContent.trim() })
      }
    })
    if (base.length >= 1) return base // got some via selectors

    // Fallback to text scanning
    const LABELS = [
      { pl: 'Obrażenia bazowe', en: 'Base damage', key: 'baseDamage' },
      { pl: 'Szansa na trafienie krytyczne', en: 'Critical hit chance', key: 'critChance' },
      { pl: 'Obrażenia dodatkowe', en: 'Additional damage', key: 'bonusDamage' },
      { pl: 'Obrażenia krytyczne', en: 'Critical damage', key: 'critDamage' },
      { pl: 'Celność', en: 'Accuracy', key: 'accuracy' }
    ]
    const all = Array.from(t.querySelectorAll('*'))
    const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase()
    for (const lab of LABELS) {
      const needles = [lab.pl.toLowerCase(), lab.en.toLowerCase()]
      let found = null
      for (const el of all) {
        const txt = norm(el.textContent || '')
        if (!txt) continue
        if (needles.some(n => txt.includes(n))) {
          found = el
          break
        }
      }
      if (found) {
        let val = null
        const m2 = (found.parentElement?.querySelector('strong')?.textContent || '').trim()
        if (m2) val = m2
        base.push({ key: lab.key, value: val ?? '?' })
      }
    }
    return base
  }

  function switchStatsDisplay() {
    log('Switching stats')

    const trainingPanel = document.querySelector(SELECTORS.trainingPanel)

    if (!trainingPanel) {
      warn('Training panel not found')
      return
    }

    const divChildren = Array.from(trainingPanel.children).filter(
      child => child.tagName.toLowerCase() === 'div' && child.id !== 'stats-switch-wrapper'
    )

    if (divChildren.length === 0) {
      warn('Stats elements not found')
      return
    }

    const statsDiv = divChildren[divChildren.length - 1]

    Array.from(statsDiv.children).forEach(child => {
      if (child.tagName === 'DIV') {
        if (child.style.display !== 'none' && child.getAttribute('displayAlways') !== 'true') {
          child.style.display = 'none'
        } else {
          child.style.display = ''
        }
      }
    })

    log('Stats switched')
  }

  function setLanguage(lang) {
    LANGUAGE = lang === 'en' ? 'en' : 'pl'
    try {
      localStorage.setItem('ecPlus.language', LANGUAGE)
    } catch {}
    // Re-render stats labels and filter labels
    try {
      refreshStats()
      // Rebuild filter select labels if present
      if (equipmentTypeSelect) {
        const currentValue = equipmentTypeSelect.value
        equipmentTypeSelect.innerHTML = ''
        const opts = getFilterOptions(LANGUAGE)
        opts.forEach(opt => {
          const option = document.createElement('option')
          option.value = opt.value
          option.textContent = opt.label
          equipmentTypeSelect.appendChild(option)
        })
        equipmentTypeSelect.value = currentValue || 'all'
      }
      // Update settings panel texts if present
      updateSettingsPanelTexts()
    } catch {}
  }

  function updateSettingsPanelTexts() {
    const panel = document.getElementById('ecplus-settings')
    if (!panel) return
    const title = panel.querySelector('.ecplus-settings__title span')
    if (title) title.textContent = LANGUAGE === 'pl' ? 'Ustawienia:' : 'Settings:'
    const labels = panel.querySelectorAll('.ecplus-settings__controls label span')
    if (!labels) return
    const mapPl = ['Kolory perfów', 'Filtry sprzętu', 'Dodatkowe staty', 'Przenieś przycisk']
    const mapEn = ['Perf colors', 'Equipment filters', 'Extra stats', 'Relocate button']
    const texts = LANGUAGE === 'pl' ? mapPl : mapEn
    labels.forEach((span, idx) => {
      if (texts[idx]) span.textContent = texts[idx]
    })
  }

  function addSettingsPanel() {
    const trainingPanel = document.querySelector(SELECTORS.trainingPanel)
    if (!trainingPanel) return
    if (document.getElementById('ecplus-settings')) return

    const panel = document.createElement('div')
    panel.id = 'ecplus-settings'
    const collapsed = localStorage.getItem('ecPlus.settingsCollapsed') === 'true'
    if (collapsed) panel.classList.add('is-collapsed')

    const title = document.createElement('div')
    title.className = 'ecplus-settings__title'
    const titleSpan = document.createElement('span')
    titleSpan.textContent = LANGUAGE === 'pl' ? 'Ustawienia:' : 'Settings:'
    const chev = document.createElement('span')
    chev.className = 'chev'
    chev.textContent = collapsed ? '▸' : '▾'
    title.appendChild(titleSpan)
    title.appendChild(chev)
    title.addEventListener('click', () => {
      const isCollapsed = panel.classList.toggle('is-collapsed')
      chev.textContent = isCollapsed ? '▸' : '▾'
      try {
        localStorage.setItem('ecPlus.settingsCollapsed', String(isCollapsed))
      } catch {}
    })
    panel.appendChild(title)

    const controls = document.createElement('div')
    controls.className = 'ecplus-settings__controls'

    const makeToggle = (key, labelPl, labelEn) => {
      const lab = document.createElement('label')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = !!FEATURES[key]
      cb.addEventListener('change', () => {
        try {
          const next = { ...FEATURES, [key]: cb.checked }
          localStorage.setItem('ecPlus.features', JSON.stringify(next))
        } catch {}
        // For simplicity and reliability, reload to apply feature toggles
        location.reload()
      })
      const span = document.createElement('span')
      span.textContent = LANGUAGE === 'pl' ? labelPl : labelEn
      lab.appendChild(cb)
      lab.appendChild(span)
      return lab
    }

    controls.appendChild(makeToggle('perfColors', 'Kolory perfów', 'Perf colors'))
    controls.appendChild(makeToggle('filters', 'Filtry sprzętu', 'Equipment filters'))
    controls.appendChild(makeToggle('stats', 'Dodatkowe staty', 'Extra stats'))
    controls.appendChild(makeToggle('statsTable', 'Widok tabeli statystyk', 'Stats table view'))
    controls.appendChild(makeToggle('relocateButton', 'Przenieś przycisk', 'Relocate button'))

    panel.appendChild(controls)

    // Insert panel near top of training panel
    trainingPanel.insertBefore(panel, trainingPanel.firstChild)
  }

  function detectLanguageHeuristic() {
    // Returns 'pl' | 'en' | null
    try {
      const score = { pl: 0, en: 0 }
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()

      // 1) document lang
      const docLang = (document.documentElement.lang || '').toLowerCase()
      if (docLang.startsWith('pl')) score.pl += 2
      if (docLang.startsWith('en')) score.en += 2

      // 2) Header text cue (Dzień/Day)
      const headerEl =
        document.querySelector('.pl-3.ellipsis .header-text') ||
        document.querySelector('.header-text')
      const headerText = norm(headerEl?.textContent || '')
      if (headerText.includes('dzień')) score.pl += 2
      if (headerText.includes('day')) score.en += 2

      // 3) Train button text (Trenuj/Train)
      const trainBtn = document.querySelector('button.training-button.training-action-btn')
      const trainTxt = norm(trainBtn?.textContent || '')
      if (trainTxt.includes('trenuj')) score.pl += 2
      if (trainTxt.includes('train')) score.en += 2

      // 4) Native base stat labels (Celność/Accuracy etc.)
      const nativeText = norm(
        document.querySelector('.accuracy-input')?.parentElement?.previousElementSibling
          ?.textContent ||
          document.body.textContent ||
          ''
      )
      if (nativeText.includes('celność') || nativeText.includes('obrażenia')) score.pl += 2
      if (nativeText.includes('accuracy') || nativeText.includes('damage')) score.en += 2

      // Decide
      if (score.pl === 0 && score.en === 0) return null
      return score.pl >= score.en ? 'pl' : 'en'
    } catch {
      return null
    }
  }

  function detectLanguageFromHeader() {
    try {
      // If language is already set in localStorage, do not override mid-session
      if (localStorage.getItem('ecPlus.language')) return
      const guess = detectLanguageHeuristic()
      if (!guess) return
      // Always persist on first detection so both EN and PL create ecPlus.language
      setLanguage(guess)
    } catch {}
  }

  function observeLanguageChanges() {
    if (localStorage.getItem('ecPlus.language')) return // language persisted -> no live tracking
    const target = document.querySelector(SELECTORS.trainingPanel) || document.body || document
    const onMut = debounce(() => {
      detectLanguageFromHeader()
    }, 200)
    const obs = new MutationObserver(onMut)
    obs.observe(target, { childList: true, subtree: true })
  }

  function calculateAdditionalStats(removeExisting = false) {
    log('Calculating stats')

    const trainingPanel = document.querySelector(SELECTORS.trainingPanel)

    if (!trainingPanel) {
      warn('Training panel not found')
      return
    }

    const divChildren = Array.from(trainingPanel.children).filter(
      child => child.tagName.toLowerCase() === 'div' && child.id !== 'stats-switch-wrapper'
    )

    if (divChildren.length === 0) {
      warn('Stats elements not found')
      return
    }
    const statsDiv = divChildren[divChildren.length - 1]

    if (removeExisting) {
      Array.from(statsDiv.querySelectorAll('div[customStat="true"]')).forEach(div => {
        div.parentNode.removeChild(div)
      })
    }

    const statsList = fetchActivePresetStats()
    if (DEBUG) console.table(statsList)

    const useTable = FEATURES.statsTable === true
    if (useTable) {
      const wrapper = document.createElement('div')
      wrapper.setAttribute('customStat', true)
      const table = document.createElement('table')
      table.className = 'ec-stats-table'
      const tbody = document.createElement('tbody')

      // Base/original stats section
      const baseStats = extractBaseStats()
      if (baseStats.length) {
        const sec = document.createElement('tr')
        const secTd = document.createElement('td')
        secTd.colSpan = 2
        secTd.className = 'ec-section'
        secTd.textContent = LANGUAGE === 'pl' ? 'Podstawowe' : 'Base'
        sec.appendChild(secTd)
        tbody.appendChild(sec)
        const baseFrag = document.createDocumentFragment()
        baseStats.forEach(({ key, value }) => {
          const tr = document.createElement('tr')
          const l = document.createElement('td')
          l.className = 'ec-label'
          const ico = document.createElement('span')
          ico.className = 'ico'
          ico.innerHTML = `<i class="${ICONS[key] || ICONS.power}"></i>`
          const text = document.createElement('span')
          text.textContent = (DISPLAY_LABELS[LANGUAGE][key] || key) + ':'
          l.appendChild(ico)
          l.appendChild(text)
          const v = document.createElement('td')
          v.className = 'ec-val'
          v.textContent = value ?? '?'
          tr.appendChild(l)
          tr.appendChild(v)
          baseFrag.appendChild(tr)
        })
        tbody.appendChild(baseFrag)
      }

      // Additional stats section (from equipment aggregation) as two-column (military vs building)
      const sec2 = document.createElement('tr')
      const sec2Td = document.createElement('td')
      sec2Td.colSpan = 2
      sec2Td.className = 'ec-section'
      sec2Td.textContent = LANGUAGE === 'pl' ? 'Dodatkowe' : 'Additional'
      sec2.appendChild(sec2Td)
      tbody.appendChild(sec2)

      // Headers row for two columns
      const hdr = document.createElement('tr')
      const h1 = document.createElement('td')
      h1.className = 'ec-label'
      h1.textContent = LANGUAGE === 'pl' ? 'Wojskowe' : 'Military'
      const h2 = document.createElement('td')
      h2.className = 'ec-label'
      h2.style.textAlign = 'left'
      h2.textContent = LANGUAGE === 'pl' ? 'Budowa' : 'Building'
      hdr.appendChild(h1)
      hdr.appendChild(h2)
      tbody.appendChild(hdr)

      const military = statsList.filter(s => !s.isConstructionStat)
      const building = statsList.filter(s => s.isConstructionStat)
      const maxLen = Math.max(military.length, building.length)
      const addFrag = document.createDocumentFragment()
      for (let i = 0; i < maxLen; i++) {
        const tr = document.createElement('tr')
        // left cell: military
        const left = document.createElement('td')
        left.className = 'ec-label'
        if (military[i]) {
          const s = military[i]
          const ico = document.createElement('span')
          ico.className = 'ico'
          ico.innerHTML = `<i class="${s.icon || ICONS[s.textKey] || 'fas fa-circle'}"></i>`
          const txt = document.createElement('span')
          txt.textContent = `${
            DISPLAY_LABELS[LANGUAGE][s.textKey] || getTranslatedText(s.textKey, LANGUAGE)
          }: +${parseFloat(s.value.toFixed(3))}%`
          left.appendChild(ico)
          left.appendChild(txt)
        }
        // right cell: building
        const right = document.createElement('td')
        right.className = 'ec-label'
        if (building[i]) {
          const s = building[i]
          const ico = document.createElement('span')
          ico.className = 'ico'
          ico.innerHTML = `<i class="${s.icon || ICONS[s.textKey] || 'fas fa-circle'}"></i>`
          const txt = document.createElement('span')
          txt.textContent = `${
            DISPLAY_LABELS[LANGUAGE][s.textKey] || getTranslatedText(s.textKey, LANGUAGE)
          }: +${parseFloat(s.value.toFixed(3))}%`
          right.appendChild(ico)
          right.appendChild(txt)
        }
        tr.appendChild(left)
        tr.appendChild(right)
        addFrag.appendChild(tr)
      }
      tbody.appendChild(addFrag)

      table.appendChild(tbody)
      wrapper.appendChild(table)
      statsDiv.appendChild(wrapper)

      // Hide native cards grid (only when table is on)
      hideNativeStatCards(true)
    } else {
      statsList.forEach(stat => {
        const label =
          DISPLAY_LABELS[LANGUAGE][stat.textKey] || getTranslatedText(stat.textKey, LANGUAGE)
        const statDiv = createStatDiv(
          label,
          parseFloat(stat.value.toFixed(3)),
          stat.icon,
          stat.isConstructionStat,
          stat.displayAlways
        )
        statsDiv.appendChild(statDiv)
      })
      hideNativeStatCards(false)
    }

    log('Stats calculated')
  }

  function hideNativeStatCards(hide) {
    try {
      const trainingPanel = getTrainingPanel()
      if (!trainingPanel) return
      // The native cards live right before our custom content inside last stats div (same as statsDiv)
      const divChildren = Array.from(trainingPanel.children).filter(
        child => child.tagName.toLowerCase() === 'div' && child.id !== 'stats-switch-wrapper'
      )
      if (divChildren.length === 0) return
      const statsDiv = divChildren[divChildren.length - 1]
      Array.from(statsDiv.children).forEach(child => {
        if (child.getAttribute && child.getAttribute('customStat') === 'true') return // keep our injected
        // Hide only native col wrappers with stat-box inside
        if (child.classList && child.classList.contains('col-6')) {
          child.style.display = hide ? 'none' : ''
        }
      })
    } catch {}
  }

  // Stats switch UI (only when table view is OFF)
  let statsSwitch
  function addStatsSwitch() {
    if (FEATURES.statsTable) return // no switch in table mode
    log('Adding stats switch')

    const trainingPanel = document.querySelector(SELECTORS.trainingPanel)
    if (!trainingPanel) {
      warn('Training panel not found')
      return
    }

    const wrapper = document.createElement('div')
    wrapper.id = 'stats-switch-wrapper'
    wrapper.style.display = 'flex'
    wrapper.style.alignItems = 'stretch'
    wrapper.style.gap = '10px'
    wrapper.style.justifyContent = 'flex-end'
    wrapper.style.padding = '2px'
    wrapper.style.marginTop = '10px'

    const label = document.createElement('label')
    label.style.display = 'flex'
    label.style.alignItems = 'center'
    label.style.cursor = 'pointer'

    const desc = document.createElement('span')
    desc.id = 'switch-label'
    desc.textContent = LANGUAGE === 'pl' ? 'Wojskowe' : 'Military'
    desc.style.height = '20px'
    desc.style.display = 'flex'
    desc.style.alignItems = 'center'

    statsSwitch = document.createElement('input')
    statsSwitch.type = 'checkbox'
    statsSwitch.id = 'stats-switch'
    statsSwitch.style.display = 'none'

    const customSwitch = document.createElement('span')
    customSwitch.id = 'custom-switch'
    const knob = document.createElement('span')
    knob.id = 'switch-knob'

    customSwitch.appendChild(knob)
    label.appendChild(statsSwitch)
    label.appendChild(customSwitch)

    wrapper.appendChild(desc)
    wrapper.appendChild(label)

    trainingPanel.appendChild(wrapper)

    function updateSwitch() {
      if (statsSwitch.checked) {
        desc.textContent = LANGUAGE === 'pl' ? 'Budowa' : 'Building'
        knob.style.left = '22px'
        customSwitch.style.background = '#4caf50'
      } else {
        desc.textContent = LANGUAGE === 'pl' ? 'Wojskowe' : 'Military'
        knob.style.left = '2px'
        customSwitch.style.background = '#ccc'
      }
      refreshStats()
    }

    statsSwitch.addEventListener('change', updateSwitch)
    statsSwitch.checked = false
    log('Stats switch added')
  }

  const FILTER_VISIBILITY = {
    all: null,
    military_all: new Set([
      'MILITAR',
      'MILITAR_DESERT',
      'MILITAR_FLATLAND',
      'MILITAR_FOREST',
      'MILITAR_MOUNTAINS'
    ]),
    military_general: new Set(['MILITAR']),
    military_desert: new Set(['MILITAR_DESERT']),
    military_flatland: new Set(['MILITAR_FLATLAND']),
    military_forest: new Set(['MILITAR_FOREST']),
    military_mountains: new Set(['MILITAR_MOUNTAINS']),
    construction: new Set(['CONSTRUCTION']),
    mining: new Set(['MINING'])
  }

  function getFilterOptions(language) {
    if (language === 'pl') {
      return [
        { value: 'all', label: 'Wszystkie' },
        { value: 'military_all', label: 'Wojskowe (Wszystkie)' },
        { value: 'military_general', label: 'Wojskowe (Ogólne)' },
        { value: 'military_desert', label: 'Wojskowe (Pustynia)' },
        { value: 'military_flatland', label: 'Wojskowe (Równiny)' },
        { value: 'military_forest', label: 'Wojskowe (Las)' },
        { value: 'military_mountains', label: 'Wojskowe (Góry)' },
        { value: 'construction', label: 'Budowa' },
        { value: 'mining', label: 'Kopalnia' }
      ]
    }
    return [
      { value: 'all', label: 'All' },
      { value: 'military_all', label: 'Military (All)' },
      { value: 'military_general', label: 'Military (General)' },
      { value: 'military_desert', label: 'Military (Desert)' },
      { value: 'military_flatland', label: 'Military (Flatland)' },
      { value: 'military_forest', label: 'Military (Forest)' },
      { value: 'military_mountains', label: 'Military (Mountains)' },
      { value: 'construction', label: 'Construction' },
      { value: 'mining', label: 'Mining' }
    ]
  }

  function filterEquipment(filter) {
    const equipmentPanel = getEquipmentPanel()

    if (!equipmentPanel) {
      warn('Equipment panel not found')
      return
    }

    const allowed = FILTER_VISIBILITY[filter] || null
    const items = equipmentPanel.querySelectorAll(SELECTORS.equipmentListSlot)
    items.forEach(div => {
      const type = div.getAttribute('data-type')
      div.style.display = !allowed || allowed.has(type) ? '' : 'none'
    })
  }

  let equipmentTypeSelect
  function addEquipmentFiltering() {
    log('Adding equipment filtering')

    const equipmentPanel = getEquipmentPanel()

    if (!equipmentPanel) {
      warn('Equipment panel not found')
      return
    }

    const dropzone = equipmentPanel.querySelector(SELECTORS.dropzone)

    if (!dropzone) {
      warn('Dropzone element not found')
      return
    }

    dropzone.style.flex = '1'
    dropzone.style.alignContent = 'flex-start'
    dropzone.style.border = '1px dashed gray'
    dropzone.style.padding = '5px'

    const scrapperDiv = equipmentPanel.querySelector(SELECTORS.scrapperDiv)

    if (!scrapperDiv) {
      warn('Scrapper element not found')
      return
    }

    scrapperDiv.remove()
    equipmentPanel.appendChild(scrapperDiv)

    equipmentTypeSelect = document.createElement('select')
    equipmentTypeSelect.style.margin = '8px 0'
    equipmentTypeSelect.id = 'equipment-filter'
    equipmentTypeSelect.style.width = '35%'
    const options = getFilterOptions(LANGUAGE)
    options.forEach(opt => {
      const option = document.createElement('option')
      option.value = opt.value // stable key
      option.textContent = opt.label // localized label
      equipmentTypeSelect.appendChild(option)
    })
    equipmentTypeSelect.value = 'all'

    const h5 = equipmentPanel.querySelector('h5')
    if (h5 && h5.parentElement) {
      h5.parentElement.appendChild(equipmentTypeSelect)
    } else if (h5) {
      equipmentPanel.appendChild(equipmentTypeSelect)
    } else {
      equipmentPanel.insertBefore(equipmentTypeSelect, equipmentPanel.firstChild)
    }

    equipmentTypeSelect.addEventListener('change', function () {
      filterEquipment(equipmentTypeSelect.value)
    })

    log('Equipment filtering added')
  }

  function refreshStats() {
    log('Refreshing stats')
    statsList.forEach(stat => (stat.value = 0))
    calculateAdditionalStats(true)
    filterEquipment(equipmentTypeSelect.value)
    perfItems()
    log('Stats refreshed')
  }

  // Tiny debounce util
  function debounce(fn, wait = 150) {
    let t
    return function (...args) {
      clearTimeout(t)
      t = setTimeout(() => fn.apply(this, args), wait)
    }
  }

  function observeAllSlotChanges(callback) {
    // Observe the preset area for any slot/content changes once (subtree)
    const area = getPresetArea()
    const debounced = debounce(() => {
      callback()
    }, 150)
    const observer = new MutationObserver(() => {
      // Detect language first (header may appear later), then refresh
      detectLanguageFromHeader()
      debounced()
    })
    observer.observe(area, { childList: true, subtree: true })
  }

  // Robust percent parsing accommodating spaces and commas
  function parsePercent(text) {
    const normalized = String(text).replace(/\s+/g, '').replace(',', '.')
    const m = normalized.match(/^([+-]?\d+(?:\.\d+)?)%$/)
    return m ? parseFloat(m[1]) : null
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Auto-detect language on Training header (Dzień/Day) only if not persisted
      detectLanguageFromHeader()
      observeLanguageChanges()
      addSettingsPanel()
      if (FEATURES.relocateButton) relocateTrainButton()
      if (FEATURES.stats) {
        calculateAdditionalStats()
        addStatsSwitch()
      }
      if (FEATURES.filters) addEquipmentFiltering()
      observeAllSlotChanges(() => refreshStats())
      if (FEATURES.perfColors) perfItems()
    })
  } else {
    detectLanguageFromHeader()
    observeLanguageChanges()
    addSettingsPanel()
    if (FEATURES.relocateButton) relocateTrainButton()
    if (FEATURES.stats) {
      calculateAdditionalStats()
      addStatsSwitch()
    }
    if (FEATURES.filters) addEquipmentFiltering()
    observeAllSlotChanges(() => refreshStats())
    if (FEATURES.perfColors) perfItems()
  }
})()
