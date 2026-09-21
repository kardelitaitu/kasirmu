// kasir.mu Admin — pure helper module (H1/H2 hardening).
//
// Extracted from the monolithic admin.js so the chart/format/escape logic
// is unit-testable in isolation (vitest, jsdom). Loaded as a plain script
// BEFORE admin.js; defines window.AdminUtils AND individual globals for
// backward compatibility with admin.js call sites.
//
// In Node (vitest): module.exports for direct import.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(); // Node/vitest
  } else {
    var utils = factory();      // browser
    root.AdminUtils = utils;
    // Also set individual globals so admin.js (which calls bare function
    // names like el(), escapeHtml()) works without changes.
    Object.keys(utils).forEach(function (k) { root[k] = utils[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Create a DOM element safely (never innerHTML with API data).
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Escape HTML entities for any API-sourced string interpolated into
  // innerHTML (defense-in-depth — donut legend labels, chart text).
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function fmtIdr(val) { return 'Rp ' + Math.round(val).toLocaleString('id-ID'); }
  function fmtUsd(val) { return '$' + Number(val).toFixed(2); }

  // fmtMonthTick returns the x-axis month tick label for a "YYYY-MM"
  // bucket string. When the year differs from prevYear (or prevYear is
  // empty — the first emitted tick), the label carries a year suffix so
  // a Dec→Jan boundary is unambiguous (e.g. "12" then "01/26"). Pure:
  // no state; the caller tracks the last emitted year.
  function fmtMonthTick(monthStr, prevYear) {
    if (!monthStr) return { label: '', year: prevYear };
    var mm = String(monthStr).slice(5);
    var yyyy = String(monthStr).slice(0, 4);
    if (yyyy && yyyy !== prevYear) {
      return { label: mm + '/' + yyyy.slice(2), year: yyyy };
    }
    return { label: mm, year: prevYear };
  }

  // statusLabel maps the server's status enum to a human label (B16).
  // Unknown values fall back to the raw string — never to a missing-key
  // placeholder, so a new server-side status still shows something real.
  function statusLabel(status) {
    if (status === undefined || status === null || status === '') return '—';
    var key = 'status.' + status;
    return STRINGS[key] !== undefined ? STRINGS[key] : status;
  }

  function statusPill(status) {
    var map = { active: ['pill-ok'], unused: ['pill-muted'], grace_period: ['pill-warn'], expired: ['pill-bad'], revoked: ['pill-bad'], paused: ['pill-warn'], free: ['pill-muted'], plus: ['pill-ok'], pro: ['pill-warn'], premium: ['pill-ok'], enterprise: ['pill-ok'] };
    var cls = (map[status] || ['pill-muted'])[0];
    return el('span', 'pill ' + cls, statusLabel(status));
  }

  // createSeqGuard tracks the newest of N overlapping async requests so
  // superseded responses can be discarded (B15: renderTenants let a slow
  // page-2 response overwrite page 3 — last-arrival-wins, not
  // last-click-wins). next() stamps a request; isCurrent(id) is true only
  // for the most recent stamp.
  function createSeqGuard() {
    var n = 0;
    return {
      next: function () { n += 1; return n; },
      isCurrent: function (id) { return id === n; },
    };
  }

  // svgChart renders a multi-series line chart as an SVG string. Pure:
  // takes _id (unused, kept for signature compatibility with call sites
  // that pass a chart id), data + series + opts and returns an SVG string.
  function svgChart(_id, data, series, opts) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return '<div class="chart-empty">No data</div>';
    }
    // B36 (fuzz-found): normalizeStats guarantees the ARRAY but not its
    // ELEMENTS — a truncated/hostile payload with null rows crashed the
    // whole render (Cannot read properties of null). Drop non-object rows.
    data = data.filter(function (d) { return d && typeof d === 'object'; });
    if (data.length === 0) {
      return '<div class="chart-empty">No data</div>';
    }
    var vals = data.map(function (d) { return series.map(function (s) { return Number(d[s]); }); }).flat().filter(function (n) { return Number.isFinite(n); });
    if (vals.length === 0) {
      return '<div class="chart-empty">No data</div>';
    }
    // Canvas: narrow (default) keeps the historical 600×180 geometry.
    // opts.wide selects a 1280-wide canvas for full-row cards — a 600-unit
    // viewBox stretched across a ~1300px card upscaled every glyph ~2.2×
    // (10px labels rendered ~22px, "too zoomed in"). At 1280 the rendered
    // scale is ~1.0, so viewBox font sizes are the rendered sizes.
    var wide = !!(opts && opts.wide);
    // opts.phone: a ~350-unit canvas rendered ~1:1 on a phone card, so
    // viewBox font sizes are true rendered sizes (no downscaling).
    var phone = !wide && !!(opts && opts.phone);
    var w = wide ? 1280 : (phone ? 350 : 600);
    var h = wide ? 230 : (phone ? 230 : 200);
    // Y-axis gutter: wide leaves room for the "Rp999.9jt" style labels
    // (~58px at 13px font); narrow/phone only draw short integer counts.
    var px = wide ? 72 : (phone ? 52 : 40);
    var py = wide ? 24 : 20;
    // Wide adds right padding so the last point's centered label stays
    // inside the viewBox; narrow keeps its exact legacy geometry.
    var pw = wide ? w - px - 24 : (phone ? w - px - 8 : w - px);
    var ph = wide ? h - py - 40 : (phone ? h - py - 30 : h - py - 30);
    var max = Math.max.apply(null, vals);
    var min = 0;
    var rng = max - min || 1;
    var x = function (i) { return px + (i / (data.length - 1 || 1)) * pw; };
    var y = function (v) { return py + ph - ((v - min) / rng) * ph; };
    // Design-language semantic tokens — the chart re-themes with the page.
    var colors = { usd: 'var(--primary)', idr: 'var(--success)', count: 'var(--primary)', mrr: 'var(--primary)' };
    // Horizontal gridlines at each y-label (hairline borders, not fills).
    // non-scaling-stroke keeps the hairline 1 CSS px at any canvas scale.
    var grid = '';
    for (var gi = 0; gi <= 4; gi++) {
      var gv = min + (rng / 4) * gi;
      grid += '<line x1="' + px + '" y1="' + y(gv) + '" x2="' + w + '" y2="' + y(gv) + '" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    }
    var paths = '', fills = '';
    // sourceKey in opts splits the path into segments by consecutive
    // source values — estimate months use a dashed line and no area fill,
    // so the operator can see which months are real vs projected.
    var sourceKey = opts && opts.sourceKey;
    series.forEach(function (s) {
      if (sourceKey) {
        // Build segments of consecutive source values.
        var segments = [];
        var cur = null;
        data.forEach(function (d, i) {
          var src = String(d[sourceKey] || 'estimate');
          var val = Number(d[s]) || 0;
          var pt = x(i) + ',' + y(val);
          if (cur && cur.source === src) {
            cur.pts.push(pt);
          } else {
            if (cur) segments.push(cur);
            cur = { source: src, pts: [pt] };
          }
        });
        if (cur) segments.push(cur);
        segments.forEach(function (seg) {
          var isEst = seg.source === 'estimate';
          var d = 'M ' + seg.pts.join(' L ');
          paths += '<path d="' + d + '" stroke="' + (colors[s] || 'var(--primary)') + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" class="chart-line" vector-effect="non-scaling-stroke"' + (isEst ? ' stroke-dasharray="5 4"' : '') + '/>';
          if (opts && opts.area && !isEst) {
            // Points are "x,y" strings — parseFloat yields the x coordinate
            // (avoids a literal split(',') which the i18n audit regex would
            // misread as a t(',') call).
            var firstX = parseFloat(seg.pts[0]);
            var lastX = parseFloat(seg.pts[seg.pts.length - 1]);
            fills += '<path d="M ' + firstX + ',' + (py + ph) + ' L ' + seg.pts.join(' L ') + ' L ' + lastX + ',' + (py + ph) + ' Z" fill="' + (colors[s] || 'var(--primary)') + '" opacity=".1"/>';
          }
        });
      } else {
        var pts = data.map(function (d, i) { return x(i) + ',' + y(Number(d[s]) || 0); }).join(' L ');
        paths += '<path d="M ' + pts + '" stroke="' + (colors[s] || 'var(--primary)') + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" class="chart-line" vector-effect="non-scaling-stroke"/>';
        if (opts && opts.area) {
          // B42: the area path was missing its leading "M" — an invalid
          // d= meant the browser dropped the whole element, so the 10%
          // area shading under the line silently never rendered.
          var base = 'M ' + x(0) + ',' + (py + ph) + ' L ' + pts + ' L ' + x(data.length - 1) + ',' + (py + ph) + ' Z';
          fills += '<path d="' + base + '" fill="' + (colors[s] || 'var(--primary)') + '" opacity=".1"/>';
        }
      }
    });
    var yLabels = '';
    for (var i = 0; i <= 4; i++) {
      var v = min + (rng / 4) * i;
      var fs = wide ? 13 : (phone ? 11 : 12);
      yLabels += '<text x="' + (px - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" fill="var(--muted)" font-size="' + fs + '">' + (opts && opts.fmt ? opts.fmt(v) : Math.round(v)) + '</text>';
    }
    var xLabels = '';
    // Wide canvas fits a label under every point; narrow keeps the
    // every-other-point legacy density; phone uses every third point
    // so labels never collide at true size.
    var step = wide ? 1 : (phone ? 3 : 2);
    var lastYear = '';
    data.forEach(function (d, i) {
      if (i % step === 0 || i === data.length - 1) {
        // B5 fix: the M1 guard protected values but not labels — a row
        // without month threw on .slice and killed the whole dashboard.
        // fmtMonthTick adds a year suffix at Dec→Jan boundaries (e.g.
        // "12" then "01/26") so the same month in two years is legible.
        var tick = fmtMonthTick(d.month, lastYear);
        lastYear = tick.year;
        xLabels += '<text x="' + x(i) + '" y="' + (py + ph + 18) + '" text-anchor="middle" fill="var(--muted)" font-size="' + (wide ? 12 : (phone ? 10 : 11)) + '">' + escapeHtml(tick.label) + '</text>';
      }
    });
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="chart-svg">' + grid + fills + paths + yLabels + xLabels + '</svg>';
  }

  // svgDonut renders a donut chart + legend. Pure; guards empty/zero data.
  // _id is unused (kept for signature compatibility).
  function svgDonut(_id, data, labelKey, valueKey, colors) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return { svg: '<div class="chart-empty">No data</div>', legend: '' };
    }
    // B36 (fuzz-found): null rows crashed the reduce — drop non-objects.
    data = data.filter(function (d) { return d && typeof d === 'object'; });
    if (data.length === 0) {
      return { svg: '<div class="chart-empty">No data</div>', legend: '' };
    }
    var total = data.reduce(function (s, d) { return s + (Number(d[valueKey]) || 0); }, 0);
    if (total <= 0) {
      return { svg: '<div class="chart-empty">No data</div>', legend: '' };
    }
    var acc = 0;
    var slices = '';
    var cx = 80, cy = 80, r = 60;
    // Brand palette in the design-language order (blue → green → orange →
    // sky → pink → yellow); tokens so dark mode keeps the same hues.
    var colorList = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--info)', 'var(--pink)', 'var(--yellow)'];
    data.forEach(function (d, i) {
      var pct = (Number(d[valueKey]) || 0) / total;
      var ang = pct * 360;
      var start = (acc / 360) * 2 * Math.PI - Math.PI / 2;
      var end = ((acc + ang) / 360) * 2 * Math.PI - Math.PI / 2;
      var x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
      var x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
      var large = ang > 180 ? 1 : 0;
      var c = colors && colors[i] ? colors[i] : colorList[i % colorList.length];
      if (ang >= 360) {
        // B4 fix: a single arc with start == end point draws NOTHING per
        // the SVG spec — a 100% slice (all tenants on one tier, the common
        // early state) rendered as an empty ring while the legend claimed
        // 100%. A full circle needs two arcs; split at the halfway angle.
        var mid = start + Math.PI;
        var xm = cx + r * Math.cos(mid), ym = cy + r * Math.sin(mid);
        slices += '<path d="M ' + cx + ' ' + cy + ' L ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 0 1 ' + xm + ' ' + ym + ' A ' + r + ' ' + r + ' 0 0 1 ' + x1 + ' ' + y1 + ' Z" fill="' + c + '" stroke="var(--bg-surface)" stroke-width="2"/>';
      } else {
        slices += '<path d="M ' + cx + ' ' + cy + ' L ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 + ' Z" fill="' + c + '" stroke="var(--bg-surface)" stroke-width="2"/>';
      }
      acc += ang;
    });
    var legend = '';
    data.forEach(function (d, i) {
      var pct = (Number(d[valueKey]) || 0) / total;
      var c = colors && colors[i] ? colors[i] : colorList[i % colorList.length];
      legend += '<div class="donut-legend-item"><span class="donut-swatch" style="background:' + c + '"></span><span class="donut-label">' + escapeHtml(d[labelKey]) + '</span> <span class="donut-pct">' + Math.round(pct * 100) + '%</span></div>';
    });
    // Pie geometry + a surface-colored center disc = donut ring. The disc
    // is a <circle>, not an arc, so the per-slice arc contract holds.
    // The center carries the total count so the hole is not dead space.
    return {
      svg: '<svg viewBox="0 0 160 160">' + slices +
        '<circle cx="' + cx + '" cy="' + cy + '" r="34" fill="var(--bg-surface)"/>' +
        '<text x="' + cx + '" y="' + (cy + 2) + '" text-anchor="middle" dominant-baseline="central" fill="var(--text)" font-size="17" font-weight="700">' + Math.round(total).toLocaleString('en-US') + '</text>' +
        '</svg>',
      legend: legend,
    };
  }

  // kpiC builds a KPI stat card (label + value + optional sub + icon).
  // Pure DOM helper — unit-testable in jsdom.
  function kpiC(label, value, sub, icon, iconCls) {
    var s = el('div', 'kpi');
    if (icon) {
      var ic = el('div', 'kpi-icon ' + (iconCls || 'kpi-icon-blue'));
      ic.innerHTML = icon;
      s.appendChild(ic);
    }
    var body = el('div', 'kpi-body');
    body.appendChild(el('div', 'kpi-label', label));
    body.appendChild(el('div', 'kpi-value', value));
    if (sub) body.appendChild(el('div', 'kpi-sub', sub));
    s.appendChild(body);
    return s;
  }

  // statC builds a stat card ("one number, one semantic accent, one
  // label"). Cards are neutral surfaces (white + hairline border); the
  // semantic colour is reserved for the sub-line/delta so a full row of
  // coloured fills never competes with the hero. variant:
  // primary|success|warning|danger|info; unknown variants fall back to
  // primary so a typo can never render an unstyled card.
  function statC(label, value, sub, variant) {
    var v = ['primary', 'success', 'warning', 'danger', 'info'].indexOf(variant) !== -1 ? variant : 'primary';
    var card = el('div', 'stat stat--' + v);
    card.appendChild(el('div', 'stat-label', label));
    card.appendChild(el('div', 'stat-value', value));
    if (sub) card.appendChild(el('div', 'stat-sub', sub));
    return card;
  }

  // tableCard builds a card with a header + data table (or an empty state).
  // rows is an array of arrays of cell strings.
  function tableCard(heading, headers, rows) {
    var card = el('div', 'card table-card');
    card.appendChild(el('h2', null, heading));
    // B41 (B36 class): normalizeStats guarantees the ARRAY but not its
    // ELEMENTS, and a truncated payload can hand this a non-array rows or
    // headers — row.forEach then threw and took the whole view down.
    // Validate the containers and skip malformed rows.
    if (!Array.isArray(rows) || rows.length === 0) { card.appendChild(el('p', 'empty', t('table.noData'))); return card; }
    var table = el('table');
    var thead = el('thead');
    var tr = el('tr');
    if (Array.isArray(headers)) {
      headers.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    }
    thead.appendChild(tr); table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (row) {
      if (!Array.isArray(row)) return; // malformed row — skip, don't crash
      var tr2 = el('tr');
      row.forEach(function (cell) { tr2.appendChild(el('td', null, cell)); });
      tbody.appendChild(tr2);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    return card;
  }

  // ── API helper (H1) ─────────────────────────────────────────────
  // Pure classification + error-builder for the admin API layer. The DOM
  // side (rendering the access-denied screen) stays in admin.js; these are
  // unit-testable without a fetch/document.

  // tenantRow builds one <tr> for the tenants table (email, status pill,
  // license key, tier, created date, Details button). Extracted from
  // admin.js renderTenants so the row logic is unit-testable.
  // INVARIANT: the parameter must NEVER be named `t` — it would shadow the
  // i18n t() helper (the B1 bug: the i18n refactor left `t('tenant.details')`
  // calling a tenant object, crashing the whole Tenants tab).
  function tenantRow(tenant, onDetails) {
    var row = el('tr');
    row.appendChild(el('td', null, tenant.email || '—'));
    var td1 = el('td'); td1.appendChild(statusPill(tenant.status)); row.appendChild(td1);
    // Merged license/tier cell — "[tier] date expired" (user-requested
    // format). Tier prefers the billing subscription; expiry falls back
    // license → subscription. The raw license key column was dropped;
    // the key survives as the hover title so support can still see it.
    var lic = tenant.license || {}, sub = tenant.subscription || {};
    var tier = sub.tierKey || lic.tierKey || '';
    var exp = sub.expiresAt || lic.expiresAt || '';
    var combo = (tier ? '[' + tier + '] ' : '') + (exp ? String(exp).slice(0, 10) : '—');
    var td2 = el('td', null, combo || '—');
    if (combo && lic.key) { td2.title = combo + ' · ' + lic.key; }
    row.appendChild(td2);
    // B37 (fuzz-found): a non-string truthy created (number/object from a
    // truncated payload) crashed .slice and killed the whole table render.
    row.appendChild(el('td', null, tenant.created ? String(tenant.created).slice(0, 10) : '—'));
    var tdAction = el('td');
    var btn = el('button', 'btn btn-sm btn-ghost', t('tenant.details'));
    btn.addEventListener('click', function () { onDetails(tenant.id); });
    tdAction.appendChild(btn); row.appendChild(tdAction);
    return row;
  }

  // tenantDetailRows builds the [label, value] pairs for the tenant
  // detail modal's key/value grid (extracted from admin.js
  // showTenantDetail so the data mapping is unit-testable).
  function tenantDetailRows(data) {
    var tenant = data.tenant || {}, lic = data.license || {}, sub = data.subscription || {};
    var devices = Array.isArray(data.devices) ? data.devices : []; // B37 class
    var rows = [
      [t('th.status'), statusLabel(tenant.status)],
      [t('th.emailVerified'), tenant.emailVerified ? '✓' : '○'],
      [t('tenant.phone'), tenant.phone || '—'],
      [t('th.created'), tenant.created ? String(tenant.created).slice(0, 10) : '—'],
      [t('th.licenseKey'), lic.key || '—'],
      [t('th.tier'), sub.tierKey || lic.tierKey || '—'],
      [t('th.subscriptionStatus'), statusLabel(sub.status)],
      [t('th.expires'), sub.expiresAt || '—'],
      // Grace is a conditional hardship state — show the row only when
      // the tenant is actually in one (avoids a meaningless '—' row for
      // the 95% of tenants not in grace).
      sub.graceUntil ? [t('tenant.graceUntil'), sub.graceUntil] : null,
      [t('th.devices'), devices.length],
    ];
    return rows.filter(function (r) { return r; });
  }

  // revokeConfirmModal builds the confirm-by-email dialog for destructive
  // tenant actions (previously one click — no guard at all). The confirm
  // button stays disabled until the typed email matches the tenant's
  // address (trimmed, case-insensitive); a live mismatch hint appears when
  // text is present. Returns { box, cancelBtn } — the caller mounts it and
  // wires cancel to its closeModal.
  // opts (Phase 4) reuses the same gate for "delete tenant": title, hint,
  // confirmLabel and an extraWarn paragraph (cascade consequences).
  function revokeConfirmModal(email, onConfirm, opts) {
    opts = opts || {};
    var box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.appendChild(el('h3', null, opts.title || t('tenant.revokeTitle')));
    var p = el('p', 'small');
    p.style.marginBottom = '.6rem';
    p.textContent = (opts.hint || t('tenant.revokeHint')) + (email || '—');
    box.appendChild(p);
    if (opts.extraWarn) {
      var warn = el('p', 'small', opts.extraWarn);
      warn.style.cssText = 'color:var(--danger);margin:0 0 .6rem';
      box.appendChild(warn);
    }
    var input = el('input', 'input');
    input.placeholder = t('tenant.revokePlaceholder');
    input.autocomplete = 'off';
    input.spellcheck = false;
    box.appendChild(input);
    var err = el('p', 'small', t('tenant.revokeMismatch'));
    err.style.cssText = 'color:var(--danger);margin:.4rem 0 0;display:none';
    box.appendChild(err);
    var act = el('div', 'modal-actions');
    var cancelBtn = el('button', 'btn btn-ghost', t('tenant.cancel'));
    act.appendChild(cancelBtn);
    var confirmBtn = el('button', 'btn btn-bad', opts.confirmLabel || t('tenant.revoke'));
    confirmBtn.disabled = true;
    var matches = function () { return input.value.trim().toLowerCase() === String(email || '').trim().toLowerCase(); };
    input.addEventListener('input', function () {
      confirmBtn.disabled = !matches();
      err.style.display = input.value.trim() === '' || matches() ? 'none' : 'block';
    });
    act.appendChild(confirmBtn);
    box.appendChild(act);
    // busyWrap (B19): one confirm click fires exactly one action POST.
    confirmBtn.addEventListener('click', busyWrap(confirmBtn, function () {
      if (matches()) onConfirm();
    }));
    return { box: box, cancelBtn: cancelBtn };
  }

  // svgBarChart renders a simple bar chart as an SVG string (extracted
  // from the signups/churn blocks in admin.js renderDashboard).
  // B3 fix: the value field is opts.valueKey (default 'count') — the
  // server's churnPerMonth rows carry the number in `churn` with `count`
  // at Go's zero value, so a hardcoded d.count rendered permanently-zero
  // (NaN-height) churn bars. Empty data gets the chart-empty state
  // instead of Math.max()=-Infinity / 420/0=Infinity geometry, and a
  // missing month degrades to '' instead of throwing.
  function svgBarChart(_id, data, opts) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return '<div class="chart-empty">No data</div>';
    }
    // B36 (fuzz-found): null rows crashed the value map — drop non-objects
    // (an all-filtered set falls to the existing maxS>0 empty guard).
    data = data.filter(function (d) { return d && typeof d === 'object'; });
    var valueKey = (opts && opts.valueKey) || 'count';
    // Canvas: narrow uses a 620-unit canvas (matches the half-column card
    // width at desktop widths → ~1:1 scale); opts.wide selects a 1280-wide
    // canvas for full-row cards so text isn't upscaled ~2.2× when the
    // SVG stretches across the row (same "too zoomed in" defect as the
    // line chart).
    var wide = !!(opts && opts.wide);
    // opts.phone: ~350-unit canvas rendered ~1:1 on a phone card.
    var phone = !wide && !!(opts && opts.phone);
    var w = wide ? 1280 : (phone ? 350 : 620);
    var h = wide ? 230 : (phone ? 200 : 200);
    var baseline = wide ? 195 : (phone ? 160 : 165);
    // Top padding must clear the tallest bar's value label (12-13px glyphs
    // sit above the bar top) — 10px clipped the label on the max bar.
    var topPad = wide ? 34 : (phone ? 30 : 24);
    var plotH = baseline - topPad;
    var maxS = Math.max.apply(null, data.map(function (d) { return Number(d[valueKey]) || 0; }));
    var barW = (w - 20) / data.length;
    var bars = '<line x1="10" y1="' + baseline + '" x2="' + (w - 10) + '" y2="' + baseline + '" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    var lastYear = '';
    data.forEach(function (d, i) {
      var v = Number(d[valueKey]) || 0;
      var bh = maxS > 0 ? (v / maxS) * plotH : 0;
      var bx = 10 + i * barW;
      // Wide slots would make each bar ~74 units thick at 1:1 — cap the
      // drawn width and center it in the slot so bars stay elegant.
      var bw = Math.min(barW * 0.7, 48);
      var cx = bx + barW / 2;
      var vfs = wide ? 13 : (phone ? 11 : 12), lfs = wide ? 12 : (phone ? 10 : 11);
      var tick = fmtMonthTick(d.month, lastYear);
      lastYear = tick.year;
      bars += '<rect x="' + (cx - bw / 2) + '" y="' + (baseline - bh) + '" width="' + bw + '" height="' + bh + '" rx="4" fill="' + (opts && opts.color || 'var(--primary)') + '"/>' +
        '<text x="' + cx + '" y="' + (baseline - bh - 8) + '" text-anchor="middle" fill="var(--text)" font-size="' + vfs + '" font-weight="600">' + v + '</text>' +
        '<text x="' + cx + '" y="' + (baseline + 18) + '" text-anchor="middle" fill="var(--muted)" font-size="' + lfs + '">' + escapeHtml(tick.label) + '</text>';
    });
    return '<svg viewBox="0 0 ' + w + ' ' + h + '"' + ((wide || phone) ? '' : ' style="max-height:180px"') + ' class="chart-svg">' + bars + '</svg>';
  }

  // svgStackedBars renders a stacked bar chart for the per-provider revenue
  // mix (provider revenue split, recommendation #2).  Each data row carries
  // one numeric key per stack segment (e.g. paddleIdr, midtransIdr); segments
  // are stacked from the baseline up, and the total is labeled above each
  // bar.  Pure: returns an SVG string; empty/non-object rows degrade to the
  // chart-empty state like the other chart helpers.
  //
  // opts.stack: [{ key, color, label }] — segment order (bottom → top).
  // opts.fmt:   value formatter for the total label (optional).
  // opts.wide/opts.phone: same canvas sizing as svgBarChart.
  function svgStackedBars(_id, data, opts) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return '<div class="chart-empty">No data</div>';
    }
    data = data.filter(function (d) { return d && typeof d === 'object'; });
    var stack = (opts && opts.stack) || [];
    if (stack.length === 0) {
      return '<div class="chart-empty">No data</div>';
    }
    // Totals per row; drop rows with no positive total.
    var totals = data.map(function (d) {
      var t = 0;
      stack.forEach(function (s) { t += Number(d[s.key]) || 0; });
      return t;
    });
    var wide = !!(opts && opts.wide);
    var phone = !wide && !!(opts && opts.phone);
    var w = wide ? 1280 : (phone ? 350 : 620);
    var h = wide ? 230 : (phone ? 200 : 200);
    var baseline = wide ? 195 : (phone ? 160 : 165);
    var topPad = wide ? 34 : (phone ? 30 : 24);
    var plotH = baseline - topPad;
    var maxT = Math.max.apply(null, totals.filter(function (n) { return Number.isFinite(n); }));
    if (!(maxT > 0)) {
      return '<div class="chart-empty">No data</div>';
    }
    var barW = (w - 20) / data.length;
    var out = '<line x1="10" y1="' + baseline + '" x2="' + (w - 10) + '" y2="' + baseline + '" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    var vfs = wide ? 13 : (phone ? 11 : 12), lfs = wide ? 12 : (phone ? 10 : 11);
    var lastYear = '';
    data.forEach(function (d, i) {
      var total = totals[i];
      var bx = 10 + i * barW;
      var bw = Math.min(barW * 0.7, 48);
      var cx = bx + barW / 2;
      var yCursor = baseline;
      stack.forEach(function (s) {
        var v = Number(d[s.key]) || 0;
        var bh = maxT > 0 ? (v / maxT) * plotH : 0;
        if (bh <= 0) return;
        yCursor -= bh;
        out += '<rect x="' + (cx - bw / 2) + '" y="' + yCursor + '" width="' + bw + '" height="' + bh + '" rx="2" fill="' + (s.color || 'var(--primary)') + '"/>';
      });
      if (total > 0) {
        out += '<text x="' + cx + '" y="' + (yCursor - 8) + '" text-anchor="middle" fill="var(--text)" font-size="' + vfs + '" font-weight="600">' + (opts && opts.fmt ? opts.fmt(total) : Math.round(total)) + '</text>';
      }
      var tick = fmtMonthTick(d.month, lastYear);
      lastYear = tick.year;
      out += '<text x="' + cx + '" y="' + (baseline + 18) + '" text-anchor="middle" fill="var(--muted)" font-size="' + lfs + '">' + escapeHtml(tick.label) + '</text>';
    });
    return '<svg viewBox="0 0 ' + w + ' ' + h + '"' + ((wide || phone) ? '' : ' style="max-height:180px"') + ' class="chart-svg">' + out + '</svg>';
  }

  // ── Chart hover tooltips (#9) ───────────────────────────────────
  // The SVG charts are hand-rolled strings; hovering reads the exact
  // value under the cursor. Pure text builder + nearest-index math are
  // unit-testable; bindChartTooltip wires them to a live SVG element.

  // chartMonthLabel formats a "YYYY-MM" bucket for tooltip display.
  function chartMonthLabel(monthStr) {
    if (!monthStr) return '';
    var d = new Date(String(monthStr) + '-01T00:00:00Z');
    return isNaN(d.getTime()) ? monthStr : d.toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  // chartTipText builds the tooltip text for one data row. series is
  // [{ key, label }]; fmt optionally formats each numeric value.
  // Pure — no DOM.
  function chartTipText(row, series, fmt) {
    if (!row || typeof row !== 'object' || !series || !series.length) return '';
    var month = chartMonthLabel(row.month);
    var parts = [];
    series.forEach(function (s) {
      var v = Number(row[s.key]);
      if (!Number.isFinite(v)) return;
      parts.push(s.label + ': ' + (fmt ? fmt(v) : String(Math.round(v))));
    });
    return (month ? month + ' — ' : '') + parts.join(' · ');
  }

  // nearestChartIndex maps a hover x-ratio (0..1, cursor position within
  // the SVG's rendered width) to the nearest data index.
  function nearestChartIndex(ratio, count) {
    if (!(count > 1)) return 0;
    var r = Math.max(0, Math.min(1, ratio));
    return Math.min(count - 1, Math.max(0, Math.round(r * (count - 1))));
  }

  // bindChartTooltip attaches hover tooltips to a rendered .chart-svg.
  // rows is the data array aligned with the x-axis; series + fmt define
  // what each tooltip shows. Renders one absolutely-positioned tip inside
  // the chart card (which must be position:relative — see .chart-card).
  // kind: 'bar' (default, svgBarChart / svgStackedBars) or 'line' (svgChart).
  function bindChartTooltip(svgEl, rows, series, fmt, kind) {
    if (!svgEl || !rows || !rows.length || !series || !series.length) return;
    // Selector kept in a variable so the i18n audit regex (which scans for
    // t('...') substrings) does not misread closest('.chart-card') as a
    // translation key lookup.
    var cardSel = '.chart-card';
    var card = svgEl.closest ? svgEl.closest(cardSel) : svgEl.parentNode;
    if (!card) card = svgEl.parentNode;
    var tip = el('div', 'chart-tip');
    tip.setAttribute('role', 'tooltip');
    tip.style.display = 'none';
    card.appendChild(tip);

    // Pre-parse the SVG viewBox to get the logical coordinate width.
    // The viewBox is "0 0 w h" — we only need w. The separator is kept in a
    // variable so the i18n audit regex (which scans for t('...') calls) does
    // not misread the word "split" + (' ') as a translation key lookup.
    var spaceSep = ' ';
    var vbAttr = (svgEl.getAttribute('viewBox') || '').split(spaceSep);
    var vbW = parseFloat(vbAttr[2]) || 0;
    // If no viewBox (e.g. test stubs), fall back to CSS-pixel width so the
    // ratio conversion still works as a fallback (the old behaviour).
    kind = kind || 'bar';

    function place(ev) {
      var rect = svgEl.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      var cssX = ev.clientX - rect.left; // CSS px from left edge
      var n = rows.length;
      var idx;

      if (kind === 'line' && vbW > 0) {
        // Line chart: points at px + (i/(n-1))*pw.
        // Derive px/pw from the viewBox width (matching svgChart hardcoded values).
        var px, pw;
        if (vbW === 600) { px = 40;  pw = 560; }          // narrow
        else if (vbW === 350) { px = 52; pw = 290; }       // phone
        else if (vbW === 1280) { px = 72; pw = 1184; }     // wide
        else { px = 40; pw = vbW - 40; }                   // fallback
        var vbX = (cssX / rect.width) * vbW;
        if (n > 1) {
          var step = pw / (n - 1);
          idx = Math.round((vbX - px) / step);
        } else {
          idx = 0;
        }
      } else {
        // Bar chart (default): slots of (vbW-20)/n width, starting at x=10.
        // svgBarChart / svgStackedBars share this geometry.
        var w = vbW > 0 ? vbW : rect.width; // fallback: CSS pixels
        var slotW = (w - 20) / n;
        var x0 = vbW > 0 ? (cssX / rect.width) * vbW : cssX;
        if (slotW > 0) {
          idx = Math.floor((x0 - 10) / slotW);
        } else {
          idx = 0;
        }
      }
      idx = Math.min(n - 1, Math.max(0, idx));
      var row = rows[idx] || {};
      tip.textContent = chartTipText(row, series, fmt);
      tip.style.display = 'block';
      var x = ev.clientX - rect.left + 12;
      var maxX = rect.width - tip.offsetWidth - 4;
      tip.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
      tip.style.top = Math.max(0, ev.clientY - rect.top - tip.offsetHeight - 12) + 'px';
    }
    function hide() { tip.style.display = 'none'; }
    svgEl.addEventListener('mousemove', place);
    svgEl.addEventListener('mouseleave', hide);
  }

  // timeoutSignal builds an AbortSignal for a request, degrading to NO
  // signal where AbortSignal.timeout is unavailable (B20: the static is
  // Chrome/WebView 103+/Safari 16+; calling it unguarded threw TypeError
  // on older browsers and broke EVERY api() call — a regression
  // introduced by the B10/B12 timeout fixes). Un-timed beats broken.
  function timeoutSignal(timeoutMs, fallbackMs) {
    var ms = timeoutMs > 0 ? timeoutMs : fallbackMs;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      return AbortSignal.timeout(ms);
    }
    return undefined;
  }

  // fetchFxRate queries open.er-api.com for the live USD→IDR rate.
  // Extracted from admin.js so the timeout semantics are unit-testable.
  // B10 fix: the original awaited an UN-TIMED fetch — a firewalled or
  // captive-portal-blocked er-api.com left the dashboard skeleton hanging
  // for the browser's full connect timeout. The request now carries an
  // AbortSignal.timeout and any failure degrades to {live:false}, so the
  // caller falls back to the last-known/default rate immediately.
  async function fetchFxRate(fetchImpl, timeoutMs) {
    var f = fetchImpl || fetch;
    try {
      var r = await f('https://open.er-api.com/v6/latest/USD', {
        signal: timeoutSignal(timeoutMs, 5000),
      });
      var d = await r.json();
      var idr = d && d.rates ? Number(d.rates.IDR) : NaN;
      if (Number.isFinite(idr) && idr > 0) {
        return { rate: idr, updatedAt: new Date().toISOString(), live: true };
      }
    } catch (e) { /* not live */ }
    return { rate: null, updatedAt: '', live: false };
  }

  // fxTimeLabel renders an FX updatedAt timestamp in WIB (UTC+7) — the
  // operating timezone of the product — instead of the raw UTC clock time
  // the chip used to show. Both producers (the stats API and
  // fetchFxRate's toISOString) emit 'YYYY-MM-DDTHH:MM…Z'.
  // Returns '' for unparseable input so the caller can drop the suffix
  // rather than render garbage; a zone-less string falls back to the
  // legacy raw "HH:MM UTC" (Date would parse it as browser-local and a
  // +7 shift would then double-apply).
  function fxTimeLabel(iso) {
    if (!iso || typeof iso !== 'string') return '';
    var utcAnchored = /Z$/i.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso);
    if (!utcAnchored) {
      var raw = iso.slice(11, 16);
      return raw ? raw + ' UTC' : '';
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    if (isNaN(shifted.getTime())) return '';
    var hh = ('0' + shifted.getUTCHours()).slice(-2);
    var mm = ('0' + shifted.getUTCMinutes()).slice(-2);
    return hh + ':' + mm + ' UTC+7';
  }

  // stripAnsi removes ANSI terminal escape sequences (colors, cursor
  // moves, OSC titles) that container logs carry, so the log panel shows
  // clean text.
  function stripAnsi(s) {
    return String(s == null ? '' : s)
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/\x1b[@-_]/g, '');
  }

  // logTsWib formats a log timestamp as HH:MM:SS in WIB (UTC+7) — the
  // same operating-timezone convention as the FX chip. Returns '' for
  // unparseable input; the row then simply omits the stamp.
  function logTsWib(iso) {
    if (!iso || typeof iso !== 'string') return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    if (isNaN(shifted.getTime())) return '';
    return ('0' + shifted.getUTCHours()).slice(-2) + ':' +
      ('0' + shifted.getUTCMinutes()).slice(-2) + ':' +
      ('0' + shifted.getUTCSeconds()).slice(-2);
  }

  // logView renders the platform log lines (Northflank via the worker
  // proxy) as a terminal-style panel. Rows are built with el() →
  // textContent, so hostile log content can never inject markup.
  function logView(lines) {
    var wrap = el('div', 'log-view');
    if (!Array.isArray(lines) || lines.length === 0) {
      wrap.appendChild(el('p', 'empty', t('health.logsEmpty')));
      return wrap;
    }
    lines.forEach(function (l) {
      var msgText = stripAnsi(l && l.log);
      var isErr = /\b(error|failed|exception|fatal|panic)\b/i.test(msgText);
      var row = el('div', 'log-line' + (isErr ? ' log-line--err' : ''));
      var ts = l && l.ts ? logTsWib(l.ts) : '';
      if (ts) row.appendChild(el('span', 'log-ts', ts));
      row.appendChild(el('span', 'log-msg', msgText));
      wrap.appendChild(row);
    });
    return wrap;
  }

  // cfDeployRows renders Cloudflare Worker deployment history (newest
  // first) as compact rows: deploy message with the git sha highlighted,
  // author, trigger chip and a WIB timestamp. Built with el() →
  // textContent; API data never touches innerHTML.
  function cfDeployRows(deploys) {
    var wrap = el('div', 'deploy-list');
    if (!Array.isArray(deploys) || deploys.length === 0) {
      wrap.appendChild(el('p', 'empty', t('health.deploysEmpty')));
      return wrap;
    }
    deploys.forEach(function (d) {
      var row = el('div', 'deploy-row');
      var main = el('span', 'deploy-msg');
      var msg = String((d && d.message) || '');
      // Highlight the embedded git sha ("Coding Agent — 47e3ea90 …").
      var m = msg.match(/\b[0-9a-f]{8}\b/);
      if (m && m.index !== undefined) {
        if (m.index > 0) main.appendChild(document.createTextNode(msg.slice(0, m.index)));
        main.appendChild(el('span', 'deploy-sha', m[0]));
        if (m.index + m[0].length < msg.length) main.appendChild(document.createTextNode(msg.slice(m.index + m[0].length)));
      } else {
        main.textContent = msg || '—';
      }
      row.appendChild(main);
      if (d && d.author) row.appendChild(el('span', 'deploy-author', String(d.author)));
      var trig = String((d && d.trigger) || 'deployment');
      row.appendChild(el('span', 'deploy-chip deploy-chip--' + (trig === 'secret' ? 'secret' : 'deploy'), trig));
      var ts = d && d.time ? logTsWib(d.time) : '';
      if (ts) row.appendChild(el('span', 'deploy-time', ts + ' WIB'));
      wrap.appendChild(row);
    });
    return wrap;
  }

  // relTime renders a coarse relative timestamp ("just now", "4m ago",
  // "3h ago", "2d ago"). nowMs is injectable so tests are deterministic.
  // Returns '' for junk input.
  function relTime(iso, nowMs) {
    if (!iso || typeof iso !== 'string') return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    var s = Math.floor((now - d.getTime()) / 1000);
    if (s < 10) return t('health.justNow');
    if (s < 60) return s + 's' + t('health.agoSuffix');
    if (s < 3600) return Math.floor(s / 60) + 'm' + t('health.agoSuffix');
    if (s < 86400) return Math.floor(s / 3600) + 'h' + t('health.agoSuffix');
    return Math.floor(s / 86400) + 'd' + t('health.agoSuffix');
  }

  // sparkline renders a request-per-minute area chart as an SVG string
  // (caller sets innerHTML). buckets: [{t: ISO, req, err}] ascending.
  // Errors overlay as a red line scaled to their own max (error counts
  // are orders of magnitude smaller than requests).
  function sparkline(buckets, opts) {
    if (!Array.isArray(buckets) || buckets.length < 2) {
      return '<div class="chart-empty">' + escapeHtml(t('health.trafficEmpty')) + '</div>';
    }
    // Readability fix: the plot was a bare line — no gridlines, no y
    // values. Gridlines every 25% of peak + a y-label column. Labels are
    // HTML (not SVG <text>) because preserveAspectRatio="none" stretches
    // SVG text horizontally when the card width ≠ viewBox width; HTML
    // stays crisp at any card width. The opts arg is kept for signature
    // compatibility (the old phone variant is obsolete — HTML labels made
    // it unnecessary).
    var w = 620, h = 150, baseline = 118, top = 18, pad = 10;
    var plotW = w - pad * 2, plotH = baseline - top;
    var maxR = Math.max.apply(null, buckets.map(function (b) { return Number(b && b.req) || 0; }));
    var maxE = Math.max.apply(null, buckets.map(function (b) { return Number(b && b.err) || 0; }));
    if (maxR <= 0) {
      return '<div class="chart-empty">' + escapeHtml(t('health.trafficEmpty')) + '</div>';
    }
    var x = function (i) { return pad + (i * plotW) / (buckets.length - 1); };
    var yR = function (v) { return baseline - (v / maxR) * plotH; };
    // Gridlines at 0/25/50/75/100% of peak. The svg is rendered at a CSS
    // height of 150px with a 150-unit viewBox, so viewBox y maps 1:1 to
    // pixels and the HTML label column can align with top:18/43/68/93/118.
    var grid = '', yLabels = '';
    var fmt = function (v) { v = Math.round(v); return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v); };
    for (var gi = 0; gi <= 4; gi++) {
      var gy = top + (plotH / 4) * gi;
      grid += '<line x1="' + pad + '" y1="' + gy + '" x2="' + (w - pad) + '" y2="' + gy + '" stroke="var(--border)" stroke-width="1"' + (gi === 4 ? '' : ' stroke-dasharray="4 4"') + ' vector-effect="non-scaling-stroke"/>';
      yLabels += '<span style="top:' + Math.round(gy) + 'px">' + fmt(maxR * (4 - gi) / 4) + '</span>';
    }
    // B42 lesson: the area path must START with the M command.
    var pts = buckets.map(function (b, i) { return x(i) + ',' + yR(Number(b.req) || 0).toFixed(1); }).join(' L ');
    var area = 'M ' + x(0) + ',' + baseline + ' L ' + pts + ' L ' + x(buckets.length - 1) + ',' + baseline + ' Z';
    var errs = '';
    if (maxE > 0) {
      var yE = function (v) { return baseline - (v / maxE) * plotH; };
      var ePts = buckets.map(function (b, i) { return x(i) + ',' + yE(Number(b.err) || 0).toFixed(1); }).join(' ');
      errs = '<polyline points="' + ePts + '" fill="none" stroke="var(--danger)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
    }
    var t0 = logTsWib(buckets[0].t), t1 = logTsWib(buckets[buckets.length - 1].t);
    return '<div class="spark-wrap">' +
      '<div class="spark-y" aria-hidden="true">' + yLabels + '</div>' +
      '<div class="spark-plot">' +
        '<svg viewBox="0 0 ' + w + ' ' + h + '" class="chart-svg spark-svg" preserveAspectRatio="none">' +
          grid +
          '<path d="' + area + '" fill="var(--tint-primary-bg)" stroke="none"/>' +
          '<polyline points="' + buckets.map(function (b, i) { return x(i) + ',' + yR(Number(b.req) || 0).toFixed(1); }).join(' ') + '" fill="none" stroke="var(--primary)" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
          errs +
        '</svg>' +
        '<div class="spark-x" aria-hidden="true"><span>' + escapeHtml(t0) + '</span><span>' + escapeHtml(t1) + '</span></div>' +
      '</div>' +
      '</div>';
  }

  // nfStatusCard renders the Northflank service status (deployment,
  // build, running git sha, branch, region, instances) as a compact
  // key-value card. Built with el() → textContent.
  function nfStatusCard(s) {
    var wrap = el('div', 'svc-grid');
    if (!s || typeof s !== 'object') {
      wrap.appendChild(el('p', 'empty', t('health.serviceEmpty')));
      return wrap;
    }
    function kv(label, valueText, valueCls) {
      wrap.appendChild(el('span', 'muted', label));
      var v = el('span', valueCls || null, valueText);
      v.style.textAlign = 'right';
      wrap.appendChild(v);
    }
    var dStatus = String(s.deploymentStatus || '—');
    var dCls = dStatus === 'COMPLETED' ? 'status-ok' : (dStatus === 'ERROR' ? 'status-bad' : 'status-warn');
    kv(t('health.status'), dStatus, 'status-chip ' + dCls);
    kv(t('health.svcRegion'), String(s.region || '—'));
    kv(t('health.svcBranch'), String(s.branch || '—'));
    if (s.deployedSha) {
      wrap.appendChild(el('span', 'muted', t('health.svcRunningSha')));
      var fullSha = String(s.deployedSha);
      var shaCell = el('span', 'mono-cell');
      var shaEl = el('span', 'deploy-sha', fullSha.slice(0, 8));
      shaEl.title = fullSha;
      shaCell.appendChild(shaEl);
      if (s.deploymentAt) shaCell.appendChild(el('span', 'muted', ' · ' + relTime(s.deploymentAt)));
      shaCell.style.textAlign = 'right';
      wrap.appendChild(shaCell);
    }
    kv(t('health.svcInstances'), String(s.instances != null ? s.instances : '—'));
    if (s.buildStatus) kv(t('health.svcBuild'), String(s.buildStatus), 'status-chip ' + (s.buildStatus === 'SUCCESS' ? 'status-ok' : 'status-warn'));
    return wrap;
  }

  // uptimeRows renders the public-surface uptime checks: name, up dot,
  // latency in ms, and the failure reason when down. el() → textContent.
  function uptimeRows(checks) {
    var wrap = el('div', 'up-list');
    if (!Array.isArray(checks) || checks.length === 0) {
      wrap.appendChild(el('p', 'empty', t('health.serviceEmpty')));
      return wrap;
    }
    checks.forEach(function (c) {
      var row = el('div', 'up-row');
      row.appendChild(el('span', 'up-dot ' + (c && c.up ? 'up-dot--ok' : 'up-dot--bad')));
      row.appendChild(el('span', 'up-name', String((c && c.name) || '?')));
      if (c && c.vantage) {
        row.appendChild(el('span', 'up-vantage', c.vantage === 'browser' ? t('health.vantageBrowser') : t('health.vantageEdge')));
      }
      if (c && c.up) {
        row.appendChild(el('span', 'up-ms', (Number(c.ms) || 0) + ' ms'));
      } else {
        var err = el('span', 'up-err', String((c && c.error) || t('health.uptimeFailed')));
        err.title = err.textContent;
        row.appendChild(err);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  // exchangeUrlFrom validates the /exchange-issue response and builds the
  // redirect URL. B13 fix: login.js concatenated body.code unguarded — a
  // 200 response without a code sent the browser to /?code=undefined, the
  // worker's consume failed, and it bounced back to login: a silent loop.
  function exchangeUrlFrom(body) {
    if (!body || typeof body.code !== 'string' || body.code === '') {
      var err = new Error('exchange-issue returned no code');
      err.exchangeFailed = true;
      throw err;
    }
    return '/?code=' + encodeURIComponent(body.code);
  }

  // isLockoutActive reports whether a button currently carries a running
  // startLockoutCountdown timer. B14: login.js setAuthMode must not
  // overwrite the countdown label mid-lockout.
  function isLockoutActive(btn) {
    return !!(btn && btn._ozLockoutTimer);
  }

  // setNavActive moves the active-tab marker across the top-nav buttons,
  // keeping the CSS class (visual) and aria-current (assistive tech) in
  // sync. B38: the old code only toggled .nav-active, so a screen reader
  // had no way to know which admin section was open. `btns` is any
  // iterable of buttons (NodeList/array); a null/undefined active button
  // clears every marker defensively (callers may re-render mid-click).
  /**
   * @param {ArrayLike<HTMLElement>} btns
   * @param {HTMLElement|null|undefined} activeBtn
   */
  function setNavActive(btns, activeBtn) {
    // Array.prototype.forEach.call (not btns.forEach) so an old WebView
    // NodeList — which may lack forEach — still works (B20 class: this
    // admin targets legacy embedded browsers).
    Array.prototype.forEach.call(btns, function (btn) {
      btn.classList.remove('nav-active');
      btn.removeAttribute('aria-current');
    });
    if (activeBtn) {
      activeBtn.classList.add('nav-active');
      activeBtn.setAttribute('aria-current', 'page');
    }
  }

  // busyWrap — single-flight async guard for action buttons (B19).
  function busyWrap(btn, fn) {
    var busy = false;
    return function () {
      if (busy) return Promise.resolve();
      busy = true;
      if (btn) btn.disabled = true;
      var result;
      try {
        result = fn();
      } catch (e) {
        busy = false;
        if (btn) btn.disabled = false;
        throw e;
      }
      if (!result || typeof result.then !== 'function') {
        busy = false;
        if (btn) btn.disabled = false;
        return result;
      }
      return result.then(
        function (v) { busy = false; if (btn) btn.disabled = false; return v; },
        function (e) { busy = false; if (btn) btn.disabled = false; return Promise.reject(e); }
      );
    };
  }

  // fetchWithTimeout performs a fetch that is guaranteed to settle.
  // Extracted from admin.js api() so the timeout semantics are testable.
  // B12 fix: api() awaited two UN-TIMED fetches per call (the session
  // endpoint and the license API). A hung license-server connection —
  // half-open TCP, overloaded origin — left renderDashboard/renderTenants/
  // renderHealth pending forever: skeleton, no retry UI, no console error.
  // Every admin fetch now carries AbortSignal.timeout; a timeout surfaces
  // as a rejection the existing catch paths already render as errors.
  async function fetchWithTimeout(fetchImpl, url, opts, timeoutMs) {
    var f = fetchImpl || fetch;
    var o = opts || {};
    var sig = timeoutSignal(timeoutMs, 15000);
    if (sig) o.signal = sig;
    return f(url, o);
  }

  // mountModal wires the shared modal mechanics: backdrop + dialog box,
  // backdrop-click close, ESC close, and a returned close() for buttons.
  // Extracted from the duplicated blocks in admin.js showTenantDetail /
  // upgradePrompt so the listener lifecycle is unit-testable.
  // B11 fix: the original only detached the keydown handler on the ESC
  // path — closing via the button or backdrop left it attached, so every
  // such open leaked one listener that kept reacting to later ESCs
  // (clearing whatever modal was open then, and double-firing). One
  // idempotent close() now serves all three paths and always detaches.
  function mountModal(modalRoot, box) {
    var m = el('div', 'modal-back');
    m.appendChild(box);
    var open = true;
    // B27: focus management. The dialog was announced (role=dialog,
    // aria-modal=true set by callers) but focus stayed on the trigger
    // behind the backdrop — keyboard and screen-reader users tabbed
    // through hidden content while the modal was open, and closing left
    // focus wherever it happened to be. Move focus into the dialog on
    // open (first focusable child, else the box via tabindex=-1) and
    // restore it to the opener on close.
    var prevFocus = document.activeElement;
    if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
    function close() {
      if (!open) return;
      open = false;
      // Only clear the root while our backdrop is still mounted — a
      // stacked modal (upgrade over detail) may already have replaced it.
      if (m.parentNode === modalRoot) modalRoot.innerHTML = '';
      document.removeEventListener('keydown', escHandler);
      document.removeEventListener('keydown', trapHandler); // B28: same lifecycle as esc — no leak
      // The opener may have been removed meanwhile (renderTenants
      // re-renders the table) — only restore into a live element.
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
        prevFocus.focus();
      }
    }
    function escHandler(e) { if (e.key === 'Escape') close(); }
    // B28 (WCAG 2.1.2): while the dialog is open, Tab must cycle inside
    // it — the old code let the keyboard walk out into the background
    // page behind the backdrop. Focusables are queried at event time so
    // content that arrives later (tenant detail after its fetch) is
    // included without re-wiring.
    function trapHandler(e) {
      if (e.key !== 'Tab') return;
      var f = box.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return; // nothing to cycle through yet
      var firstEl = f[0], lastEl = f[f.length - 1];
      var active = document.activeElement;
      if (e.shiftKey && (active === firstEl || active === box)) {
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault(); firstEl.focus();
      } else if (!box.contains(active)) {
        e.preventDefault(); firstEl.focus();
      }
    }
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    document.addEventListener('keydown', escHandler);
    document.addEventListener('keydown', trapHandler);
    modalRoot.appendChild(m);
    var first = box.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first || box).focus();
    return close;
  }

  // flashMessage appends a transient toast to container and removes it
  // after ttlMs (default 3000). B34 (WCAG 4.1.3): the inline flash() in
  // admin.js appended a bare div — screen readers never announced it, so
  // "Renewed ✓" / "Revoke failed" happened invisibly to AT users.
  // role=alert on the appended node makes assistive tech announce it.
  function flashMessage(container, msg, ttlMs) {
    var f = el('div', 'flash', msg);
    f.setAttribute('role', 'alert');
    container.appendChild(f);
    setTimeout(function () { f.remove(); }, ttlMs || 3000);
    return f;
  }

  // startCountdown drives a plain text node with a per-second countdown
  // (the OTP resend cooldown). B18: the original kept its timer in a
  // login.js module global and setAuthMode hid the element without
  // touching the timer — a live cooldown ran invisibly after a tab
  // switch and the user walked into a 429. The handle now lives on the
  // node (same pattern as startLockoutCountdown), so visibility can
  // follow countdownActive(node).
  /**
   * @param {HTMLElement|null} node
   * @param {number} seconds
   * @param {function(number): string} fmt
   * @param {function(): void} [onEnd]
   */
  function startCountdown(node, seconds, fmt, onEnd) {
    if (!node) return;
    if (node._ozCdTimer) clearInterval(node._ozCdTimer);
    // B39: `seconds` comes straight from server JSON (body.retry_after).
    // A garbage value ("abc", NaN) made `remaining -= 1` produce NaN
    // forever — NaN <= 0 is false, so the interval NEVER ended: the OTP
    // cooldown ran invisibly and (in the lockout variant) the login
    // button stayed disabled until a full page reload. Coerce to a
    // finite integer; invalid or non-positive means "already over".
    var remaining = Math.floor(Number(seconds));
    if (!Number.isFinite(remaining) || remaining <= 0) {
      node._ozCdTimer = null;
      if (onEnd) onEnd();
      return;
    }
    node.textContent = fmt(remaining);
    node._ozCdTimer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(node._ozCdTimer);
        node._ozCdTimer = null;
        if (onEnd) onEnd();
      } else {
        node.textContent = fmt(remaining);
      }
    }, 1000);
  }

  /**
   * @param {HTMLElement|null} node
   */
  function stopCountdown(node) {
    if (node && node._ozCdTimer) { clearInterval(node._ozCdTimer); node._ozCdTimer = null; }
  }

  /**
   * @param {HTMLElement|null} node
   * @returns {boolean}
   */
  function countdownActive(node) {
    return !!(node && node._ozCdTimer);
  }

  // setAuthMode applies the login form's OTP/password tab state.
  // Extracted from login.js so the mode-switch guards are unit-testable.
  // B21 fix: the tab buttons called it unconditionally — clicking the
  // other tab while a login request was in flight flipped currentMode,
  // and the response handler then wrote the WRONG mode's button label
  // (and could start the OTP cooldown on the password tab). opts
  // .isSubmitting() lets the caller veto the flip mid-submit; the
  // function returns whether it applied so login.js can gate currentMode.
  function setAuthMode(mode, els, opts) {
    els = els || {};
    if (opts && typeof opts.isSubmitting === 'function' && opts.isSubmitting()) return false;
    var tabOtp = els.tabOtp, tabPwd = els.tabPwd, pwdGroup = els.pwdGroup,
        otpGroup = els.otpGroup, loginBtn = els.loginBtn, cd = els.cd;
    if (mode === 'otp') {
      // B40 (WCAG 4.8.2): the visual .active class was toggled but
      // aria-selected never was — after switching modes a screen reader
      // still reported the ORIGINAL tab as selected, so the user could
      // not tell which credential the form was asking for.
      if (tabOtp) { tabOtp.classList.add('active'); tabOtp.setAttribute('aria-selected', 'true'); }
      if (tabPwd) { tabPwd.classList.remove('active'); tabPwd.setAttribute('aria-selected', 'false'); }
      if (pwdGroup) pwdGroup.classList.add('hidden');
      // B18: the resend cooldown is enforced server-side and its countdown
      // keeps running across a tab switch — re-show it when returning.
      if (cd && countdownActive(cd)) cd.classList.remove('hidden');
      var isCodeActive = otpGroup && !otpGroup.classList.contains('hidden');
      // B14: never overwrite an active lockout countdown label.
      if (loginBtn && !isLockoutActive(loginBtn)) {
        if (isCodeActive) {
          loginBtn.textContent = t('login.verifyCode');
        } else {
          if (otpGroup) otpGroup.classList.add('hidden');
          loginBtn.textContent = t('login.sendCode');
        }
      } else if (!isCodeActive && otpGroup) {
        otpGroup.classList.add('hidden');
      }
    } else {
      if (tabOtp) { tabOtp.classList.remove('active'); tabOtp.setAttribute('aria-selected', 'false'); }
      if (tabPwd) { tabPwd.classList.add('active'); tabPwd.setAttribute('aria-selected', 'true'); }
      if (pwdGroup) pwdGroup.classList.remove('hidden');
      if (otpGroup) otpGroup.classList.add('hidden');
      if (cd) cd.classList.add('hidden');
      if (loginBtn && !isLockoutActive(loginBtn)) loginBtn.textContent = t('login.signInPassword');
    }
    return true;
  }

  // startLockoutCountdown drives the login button's 429 lockout label.
  // Extracted from login.js showLockoutCountdown so the timer semantics
  // are unit-testable (login.js has DOM boot side effects).
  // B7 fix: the original created a NEW setInterval per 429 and only ever
  // referenced it from its own closure — a second rate-limited response
  // left the first timer racing: it re-enabled the button early (its
  // shorter retry_after expired first) and zombie-rewrote the restored
  // label afterwards. The handle now lives on the button, so a new
  // countdown always supersedes the previous one.
  /**
   * @param {HTMLElement|null} btn
   * @param {number} seconds
   * @param {function(number): string} fmt
   * @param {function(): string} restore
   */
  function startLockoutCountdown(btn, seconds, fmt, restore) {
    if (!btn) return;
    if (btn._ozLockoutTimer) clearInterval(btn._ozLockoutTimer);
    // B39: `seconds` is server-supplied (body.retry_after). A garbage
    // value made `remaining--` stay NaN forever — NaN <= 0 is false, so
    // the interval never fired the restore path and the login button
    // remained disabled until the page was reloaded. Treat invalid or
    // non-positive seconds as "no lockout": leave the button usable.
    var remaining = Math.floor(Number(seconds));
    if (!Number.isFinite(remaining) || remaining <= 0) {
      btn._ozLockoutTimer = null;
      btn.disabled = false;
      btn.textContent = restore();
      return;
    }
    btn.disabled = true;
    btn.textContent = fmt(remaining);
    btn._ozLockoutTimer = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        clearInterval(btn._ozLockoutTimer);
        btn._ozLockoutTimer = null;
        btn.disabled = false;
        btn.textContent = restore();
        return;
      }
      btn.textContent = fmt(remaining);
    }, 1000);
  }

  /**
   * Response shapes for the admin stats payload.
   *
   * These mirror the server's response literally — the source of truth is
   * `handleAdminStats` in apps/license-server/admin_stats.go, which builds
   * the `kpis` map and the twelve arrays in one `e.JSON(...)` call. When a
   * field is added there, `normalizeStats` already passes it through (it
   * copies every key of the incoming kpis object), so only this declaration
   * goes stale — which is exactly how the admin analytics features shipped
   * with `astro check` failing on properties that existed at runtime and on
   * the wire.
   *
   * @typedef {Object} AdminKpis
   * @property {number} totalUsers
   * @property {number} activeUsers
   * @property {number} totalSubscribers
   * @property {number} activeDevices
   * @property {number} arpuUsd
   * @property {number} trialToPaidRate
   * @property {number} fxRate
   * ── Monthly income, gross and refunds, per currency ──
   * @property {number} mrrUsd
   * @property {number} mrrIdr
   * @property {number} monthlyGrossUsd
   * @property {number} monthlyGrossIdr
   * @property {number} monthlyRefundUsd
   * @property {number} monthlyRefundIdr
   * @property {number} monthlyPaddleUsd
   * @property {number} monthlyPaddleIdr
   * @property {number} monthlyMidtransUsd
   * @property {number} monthlyMidtransIdr
   * ── Lifetime totals ──
   * @property {number} lifetimeUsd
   * @property {number} lifetimeIdr
   * @property {number} lifetimeRefundUsd
   * @property {number} lifetimeRefundIdr
   * @property {number} lifetimePaddleUsd
   * @property {number} lifetimePaddleIdr
   * @property {number} lifetimeMidtransUsd
   * @property {number} lifetimeMidtransIdr
   * ── Provenance and freshness: deliberately excluded from
   * normalizeStats' coercion list so they pass through untouched ──
   * @property {string} grossSource - "provider" when backed by the payment
   * ledger, "estimate" when derived from FX-converted MRR.
   * @property {boolean} fxLive
   * @property {string} fxUpdatedAt - RFC3339
   * @property {string} revenueCachedAt - RFC3339, when the provider ledger
   * snapshot was refreshed.
   */

  /**
   * @typedef {Object} AdminStats
   * @property {Array} revenueTrend
   * @property {Array} subscriberGrowth
   * @property {Array} tierDistribution
   * @property {Array} providerSplit
   * @property {Array} signupsPerMonth
   * @property {Array} churnPerMonth
   * @property {Array} topSubscribers
   * @property {Array} recentSignups
   * @property {Array} expiringSoon
   * @property {Array} needsAttention
   * @property {Array} recentRevenueEvents
   * @property {Array} trialFunnel
   * @property {AdminKpis} kpis
   */

  // normalizeStats guarantees the shapes renderDashboard expects. admin.js
  // dereferenced m.revenueTrend.forEach / m.kpis.mrrUsd BEFORE the chart
  // guards ran, so a partial stats payload (older server build, truncated
  // response) threw a bare TypeError and the dashboard rendered nothing.
  // Non-object input is tolerated; numeric KPIs are coerced (null/undefined
  // -> 0, numeric strings -> number) so fmtUsd/fmtIdr never see NaN text.
  /**
   * @param {any} raw
   * @returns {AdminStats}
   */
  function normalizeStats(raw) {
    var m = (raw && typeof raw === 'object') ? raw : {};
    var arr = function (v) { return Array.isArray(v) ? v : []; };
    var num = function (v) { var n = Number(v); return Number.isFinite(n) ? n : 0; };
    var k = (m.kpis && typeof m.kpis === 'object') ? m.kpis : {};
    var kpis = {};
    Object.keys(k).forEach(function (key) { kpis[key] = k[key]; });
    // B35 (fuzz-found): the copy above passes EVERY key raw and only the
    // old 7-key list was coerced — fxRate/mrrIdr/lifetimeUsd/lifetimeIdr
    // could reach the cards as NaN/Infinity ("Rp NaN"). Coerce the full
    // numeric set the server sends; fxUpdatedAt (string) and fxLive
    // (boolean) intentionally pass through.
    ['totalUsers', 'activeUsers', 'totalSubscribers', 'activeDevices',
      'mrrUsd', 'mrrIdr', 'lifetimeUsd', 'lifetimeIdr', 'arpuUsd',
      'trialToPaidRate', 'fxRate', 'monthlyGrossUsd', 'monthlyGrossIdr',
      'monthlyPaddleUsd', 'monthlyPaddleIdr', 'monthlyMidtransUsd', 'monthlyMidtransIdr',
      'monthlyRefundUsd', 'monthlyRefundIdr',
      'lifetimePaddleUsd', 'lifetimePaddleIdr', 'lifetimeMidtransUsd', 'lifetimeMidtransIdr',
      'lifetimeRefundUsd', 'lifetimeRefundIdr']
      .forEach(function (key) { kpis[key] = num(k[key]); });
    return {
      revenueTrend: arr(m.revenueTrend),
      subscriberGrowth: arr(m.subscriberGrowth),
      tierDistribution: arr(m.tierDistribution),
      providerSplit: arr(m.providerSplit),
      signupsPerMonth: arr(m.signupsPerMonth),
      churnPerMonth: arr(m.churnPerMonth),
      topSubscribers: arr(m.topSubscribers),
      recentSignups: arr(m.recentSignups),
      expiringSoon: arr(m.expiringSoon),
      needsAttention: arr(m.needsAttention),
      recentRevenueEvents: arr(m.recentRevenueEvents),
      trialFunnel: arr(m.trialFunnel),
      kpis: kpis,
    };
  }

  // Returns true when an HTTP status means "session not authorized" for the
  // admin panel (401 unauth'd, 403 non-admin tenant).
  function isAuthDenied(status) {
    return status === 401 || status === 403;
  }

  // Build the thrown Error for an auth-denied response. Marking
  // err.authDenied lets callers distinguish "fetch failed" from "auth was
  // the problem" so they never overwrite the access-denied screen.
  function authDeniedError(path) {
    const err = new Error(path + ' (auth denied)');
    err.authDenied = true;
    return err;
  }

  // ── i18n (H3) ───────────────────────────────────────────────────
  // Key-value string table. English is the default; a future locale just
  // swaps this object. t(key) returns the localized string (missing keys
  // fall back to the key itself so the UI never shows a blank label).
  var STRINGS = {
    'dashboard.title': 'Dashboard',
    'section.revenue': 'Revenue',
    'section.growth': 'Growth',
    'common.active': 'active',
    'common.refresh': 'Refresh',
    'common.refreshedAt': 'updated',
    'common.refunds': 'refunds',
    'common.estimate': 'estimate',
    'common.providerVerified': 'Paddle/Midtrans webhooks',
    'kpi.totalUsers': 'Total Users',
    'kpi.totalSubscribers': 'Total Subscribers',
    'kpi.mrr': 'MRR',
    'kpi.monthlyGrossIdr': 'Monthly Gross (IDR)',
    'kpi.arpu': 'ARPU',
    'kpi.activeTerminals': 'Active Terminals',
    'kpi.trialToPaid': 'Trial → Paid',
    'chart.revenueTrendIdr': 'Revenue Trend (IDR)',
    'chart.revenueByProvider': 'Revenue by Provider (IDR)',
    'chart.monthsVerified': 'months verified (rest estimated)',
    'chart.subscriberGrowth': 'Subscriber Growth',
    'chart.tierDistribution': 'Tier Distribution',
    'chart.paymentProvider': 'Payment Provider',
    'chart.signupsPerMonth': 'Signups per Month',
    'chart.churnCanceled': 'Churn / Canceled',
    'chart.trialFunnel': 'Trial → Paid Funnel',
    'table.topSubscribers': 'Top Subscribers',
    'table.recentSignups': 'Recent Signups',
    'table.recentRevenueEvents': 'Recent Revenue Events',
    'table.expiringSoon': 'Expiring Soon (within 30 days)',
    'alert.title': 'Needs Attention',
    'alert.grace_period': 'Grace period',
    'alert.expired_active': 'Expired key active',
    'alert.refund': 'Refund',
    // ADR #57 §2.4. Deliberately distinguishable: a mismatch is positive
    // evidence of a re-signed APK, while a persistent unknown is unreadable
    // reporting that may equally be our own bug (§Q4).
    'alert.integrity_mismatch': 'Build tampered',
    'alert.integrity_unknown_persistent': 'Build unreadable',
    'alert.pos_over_quota': 'Over device quota',
    'table.tenants': 'Tenants',
    'table.noData': 'No data.',
    'table.noTenantsMatch': 'No tenants match.',
    'th.email': 'Email',
    'th.tier': 'Tier',
    'th.mrr': 'MRR',
    'th.renewal': 'Renewal',
    'th.provider': 'Provider',
    'th.status': 'Status',
    'th.amount': 'Amount',
    'th.when': 'When',
    'th.daysLeft': 'Days Left',
    'th.created': 'Created',
    'th.expires': 'Expires',
    'th.licenseKey': 'License key',
    'th.license': 'License',
    'th.licenseTier': 'License / Tier',
    'tenant.phone': 'Phone',
    'tenant.graceUntil': 'Grace until',
    'tenant.revokeTitle': 'Revoke tenant access',
    'tenant.revokeHint': 'This disables the tenant immediately. Type their email to confirm: ',
    'tenant.revokePlaceholder': 'tenant email',
    'tenant.revokeMismatch': 'Email does not match yet.',
    'tenant.renewNoSub': 'Renew (no subscription)',
    'tenant.renewNoSubTip': 'No subscription record — renew would fail. Use "Grant subscription" to add one.',
    'tenant.noSubWarn': 'This tenant has NO subscription record — saving would silently do nothing server-side.',
    'th.devices': 'Devices',
    'th.subscriptionStatus': 'Subscription status',
    'th.emailVerified': 'Email verified',
    'tenant.currentTier': 'Current tier: ',
    'tenant.details': 'Details',
    'tenant.title': 'Tenant: ',
    'tenant.changeTier': 'Change tier',
    'tenant.reasonOverride': 'Reason for override (audit)',
    'tenant.renew365': 'Renew +365d',
    // ── Phase 4: tenant lifecycle UI ──────────────────────────────
    'tenant.editContact': 'Edit contact',
    'tenant.editTitle': 'Edit tenant contact',
    'tenant.emailTaken': 'That email is already in use.',
    'tenant.contactUpdated': 'Contact updated',
    'tenant.devices': 'Devices',
    'tenant.lastSeen': 'Last seen',
    'tenant.deviceRevoked': 'Device revoked',
    'tenant.renewTitle': 'Renew subscription',
    'tenant.setExactDate': 'Set exact date',
    'tenant.or': 'or',
    'tenant.grantTitle': 'Grant subscription',
    'tenant.grantHint': 'For transfer/e-wallet payments made outside Paddle/Midtrans.',
    'tenant.months': 'Months',
    'tenant.exactDate': 'Exact date (inclusive)',
    'tenant.reasonGrant': 'Reason (audit trail)',
    'tenant.reasonRequired': 'Reason is required.',
    'tenant.granted': 'Granted',
    'tenant.delete': 'Delete tenant',
    'tenant.deleteTitle': 'Delete tenant permanently',
    'tenant.deleteHint': 'This cannot be undone. Type the tenant email to confirm: ',
    'tenant.deleteWarn': 'All devices and subscriptions are deleted. License keys are unlinked but kept for the audit trail.',
    'tenant.deleteConfirm': 'Delete permanently',
    'tenant.deleted': 'Tenant deleted',
    // ──────────────────────────────────────────────────────────────
    'tenant.revoke': 'Revoke',
    'tenant.revoked': 'Revoked',
    'tenant.activate': 'Activate',
    'tenant.activated': 'Activated',
    'tenant.renewed': 'Renewed',
    'tenant.tierChanged': 'Tier changed',
    'tenant.upgrade': 'Upgrade',
    'tenant.save': 'Save',
    'tenant.cancel': 'Cancel',
    'tenant.close': 'Close',
    'toolbar.searchPlaceholder': 'Search by email…',
    'toolbar.search': 'Search',
    'toolbar.clear': 'Clear',
    'toolbar.enter': 'Enter',
    'toolbar.showing': 'Showing ',
    'toolbar.of': ' of ',
    'toolbar.page': 'Page ',
    'toolbar.prev': '← Prev',
    'toolbar.next': 'Next →',
    'health.title': 'System Health',
    'health.status': 'Status',
    'health.ok': '✓ OK',
    'health.degraded': '✗ Degraded',
    'health.database': 'Database',
    'health.connected': '✓ Connected',
    'health.unreachable': '✗ Unreachable',
    'health.smtp': 'SMTP',
    'health.configured': '✓ Configured',
    'health.notConfigured': '— Not configured',
    'health.version': 'Version',
    'health.time': 'Time',
    'health.logsTitle': 'Service Logs — cloud (last 100 lines)',
    'health.logsRefresh': '↻ Refresh',
    'health.logsCaption': 'times in UTC+7 · source: Northflank',
    'health.logsEmpty': 'No log lines in the last 24 hours.',
    'health.logsFailed': 'Could not load logs.',
    'health.deploysTitle': 'Cloudflare Deployments — worker oz-pos',
    'health.deploysRefresh': '↻ Refresh',
    'health.deploysCaption': 'times in UTC+7 · source: Cloudflare',
    'health.deploysEmpty': 'No deployments found.',
    'health.deploysFailed': 'Could not load deployments.',
    'health.serviceTitle': 'Cloud Service — cloud @ oz-pos',
    'health.serviceRefresh': '↻ Refresh',
    'health.serviceEmpty': 'Service status unavailable.',
    'health.serviceFailed': 'Could not load service status.',
    'health.svcRegion': 'Region',
    'health.svcBranch': 'Branch',
    'health.svcRunningSha': 'Running build',
    'health.svcInstances': 'Instances',
    'health.svcBuild': 'Last build',
    'health.uptimeTitle': 'Uptime — public surfaces',
    'health.uptimeRefresh': '↻ Refresh',
    'health.uptimeFailed': 'unreachable',
    'health.vantageEdge': 'edge',
    'health.vantageBrowser': 'browser',
    'health.workerLogsTitle': 'Worker Logs — oz-pos (last hour)',
    'health.workerLogsRefresh': '↻ Refresh',
    'health.workerLogsEmpty': 'No worker log events in the last hour.',
    'health.workerLogsFailed': 'Could not load worker logs.',
    'health.trafficTitle': 'Traffic — requests/minute (24h)',
    'health.trafficRefresh': '↻ Refresh',
    'health.trafficEmpty': 'No traffic in the last 24 hours.',
    'health.trafficFailed': 'Could not load traffic.',
    'health.justNow': 'just now',
    'health.agoSuffix': ' ago',
    'health.autoOn': 'Auto-refresh: on',
    'health.autoOff': 'Auto-refresh: off',
    'health.updated': 'updated',
    'common.loading': 'Loading…',
    'common.loadingTenants': 'Loading tenants…',
    'common.failedToLoadTenants': 'Failed to load tenants.',
    'common.failedToLoadTenantDetail': 'Failed to load tenant detail.',
    'common.failedToLoadHealth': 'Failed to load health.',
    'common.statsUnavailable': 'Stats unavailable',
    'common.statsApiNoResponse': 'The dashboard API did not respond. Try again.',
    'common.retry': 'Retry',
    'common.stale': ' stale',
    'common.successfully': ' successfully',
    'common.failed': ' failed',
    'toolbar.nonFree': 'non-free (plus/pro/premium/enterprise)',
    'toolbar.perSubscriber': 'per subscriber',
    'toolbar.conversionRate': 'conversion rate',
    // ── Login pages (shared by admin + dashboard login.js) ──
    'login.sendCode': 'Send Verification Code',
    'login.sendingCode': 'Sending verification code…',
    'login.verifyCode': 'Verify Code & Sign In',
    'login.verifyingCode': 'Verifying code…',
    'login.signIn': 'Sign In',
    'login.signInPassword': 'Sign In with Password',
    'login.signingIn': 'Signing in…',
    'login.enterEmail': 'Please enter your email address',
    'login.enterCode': 'Please enter the 6-digit code from your email',
    'login.enterPassword': 'Please enter your password',
    'login.invalidOrExpiredCode': 'Invalid or expired verification code',
    'login.invalidEmailOrPassword': 'Invalid email or password',
    'login.failedToSendCode': 'Failed to send verification code',
    'login.emailDeliveryNotConfigured': 'Email delivery is not configured on server',
    'login.accessDeniedOrigin': 'Access denied: origin not allowed',
    'login.couldNotConnect': 'Could not connect to authentication server',
    'login.exchangeFailed': 'Sign-in succeeded but the session handoff failed. Please try again.',
    // B16: human labels for the server status enum (PocketBase
    // SelectField values: active/expired/grace_period/revoked/paused,
    // plus 'unused' for license keys). Unknown values fall back to raw.
    'status.active': 'Active',
    'status.expired': 'Expired',
    'status.grace_period': 'Grace Period',
    'status.revoked': 'Revoked',
    'status.paused': 'Paused',
    'status.unused': 'Unused',
    'login.resendPrompt': 'Did not receive code? Click below to resend.',
    'login.signingIn': 'Signing in…',
    'login.resendIn': 'Resend code in ',
    'login.tryAgainIn': 'Try again in ',
    'login.seconds': 's',
    'login.codeSent': '✓ Verification code sent! Please check your email inbox (and spam folder).',
    'login.codeVerified': '✓ Code verified! Signing in…',
    'login.signingInNow': '✓ Signing in…',
    'login.invalidOrExpiredCodeShort': 'Invalid or expired code',
    // ── User dashboard SPA (dashboard.js) ──
    'dash.account': 'Account',
    'dash.dashboard': 'Dashboard',
    'dash.yourAccount': 'Your account at a glance',
    'dash.subscription': 'Subscription',
    'dash.license': 'License',
    'dash.devices': 'Devices',
    'dash.maxStores': 'Max Stores',
    'dash.maxTerminal': 'Max Terminal',
    'dash.maxKds': 'Max KDS',
    'dash.stores': 'stores',
    'dash.registers': 'registers',
    'dash.screens': 'screens',
    'dash.currentPlan': 'current plan',
    'dash.copy': 'Copy',
    'dash.copied': '✓ Copied',
    'dash.noActiveSubscription': 'No active subscription.',
    'dash.viewPricing': 'View pricing',
    'dash.noDevices': 'No registered devices yet. Activate the app on a terminal to register it.',
    'dash.registeredTerminals': 'registered terminals',
    'dash.activePlans': 'active plans',
    'dash.entitlement': 'entitlement',
    'dash.machine': 'Machine',
    'dash.registered': 'Registered',
    'dash.status': 'Status',
    'dash.tier': 'Tier',
    'dash.key': 'Key',
    'dash.starts': 'Starts',
    'dash.expires': 'Expires',
    'dash.graceUntil': 'Grace until',
    'dash.free': 'Free',
    'dash.email': 'Email',
    'dash.emailVerified': 'Email verified',
    'dash.verified': '✓ Verified',
    'dash.unverified': '○ Unverified',
    'dash.couldNotLoad': 'Could not load the dashboard: ',
    'auth.accessDenied': 'Access denied',
    // P3: auth.signInAgain was previously a single string containing an
    // <a href="/__oz/logout" style="color:var(--accent)"> tag, injected
    // via innerHTML — an HTML-in-i18n pattern that is a footgun for future
    // editors. Split into three text-only keys so the admin.js access-denied
    // card builds the link via DOM API (el('a', ...)), not innerHTML.
    'auth.signInAgainBefore': 'Your session is not authorized for the admin panel. If you are the admin, please ',
    'auth.signInAgainLink': 'sign in again',
    'auth.signInAgainAfter': '.',
  };

  function t(key) {
    return STRINGS[key] !== undefined ? STRINGS[key] : key;
  }

  return {
    el: el,
    escapeHtml: escapeHtml,
    fmtIdr: fmtIdr,
    fmtUsd: fmtUsd,
    fmtMonthTick: fmtMonthTick,
    statusPill: statusPill,
    svgChart: svgChart,
    svgDonut: svgDonut,
    kpiC: kpiC,
    statC: statC,
    tableCard: tableCard,
    tenantRow: tenantRow,
    tenantDetailRows: tenantDetailRows,
    revokeConfirmModal: revokeConfirmModal,
    svgBarChart: svgBarChart,
    svgStackedBars: svgStackedBars,
    chartTipText: chartTipText,
    nearestChartIndex: nearestChartIndex,
    bindChartTooltip: bindChartTooltip,
    chartMonthLabel: chartMonthLabel,
    normalizeStats: normalizeStats,
    startLockoutCountdown: startLockoutCountdown,
    startCountdown: startCountdown,
    stopCountdown: stopCountdown,
    countdownActive: countdownActive,
    setAuthMode: setAuthMode,
    busyWrap: busyWrap,
    fetchFxRate: fetchFxRate,
    fxTimeLabel: fxTimeLabel,
    stripAnsi: stripAnsi,
    logTsWib: logTsWib,
    logView: logView,
    cfDeployRows: cfDeployRows,
    relTime: relTime,
    sparkline: sparkline,
    nfStatusCard: nfStatusCard,
    uptimeRows: uptimeRows,
    mountModal: mountModal,
    flashMessage: flashMessage,
    fetchWithTimeout: fetchWithTimeout,
    exchangeUrlFrom: exchangeUrlFrom,
    isLockoutActive: isLockoutActive,
    setNavActive: setNavActive,
    statusLabel: statusLabel,
    createSeqGuard: createSeqGuard,
    t: t,
    STRINGS: STRINGS,
    isAuthDenied: isAuthDenied,
    authDeniedError: authDeniedError,
  };
}));