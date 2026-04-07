(function () {
  'use strict';

  const STORAGE_KEY = 'hourlyActivityLog_v2';
  const LEGACY_KEY = 'hourlyActivityLog_v1';
  const SETTINGS_KEY = 'hourlyTrackerSettings_v1';

  /** @type {{ entries: Record<string, { text: string, at?: string }>, suggestionLibrary: string[] }} */
  let state = { entries: {}, suggestionLibrary: [] };

  let deferredInstall = null;
  /** @type {{ notifyEnabled: boolean }} */
  let settings = { notifyEnabled: false };
  let hourlyNotifyTimerId = null;

  const el = {
    viewDate: document.getElementById('view-date'),
    hourTbody: document.getElementById('hour-tbody'),
    daySummary: document.getElementById('day-summary'),
    btnToday: document.getElementById('btn-today'),
    btnPdf: document.getElementById('btn-pdf'),
    btnInstall: document.getElementById('btn-install'),
    panelLog: document.getElementById('panel-log'),
    panelHistory: document.getElementById('panel-history'),
    panelActivity: document.getElementById('panel-activity'),
    tabBtnLog: document.getElementById('tab-btn-log'),
    tabBtnHistory: document.getElementById('tab-btn-history'),
    tabBtnActivity: document.getElementById('tab-btn-activity'),
    historyTbody: document.getElementById('history-tbody'),
    activityTbody: document.getElementById('activity-tbody'),
    activityEmpty: document.getElementById('activity-empty'),
    activityTotal: document.getElementById('activity-total'),
    historyEmpty: document.getElementById('history-empty'),
    suggestionDatalist: document.getElementById('activity-suggestions'),
    notifyCard: document.getElementById('notify-card'),
    notifyDesc: document.getElementById('notify-desc'),
    notifyAndroidHint: document.getElementById('notify-android-hint'),
    btnNotifyAllow: document.getElementById('btn-notify-allow'),
    btnNotifyDisable: document.getElementById('btn-notify-disable'),
    notifyStatus: document.getElementById('notify-status')
  };

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function todayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function slotKeyFromDateHour(dateStr, hour) {
    return `${dateStr}T${pad2(hour)}`;
  }

  /** e.g. 12 PM – 1 PM for hour slot h on dateStr */
  function hourRangeLabel(dateStr, h) {
    const start = new Date(dateStr + 'T' + pad2(h) + ':00:00');
    if (Number.isNaN(start.getTime())) return '—';
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    const a = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const b = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${a} – ${b}`;
  }

  function migrateV1Entries(old) {
    /** @type {Record<string, { text: string, at?: string }>} */
    const out = {};
    Object.keys(old || {}).forEach((k) => {
      const e = old[k];
      if (!e) return;
      if (e.skipped) return;
      const t = typeof e.text === 'string' ? e.text.trim() : '';
      if (!t) return;
      out[k] = { text: t, at: e.at || new Date().toISOString() };
    });
    return out;
  }

  function uniqueTextsFromEntries(entries) {
    const seen = new Set();
    const list = [];
    Object.keys(entries || {}).forEach((k) => {
      const t = (entries[k].text || '').trim();
      if (!t) return;
      const low = t.toLowerCase();
      if (seen.has(low)) return;
      seen.add(low);
      list.push(t);
    });
    return list;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p.notifyEnabled === 'boolean') settings.notifyEnabled = p.notifyEnabled;
      }
    } catch (_) {
      settings = { notifyEnabled: false };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ notifyEnabled: settings.notifyEnabled }));
  }

  function msUntilNextHourBoundary() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return Math.max(0, next - now);
  }

  function clearHourlyNotificationSchedule() {
    if (hourlyNotifyTimerId) {
      clearTimeout(hourlyNotifyTimerId);
      hourlyNotifyTimerId = null;
    }
  }

  async function deliverHourlyNotification() {
    if (!settings.notifyEnabled) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const title = 'Hourly activity log';
    const body = 'Time to log what you did in the last hour. Open the app and tap Submit on that row.';
    const opts = {
      body,
      icon: new URL('icons/icon-192.png', window.location.href).href,
      badge: new URL('icons/icon-192.png', window.location.href).href,
      tag: 'hourly-reminder',
      renotify: true,
      vibrate: [200, 100, 200]
    };
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
    } catch (_) {
      try {
        new Notification(title, opts);
      } catch (_) {}
    }
  }

  function scheduleHourlyNotifications() {
    clearHourlyNotificationSchedule();
    if (!settings.notifyEnabled || Notification.permission !== 'granted') return;
    function tick() {
      if (!settings.notifyEnabled || Notification.permission !== 'granted') {
        clearHourlyNotificationSchedule();
        return;
      }
      const ms = msUntilNextHourBoundary();
      hourlyNotifyTimerId = setTimeout(async () => {
        await deliverHourlyNotification();
        tick();
      }, ms);
    }
    tick();
  }

  function updateNotifyUI() {
    if (!el.notifyStatus) return;
    const supported = typeof Notification !== 'undefined';
    if (!supported) {
      el.notifyStatus.textContent = 'Notifications are not supported in this browser.';
      if (el.btnNotifyAllow) el.btnNotifyAllow.disabled = true;
      if (el.btnNotifyDisable) el.btnNotifyDisable.classList.add('hidden');
      return;
    }
    const p = Notification.permission;
    if (p === 'denied') {
      el.notifyStatus.textContent =
        'Notifications are blocked. On Android, allow them in Chrome site settings (lock icon → Permissions) or system app settings.';
      if (el.notifyAndroidHint) el.notifyAndroidHint.classList.remove('hidden');
      if (el.btnNotifyAllow) {
        el.btnNotifyAllow.textContent = 'Open browser settings';
        el.btnNotifyAllow.classList.remove('hidden');
        el.btnNotifyAllow.disabled = false;
      }
      if (el.btnNotifyDisable) el.btnNotifyDisable.classList.add('hidden');
      return;
    }
    if (el.notifyAndroidHint) el.notifyAndroidHint.classList.add('hidden');
    if (p === 'default') {
      el.notifyStatus.textContent =
        'Tap “Allow hourly notifications” — Android will ask you to allow alerts for this app.';
      if (el.btnNotifyAllow) {
        el.btnNotifyAllow.textContent = 'Allow hourly notifications';
        el.btnNotifyAllow.classList.remove('hidden');
        el.btnNotifyAllow.disabled = false;
      }
      if (el.btnNotifyDisable) el.btnNotifyDisable.classList.add('hidden');
      return;
    }
    if (p === 'granted') {
      if (settings.notifyEnabled) {
        el.notifyStatus.textContent =
          'Hourly reminders are on. Next reminder is scheduled at the start of the next clock hour (while the browser can run timers).';
        if (el.btnNotifyAllow) el.btnNotifyAllow.classList.add('hidden');
        if (el.btnNotifyDisable) {
          el.btnNotifyDisable.classList.remove('hidden');
          el.btnNotifyDisable.textContent = 'Turn off hourly reminders';
        }
      } else {
        el.notifyStatus.textContent = 'Notifications are allowed. Turn on hourly reminders below.';
        if (el.btnNotifyAllow) {
          el.btnNotifyAllow.textContent = 'Turn on hourly reminders';
          el.btnNotifyAllow.classList.remove('hidden');
        }
        if (el.btnNotifyDisable) el.btnNotifyDisable.classList.add('hidden');
      }
    }
  }

  async function onNotifyAllowClick() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'denied') {
      window.open('https://support.google.com/chrome/answer/3220216', '_blank', 'noopener');
      return;
    }
    const p = await Notification.requestPermission();
    if (p === 'granted') {
      settings.notifyEnabled = true;
      saveSettings();
      scheduleHourlyNotifications();
    } else {
      settings.notifyEnabled = false;
      saveSettings();
      clearHourlyNotificationSchedule();
    }
    updateNotifyUI();
  }

  function onNotifyDisableClick() {
    settings.notifyEnabled = false;
    saveSettings();
    clearHourlyNotificationSchedule();
    updateNotifyUI();
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 2 && typeof parsed.entries === 'object') {
          state.entries = parsed.entries;
          state.suggestionLibrary = Array.isArray(parsed.suggestionLibrary) ? parsed.suggestionLibrary : [];
          return;
        }
      }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        state.entries = migrateV1Entries(parsed.entries || {});
        state.suggestionLibrary = uniqueTextsFromEntries(state.entries);
        saveState();
        localStorage.removeItem(LEGACY_KEY);
        return;
      }
    } catch (_) {
      state = { entries: {}, suggestionLibrary: [] };
    }
  }

  function saveState() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        entries: state.entries,
        suggestionLibrary: state.suggestionLibrary
      })
    );
  }

  function hasSavedEntry(key) {
    const e = state.entries[key];
    return !!(e && typeof e.text === 'string' && e.text.trim().length > 0);
  }

  function persistSlot(key, text) {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      delete state.entries[key];
    } else {
      state.entries[key] = { text: trimmed, at: new Date().toISOString() };
    }
    saveState();
  }

  function addToSuggestionLibrary(text) {
    const t = (text || '').trim();
    if (!t) return;
    const low = t.toLowerCase();
    const existing = new Set(state.suggestionLibrary.map((s) => s.toLowerCase()));
    if (existing.has(low)) return;
    state.suggestionLibrary.unshift(t);
    if (state.suggestionLibrary.length > 400) state.suggestionLibrary.length = 400;
    saveState();
    renderSuggestionDatalist();
  }

  function renderSuggestionDatalist() {
    if (!el.suggestionDatalist) return;
    el.suggestionDatalist.innerHTML = '';
    state.suggestionLibrary.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      el.suggestionDatalist.appendChild(opt);
    });
  }

  function matchesSuggestionLibrary(value) {
    const t = (value || '').trim();
    if (!t) return false;
    const low = t.toLowerCase();
    return state.suggestionLibrary.some((s) => s.toLowerCase() === low);
  }

  function updateDaySummary() {
    const dateStr = el.viewDate.value || todayDateStr();
    let filled = 0;
    for (let h = 0; h < 24; h++) {
      const key = slotKeyFromDateHour(dateStr, h);
      if (hasSavedEntry(key)) filled++;
    }
    el.daySummary.textContent = `${dateStr} · ${filled} of 24 hours saved · ${24 - filled} empty`;
  }

  function refreshRowAppearance(tr) {
    if (!tr) return;
    const key = tr.getAttribute('data-slot');
    if (!key) return;
    const saved = hasSavedEntry(key);
    tr.classList.toggle('row-done', saved);
    tr.classList.toggle('row-pending', !saved);
  }

  function renderDay() {
    const dateStr = el.viewDate.value || todayDateStr();
    const rows = [];
    for (let h = 0; h < 24; h++) {
      const key = slotKeyFromDateHour(dateStr, h);
      const entry = state.entries[key];
      const text = entry && entry.text ? entry.text : '';
      rows.push({
        key,
        rangeLabel: hourRangeLabel(dateStr, h),
        text,
        saved: hasSavedEntry(key)
      });
    }

    updateDaySummary();

    el.hourTbody.innerHTML = rows
      .map((r) => {
        return `<tr class="${r.saved ? 'row-done' : 'row-pending'}" data-slot="${escapeAttr(r.key)}">
          <td class="cell-hour"><span class="hour-label">${escapeHtml(r.rangeLabel)}</span></td>
          <td class="cell-activity">
            <label class="suggest-wrap">
              <span class="suggest-label">Suggestions</span>
              <input type="text" class="suggest-input" list="activity-suggestions" data-slot="${escapeAttr(r.key)}" placeholder="Pick or type to filter, then choose from dropdown" autocomplete="off" />
            </label>
            <textarea class="hour-input" data-slot="${escapeAttr(r.key)}" rows="3" maxlength="4000" placeholder="What did you do during this hour? Submit saves it."></textarea>
          </td>
          <td class="cell-submit">
            <button type="button" class="btn btn-submit" data-slot="${escapeAttr(r.key)}">Submit</button>
          </td>
        </tr>`;
      })
      .join('');

    rows.forEach((r) => {
      const ta = el.hourTbody.querySelector('.hour-input[data-slot="' + escapeAttr(r.key) + '"]');
      if (ta) ta.value = r.text;
    });
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function collectUniqueDates() {
    const set = new Set();
    Object.keys(state.entries).forEach((k) => {
      const i = k.indexOf('T');
      if (i > 0) set.add(k.slice(0, i));
    });
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }

  function countFilledHours(dateStr) {
    let n = 0;
    for (let h = 0; h < 24; h++) {
      if (hasSavedEntry(slotKeyFromDateHour(dateStr, h))) n++;
    }
    return n;
  }

  function weekdayForDateStr(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }

  /**
   * Group saved slot texts by case-insensitive key; count hours (slots) each.
   * @returns {{ display: string, hours: number }[]}
   */
  function aggregateActivityHours() {
    /** @type {Map<string, { display: string, hours: number }>} */
    const map = new Map();
    Object.keys(state.entries).forEach((slotKey) => {
      const e = state.entries[slotKey];
      const t = (e.text || '').trim();
      if (!t) return;
      const norm = t.toLowerCase();
      const cur = map.get(norm);
      if (cur) {
        cur.hours += 1;
      } else {
        map.set(norm, { display: t, hours: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (b.hours !== a.hours) return b.hours - a.hours;
      return a.display.localeCompare(b.display, undefined, { sensitivity: 'base' });
    });
  }

  function renderActivitySummary() {
    if (!el.activityTbody || !el.activityEmpty || !el.activityTotal) return;
    const rows = aggregateActivityHours();
    const totalSlots = rows.reduce((s, r) => s + r.hours, 0);
    if (rows.length === 0) {
      el.activityTbody.innerHTML = '';
      el.activityEmpty.classList.remove('hidden');
      el.activityTotal.textContent = 'Total logged hours: 0';
      return;
    }
    el.activityEmpty.classList.add('hidden');
    el.activityTotal.textContent = `Total logged hours: ${totalSlots} · ${rows.length} distinct activit${rows.length === 1 ? 'y' : 'ies'}`;
    el.activityTbody.innerHTML = rows
      .map((r) => {
        const pct = totalSlots > 0 ? Math.round((r.hours / totalSlots) * 1000) / 10 : 0;
        const pctStr = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
        return `<tr>
          <td class="activity-cell">${escapeHtml(r.display)}</td>
          <td class="num">${r.hours}</td>
          <td class="num pct">${pctStr}%</td>
        </tr>`;
      })
      .join('');
  }

  function renderHistory() {
    const dates = collectUniqueDates();
    if (dates.length === 0) {
      el.historyTbody.innerHTML = '';
      el.historyEmpty.classList.remove('hidden');
      return;
    }
    el.historyEmpty.classList.add('hidden');
    el.historyTbody.innerHTML = dates
      .map((dateStr) => {
        const filled = countFilledHours(dateStr);
        const wd = weekdayForDateStr(dateStr);
        return `<tr>
          <td class="mono">${escapeHtml(dateStr)}</td>
          <td>${escapeHtml(wd)}</td>
          <td class="num">${filled}</td>
          <td class="cell-open"><button type="button" class="btn secondary btn-open-day" data-date="${escapeAttr(dateStr)}">Open</button></td>
        </tr>`;
      })
      .join('');
  }

  el.hourTbody.addEventListener('change', (e) => {
    const inp = e.target.closest('.suggest-input');
    if (!inp) return;
    const row = inp.closest('tr');
    const ta = row && row.querySelector('.hour-input');
    if (!ta) return;
    if (matchesSuggestionLibrary(inp.value)) {
      ta.value = inp.value.trim();
    }
  });

  el.hourTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-submit');
    if (!btn) return;
    const key = btn.getAttribute('data-slot');
    if (!key) return;
    const row = btn.closest('tr');
    const ta = row && row.querySelector('.hour-input');
    const text = ta ? ta.value : '';
    persistSlot(key, text);
    if (text.trim()) addToSuggestionLibrary(text.trim());
    updateDaySummary();
    renderHistory();
    renderActivitySummary();
    refreshRowAppearance(row);
  });

  el.historyTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-open-day');
    if (!btn) return;
    const d = btn.getAttribute('data-date');
    if (!d) return;
    el.viewDate.value = d;
    renderDay();
    showPanel('log');
  });

  function showPanel(name) {
    const isLog = name === 'log';
    const isHistory = name === 'history';
    const isActivity = name === 'activity';

    el.panelLog.classList.toggle('hidden', !isLog);
    el.panelLog.hidden = !isLog;
    el.panelHistory.classList.toggle('hidden', !isHistory);
    el.panelHistory.hidden = !isHistory;
    if (el.panelActivity) {
      el.panelActivity.classList.toggle('hidden', !isActivity);
      el.panelActivity.hidden = !isActivity;
    }

    el.tabBtnLog.classList.toggle('active', isLog);
    el.tabBtnHistory.classList.toggle('active', isHistory);
    if (el.tabBtnActivity) el.tabBtnActivity.classList.toggle('active', isActivity);

    el.tabBtnLog.setAttribute('aria-selected', isLog ? 'true' : 'false');
    el.tabBtnHistory.setAttribute('aria-selected', isHistory ? 'true' : 'false');
    if (el.tabBtnActivity) el.tabBtnActivity.setAttribute('aria-selected', isActivity ? 'true' : 'false');

    if (isHistory) renderHistory();
    if (isActivity) renderActivitySummary();
  }

  el.tabBtnLog.addEventListener('click', () => showPanel('log'));
  el.tabBtnHistory.addEventListener('click', () => showPanel('history'));
  if (el.tabBtnActivity) el.tabBtnActivity.addEventListener('click', () => showPanel('activity'));

  function buildPdfForDate(dateStr) {
    const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDF) {
      alert('PDF library not loaded. Open the app online once to cache it, then try again.');
      return;
    }
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 48;
    let y = margin;
    const wd = weekdayForDateStr(dateStr);
    doc.setFontSize(14);
    doc.text('Hourly activity log — ' + dateStr + ' (' + wd + ')', margin, y);
    y += 28;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text('Generated ' + new Date().toLocaleString(), margin, y);
    y += 24;
    doc.setTextColor(0);

    for (let h = 0; h < 24; h++) {
      const key = slotKeyFromDateHour(dateStr, h);
      const entry = state.entries[key];
      const line = entry?.text?.trim() ? entry.text.trim() : '—';
      const range = hourRangeLabel(dateStr, h);
      const block = range + ' — ' + line;
      const lines = doc.splitTextToSize(block, 500);
      if (y > 780) {
        doc.addPage();
        y = margin;
      }
      doc.setFontSize(11);
      doc.text(lines, margin, y);
      y += lines.length * 14 + 6;
    }

    doc.save('activity-log-' + dateStr + '.pdf');
  }

  el.btnPdf.addEventListener('click', () => {
    const dateStr = el.viewDate.value || todayDateStr();
    buildPdfForDate(dateStr);
  });

  el.viewDate.addEventListener('change', () => {
    renderDay();
  });

  el.btnToday.addEventListener('click', () => {
    el.viewDate.value = todayDateStr();
    renderDay();
  });

  function registerSW() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => null);
  }

  function setupInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      el.btnInstall.classList.remove('hidden');
    });
    el.btnInstall.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      el.btnInstall.classList.add('hidden');
    });
  }

  loadState();
  loadSettings();
  renderSuggestionDatalist();
  el.viewDate.value = todayDateStr();
  setupInstall();
  if (el.btnNotifyAllow) el.btnNotifyAllow.addEventListener('click', onNotifyAllowClick);
  if (el.btnNotifyDisable) el.btnNotifyDisable.addEventListener('click', onNotifyDisableClick);
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      settings.notifyEnabled &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      scheduleHourlyNotifications();
    }
  });
  registerSW().then(() => {
    updateNotifyUI();
    if (settings.notifyEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      scheduleHourlyNotifications();
    }
  });
  renderDay();
  renderHistory();
  renderActivitySummary();
})();
