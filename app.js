(() => {
  "use strict";

  const CONFIG = window.GUQ_CATERING_CONFIG || {};
  const DEFAULT_SETTINGS = {
    site_name: "GU-Q Catering Catalogue",
    brand_name: "Georgetown University in Qatar",
    department_name: "Office of Finance · Procurement & Payables",
    academic_year: "2026–2027",
    hero_eyebrow: "Preferred Catering Catalogue · AY 2026–2027",
    hero_title: "Plan events faster. Choose catering with confidence.",
    hero_description: "An executive procurement view of approved catering partners.",
    catalogue_heading: "Preferred catering partners",
    catalogue_subtitle: "One card per hotel, with category-level average pricing and direct menu access.",
    notice_text: "Prices shown are average prices per person based on the currently entered menu data.",
    footer_text: "GU-Q Finance Catering Catalogue",
    google_sheet_edit_url: "",
    primary_color: "#0C2A52",
    secondary_color: "#173D70",
    accent_color: "#E6C78C",
    comparison_limit: "4",
    default_sort: "name",
    show_shortlist: "TRUE",
    show_procurement_snapshot: "TRUE",
    show_category_shortcuts: "TRUE",
    currency_label: "QAR"
  };

  const CATEGORY_META = {
    "Coffee Break": { code: "CB", accent: "#B87545" },
    "Breakfast": { code: "BF", accent: "#C0964F" },
    "Buffet": { code: "BU", accent: "#3E6D78" },
    "Canapés": { code: "CA", accent: "#7B3E57" },
    "Canapes": { code: "CA", accent: "#7B3E57" },
    "Set Menu": { code: "SM", accent: "#6C5B49" },
    "Beverage": { code: "BV", accent: "#4F7467" },
    "Meeting Package": { code: "MP", accent: "#465F8C" },
    "Family Style": { code: "FS", accent: "#8A6A43" }
  };

  let DATA = { hotels: [], generated_at: "" };
  let SETTINGS = { ...DEFAULT_SETTINGS };
  let activeCategory = "";
  let shortlist = new Set(JSON.parse(localStorage.getItem("guqCateringShortlist") || "[]"));

  const $ = (id) => document.getElementById(id);
  const bool = (value, fallback = true) => {
    if (value === undefined || value === null || value === "") return fallback;
    return ["true", "1", "yes", "y"].includes(String(value).trim().toLowerCase());
  };
  const num = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const n = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };
  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  function safeUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    if (/^(https?:\/\/)/i.test(url)) return url;
    if (/^(assets\/|\.\/|\.\.\/)/i.test(url)) return url;
    return "";
  }

  function resolveImage(value) {
    const url = safeUrl(value);
    if (!url) return "";

    let match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (match) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1])}&sz=w1600`;

    match = url.match(/[?&]id=([^&]+)/i);
    if (url.includes("drive.google.com") && match) {
      return `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1])}&sz=w1600`;
    }
    return url;
  }

  function safeHex(value, fallback) {
    const v = String(value || "").trim();
    return /^#[0-9A-Fa-f]{6}$/.test(v) ? v : fallback;
  }

  function unique(values) {
    return [...new Set(values)].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
  }

  function activeValue(value) {
    if (value === undefined || value === null || value === "") return true;
    return bool(value, true);
  }

  function settingsFromPayload(payload) {
    return { ...DEFAULT_SETTINGS, ...(payload && payload.settings ? payload.settings : {}) };
  }

  function normalizePayload(payload) {
    const suppliers = Array.isArray(payload?.suppliers) ? payload.suppliers : [];
    const categories = Array.isArray(payload?.hotel_categories) ? payload.hotel_categories : [];
    const supplierMap = new Map();

    suppliers.forEach((s) => {
      const name = String(s.supplier || "").trim();
      if (!name || !activeValue(s.active)) return;
      supplierMap.set(name, {
        supplier: name,
        tier: String(s.tier || "").trim(),
        status: String(s.status || "").trim(),
        website_url: safeUrl(s.website_url),
        image_url: String(s.image_url || "").trim()
      });
    });

    const groups = new Map();

    categories.forEach((row) => {
      const supplier = String(row.supplier || "").trim();
      const category = String(row.category || "").trim();
      if (!supplier || !category || !activeValue(row.active)) return;

      // If Suppliers contains this supplier and it is inactive, do not surface it.
      if (suppliers.length && !supplierMap.has(supplier)) return;

      if (!groups.has(supplier)) {
        const s = supplierMap.get(supplier) || { supplier, tier: "", status: "", image_url: "", website_url: "" };
        groups.set(supplier, { ...s, categories: [] });
      }

      groups.get(supplier).categories.push({
        category,
        average_price_qar: num(row.average_price_qar),
        menu_url: safeUrl(row.menu_url),
        source_files: String(row.source_files || "")
          .split(" | ")
          .map((v) => v.trim())
          .filter(Boolean)
      });
    });

    const hotels = [...groups.values()]
      .map((h) => ({
        ...h,
        categories: h.categories.sort((a, b) => a.category.localeCompare(b.category))
      }))
      .sort((a, b) => a.supplier.localeCompare(b.supplier));

    return {
      hotels,
      generated_at: payload?.generated_at || ""
    };
  }

  function catalogueStats(hotels) {
    const prices = hotels
      .flatMap((h) => h.categories.map((c) => c.average_price_qar))
      .filter((p) => Number.isFinite(p));

    return {
      hotel_count: hotels.length,
      category_rows: hotels.reduce((sum, h) => sum + h.categories.length, 0),
      category_count: new Set(hotels.flatMap((h) => h.categories.map((c) => c.category))).size,
      lowest_price: prices.length ? Math.min(...prices) : null,
      average_price: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null
    };
  }

  function formatPrice(value) {
    return Number.isFinite(value) ? `${SETTINGS.currency_label} ${Math.round(value)}` : "Price on request";
  }

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function fetchJsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const callback = `__guqCateringCallback_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("JSONP timeout"));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        delete window[callback];
        script.remove();
      }

      window[callback] = (payload) => {
        cleanup();
        resolve(payload);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP request failed"));
      };

      const joiner = url.includes("?") ? "&" : "?";
      script.src = `${url}${joiner}callback=${encodeURIComponent(callback)}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }

  async function loadPayload() {
    const apiUrl = String(CONFIG.SHEET_API_URL || "").trim();
    const timeoutMs = Number(CONFIG.REQUEST_TIMEOUT_MS || 12000);

    if (!apiUrl || apiUrl.includes("PASTE_GOOGLE_APPS_SCRIPT")) {
      throw new Error("The Google Apps Script URL has not been configured in config.js.");
    }

    try {
      return await fetchJson(apiUrl, timeoutMs);
    } catch (fetchError) {
      // Apps Script can be served from a different origin. JSONP is the safe static-site fallback.
      try {
        return await fetchJsonp(apiUrl, timeoutMs);
      } catch (jsonpError) {
        throw new Error(`Google Sheet connection failed. ${fetchError.message}`);
      }
    }
  }


  function applySettings() {
    document.title = SETTINGS.site_name || DEFAULT_SETTINGS.site_name;

    $("brandName").textContent = SETTINGS.brand_name;
    $("departmentName").textContent = SETTINGS.department_name;
    $("heroEyebrow").textContent = SETTINGS.hero_eyebrow;
    $("heroTitle").textContent = SETTINGS.hero_title;
    $("heroDescription").textContent = SETTINGS.hero_description;
    $("catalogueHeading").textContent = SETTINGS.catalogue_heading;
    $("catalogueSubtitle").textContent = SETTINGS.catalogue_subtitle;
    $("noticeText").textContent = SETTINGS.notice_text;
    $("footerText").textContent = SETTINGS.footer_text;

    document.documentElement.style.setProperty("--gt-navy", safeHex(SETTINGS.primary_color, "#0C2A52"));
    document.documentElement.style.setProperty("--gt-navy-2", safeHex(SETTINGS.secondary_color, "#173D70"));
    document.documentElement.style.setProperty("--warm", safeHex(SETTINGS.accent_color, "#E6C78C"));

    $("shortlistTop").hidden = !bool(SETTINGS.show_shortlist, true);
    $("snapshotWrap").querySelector(".snapshot").hidden = !bool(SETTINGS.show_procurement_snapshot, true);
    $("categoryCommand").hidden = !bool(SETTINGS.show_category_shortcuts, true);

    if (["name", "low", "high", "count"].includes(String(SETTINGS.default_sort))) {
      $("sortFilter").value = SETTINGS.default_sort;
    }

    // Update price-filter labels with the chosen currency.
    [...$("priceFilter").options].forEach((opt) => {
      if (opt.value) opt.textContent = `≤ ${SETTINGS.currency_label} ${opt.value}`;
    });
  }

  function connectionAlert(message, type = "warning") {
    const wrap = $("connectionAlert");
    wrap.hidden = false;
    wrap.className = `shell connection-alert ${type === "error" ? "error" : ""}`;
    wrap.innerHTML = `<div><strong>${type === "error" ? "Catalogue data is unavailable." : "Preview data is being shown."}</strong>${escapeHtml(message)}</div>`;
  }

  function clearConnectionAlert() {
    $("connectionAlert").hidden = true;
    $("connectionAlert").innerHTML = "";
  }

  function buildMosaic() {
    const picks = DATA.hotels.slice(0, 3);
    $("heroMosaic").innerHTML = picks
      .map((h) => {
        const image = resolveImage(h.image_url);
        return `
          <div class="mosaic-card">
            ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(h.supplier)}" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'"><div class="image-placeholder" style="display:none"><div><b>${escapeHtml(h.supplier)}</b><span>Check Suppliers → image_url</span></div></div>` : `<div class="image-placeholder"><div><b>${escapeHtml(h.supplier)}</b><span>Add Suppliers → image_url</span></div></div>`}
            <div class="mosaic-label">
              <b>${escapeHtml(h.supplier)}</b>
              <span>${h.categories.length} catering categories</span>
            </div>
          </div>`;
      })
      .join("");
  }

  function categorySummary() {
    const map = new Map();
    DATA.hotels.forEach((h) => {
      h.categories.forEach((c) => {
        if (!map.has(c.category)) map.set(c.category, new Set());
        map.get(c.category).add(h.supplier);
      });
    });
    return [...map.entries()]
      .map(([name, hotels]) => ({ name, count: hotels.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function buildCategoryButtons() {
    const cats = categorySummary();
    $("categoryButtons").innerHTML =
      `<button class="cat-filter ${activeCategory ? "" : "active"}" data-cat="">All categories</button>` +
      cats
        .map(
          (c) =>
            `<button class="cat-filter ${activeCategory === c.name ? "active" : ""}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)} · ${c.count}</button>`
        )
        .join("");

    document.querySelectorAll(".cat-filter").forEach((button) => {
      button.addEventListener("click", () => {
        activeCategory = button.dataset.cat || "";
        buildCategoryButtons();
        render();
      });
    });
  }

  function fillSelect(id, values, firstLabel) {
    $(id).innerHTML =
      `<option value="">${escapeHtml(firstLabel)}</option>` +
      values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  }

  function initFilters() {
    fillSelect("hotelFilter", unique(DATA.hotels.map((h) => h.supplier)), "All hotels");
    fillSelect("tierFilter", unique(DATA.hotels.map((h) => h.tier)), "All tiers");
  }

  function getSearchText() {
    return String($("search").value || $("globalSearch").value || "").trim().toLowerCase();
  }

  function filteredHotels() {
    const q = getSearchText();
    const hotel = $("hotelFilter").value;
    const tier = $("tierFilter").value;
    const cap = num($("priceFilter").value);
    const sort = $("sortFilter").value;

    let hotels = DATA.hotels
      .map((h) => {
        const categories = h.categories.filter((c) => {
          if (activeCategory && c.category !== activeCategory) return false;
          if (Number.isFinite(cap) && Number.isFinite(c.average_price_qar) && c.average_price_qar > cap) return false;
          if (Number.isFinite(cap) && !Number.isFinite(c.average_price_qar)) return false;
          if (q && !(h.supplier.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))) return false;
          return true;
        });
        return { ...h, categories };
      })
      .filter((h) => (!hotel || h.supplier === hotel) && (!tier || h.tier === tier) && h.categories.length);

    hotels = hotels.map((h) => {
      const prices = h.categories.map((c) => c.average_price_qar).filter((p) => Number.isFinite(p));
      return {
        ...h,
        low: prices.length ? Math.min(...prices) : null,
        high: prices.length ? Math.max(...prices) : null
      };
    });

    if (sort === "low") {
      hotels.sort((a, b) => (a.low ?? Infinity) - (b.low ?? Infinity) || a.supplier.localeCompare(b.supplier));
    } else if (sort === "high") {
      hotels.sort((a, b) => (b.high ?? -Infinity) - (a.high ?? -Infinity) || a.supplier.localeCompare(b.supplier));
    } else if (sort === "count") {
      hotels.sort((a, b) => b.categories.length - a.categories.length || a.supplier.localeCompare(b.supplier));
    } else {
      hotels.sort((a, b) => a.supplier.localeCompare(b.supplier));
    }
    return hotels;
  }

  function categoryMeta(category) {
    if (CATEGORY_META[category]) return CATEGORY_META[category];
    const code = category
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "MN";
    return { code, accent: "#526987" };
  }

  function shortlistEnabled() {
    return bool(SETTINGS.show_shortlist, true);
  }

  function render() {
    const hotels = filteredHotels();
    const currentStats = catalogueStats(hotels);

    $("resultBadge").textContent = `${hotels.length} hotel${hotels.length === 1 ? "" : "s"} · ${currentStats.category_rows} options`;

    const grid = $("grid");
    if (!hotels.length) {
      grid.innerHTML = `<div class="empty">No catering partners match the current filters.</div>`;
      return;
    }

    grid.innerHTML = hotels
      .map((h) => {
        const image = resolveImage(h.image_url);
        const firstMenu = h.categories.find((c) => c.menu_url)?.menu_url || "";
        const isShort = shortlist.has(h.supplier);
        const shortlistButton = shortlistEnabled()
          ? `<button class="shortlist ${isShort ? "active" : ""}" data-shortlist="${escapeHtml(h.supplier)}" title="Shortlist hotel">${isShort ? "★" : "☆"}</button>`
          : "";

        const rows = h.categories
          .map((c) => {
            const meta = categoryMeta(c.category);
            const menu = safeUrl(c.menu_url);
            const rowTag = menu ? "a" : "div";
            const linkAttrs = menu ? `href="${escapeHtml(menu)}" target="_blank" rel="noopener noreferrer"` : "";
            return `
              <${rowTag} class="menu-row" ${linkAttrs}>
                <div class="menu-code" style="background:${escapeHtml(meta.accent)}">${escapeHtml(meta.code)}</div>
                <div class="menu-name">${escapeHtml(c.category)}<small>Average quoted price / person</small></div>
                <div class="menu-price">
                  <strong>${escapeHtml(formatPrice(c.average_price_qar))}</strong>
                  <span>${menu ? "MENU ↗" : "LINK NEEDED"}</span>
                </div>
              </${rowTag}>`;
          })
          .join("");

        return `
          <article class="card">
            <div class="card-image">
              ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(h.supplier)}" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'"><div class="image-placeholder" style="display:none"><div><b>${escapeHtml(h.supplier)}</b><span>Check Suppliers → image_url</span></div></div>` : `<div class="image-placeholder"><div><b>${escapeHtml(h.supplier)}</b><span>Add Suppliers → image_url</span></div></div>`}
              <div class="tier">${escapeHtml(h.tier || "Partner")}</div>
              ${shortlistButton}
              <div class="card-title-wrap">
                <h3>${escapeHtml(h.supplier)}</h3>
                <p>${escapeHtml(h.status || "Approved catering partner")}</p>
              </div>
            </div>
            <div class="card-body">
              <div class="card-summary">
                <div class="from"><span>Lowest visible average</span><strong>${escapeHtml(formatPrice(h.low))}</strong></div>
                <div class="count">${h.categories.length} categor${h.categories.length === 1 ? "y" : "ies"}</div>
              </div>
              <div class="menu-list">${rows}</div>
              <div class="card-foot">
                ${
                  firstMenu
                    ? `<a class="primary-action" href="${escapeHtml(firstMenu)}" target="_blank" rel="noopener noreferrer">Open menu</a>`
                    : `<span class="primary-action" style="opacity:.55">Menu link needed</span>`
                }
                ${
                  shortlistEnabled()
                    ? `<button class="secondary-action" data-shortlist="${escapeHtml(h.supplier)}">${isShort ? "Remove shortlist" : "Shortlist"}</button>`
                    : h.website_url
                      ? `<a class="secondary-action" href="${escapeHtml(h.website_url)}" target="_blank" rel="noopener noreferrer">Hotel website</a>`
                      : ""
                }
              </div>
            </div>
          </article>`;
      })
      .join("");

    document.querySelectorAll("[data-shortlist]").forEach((button) => {
      button.addEventListener("click", () => toggleShortlist(button.dataset.shortlist));
    });
  }

  function persistShortlist() {
    localStorage.setItem("guqCateringShortlist", JSON.stringify([...shortlist]));
  }

  function toggleShortlist(name) {
    if (!shortlistEnabled()) return;

    if (shortlist.has(name)) {
      shortlist.delete(name);
    } else {
      const limit = Math.max(1, Number(SETTINGS.comparison_limit || 4));
      if (shortlist.size >= limit) {
        alert(`Shortlist up to ${limit} hotels for a clean comparison.`);
        return;
      }
      shortlist.add(name);
    }
    persistShortlist();
    updateShortlist();
    render();
  }

  function updateShortlist() {
    const validNames = new Set(DATA.hotels.map((h) => h.supplier));
    shortlist = new Set([...shortlist].filter((name) => validNames.has(name)));
    persistShortlist();

    $("shortlistCount").textContent = shortlist.size;
    $("snapShort").textContent = shortlist.size;

    const show = shortlistEnabled() && shortlist.size > 0;
    $("dock").classList.toggle("show", show);
    $("dockItems").innerHTML = [...shortlist].map((name) => `<span class="dock-pill">${escapeHtml(name)}</span>`).join("");
  }

  function showCompare() {
    const selected = DATA.hotels.filter((h) => shortlist.has(h.supplier));
    if (!selected.length) return;

    const cats = unique(selected.flatMap((h) => h.categories.map((c) => c.category)));
    let html = `<table class="compare-table"><thead><tr><th>Category</th>${selected
      .map((h) => `<th class="hotel-col">${escapeHtml(h.supplier)}</th>`)
      .join("")}</tr></thead><tbody>`;

    cats.forEach((cat) => {
      html += `<tr><th>${escapeHtml(cat)}</th>${selected
        .map((h) => {
          const c = h.categories.find((item) => item.category === cat);
          if (!c) return "<td>—</td>";
          const menu = safeUrl(c.menu_url);
          return `<td><b>${escapeHtml(formatPrice(c.average_price_qar))}</b><br>${
            menu ? `<a href="${escapeHtml(menu)}" target="_blank" rel="noopener noreferrer">Open menu ↗</a>` : "No menu link"
          }</td>`;
        })
        .join("")}</tr>`;
    });
    html += "</tbody></table>";

    $("compareWrap").innerHTML = html;
    $("compareModal").classList.add("show");
  }

  function updateTopStats() {
    const all = catalogueStats(DATA.hotels);
    $("heroHotels").textContent = all.hotel_count;
    $("heroCategories").textContent = all.category_count;
    $("heroLow").textContent = formatPrice(all.lowest_price);
    $("snapRows").textContent = all.category_rows;
    $("snapAvg").textContent = formatPrice(all.average_price);
  }

  function buildAll() {
    applySettings();
    updateTopStats();
    buildMosaic();
    buildCategoryButtons();
    initFilters();
    updateShortlist();
    render();
  }

  function syncSearch(value) {
    $("search").value = value;
    $("globalSearch").value = value;
    render();
  }

  function setSourceStatus(source, generatedAt = "") {
    if (source === "sheet") {
      $("syncText").textContent = generatedAt ? `Live Sheet · ${new Date(generatedAt).toLocaleString()}` : "Live Google Sheet";
      $("syncDot").style.background = "#67c08c";
      $("snapSync").textContent = "Live";
    }
  }

  async function refreshCatalogue() {
    $("grid").innerHTML = `<div class="loading">Loading Google Sheet catalogue…</div>`;
    clearConnectionAlert();

    try {
      const payload = await loadPayload();
      SETTINGS = settingsFromPayload(payload);
      DATA = normalizePayload(payload);

      if (!DATA.hotels.length) {
        throw new Error("The Sheet connected successfully, but no active hotel/category rows were returned.");
      }

      setSourceStatus("sheet", DATA.generated_at);
      buildAll();
    } catch (error) {
      connectionAlert(
        `${error.message} Configure config.js and the Apps Script deployment before using the production catalogue. Hotel photos and menu attachments are intentionally not stored as fallback files in GitHub.`,
        "error"
      );
      $("syncText").textContent = "Sheet not connected";
      $("snapSync").textContent = "Offline";
      $("grid").innerHTML = `<div class="empty">Connect the Google Sheet to load hotel images, catering prices and menu attachments.</div>`;
    }
  }

  $("globalSearch").addEventListener("input", (e) => syncSearch(e.target.value));
  $("search").addEventListener("input", (e) => syncSearch(e.target.value));
  ["hotelFilter", "tierFilter", "priceFilter", "sortFilter"].forEach((id) => $(id).addEventListener("change", render));

  $("refreshBtn").addEventListener("click", refreshCatalogue);
  $("sheetBtn").addEventListener("click", () => {
    const url = safeUrl(SETTINGS.google_sheet_edit_url);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else alert("Add the Google Sheet editing URL in Site Settings → google_sheet_edit_url.");
  });

  $("shortlistTop").addEventListener("click", () => {
    if (shortlist.size) showCompare();
    else alert("Use the ☆ button on hotel cards to build a shortlist.");
  });
  $("dockCompare").addEventListener("click", showCompare);
  $("dockClear").addEventListener("click", () => {
    shortlist.clear();
    persistShortlist();
    updateShortlist();
    render();
  });

  $("compareClose").addEventListener("click", () => $("compareModal").classList.remove("show"));
  $("compareModal").addEventListener("click", (e) => {
    if (e.target.id === "compareModal") e.currentTarget.classList.remove("show");
  });

  refreshCatalogue();
})();
