    const API = (window.__OZ_CONFIG__ && window.__OZ_CONFIG__.licenseApiUrl) || 'https://license.kasir.mu';
    let currentTab = 'dashboard';
    // Health-tab auto-refresh interval handles; cleared when the health
    // tab is left so tab switches never leave orphan timers firing.
    let healthTimers = [];

    // ── FX rate (live from open.er-api.com, fallback to 16000) ───
    let fxRate = 16000;
    let fxUpdatedAt = '';
    let fxLive = false;
    // fetchFxRate (with its B10 timeout) comes from admin-utils.js; the
    // old local copy awaited an un-timed fetch and could hang the whole
    // dashboard render. State is applied at the call site below.

    // ── Helpers ──────────────────────────────────────────────────────
    // el, escapeHtml, fmtIdr, fmtUsd, statusPill, svgChart, svgDonut are
    // defined in admin-utils.js (loaded first) so they're unit-testable.
    // admin-utils.js sets these as globals for backward compatibility.

    async function api(path, body, method) {
      // B12 fix: both fetches go through admin-utils.fetchWithTimeout —
      // the old un-timed awaits left the whole render pending forever on
      // a hung connection (skeleton, no retry UI, no console error).
      // Phase 4: third arg sets PATCH/DELETE explicitly; the historic
      // contract (body ⇒ POST, no body ⇒ GET) is unchanged for the
      // existing call sites.
      const sess = await fetchWithTimeout(undefined, '/__oz/session');
      const token = (await sess.json()).token;
      const opts = { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };
      if (body) { opts.method = method || 'POST'; opts.body = body; }
      const res = await fetchWithTimeout(undefined, API + path, opts);
      if (isAuthDenied(res.status)) {
        // P3: build the card via DOM API (el() uses textContent), NOT
        // innerHTML — the sign-in-again message is text-only i18n now, and
        // a future translator cannot accidentally inject markup.
        const card = el('div', 'card');
        card.style.cssText = 'text-align:center;padding:2rem';
        const h2 = el('h2', null, t('auth.accessDenied'));
        h2.style.cssText = 'margin:0 0 .5rem;color:var(--bad)';
        card.appendChild(h2);
        const p = el('p', 'empty');
        p.appendChild(document.createTextNode(t('auth.signInAgainBefore')));
        const link = el('a', null, t('auth.signInAgainLink'));
        link.href = '/__oz/logout';
        link.style.color = 'var(--accent)';
        p.appendChild(link);
        p.appendChild(document.createTextNode(t('auth.signInAgainAfter')));
        card.appendChild(p);
        const content = document.getElementById('content');
        content.innerHTML = '';
        content.appendChild(card);
        // Throw so callers don't overwrite the access-denied screen with a
        // generic error state (the fetch was fine; auth is the problem).
        throw authDeniedError(path);
      }
      if (!res.ok) throw new Error(path + ' (' + res.status + ')');
      return res.json();
    }

    // ── SVG chart helpers ────────────────────────────────────────────
    // svgChart, svgDonut are defined in admin-utils.js (loaded first).

    // ── Dashboard tab ────────────────────────────────────────────────
    // P3 fix (review): renderDashboard had no sequence guard — a slow stats
    // response landing after the user switched tabs overwrote the tenants/
    // health view. Same last-click-wins pattern as renderTenants (B15).
    const dashboardGuard = createSeqGuard();
    async function renderDashboard(background, forceRefresh) {
      // Build into a detached fragment and swap only when fully rendered —
      // a background refresh never flashes a skeleton over the live view.
      const c = el('div');
      const seq = dashboardGuard.next();

      // Load real stats; on failure show an error state (no MOCK fallback).
      // ?refresh=1 bypasses the 5-minute provider-revenue cache on the server.
      let stats = null;
      let loadError = null;
      try { stats = await api('/api/v1/admin/stats' + (forceRefresh ? '?refresh=1' : '')); } catch (err) { loadError = err; }
      // A newer render superseded this one while we awaited — drop out.
      if (!dashboardGuard.isCurrent(seq)) { return; }
      if (!stats) {
        // api() already rendered an "Access denied" screen for 401/403 —
        // don't overwrite it with a generic error. Only show the retry UI
        // for network / server errors. A BACKGROUND refresh keeps the
        // last good view mounted instead of replacing it with an error.
        if (loadError && loadError.authDenied) { return; }
        if (background) { return; }
        c.innerHTML =
          '<div class="card" style="text-align:center;padding:2rem">' +
          '<h2 style="margin:0 0 .5rem;color:var(--bad)">' + t('common.statsUnavailable') + '</h2>' +
          '<p class="empty">' + t('common.statsApiNoResponse') + '</p>' +
          '<button class="btn" id="retry-stats">' + t('common.retry') + '</button>' +
          '</div>';
        const retry = document.getElementById('retry-stats');
        if (retry) { retry.addEventListener('click', () => renderDashboard(false)); }
        setTabContent('dashboard', c);
        return;
      }
      // B6 fix: normalizeStats guarantees the array/kpis shapes the render
      // below dereferences — previously a partial payload made
      // m.revenueTrend.forEach throw before any chart guard could run.
      const m = normalizeStats(stats);

      // FX rate: prefer the real endpoint's value; otherwise fetch live.
      if (m.kpis.fxRate) { fxRate = m.kpis.fxRate; fxLive = !!m.kpis.fxLive; fxUpdatedAt = m.kpis.fxUpdatedAt || ''; }
      else {
        const fx = await fetchFxRate();
        if (!dashboardGuard.isCurrent(seq)) { return; } // superseded mid-fx-fetch
        if (fx.live) { fxRate = fx.rate; fxLive = true; fxUpdatedAt = fx.updatedAt; }
        else { fxLive = false; }
      }
      // Convert all revenue data to IDR — but keep the server's
      // provider-verified per-month idr when present (revenue_events
      // ledger writes BOTH currencies at webhook time; re-deriving idr
      // from usd×fx would double-convert Midtrans IDR and drift with the
      // live rate). Fall back to usd×fx only when the server sent no idr
      // (older server build / estimate months).
      m.revenueTrend.forEach(d => { if (!(d.idr > 0)) d.idr = Math.round((d.usd || 0) * fxRate); });

      c.innerHTML = '';

      // --- Page head: title + context caption + FX chip (design-language
      //     page header — one h1 per page, secondary caption in muted) ---
      const head = el('div', 'page-head');
      const headTitle = el('div');
      headTitle.appendChild(el('h1', null, t('dashboard.title')));
      headTitle.appendChild(el('p', 'page-sub', t('kpi.totalSubscribers') + ' ' + m.kpis.totalSubscribers + ' · ' + t('kpi.activeTerminals') + ' ' + m.kpis.activeDevices));
      const fx = el('div', 'fx-chip');
      const fxDot = el('span', null, fxLive ? '●' : '○');
      fxDot.style.color = fxLive ? 'var(--ok)' : 'var(--warn)';
      fx.appendChild(fxDot);
      fx.appendChild(document.createTextNode(`1 USD = ${fxRate.toLocaleString()} IDR`));
      if (fxUpdatedAt) { const lbl = fxTimeLabel(fxUpdatedAt); if (lbl) fx.appendChild(el('span', 'small', ` (${lbl})`)); }
      if (!fxLive) fx.appendChild(el('span', 'small', t('common.stale')));
      head.appendChild(headTitle);
      head.appendChild(fx);
      c.appendChild(head);

      // --- Hero: the ONE brand-colored highlight card per view
      //     (design-language → Cards → Highlight) — revenue is the hero.
      //     Value = provider-verified monthly gross (revenue_events ledger
      //     from Paddle/Midtrans webhooks); the source chip tells the
      //     operator whether it is real money or a subscription estimate.
      // Source chip: provider-verified webhook gross vs subscription
      // estimate.  An older server build sends neither grossSource nor
      // monthlyGrossUsd — that must read as "estimate", never as verified
      // money.
      const heroIsEstimate = m.kpis.grossSource === 'estimate' || !m.kpis.grossSource || !(m.kpis.monthlyGrossUsd > 0);
      const heroSrc = heroIsEstimate ? t('common.estimate') : t('common.providerVerified');
      // Hero value: provider-verified monthly gross ONLY.  When the server
      // sends no verified gross (monthlyGrossIdr 0 / grossSource estimate)
      // the hero must show 0 — a manual DB tier override (free→plus) creates
      // a subscription row but NO webhook payment, and the MRR projection
      // must not be recycled into the gross number.  MRR is always shown
      // separately in the hero sub-line.
      const heroIdr = m.kpis.monthlyGrossIdr > 0 ? m.kpis.monthlyGrossIdr : 0;
      const hero = el('div', 'hero-card');
      // Label: include the current month so the operator knows what period
      // the gross covers, and a refresh button.
      const heroLabelRow = el('div', 'hero-label-row');
      const heroLabel = el('span', 'hero-label', t('kpi.monthlyGrossIdr') + ' · ' + new Date().toLocaleString('en', { month: 'short', year: 'numeric' }));
      const refreshBtn = el('button', 'hero-refresh');
      refreshBtn.type = 'button';
      refreshBtn.textContent = '↻';
      refreshBtn.title = t('common.refresh');
      refreshBtn.addEventListener('click', function () { renderDashboard(false, true); });
      heroLabelRow.appendChild(heroLabel);
      heroLabelRow.appendChild(refreshBtn);
      hero.appendChild(heroLabelRow);
      hero.appendChild(el('div', 'hero-value', fmtIdr(heroIdr)));
      const heroChip = el('span', 'hero-chip', heroSrc);
      heroChip.style.cssText = 'font-size:.72rem;opacity:.75;font-weight:600;letter-spacing:.03em;text-transform:uppercase';
      const heroSub = el('div', 'hero-sub');
      heroSub.appendChild(heroChip);
      // Net keepable: gross minus refunds this month (when refunds exist).
      const monthRefund = m.kpis.monthlyRefundIdr > 0 ? m.kpis.monthlyRefundIdr : 0;
      heroSub.appendChild(document.createTextNode(` · ${t('kpi.mrr')} ${fmtUsd(m.kpis.mrrUsd)} (${t('common.estimate')}) · ${t('kpi.arpu')} ${fmtUsd(m.kpis.arpuUsd)}`));
      if (monthRefund > 0) {
        const refundChip = el('span', 'hero-chip', '−' + t('common.refunds') + ' ' + fmtIdr(monthRefund));
        refundChip.style.cssText = 'font-size:.72rem;opacity:.9;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--bad)';
        heroSub.appendChild(refundChip);
      }
      // Last-refreshed timestamp (provider ledger cache time, not fetch time).
      if (m.kpis.revenueCachedAt) {
        const fresht = new Date(m.kpis.revenueCachedAt);
        if (!isNaN(fresht.getTime())) {
          heroSub.appendChild(el('span', 'small', ' · ' + t('common.refreshedAt') + ' ' + fresht.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })));
        }
      }
      hero.appendChild(heroSub);
      c.appendChild(hero);

      // --- Stats row: tinted stat cards (spec: tinted bg + 20% border +
      //     hero number in the semantic color, used sparingly) ---
      const statGrid = el('div', 'stat-grid');
      statGrid.appendChild(statC(t('kpi.totalUsers'), String(m.kpis.totalUsers), m.kpis.activeUsers + ' ' + t('common.active'), 'primary'));
      statGrid.appendChild(statC(t('kpi.totalSubscribers'), String(m.kpis.totalSubscribers), t('toolbar.nonFree'), 'success'));
      statGrid.appendChild(statC(t('kpi.activeTerminals'), String(m.kpis.activeDevices), t('toolbar.perSubscriber'), 'info'));
      statGrid.appendChild(statC(t('kpi.trialToPaid'), m.kpis.trialToPaidRate + '%', t('toolbar.conversionRate'), 'warning'));
      c.appendChild(statGrid);

      // --- Revenue section: full-width trend + tier/provider distribution ---
      c.appendChild(el('h2', 'section-title', t('section.revenue')));
      const chartGrid = el('div', 'chart-grid');
      // Chart canvas variant: the 1280-wide "wide" canvases are 1:1 on a
      // desktop full-row card but downscale chart text to ~3px on a phone
      // card. The phone variant renders ~1:1 (labels at true size).
      // Half-width cards (2-column grid, ~620px) MUST use the narrow 600px
      // viewBox instead of wide — otherwise the 1280 viewBox gets downscaled
      // 0.48× and 9px text becomes ~4.3px.
      const cvPhone = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
      const fullCv = cvPhone ? { phone: true } : { wide: true };
      const halfCv = cvPhone ? { phone: true } : {}; // narrow (600px) — proportional to half-column

      // Revenue trend (spans the full row — the hero chart)
      const revCard = el('div', 'chart-card chart-card--wide');
      revCard.appendChild(el('h3', null, t('chart.revenueTrendIdr')));
      // Subtitle: how many months have provider-verified data vs estimate.
      const verifiedCount = m.revenueTrend.filter(function (d) { return d.source !== 'estimate'; }).length;
      if (verifiedCount > 0) revCard.appendChild(el('p', 'chart-sub', verifiedCount + ' of ' + m.revenueTrend.length + ' ' + t('chart.monthsVerified')));
      revCard.innerHTML += svgChart('rev', m.revenueTrend, ['idr'], Object.assign({ area: true, sourceKey: 'source', fmt: v => 'Rp' + (v/1000000).toFixed(1) + 'jt' }, fullCv));
      chartGrid.appendChild(revCard);
      // Hover tooltip: month + exact gross (IDR) value under the cursor.
      bindChartTooltip(revCard.querySelector('.chart-svg'), m.revenueTrend, [{ key: 'idr', label: t('kpi.monthlyGrossIdr') }], v => fmtIdr(Math.round(v)), 'line');

      // Provider revenue mix (stacked bars — recommendation #2): each month
      // shows the Paddle (IDR, write-time converted) + Midtrans (native IDR)
      // portions stacked, so the provider mix of gross is visible at a
      // glance instead of a single mixed-currency total. Estimate months
      // (no provider events) render an empty slot, matching the dashed
      // segment on the trend line.
      const mixCard = el('div', 'chart-card chart-card--wide');
      const mixHead = el('div', 'chart-head');
      mixHead.appendChild(el('h3', null, t('chart.revenueByProvider')));
      mixHead.appendChild(el('span', 'chart-legend', '<span class="sw sw--paddle"></span>Paddle <span class="sw sw--midtrans"></span>Midtrans'));
      mixCard.appendChild(mixHead);
      mixCard.innerHTML += svgStackedBars('mix', m.revenueTrend, Object.assign({
        stack: [
          { key: 'paddleIdr', color: 'var(--primary)' },
          { key: 'midtransIdr', color: 'var(--success)' },
        ],
        fmt: v => 'Rp' + (v/1000000).toFixed(1) + 'jt',
      }, fullCv));
      chartGrid.appendChild(mixCard);
      bindChartTooltip(mixCard.querySelector('.chart-svg'), m.revenueTrend, [
        { key: 'paddleIdr', label: 'Paddle' },
        { key: 'midtransIdr', label: 'Midtrans' },
      ], v => 'Rp' + (v/1000000).toFixed(1) + 'jt');

      // Tier distribution (donut)
      const tierCard = el('div', 'chart-card');
      tierCard.appendChild(el('h3', null, t('chart.tierDistribution')));
      const donut = svgDonut('tiers', m.tierDistribution, 'tier', 'count');
      const tierRow = el('div', 'donut-row');
      const donutDiv = el('div', 'donut-chart'); donutDiv.innerHTML = donut.svg;
      tierRow.appendChild(donutDiv);
      const legendDiv = el('div', 'donut-legend'); legendDiv.innerHTML = donut.legend;
      tierRow.appendChild(legendDiv);
      tierCard.appendChild(tierRow);
      chartGrid.appendChild(tierCard);

      // Provider split (donut)
      const provCard = el('div', 'chart-card');
      provCard.appendChild(el('h3', null, t('chart.paymentProvider')));
      const donut2 = svgDonut('prov', m.providerSplit, 'provider', 'count', ['var(--primary)', 'var(--success)']);
      const provRow = el('div', 'donut-row');
      const donutDiv2 = el('div', 'donut-chart'); donutDiv2.innerHTML = donut2.svg;
      provRow.appendChild(donutDiv2);
      const legendDiv2 = el('div', 'donut-legend'); legendDiv2.innerHTML = donut2.legend;
      provRow.appendChild(legendDiv2);
      provCard.appendChild(provRow);
      chartGrid.appendChild(provCard);
      c.appendChild(chartGrid);

      // --- Growth section: subscribers + signups + monthly churn ---
      c.appendChild(el('h2', 'section-title', t('section.growth')));
      const chartGrid2 = el('div', 'chart-grid');

      // Subscriber growth
      const subCard = el('div', 'chart-card');
      subCard.appendChild(el('h3', null, t('chart.subscriberGrowth')));
      subCard.innerHTML += svgChart('subs', m.subscriberGrowth, ['count'], Object.assign({ area: true }, halfCv));
      chartGrid2.appendChild(subCard);
      bindChartTooltip(subCard.querySelector('.chart-svg'), m.subscriberGrowth, [{ key: 'count', label: t('kpi.totalSubscribers') }], undefined, 'line');

      // Signups per month (bar chart — extracted to admin-utils.svgBarChart)
      const signupCard = el('div', 'chart-card');
      signupCard.appendChild(el('h3', null, t('chart.signupsPerMonth')));
      signupCard.innerHTML += svgBarChart('signups', m.signupsPerMonth, Object.assign({ valueKey: 'count', color: 'var(--accent)' }, halfCv));
      chartGrid2.appendChild(signupCard);
      bindChartTooltip(signupCard.querySelector('.chart-svg'), m.signupsPerMonth, [{ key: 'count', label: t('chart.signupsPerMonth') }]);

      // Churn per month — B3 fix: the server's churnPerMonth rows carry the
      // number in `churn` (count is Go's zero value), so the old inline code
      // reading d.count rendered permanently-zero/NaN bars. Churn also reused
      // the signups barW; each chart now sizes itself. Wide row: monthly
      // bars read better with room.
      const churnCard = el('div', 'chart-card chart-card--wide');
      churnCard.appendChild(el('h3', null, t('chart.churnCanceled')));
      churnCard.innerHTML += svgBarChart('churn', m.churnPerMonth, Object.assign({ valueKey: 'churn', color: 'var(--bad)' }, fullCv));
      chartGrid2.appendChild(churnCard);
      bindChartTooltip(churnCard.querySelector('.chart-svg'), m.churnPerMonth, [{ key: 'churn', label: t('chart.churnCanceled') }]);

      // Trial→paid funnel (#6): stacked bars showing paid conversions (green)
      // within each month's total trials (total bar height = trials started).
      if (m.trialFunnel && m.trialFunnel.length > 0) {
        const funnelData = m.trialFunnel.map(function (d) { return { month: d.month, paid: d.paid, notConverted: Math.max(0, d.trials - d.paid) }; });
        const totalTrials = funnelData.reduce(function (s, d) { return s + d.paid + d.notConverted; }, 0);
        if (totalTrials > 0) {
          const funnelCard = el('div', 'chart-card chart-card--wide');
          funnelCard.appendChild(el('h3', null, t('chart.trialFunnel')));
          funnelCard.innerHTML += svgStackedBars('funnel', funnelData, Object.assign({
            stack: [
              { key: 'paid', color: 'var(--success)' },
              { key: 'notConverted', color: 'var(--tint-warning-bg)' },
            ],
            fmt: function (v) { return String(v); },
          }, fullCv));
          chartGrid2.appendChild(funnelCard);
          bindChartTooltip(funnelCard.querySelector('.chart-svg'), m.trialFunnel, [
            { key: 'trials', label: 'Trials' },
            { key: 'paid', label: 'Paid' },
          ]);
        }
      }

      c.appendChild(chartGrid2);

      // --- Tables ---
      // Top subscribers
      if (m.topSubscribers && m.topSubscribers.length > 0) {
        c.appendChild(tableCard(t('table.topSubscribers'), [t('th.email'),t('th.tier'),t('kpi.mrr'),t('th.renewal'),t('th.provider')], m.topSubscribers.map(d => [d.email, d.tier, fmtUsd(d.mrrUsd), d.renewal, d.provider])));
      }
      // Recent revenue events (#5): the last webhook-verified charges, most
      // recent first — the operator sees money arriving near-real-time.
      if (m.recentRevenueEvents && m.recentRevenueEvents.length > 0) {
        const fmtTime = (iso) => {
          const d = new Date(iso);
          if (isNaN(d.getTime())) return iso || '';
          return d.toLocaleString('en', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        };
        c.appendChild(tableCard(t('table.recentRevenueEvents'),
          [t('th.email'), t('th.provider'), t('th.tier'), t('th.amount'), t('th.when')],
          m.recentRevenueEvents.map(d => [d.email || '—', d.provider || '—', d.tier || '—', fmtIdr(d.amountIdr), fmtTime(d.created)])));
      }
      // Recent signups
      if (m.recentSignups && m.recentSignups.length > 0) {
        c.appendChild(tableCard(t('table.recentSignups'), [t('th.email'),t('th.created'),t('th.emailVerified'),t('th.tier')], m.recentSignups.map(d => [d.email, d.created, d.verified ? '✓' : '○', d.tier])));
      }
      // Expiring soon
      if (m.expiringSoon && m.expiringSoon.length > 0) {
        c.appendChild(tableCard(t('table.expiringSoon'), [t('th.email'),t('th.tier'),t('th.expires'),t('th.daysLeft')], m.expiringSoon.map(d => [d.email, d.tier, d.expiresAt, String(d.daysLeft)])));
      }
      // Needs attention (#4): surfaced ABOVE the revenue hero so the
      // operator sees action items before the numbers. Build-integrity
      // violations and over-quota devices (ADR #57 §2.4), then grace-period
      // subscriptions, expired-but-active keys, and recent refunds.
      if (m.needsAttention && m.needsAttention.length > 0) {
        const attCard = el('div', 'card alert-card');
        attCard.appendChild(el('h2', null, t('alert.title')));
        const attList = el('ul', 'alert-list');
        m.needsAttention.forEach(item => {
          const li = el('li', 'alert-item alert-item--' + item.type);
          // Severity, not decoration. A tampered build (ADR #57 §2.1) and a
          // refund are both BAD — act now; everything else is a warning to
          // triage. The old nested ternary sent every unrecognised type to
          // --warn, which would have rendered a re-signed APK as a mere
          // warning: the one finding on this panel with a security cause.
          const BAD_TYPES = ['refund', 'integrity_mismatch'];
          const cls = 'alert-badge alert-badge--' + (BAD_TYPES.includes(item.type) ? 'bad' : 'warn');
          li.appendChild(el('span', cls, t('alert.' + item.type)));
          li.appendChild(el('span', 'alert-email', item.email || '—'));
          li.appendChild(el('span', 'alert-detail', item.detail || ''));
          if (item.tier) li.appendChild(el('span', 'alert-tier', item.tier));
          if (item.at) li.appendChild(el('span', 'alert-at', item.at));
          attList.appendChild(li);
        });
        attCard.appendChild(attList);
        c.insertBefore(attCard, c.firstChild);
      }
      setTabContent('dashboard', c);
    }

// kpiC, tableCard are defined in admin-utils.js (loaded first).

    // ── Phase 4 capability probe ────────────────────────────────────
    // The lifecycle endpoints (edit/grant/delete/device-revoke/exact-date
    // renew) only exist on license-server 0.0.34+. Until the server is
    // redeployed, the UI must not offer controls that can only fail —
    // worse, an exact-date renew against the old server would silently
    // fall back to +365 days. One cheap /admin/health call at boot gives
    // an honest gate; the controls appear as soon as the server reports
    // the new version.
    let lifecycleReady = false;
    async function probeLifecycle() {
      try {
        const h = await api('/api/v1/admin/health');
        lifecycleReady = String((h && h.version) || '') >= '0.0.34';
      } catch { lifecycleReady = false; }
      return lifecycleReady;
    }
    probeLifecycle();

    // ── Tab switching: cached DOM + per-card background refresh ─────
    // Clicking back to an earlier tab used to re-fetch everything and
    // rebuild the DOM from zero (a full reload per switch). Each tab's
    // DOM is now built once and cached; revisiting mounts it instantly
    // and every card refreshes its own data BEHIND the cached view
    // (stale-while-revalidate) — content swaps only when fresh data has
    // fully arrived, so there is never a skeleton flash.
    const tabCache = { dashboard: null, tenants: null, health: null };
    function setTabContent(name, node) {
      tabCache[name] = node;
      if (currentTab === name) {
        const content = document.getElementById('content');
        content.innerHTML = '';
        content.appendChild(node);
      }
    }
    function refreshTab(name) {
      // Never yank state from under an open dialog.
      if (document.querySelector('.modal-back')) return;
      if (name === 'dashboard') renderDashboard(true);
      if (name === 'tenants') renderTenants(true);
      if (name === 'health') { startHealthAuto(); if (healthLoader) healthLoader.refreshAll(); }
    }
    function showTab(name) {
      if (currentTab === 'health' && name !== 'health') stopHealthAuto();
      currentTab = name;
      if (!tabCache[name]) {
        const content = document.getElementById('content');
        content.innerHTML = '<div class="skeleton" style="height:8rem"></div>';
        if (name === 'dashboard') renderDashboard(false);
        if (name === 'tenants') renderTenants(false);
        if (name === 'health') buildHealthTab();
        return;
      }
      const content = document.getElementById('content');
      content.innerHTML = '';
      content.appendChild(tabCache[name]);
      refreshTab(name);
    }
    // B38: use setNavActive so aria-current moves with .nav-active — the
    // screen reader must know which admin section is open.
    document.querySelectorAll('.nav-btn').forEach(tab => {
      tab.addEventListener('click', () => {
        setNavActive(document.querySelectorAll('.nav-btn'), tab);
        showTab(tab.dataset.tab);
      });
    });

    // ── Tenants list (from ADR #42 Phase 3) — search + pagination ─────
    let tenants = [];
    let tenantsPage = 1;
    let tenantsPerPage = 25;
    let tenantsTotal = 0;
    let tenantsSearch = '';
    // B15: sequence guard — a slow response for a superseded page/search
    // must not overwrite the newer view (last-click-wins, not
    // last-arrival-wins).
    const tenantsGuard = createSeqGuard();

    async function renderTenants(background) {
      // Detached build + single swap: a background refresh (cache hit,
      // pagination, search) never flashes a skeleton over the live view.
      const c = el('div');
      const seq = tenantsGuard.next();
      if (!background) c.appendChild(el('p', 'empty', t('common.loadingTenants')));
      let data;
      try {
        const qs = '?page=' + tenantsPage + '&perPage=' + tenantsPerPage +
          (tenantsSearch ? '&search=' + encodeURIComponent(tenantsSearch) : '');
        data = await api('/api/v1/admin/tenants' + qs);
      } catch (err) { if (!tenantsGuard.isCurrent(seq)) { return; } if (err && err.authDenied) { return; } if (background) { return; } c.appendChild(el('p', 'empty', t('common.failedToLoadTenants'))); setTabContent('tenants', c); return; }
      if (!tenantsGuard.isCurrent(seq)) { return; } // a newer request superseded this one
      tenants = data.tenants || [];
      tenantsTotal = data.total || 0;

      // ── Search + pagination toolbar ─────────────────────────────
      const toolbar = el('div', 'tenant-toolbar');
      const searchBox = el('input', 'input search-input');
      searchBox.placeholder = t('toolbar.searchPlaceholder');
      searchBox.value = tenantsSearch;
      searchBox.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { tenantsSearch = searchBox.value.trim(); tenantsPage = 1; renderTenants(); }
      });
      const searchBtn = el('button', 'btn btn-sm', t('toolbar.search'));
      searchBtn.addEventListener('click', () => { tenantsSearch = searchBox.value.trim(); tenantsPage = 1; renderTenants(); });
      const clearBtn = el('button', 'btn btn-sm btn-ghost', t('toolbar.clear'));
      clearBtn.addEventListener('click', () => { tenantsSearch = ''; searchBox.value = ''; tenantsPage = 1; renderTenants(); });
      // Search field wrapper: icon + input, so the search affordance is
      // obvious in both themes (the bare field was nearly invisible on
      // the white card in light theme).
      const searchField = el('div', 'search-field');
      searchField.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
      searchField.appendChild(searchBox);
      toolbar.appendChild(searchField); toolbar.appendChild(searchBtn); toolbar.appendChild(clearBtn);
      const totalLabel = el('span', 'tenant-total', t('toolbar.showing') + tenants.length + t('toolbar.of') + tenantsTotal);
      toolbar.appendChild(totalLabel);
      c.appendChild(toolbar);

      // table-card (not just card): the tenants table keeps its readable
      // column widths on phones and scrolls horizontally INSIDE the card
      // instead of pushing the whole page wide (mobile audit finding).
      const card = el('div', 'card table-card'); card.appendChild(el('h2', null, t('table.tenants')));
      if (tenants.length === 0) { card.appendChild(el('p', 'empty', t('table.noTenantsMatch'))); c.appendChild(card); setTabContent('tenants', c); return; }
      const table = el('table');
      const thead = el('thead'); const tr = el('tr');
      // Columns (user-requested): email | status | license/tier merged
      // ("[tier] date expired") | created | details action.
      [t('th.email'),t('th.status'),t('th.licenseTier'),t('th.created'),''].forEach(h => tr.appendChild(el('th', null, h)));
      thead.appendChild(tr); table.appendChild(thead);
      const tbody = el('tbody');
      // B1 fix: the row builder moved to admin-utils.tenantRow — the old
      // inline callback named its parameter `t`, shadowing the i18n t()
      // helper, so t('tenant.details') threw and the table never rendered.
      tenants.forEach(tenant => tbody.appendChild(tenantRow(tenant, showTenantDetail)));
      table.appendChild(tbody); card.appendChild(table); c.appendChild(card);

      // ── Pagination controls ─────────────────────────────────────
      const totalPages = Math.max(1, Math.ceil(tenantsTotal / tenantsPerPage));
      if (totalPages > 1) {
        const nav = el('div', 'pagination');
        const prev = el('button', 'btn btn-sm btn-ghost', t('toolbar.prev'));
        prev.disabled = tenantsPage <= 1;
        prev.addEventListener('click', () => { if (tenantsPage > 1) { tenantsPage--; renderTenants(); } });
        nav.appendChild(prev);
        const pageInfo = el('span', 'page-info', t('toolbar.page') + tenantsPage + t('toolbar.of') + totalPages);
        nav.appendChild(pageInfo);
        const next = el('button', 'btn btn-sm btn-ghost', t('toolbar.next'));
        next.disabled = tenantsPage >= totalPages;
        next.addEventListener('click', () => { if (tenantsPage < totalPages) { tenantsPage++; renderTenants(); } });
        nav.appendChild(next);
        c.appendChild(nav);
      }
      setTabContent('tenants', c);
    }

    // ── Tenant detail (from ADR #42 Phase 3) ────────────────────────
    async function showTenantDetail(id) {
      const modal = document.getElementById('modal-root');
      modal.innerHTML = '<div class="modal-back"><div class="modal"><h3>' + t('common.loading') + '</h3></div></div>';
      // Phase 4: re-probe on every detail open — the boot-time probe goes
      // stale across a server redeploy, and a panel that stayed open
      // through it would keep hiding the lifecycle controls. Awaiting it
      // keeps the button set in sync with the server that will serve them.
      await probeLifecycle();
      try {
        const data = await api('/api/v1/admin/tenants/' + id);
        // B2 fix: the old `const t = data.tenant` shadowed the global i18n
        // t(), so every t('…') label below threw TypeError and the modal
        // ALWAYS fell through to "Failed to load tenant detail". The kv
        // mapping now lives in admin-utils.tenantDetailRows (unit-tested).
        const tenant = data.tenant || {};
        const box = el('div', 'modal');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.appendChild(el('h3', null, t('tenant.title') + (tenant.email || '')));
        const kv = el('div'); kv.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:.5rem;font-size:.82rem';
        // Build the key-value grid safely — never innerHTML with API data.
        function addRow(label, val) {
          kv.appendChild(el('span', 'muted', label));
          const vs = el('span', null, val === undefined || val === null ? '—' : String(val));
          vs.style.textAlign = 'right';
          if (label === t('th.licenseKey')) { vs.style.cssText += ';font-family:var(--font-mono);font-size:.72rem'; }
          kv.appendChild(vs);
        }
        tenantDetailRows(data).forEach(pair => addRow(pair[0], pair[1]));
        box.appendChild(kv);
        // Phase 4: device inventory — the detail payload always carried
        // devices nobody could act on. Per-device revoke (busyWrap guard),
        // revoked devices shown as a badge; timestamps via relTime.
        if (data.devices && data.devices.length) {
          const devHead = el('p', 'muted', t('tenant.devices') + ' (' + data.devices.length + ')');
          devHead.style.cssText = 'margin:.9rem 0 .2rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em';
          box.appendChild(devHead);
          data.devices.forEach(d => {
            const row = el('div'); row.style.cssText = 'display:flex;align-items:center;gap:.5rem;font-size:.8rem;padding:.3rem 0;border-top:1px solid var(--border)';
            const mid = el('span', null, d.machine_id || d.id);
            mid.style.cssText = 'font-family:var(--font-mono);font-size:.72rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            row.appendChild(mid);
            if (d.revoked_at) {
              row.appendChild(el('span', 'muted', t('tenant.revoked')));
            } else {
              if (d.last_seen_at) {
                const seen = el('span', 'muted', t('tenant.lastSeen') + ' ' + relTime(d.last_seen_at));
                seen.style.cssText = 'font-size:.72rem';
                row.appendChild(seen);
              }
              const rv = el('button', 'btn btn-ghost btn-sm', t('tenant.revoke'));
              if (lifecycleReady) {
                rv.addEventListener('click', busyWrap(rv, async () => {
                  try {
                    await api('/api/v1/admin/tenants/' + id + '/devices/' + d.id + '/revoke', '{}');
                    flash(t('tenant.deviceRevoked') + ' ' + t('common.successfully'));
                    showTenantDetail(id); // reload the same dialog with fresh state
                  } catch { flash(t('tenant.deviceRevoked') + ' ' + t('common.failed')); }
                }));
                row.appendChild(rv);
              }
            }
            box.appendChild(row);
          });
        }
        // Drop the pre-fetch loading backdrop before mounting — mountModal
        // appends, so the stale "Loading…" card would otherwise stay
        // mounted underneath the real dialog (two modal-backs stacked).
        modal.innerHTML = '';
        const actions = el('div', null); actions.style.cssText = 'display:flex;gap:.4rem;margin-top:.8rem;flex-wrap:wrap';
        // B19: busyWrap (single-flight guard) on every action button —
        // Renew POSTs +365 days per call, so a double-click granted 730.
        // Phase 4: Edit contact opens the PATCH dialog (0.0.34+ only).
        if (lifecycleReady) {
          const editBtn = el('button', 'btn btn-sm btn-ghost', t('tenant.editContact'));
          editBtn.addEventListener('click', () => { closeModal(); editContactPrompt(id, data); });
          actions.appendChild(editBtn);
        }
        if (tenant.status === 'active') {
          // Confirm-by-email: revoke used to fire on a single click.
          const revoke = el('button', 'btn btn-sm btn-bad', t('tenant.revoke'));
          revoke.addEventListener('click', () => {
            // Close the detail dialog first — the confirm replaces it
            // (no two-dialog stack fighting over ESC/backdrop clicks).
            closeModal();
            // Body '{}' (not undefined): api() only sets method POST when
            // a body is given, and the server registers revoke as POST-only —
            // undefined body sent a GET and the action silently 404'd.
            const rc = revokeConfirmModal(tenant.email, () => doAction(id, 'revoke', t('tenant.revoked'), '{}', closeConfirm));
            var closeConfirm = mountModal(modal, rc.box);
            rc.cancelBtn.addEventListener('click', closeConfirm);
          });
          actions.appendChild(revoke);
        }
        if (tenant.status !== 'active') { const activate = el('button', 'btn btn-sm btn-ok', t('tenant.activate')); activate.addEventListener('click', busyWrap(activate, () => doAction(id,'activate',t('tenant.activated'),'{}',closeModal))); actions.appendChild(activate); }
        // Guarded renew: the endpoint 404s ("no subscription found") when
        // the tenant has no subscription record — disable + reword instead
        // of letting the admin press a button that can only fail.
        // Phase 4: renew opens a dialog — quick +365d OR an exact expiry
        // date (both re-sign server-side now). On a pre-0.0.34 server the
        // exact-date branch is hidden (it would silently become +365d).
        const hasSub = !!data.subscription;
        const renew = el('button', 'btn btn-sm', hasSub ? t('tenant.renew365') : t('tenant.renewNoSub'));
        if (hasSub) {
          renew.addEventListener('click', () => { closeModal(); if (lifecycleReady) { renewPrompt(id); } else { doAction(id, 'renew', t('tenant.renewed'), '{"days":365}', null); } });
        } else { renew.disabled = true; renew.title = t('tenant.renewNoSubTip'); renew.setAttribute('aria-disabled', 'true'); }
        actions.appendChild(renew);
        // Manual grant (Phase 4): transfer/e-wallet customers with no
        // subscription record — the dead-end that used to disable renew
        // AND silently no-op tier-override.
        if (!hasSub && lifecycleReady) {
          const grant = el('button', 'btn btn-sm btn-ok', t('tenant.grantTitle'));
          grant.addEventListener('click', () => { closeModal(); grantPrompt(id); });
          actions.appendChild(grant);
        }
        const upgrade = el('button', 'btn btn-sm btn-warn', t('tenant.upgrade')); upgrade.addEventListener('click', () => { closeModal(); upgradePrompt(id,data); }); actions.appendChild(upgrade);
        box.appendChild(actions);
        // B11: mountModal owns the backdrop/ESC/close wiring and always
        // detaches the keydown listener — the old inline blocks leaked one
        // listener per non-ESC close, and each stale handler kept reacting
        // to later ESC presses.
        const closeModal = mountModal(modal, box);
        const closeBtn = el('button', 'btn btn-ghost', t('tenant.close')); closeBtn.style.cssText = 'margin-top:.8rem;width:100%'; closeBtn.addEventListener('click', closeModal); box.appendChild(closeBtn);
        // Phase 4: guarded cascade delete — full-width destructive row at
        // the very bottom, confirm-by-email with a cascade warning.
        // (0.0.34+ only; hidden against the old server.)
        if (lifecycleReady) {
          const del = el('button', 'btn btn-sm btn-bad', t('tenant.delete'));
          del.style.cssText = 'margin-top:.4rem;width:100%';
          del.addEventListener('click', () => {
            closeModal();
            const rc = revokeConfirmModal(tenant.email, async () => {
              const modalRoot = document.getElementById('modal-root');
              try {
                await api('/api/v1/admin/tenants/' + id, JSON.stringify({ confirm_email: tenant.email }), 'DELETE');
                modalRoot.innerHTML = '';
                flash(t('tenant.deleted') + ' ' + t('common.successfully'));
                renderTenants();
              } catch (err) {
                if (err && err.authDenied) { modalRoot.innerHTML = ''; return; }
                flash(t('tenant.delete') + ' ' + t('common.failed'));
              }
            }, { title: t('tenant.deleteTitle'), hint: t('tenant.deleteHint'), confirmLabel: t('tenant.deleteConfirm'), extraWarn: t('tenant.deleteWarn') });
            const closeDelete = mountModal(modal, rc.box);
            rc.cancelBtn.addEventListener('click', closeDelete);
          });
          box.appendChild(del);
        }
      } catch (err) {
        if (err && err.authDenied) { modal.innerHTML = ''; return; }
        modal.innerHTML = '<div class="modal-back"><div class="modal"><p class="empty">' + t('common.failedToLoadTenantDetail') + '</p></div></div>';
      }
    }

    async function doAction(id, action, label, body, close) {
      const modal = document.getElementById('modal-root');
      try { await api('/api/v1/admin/tenants/' + id + '/' + action, body); if (close) { close(); } else { modal.innerHTML = ''; } flash(label + t('common.successfully')); renderTenants(); } catch { flash(label + t('common.failed')); }
    }

    // ── Phase 4: lifecycle dialogs (each REPLACES the detail dialog —
    // mountModal appends, so a stale dialog underneath would fight over
    // ESC/backdrop — the established close-then-mount pattern) ────────

    function editContactPrompt(id, data) {
      const modal = document.getElementById('modal-root');
      const box = el('div', 'modal'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      box.appendChild(el('h3', null, t('tenant.editTitle')));
      const tenant = data.tenant || {};
      const lbl1 = el('p', 'muted', t('th.email')); lbl1.style.cssText = 'margin:.5rem 0 .15rem;font-size:.72rem';
      const email = el('input', 'input'); email.type = 'email'; email.value = tenant.email || ''; email.autocomplete = 'off'; email.spellcheck = false;
      const lbl2 = el('p', 'muted', t('tenant.phone')); lbl2.style.cssText = 'margin:.6rem 0 .15rem;font-size:.72rem';
      const phone = el('input', 'input'); phone.type = 'tel'; phone.value = tenant.phone || ''; phone.placeholder = '+62 …';
      const errLine = el('p', 'small', ''); errLine.style.cssText = 'color:var(--danger);margin:.4rem 0 0;display:none';
      box.appendChild(lbl1); box.appendChild(email); box.appendChild(lbl2); box.appendChild(phone); box.appendChild(errLine);
      const act = el('div', 'modal-actions');
      const closeModal = mountModal(modal, box);
      const cancel = el('button', 'btn btn-ghost', t('tenant.cancel')); cancel.addEventListener('click', closeModal); act.appendChild(cancel);
      const save = el('button', 'btn', t('tenant.save'));
      save.addEventListener('click', busyWrap(save, async () => {
        errLine.style.display = 'none';
        const payload = {};
        const newEmail = email.value.trim().toLowerCase();
        if (newEmail && newEmail !== String(tenant.email || '').toLowerCase()) { payload.email = newEmail; }
        const newPhone = phone.value.trim();
        if (newPhone && newPhone !== String(tenant.phone || '')) { payload.phone = newPhone; }
        if (!payload.email && !payload.phone) { closeModal(); return; } // nothing changed
        try {
          await api('/api/v1/admin/tenants/' + id, JSON.stringify(payload), 'PATCH');
          closeModal();
          flash(t('tenant.contactUpdated') + ' ' + t('common.successfully'));
          renderTenants();
        } catch (err) {
          if (err && err.authDenied) { closeModal(); return; }
          // api() throws Error('<path> (<status>)') — surface the collision
          // case inline instead of a generic toast.
          errLine.textContent = /409/.test(String(err && err.message)) ? t('tenant.emailTaken') : t('common.failed');
          errLine.style.display = 'block';
        }
      }));
      act.appendChild(save);
      box.appendChild(act);
    }

    function grantPrompt(id) {
      const modal = document.getElementById('modal-root');
      const box = el('div', 'modal'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      box.appendChild(el('h3', null, t('tenant.grantTitle')));
      const hint = el('p', 'small', t('tenant.grantHint')); hint.style.marginBottom = '.6rem';
      box.appendChild(hint);
      const lblT = el('p', 'muted', t('th.tier')); lblT.style.cssText = 'margin:.2rem 0 .15rem;font-size:.72rem';
      const select = el('select', 'input'); ['plus','pro','premium','enterprise'].forEach(tier => select.appendChild(el('option', null, tier)));
      const lblM = el('p', 'muted', t('tenant.months') + ' (' + t('tenant.or') + ' ' + t('tenant.exactDate') + ')'); lblM.style.cssText = 'margin:.6rem 0 .15rem;font-size:.72rem';
      const months = el('input', 'input'); months.type = 'number'; months.min = '1'; months.value = '12';
      const dateIn = el('input', 'input'); dateIn.type = 'date'; dateIn.style.marginTop = '.35rem';
      const lblR = el('p', 'muted', t('tenant.reasonGrant')); lblR.style.cssText = 'margin:.6rem 0 .15rem;font-size:.72rem';
      const reason = el('input', 'input'); reason.placeholder = t('tenant.reasonGrant'); reason.autocomplete = 'off';
      const errLine = el('p', 'small', t('tenant.reasonRequired')); errLine.style.cssText = 'color:var(--danger);margin:.4rem 0 0;display:none';
      box.appendChild(lblT); box.appendChild(select); box.appendChild(lblM); box.appendChild(months); box.appendChild(dateIn); box.appendChild(lblR); box.appendChild(reason); box.appendChild(errLine);
      const act = el('div', 'modal-actions');
      const closeModal = mountModal(modal, box);
      const cancel = el('button', 'btn btn-ghost', t('tenant.cancel')); cancel.addEventListener('click', closeModal); act.appendChild(cancel);
      const save = el('button', 'btn', t('tenant.grantTitle'));
      save.addEventListener('click', busyWrap(save, () => {
        errLine.style.display = 'none';
        if (!reason.value.trim()) { errLine.style.display = 'block'; return; }
        if (dateIn.value && Number(months.value) > 0) { errLine.textContent = t('common.failed'); errLine.style.display = 'block'; return; }
        const payload = { tier_key: select.value, reason: reason.value.trim() };
        if (dateIn.value) { payload.expires_at = dateIn.value; }
        else if (Number(months.value) > 0) { payload.months = Number(months.value); }
        else { errLine.textContent = t('common.failed'); errLine.style.display = 'block'; return; }
        doAction(id, 'grant-subscription', t('tenant.granted'), JSON.stringify(payload), closeModal);
      }));
      act.appendChild(save);
      box.appendChild(act);
    }

    function renewPrompt(id) {
      const modal = document.getElementById('modal-root');
      const box = el('div', 'modal'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      box.appendChild(el('h3', null, t('tenant.renewTitle')));
      const quick = el('button', 'btn btn-ok', t('tenant.renew365')); quick.style.cssText = 'width:100%';
      quick.addEventListener('click', busyWrap(quick, () => doAction(id, 'renew', t('tenant.renewed'), '{"days":365}', closeModal)));
      box.appendChild(quick);
      const or = el('p', 'muted', '— ' + t('tenant.or') + ' —'); or.style.cssText = 'text-align:center;margin:.5rem 0;font-size:.72rem';
      box.appendChild(or);
      const dateIn = el('input', 'input'); dateIn.type = 'date'; dateIn.style.width = '100%';
      box.appendChild(dateIn);
      const setBtn = el('button', 'btn', t('tenant.setExactDate')); setBtn.style.cssText = 'margin-top:.5rem;width:100%'; setBtn.disabled = true;
      dateIn.addEventListener('input', () => { setBtn.disabled = !dateIn.value; });
      setBtn.addEventListener('click', busyWrap(setBtn, () => {
        if (!dateIn.value) { return; }
        doAction(id, 'renew', t('tenant.renewed'), JSON.stringify({ expires_at: dateIn.value }), closeModal);
      }));
      box.appendChild(setBtn);
      const act = el('div', 'modal-actions');
      const closeModal = mountModal(modal, box);
      const cancel = el('button', 'btn btn-ghost', t('tenant.cancel')); cancel.addEventListener('click', closeModal);
      act.appendChild(cancel);
      box.appendChild(act);
    }

    function upgradePrompt(id, data) {
      const modal = document.getElementById('modal-root');
      const box = el('div', 'modal');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.appendChild(el('h3', null, t('tenant.changeTier')));
      const p = el('p', 'small'); p.style.marginBottom = '.6rem'; p.textContent = t('tenant.currentTier') + ((data.subscription && data.subscription.tierKey) || 'none');
      box.appendChild(p);
      // Tier-override honesty: the server silently no-ops when the tenant
      // has no subscription record (finds 0 rows, saves nothing, still
      // returns ok). Warn and disable Save instead of pretending.
      if (!data.subscription) {
        const warn = el('p', 'small', t('tenant.noSubWarn'));
        warn.style.cssText = 'color:var(--bad);margin:.2rem 0 .6rem';
        box.appendChild(warn);
      }
      // Tier override dropdown — hardcoded to non-free plans (server-side
      // upgradeable tiers only; 'free' is excluded because a free tenant
      // gets a tier-override when they subscribe, not via admin override).
      // Keep this list in sync with the server's ValidTiers if new tiers
      // are added (see LSE-8 tier-override handler).
      const select = el('select', 'input'); ['plus','pro','premium','enterprise'].forEach(tier => { const opt = el('option', null, tier); if (tier === (data.subscription && data.subscription.tierKey)) opt.selected = true; select.appendChild(opt); });
      box.appendChild(select);
      const reason = el('input', 'input'); reason.placeholder = t('tenant.reasonOverride'); reason.style.cssText = 'margin-top:.5rem;' + reason.style.cssText; box.appendChild(reason);
      const act = el('div', 'modal-actions');
      const closeModal = mountModal(modal, box);
      const cancel = el('button', 'btn btn-ghost', t('tenant.cancel')); cancel.addEventListener('click', closeModal); act.appendChild(cancel);
      const save = el('button', 'btn', t('tenant.save'));
      if (!data.subscription) { save.disabled = true; save.title = t('tenant.noSubWarn'); save.setAttribute('aria-disabled', 'true'); }
      else { save.addEventListener('click', busyWrap(save, async () => { await doAction(id,'tier-override',t('tenant.tierChanged'),JSON.stringify({tier_key:select.value,reason:reason.value||'admin override'}),closeModal); })); }
      act.appendChild(save);
      box.appendChild(act);
    }

    // ── Health tab ──────────────────────────────────────────────────
    // ── Health tab: built once, cached, refreshed per card ───────────
    // The old renderHealth() re-fetched /admin/health and rebuilt the
    // whole tab on EVERY visit. Now the DOM is built once and cached;
    // revisiting mounts it instantly while each card refreshes its own
    // data behind the cached view (stale-while-revalidate). Timer and
    // toggle state live at module scope so they survive tab switches;
    // auto-refresh only runs while the health tab is visible.
    let healthAutoOn = true;
    let healthLastRefresh = 0;
    let healthUpdatedAgo = null;
    let healthLoader = null; // set by buildHealthTab: { refreshAll, refreshAuto }
    function stopHealthAuto() { healthTimers.forEach(clearInterval); healthTimers = []; }
    function startHealthAuto() {
      stopHealthAuto();
      healthTimers.push(setInterval(() => { if (healthAutoOn && document.visibilityState !== 'hidden') refreshAutoHealth(); }, 60000));
      healthTimers.push(setInterval(() => {
        if (healthUpdatedAgo) healthUpdatedAgo.textContent = healthLastRefresh ? (t('health.updated') + ' ' + relTime(new Date(healthLastRefresh).toISOString())) : '';
      }, 5000));
    }
    function refreshAutoHealth() {
      // Same cadence and scope as the original auto-refresh — the two
      // heaviest proxies (NF logs, CF deploys) refresh on demand only.
      if (healthLoader) healthLoader.refreshAuto();
      healthLastRefresh = Date.now();
    }
    function buildHealthTab() {
      stopHealthAuto();
      const c = el('div');
      const card = el('div', 'card');
      // Auto-refresh control lives in the card's header row (title left,
      // toggle + updated-ago right) — not as an orphan strip floating
      // between two cards. (The old build also appended the title twice.)
      const cardHead = el('div', 'card-head');
      cardHead.appendChild(el('h2', null, t('health.title')));
      const autoBtn = el('button', 'btn btn-ghost btn-sm', t('health.autoOn'));
      autoBtn.type = 'button';
      const updatedAgo = el('span', 'muted log-meta', '');
      const headRight = el('div', 'card-head-right');
      headRight.appendChild(updatedAgo); headRight.appendChild(autoBtn);
      cardHead.appendChild(headRight);
      card.appendChild(cardHead);
      // kv values are live element references updated in place by
      // loadHealthKv — the grid is never rebuilt, so a background
      // refresh cannot flash the row.
      const kv = el('div'); kv.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:.5rem;font-size:.82rem';
      const kvValue = (label) => { kv.appendChild(el('span', 'muted', label)); const v = el('span', null, '—'); v.style.textAlign = 'right'; kv.appendChild(v); return v; };
      const kvStatus = kvValue(t('health.status'));
      const kvDb = kvValue(t('health.database'));
      const kvSmtp = kvValue(t('health.smtp'));
      const kvVersion = kvValue(t('health.version'));
      const kvTime = kvValue(t('health.time'));
      card.appendChild(kv);
      c.appendChild(card);
      healthUpdatedAgo = updatedAgo;
      const healthKvGuard = createSeqGuard();
      async function loadHealthKv() {
        const seq = healthKvGuard.next();
        let h = null;
        try { h = await api('/api/v1/admin/health'); } catch (e) { h = null; }
        if (!healthKvGuard.isCurrent(seq)) { return; }
        if (!h) { return; } // background refresh: keep the last known values
        kvStatus.textContent = h.status === 'ok' ? t('health.ok') : t('health.degraded');
        kvDb.textContent = h.db_ok ? t('health.connected') : t('health.unreachable');
        kvSmtp.textContent = h.smtp_host ? t('health.configured') : t('health.notConfigured');
        kvVersion.textContent = h.version || '—';
        kvTime.textContent = h.time || '—';
      }

        // ── Cloud Service card (Northflank metadata via worker proxy) ───
        const svcCard = el('div', 'card table-card');
        const svcHead = el('div', 'logs-head');
        svcHead.appendChild(el('h2', null, t('health.serviceTitle')));
        const svcRefresh = el('button', 'btn btn-ghost btn-sm', t('health.serviceRefresh'));
        svcRefresh.type = 'button';
        svcHead.appendChild(svcRefresh);
        svcCard.appendChild(svcHead);
        const svcWrap = el('div');
        svcWrap.appendChild(el('p', 'empty', t('common.loading')));
        svcCard.appendChild(svcWrap);
        c.appendChild(svcCard);

        // ── Uptime card (edge self-check via worker proxy, no API key) ──
        const upCard = el('div', 'card table-card');
        const upHead = el('div', 'logs-head');
        upHead.appendChild(el('h2', null, t('health.uptimeTitle')));
        const upRefresh = el('button', 'btn btn-ghost btn-sm', t('health.uptimeRefresh'));
        upRefresh.type = 'button';
        upHead.appendChild(upRefresh);
        upCard.appendChild(upHead);
        const upWrap = el('div');
        upWrap.appendChild(el('p', 'empty', t('common.loading')));
        upCard.appendChild(upWrap);
        c.appendChild(upCard);

        // ── Platform logs (Northflank cloud pod, via the worker proxy) ──
        // The NF key lives in a Worker secret; the browser only talks to
        // same-origin /__oz/nf-logs, which requires the admin session.
        const logsCard = el('div', 'card table-card');
        const logsHead = el('div', 'logs-head');
        logsHead.appendChild(el('h2', null, t('health.logsTitle')));
        const logMeta = el('span', 'muted log-meta');
        logsHead.appendChild(logMeta);
        const linesSel = el('select', 'lines-sel');
        ['100', '300', '500'].forEach(n => {
          const o = el('option', null, n + ' lines');
          o.value = n;
          if (n === '100') o.selected = true;
          linesSel.appendChild(o);
        });
        logsHead.appendChild(linesSel);
        const refreshBtn = el('button', 'btn btn-ghost btn-sm', t('health.logsRefresh'));
        refreshBtn.type = 'button';
        logsHead.appendChild(refreshBtn);
        logsCard.appendChild(logsHead);
        const logWrap = el('div');
        logWrap.appendChild(el('p', 'empty', t('common.loading')));
        logsCard.appendChild(logWrap);
        c.appendChild(logsCard);

        // Sequence guard: a stale log response must not overwrite a
        // fresher one (same last-click-wins pattern as the other tabs).
        const logsGuard = createSeqGuard();
        async function loadLogs() {
          const seq = logsGuard.next();
          refreshBtn.disabled = true;
          logWrap.innerHTML = '';
          logWrap.appendChild(el('p', 'empty', t('common.loading')));
          let body = null;
          try {
            const res = await fetchWithTimeout(undefined, '/__oz/nf-logs?lines=' + linesSel.value);
            body = await res.json();
          } catch (e) { body = null; }
          if (!logsGuard.isCurrent(seq)) { return; }
          refreshBtn.disabled = false;
          logWrap.innerHTML = '';
          if (!body || !body.ok) {
            const detail = body && body.error ? ' ' + body.error : '';
            logWrap.appendChild(el('p', 'empty', t('health.logsFailed') + detail));
            return;
          }
          logMeta.textContent = t('health.logsCaption');
          logWrap.appendChild(logView(body.lines));
        }
        refreshBtn.addEventListener('click', loadLogs);

        // ── Cloudflare deployments (worker oz-pos, via the worker proxy) ─
        // Same trust shape as the log panel: the CF token lives in a Worker
        // secret; the browser talks only to same-origin /__oz/cf-deploys.
        const cfCard = el('div', 'card table-card');
        const cfHead = el('div', 'logs-head');
        cfHead.appendChild(el('h2', null, t('health.deploysTitle')));
        const cfMeta = el('span', 'muted log-meta');
        cfHead.appendChild(cfMeta);
        const cfRefresh = el('button', 'btn btn-ghost btn-sm', t('health.deploysRefresh'));
        cfRefresh.type = 'button';
        cfHead.appendChild(cfRefresh);
        cfCard.appendChild(cfHead);
        const cfWrap = el('div');
        cfWrap.appendChild(el('p', 'empty', t('common.loading')));
        cfCard.appendChild(cfWrap);
        c.appendChild(cfCard);

        const cfGuard = createSeqGuard();
        async function loadDeploys() {
          const seq = cfGuard.next();
          cfRefresh.disabled = true;
          cfWrap.innerHTML = '';
          cfWrap.appendChild(el('p', 'empty', t('common.loading')));
          let body = null;
          try {
            const res = await fetchWithTimeout(undefined, '/__oz/cf-deploys');
            body = await res.json();
          } catch (e) { body = null; }
          if (!cfGuard.isCurrent(seq)) { return; }
          cfRefresh.disabled = false;
          cfWrap.innerHTML = '';
          if (!body || !body.ok) {
            const detail = body && body.error ? ' ' + body.error : '';
            cfWrap.appendChild(el('p', 'empty', t('health.deploysFailed') + detail));
            return;
          }
          cfMeta.textContent = t('health.deploysCaption');
          cfWrap.appendChild(cfDeployRows(body.deploys));
        }
        cfRefresh.addEventListener('click', loadDeploys);

        // ── Worker runtime logs (Cloudflare observability, via proxy) ───
        const wlCard = el('div', 'card table-card');
        const wlHead = el('div', 'logs-head');
        wlHead.appendChild(el('h2', null, t('health.workerLogsTitle')));
        const wlMeta = el('span', 'muted log-meta');
        wlHead.appendChild(wlMeta);
        const wlRefresh = el('button', 'btn btn-ghost btn-sm', t('health.workerLogsRefresh'));
        wlRefresh.type = 'button';
        wlHead.appendChild(wlRefresh);
        wlCard.appendChild(wlHead);
        const wlWrap = el('div');
        wlWrap.appendChild(el('p', 'empty', t('common.loading')));
        wlCard.appendChild(wlWrap);
        c.appendChild(wlCard);
        const wlGuard = createSeqGuard();
        async function loadWorkerLogs() {
          const seq = wlGuard.next();
          wlRefresh.disabled = true;
          wlWrap.innerHTML = '';
          wlWrap.appendChild(el('p', 'empty', t('common.loading')));
          let body = null;
          try {
            const res = await fetchWithTimeout(undefined, '/__oz/worker-logs');
            body = await res.json();
          } catch (e) { body = null; }
          if (!wlGuard.isCurrent(seq)) { return; }
          wlRefresh.disabled = false;
          wlWrap.innerHTML = '';
          if (!body || !body.ok) {
            const detail = body && body.error ? ' ' + body.error : '';
            wlWrap.appendChild(el('p', 'empty', t('health.workerLogsFailed') + detail));
            return;
          }
          wlMeta.textContent = t('health.logsCaption');
          const rows = (body.events || []).map(e => ({
            ts: e.ts,
            log: (e.outcome && e.outcome !== 'ok' ? '[' + e.outcome + '] ' : '') + (e.message || ('HTTP ' + e.status)),
          }));
          wlWrap.appendChild(logView(rows));
        }

        // ── Traffic card (GraphQL analytics via worker proxy) ───────────
        const trCard = el('div', 'card table-card');
        const trHead = el('div', 'logs-head');
        trHead.appendChild(el('h2', null, t('health.trafficTitle')));
        const trMeta = el('span', 'muted log-meta');
        trHead.appendChild(trMeta);
        const trRefresh = el('button', 'btn btn-ghost btn-sm', t('health.trafficRefresh'));
        trRefresh.type = 'button';
        trHead.appendChild(trRefresh);
        trCard.appendChild(trHead);
        const trWrap = el('div');
        trWrap.appendChild(el('p', 'empty', t('common.loading')));
        trCard.appendChild(trWrap);
        c.appendChild(trCard);
        const trGuard = createSeqGuard();
        async function loadTraffic() {
          const seq = trGuard.next();
          trRefresh.disabled = true;
          trWrap.innerHTML = '';
          trWrap.appendChild(el('p', 'empty', t('common.loading')));
          let body = null;
          try {
            const res = await fetchWithTimeout(undefined, '/__oz/traffic');
            body = await res.json();
          } catch (e) { body = null; }
          if (!trGuard.isCurrent(seq)) { return; }
          trRefresh.disabled = false;
          trWrap.innerHTML = '';
          if (!body || !body.ok) {
            const detail = body && body.error ? ' ' + body.error : '';
            trWrap.appendChild(el('p', 'empty', t('health.trafficFailed') + detail));
            return;
          }
          const buckets = body.buckets || [];
          const total = buckets.reduce((a, b) => a + (b.req || 0), 0);
          const errs = buckets.reduce((a, b) => a + (b.err || 0), 0);
          trMeta.textContent = total + ' requests · ' + errs + ' errors / 24h';
          // sparkline() returns HTML (label column + svg plot) with only
          // generated labels — all labels are escaped inside the helper.
          // The y-axis labels are HTML so they never stretch with the
          // preserveAspectRatio="none" plot.
          trWrap.innerHTML = sparkline(buckets);
        }

        // ── Loaders for the two cards created above the logs panel ──────
        const svcGuard = createSeqGuard();
        async function loadService() {
          const seq = svcGuard.next();
          svcRefresh.disabled = true;
          try {
            const res = await fetchWithTimeout(undefined, '/__oz/nf-status');
            const body = await res.json();
            if (!svcGuard.isCurrent(seq)) { return; }
            svcWrap.innerHTML = '';
            if (!body || !body.ok) {
              const detail = body && body.error ? ' ' + body.error : '';
              svcWrap.appendChild(el('p', 'empty', t('health.serviceFailed') + detail));
            } else {
              svcWrap.appendChild(nfStatusCard(body.status));
            }
          } catch (e) {
            if (!svcGuard.isCurrent(seq)) { return; }
            svcWrap.innerHTML = '';
            svcWrap.appendChild(el('p', 'empty', t('health.serviceFailed')));
          }
          svcRefresh.disabled = false;
        }

        const upGuard = createSeqGuard();
        // The three kasir.mu-zone hosts cannot be probed from inside
        // the Worker (same-zone subrequests bypass Workers routes and 522
        // against a nonexistent origin), so they are probed from the
        // browser instead — no-cors fetch, opaque but honest reachability
        // from the user's real vantage.
        async function probeBrowser(name, url, sameOrigin) {
          const t0 = performance.now();
          try {
            const opts = sameOrigin ? { cache: 'no-store' } : { mode: 'no-cors', cache: 'no-store' };
            await fetchWithTimeout(undefined, url, opts, 6000);
            return { name, up: true, ms: Math.round(performance.now() - t0), error: '', vantage: 'browser' };
          } catch (e) {
            return { name, up: false, ms: Math.round(performance.now() - t0), error: 'unreachable', vantage: 'browser' };
          }
        }
        async function loadUptime() {
          const seq = upGuard.next();
          upRefresh.disabled = true;
          try {
            const res = await fetchWithTimeout(undefined, '/__oz/uptime');
            const body = await res.json();
            const browserChecks = await Promise.all([
              probeBrowser('website (kasir.mu)', 'https://kasir.mu/'),
              probeBrowser('dashboard', 'https://dashboard.kasir.mu/'),
              probeBrowser('admin', '/', true),
            ]);
            if (!upGuard.isCurrent(seq)) { return; }
            upWrap.innerHTML = '';
            const edgeOk = body && body.ok;
            const checks = (edgeOk ? body.checks : []).concat(browserChecks);
            if (checks.length === 0) {
              upWrap.appendChild(el('p', 'empty', (body && body.error ? t('health.uptimeFailed') + ' ' + body.error : t('health.uptimeFailed'))));
            } else {
              if (!edgeOk) checks.unshift({ name: 'license api', up: false, ms: 0, error: body && body.error ? body.error : 'edge probe failed', vantage: 'edge' });
              upWrap.appendChild(uptimeRows(checks));
            }
          } catch (e) {
            if (!upGuard.isCurrent(seq)) { return; }
            upWrap.innerHTML = '';
            upWrap.appendChild(el('p', 'empty', t('health.uptimeFailed')));
          }
          upRefresh.disabled = false;
        }

        // ── Wire refresh buttons + auto-refresh (60s, health tab only) ──
        svcRefresh.addEventListener('click', loadService);
        upRefresh.addEventListener('click', loadUptime);
        wlRefresh.addEventListener('click', loadWorkerLogs);
        trRefresh.addEventListener('click', loadTraffic);
        autoBtn.addEventListener('click', () => {
          healthAutoOn = !healthAutoOn;
          autoBtn.textContent = healthAutoOn ? t('health.autoOn') : t('health.autoOff');
        });
        healthLoader = {
          // Revisit + first build: every card, including the kv row.
          refreshAll() {
            loadService(); loadUptime(); loadLogs(); loadDeploys(); loadWorkerLogs(); loadTraffic();
            loadHealthKv();
            healthLastRefresh = Date.now();
          },
          // 60s auto-tick: same scope as the original auto-refresh (the
          // two heaviest proxies stay on-demand only).
          refreshAuto() {
            loadService(); loadUptime(); loadWorkerLogs(); loadTraffic();
          },
        };
        setTabContent('health', c);
        startHealthAuto();
        healthLoader.refreshAll();
    }

    // ── Flash ───────────────────────────────────────────────────────
    function flash(msg) { flashMessage(document.body, msg); } // B34: announced via role=alert (admin-utils)

    // ── Boot ────────────────────────────────────────────────────────
    document.getElementById('logout-btn').addEventListener('click', () => {
      window.location.href = '/__oz/logout';
    });

    // Theme toggle (light/dark) — theme.js sets data-theme on <html> and
    // exposes window.__ozAdminTheme.{get,set,toggle}; the icons flip via CSS.
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        if (window.__ozAdminTheme) { window.__ozAdminTheme.toggle(); }
      });
    }

    renderDashboard();
  
