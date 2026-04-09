(function () {
  'use strict';

  const STORAGE_KEY = 'hourlyActivityLog_v2';
  const LEGACY_KEY = 'hourlyActivityLog_v1';
  const SETTINGS_KEY = 'hourlyTrackerSettings_v1';

  /** @type {{ days: Record<string, { id: string, start: string, end: string, text: string, at?: string }[]>, suggestionLibrary: string[] }} */
  let state = { days: {}, suggestionLibrary: [] };

  let deferredInstall = null;
  /** @type {{ notifyEnabled: boolean }} */
  let settings = { notifyEnabled: false };
  let hourlyNotifyTimerId = null;
  /** @type {any} */
  let activityChart = null;

  const el = {
    viewDate: document.getElementById('view-date'),
    hourList: document.getElementById('hour-list'),
    daySummary: document.getElementById('day-summary'),
    btnToday: document.getElementById('btn-today'),
    btnPdf: document.getElementById('btn-pdf'),
    btnAddSlot: document.getElementById('btn-add-slot'),
    btnInstall: document.getElementById('btn-install'),
    installCard: document.getElementById('install-card'),
    panelLog: document.getElementById('panel-log'),
    panelHistory: document.getElementById('panel-history'),
    panelActivity: document.getElementById('panel-activity'),
    panelCharts: document.getElementById('panel-charts'),
    tabBtnLog: document.getElementById('tab-btn-log'),
    tabBtnHistory: document.getElementById('tab-btn-history'),
    tabBtnActivity: document.getElementById('tab-btn-activity'),
    tabBtnCharts: document.getElementById('tab-btn-charts'),
    chartSummary: document.getElementById('chart-summary'),
    chartPlaceholder: document.getElementById('chart-placeholder'),
    chartMessage: document.getElementById('chart-message'),
    chartWrap: document.getElementById('chart-wrap'),
    chartCanvas: document.getElementById('activity-donut-chart'),
    historyList: document.getElementById('history-list'),
    activityList: document.getElementById('activity-list'),
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

  function parseTimeToMinutes(t) {
    if (!t || typeof t !== 'string') return 0;
    const parts = t.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1] || '0', 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
  }

  /** Hours between start/end; if end <= start, treat as next calendar day (overnight). */
  function slotDurationHours(start, end) {
    let a = parseTimeToMinutes(start);
    let b = parseTimeToMinutes(end);
    if (b <= a) b += 24 * 60;
    return (b - a) / 60;
  }

  function addMinutesToTimeStr(timeStr, deltaMin) {
    let m = parseTimeToMinutes(timeStr) + deltaMin;
    m = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(m / 60);
    const mnt = m % 60;
    return `${pad2(h)}:${pad2(mnt)}`;
  }

  function formatRangeLabel(dateStr, start, end) {
    const d0 = new Date(dateStr + 'T' + start + ':00');
    if (Number.isNaN(d0.getTime())) return '—';
    const d1 = new Date(dateStr + 'T' + end + ':00');
    if (parseTimeToMinutes(end) <= parseTimeToMinutes(start)) {
      d1.setDate(d1.getDate() + 1);
    }
    if (Number.isNaN(d1.getTime())) return '—';
    const a = d0.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const b = d1.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${a} – ${b}`;
  }

  function formatDurationShort(h) {
    if (h <= 0 || Number.isNaN(h)) return '—';
    const r = Math.round(h * 100) / 100;
    if (Number.isInteger(r)) return `${r} h`;
    return `${r.toFixed(2).replace(/\.?0+$/, '')} h`;
  }

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return 's' + crypto.randomUUID().replace(/-/g, '');
    }
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function migrateV2ToV3(entries) {
    /** @type {Record<string, { id: string, start: string, end: string, text: string, at?: string }[]>} */
    const days = {};
    Object.keys(entries || {}).forEach((key) => {
      const m = key.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})$/);
      if (!m) return;
      const dateStr = m[1];
      const hour = parseInt(m[2], 10);
      if (Number.isNaN(hour) || hour < 0 || hour > 23) return;
      const e = entries[key];
      const t = typeof e.text === 'string' ? e.text.trim() : '';
      if (!t) return;
      if (!days[dateStr]) days[dateStr] = [];
      const start = `${pad2(hour)}:00`;
      const end = hour === 23 ? '00:00' : `${pad2(hour + 1)}:00`;
      const safeId = 'm-' + key.replace(/[^a-zA-Z0-9]/g, '_');
      days[dateStr].push({ id: safeId, start, end, text: t, at: e.at });
    });
    Object.keys(days).forEach((d) => {
      days[d].sort((a, b) => parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start));
    });
    return days;
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

  function uniqueTextsFromDays(days) {
    const seen = new Set();
    const list = [];
    Object.keys(days || {}).forEach((dateStr) => {
      (days[dateStr] || []).forEach((slot) => {
        const t = (slot.text || '').trim();
        if (!t) return;
        const low = t.toLowerCase();
        if (seen.has(low)) return;
        seen.add(low);
        list.push(t);
      });
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
    const body = 'Time to log your activity. Open the app, set your time range, and tap Submit.';
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
        if (parsed && parsed.version === 3 && typeof parsed.days === 'object') {
          state.days = parsed.days;
          state.suggestionLibrary = Array.isArray(parsed.suggestionLibrary) ? parsed.suggestionLibrary : [];
          return;
        }
        if (parsed && parsed.version === 2 && typeof parsed.entries === 'object') {
          state.days = migrateV2ToV3(parsed.entries);
          state.suggestionLibrary = Array.isArray(parsed.suggestionLibrary) ? parsed.suggestionLibrary : [];
          if (!state.suggestionLibrary.length) {
            state.suggestionLibrary = uniqueTextsFromDays(state.days).slice(0, 400);
          }
          saveState();
          return;
        }
      }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const entries = migrateV1Entries(parsed.entries || {});
        state.days = migrateV2ToV3(entries);
        state.suggestionLibrary = uniqueTextsFromDays(state.days);
        saveState();
        localStorage.removeItem(LEGACY_KEY);
        return;
      }
    } catch (_) {
      state = { days: {}, suggestionLibrary: [] };
    }
  }

  function saveState() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        days: state.days,
        suggestionLibrary: state.suggestionLibrary
      })
    );
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

  function getSlotsToRender(dateStr) {
    const stored = state.days[dateStr];
    if (stored && stored.length) {
      return stored.slice().sort((a, b) => parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start));
    }
    return [{ id: '__draft__', start: '09:00', end: '10:00', text: '', at: undefined }];
  }

  function updateDaySummary() {
    const dateStr = el.viewDate.value || todayDateStr();
    const slots = state.days[dateStr] || [];
    let slotsWithText = 0;
    let hours = 0;
    slots.forEach((s) => {
      const t = (s.text || '').trim();
      if (!t) return;
      slotsWithText += 1;
      hours += slotDurationHours(s.start, s.end);
    });
    const hRound = Math.round(hours * 100) / 100;
    const hStr = Number.isInteger(hRound) ? String(hRound) : hRound.toFixed(2).replace(/\.?0+$/, '');
    el.daySummary.textContent = `${dateStr} · ${slotsWithText} saved block${slotsWithText === 1 ? '' : 's'} · ${hStr} h total`;
  }

  function updateSlotDurationLabel(card) {
    if (!card) return;
    const startInp = card.querySelector('.slot-start');
    const endInp = card.querySelector('.slot-end');
    const elDur = card.querySelector('.slot-duration');
    if (!startInp || !endInp || !elDur) return;
    const h = slotDurationHours(startInp.value, endInp.value);
    elDur.textContent = formatDurationShort(h);
  }

  function renderDay() {
    const dateStr = el.viewDate.value || todayDateStr();
    const rows = getSlotsToRender(dateStr);
    updateDaySummary();

    if (!el.hourList) return;
    el.hourList.innerHTML = rows
      .map((r, idx) => {
        const taId = 'slot-ta-' + idx;
        const saved = !!(r.text || '').trim() && r.id !== '__draft__';
        const stateClass = saved ? 'hour-card--done' : 'hour-card--pending';
        const rangeLabel = formatRangeLabel(dateStr, r.start, r.end);
        const dur = formatDurationShort(slotDurationHours(r.start, r.end));
        const removeHidden = rows.length <= 1 ? ' hidden' : '';
        return `<article class="hour-card ${stateClass}" data-slot-id="${escapeAttr(r.id)}">
          <div class="hour-card-top">
            <div class="hour-card-time hour-card-time--flex">
              <span class="hour-card-kicker">When</span>
              <span class="hour-range hour-range--sub">${escapeHtml(rangeLabel)}</span>
            </div>
            <div class="time-slot-row">
              <label class="time-field">
                <span class="time-field-label">Start</span>
                <input type="time" class="slot-start" step="60" value="${escapeAttr(r.start)}" />
              </label>
              <label class="time-field">
                <span class="time-field-label">End</span>
                <input type="time" class="slot-end" step="60" value="${escapeAttr(r.end)}" />
              </label>
              <span class="slot-duration">${dur}</span>
            </div>
            <div class="hour-card-actions">
              <button type="button" class="btn secondary btn-remove-slot${removeHidden}" aria-label="Remove this time slot">Remove</button>
              <button type="button" class="btn btn-submit" data-slot-id="${escapeAttr(r.id)}">Submit</button>
            </div>
          </div>
          <div class="hour-card-fields">
            <label class="suggest-wrap">
              <span class="suggest-label">Suggestions</span>
              <input type="text" class="suggest-input" list="activity-suggestions" placeholder="Pick from list or type to filter" autocomplete="off" />
            </label>
            <label class="hour-field-label" for="${taId}">Activity</label>
            <textarea id="${taId}" class="hour-input" rows="3" maxlength="4000" placeholder="What did you do in this time range? Tap Submit to save."></textarea>
          </div>
        </article>`;
      })
      .join('');

    el.hourList.querySelectorAll('.hour-card').forEach((card, i) => {
      const ta = card.querySelector('.hour-input');
      if (ta && rows[i]) ta.value = rows[i].text || '';
      updateSlotDurationLabel(card);
    });
  }

  function readCardSlot(card) {
    if (!card) return null;
    const id = card.getAttribute('data-slot-id');
    const startInp = card.querySelector('.slot-start');
    const endInp = card.querySelector('.slot-end');
    const ta = card.querySelector('.hour-input');
    if (!id || !startInp || !endInp || !ta) return null;
    return {
      id,
      start: startInp.value || '09:00',
      end: endInp.value || '10:00',
      text: ta.value || ''
    };
  }

  function applySlotToState(dateStr, slotId, start, end, text) {
    const trimmed = (text || '').trim();
    const dur = slotDurationHours(start, end);
    if (trimmed && dur <= 0) {
      alert('End time must be after start time. For overnight, use a later end (e.g. 23:00 → 00:00).');
      return false;
    }

    if (!trimmed) {
      if (slotId === '__draft__') {
        saveState();
        return true;
      }
      const arr = state.days[dateStr];
      if (!arr) {
        saveState();
        return true;
      }
      const idx = arr.findIndex((s) => s.id === slotId);
      if (idx >= 0) arr.splice(idx, 1);
      if (arr.length === 0) delete state.days[dateStr];
      saveState();
      return true;
    }

    if (slotId === '__draft__') {
      if (!state.days[dateStr]) state.days[dateStr] = [];
      state.days[dateStr].push({
        id: newId(),
        start,
        end,
        text: trimmed,
        at: new Date().toISOString()
      });
      saveState();
      return true;
    }

    const arr = state.days[dateStr];
    if (!arr) {
      state.days[dateStr] = [
        { id: slotId, start, end, text: trimmed, at: new Date().toISOString() }
      ];
      saveState();
      return true;
    }
    const slot = arr.find((s) => s.id === slotId);
    if (slot) {
      slot.start = start;
      slot.end = end;
      slot.text = trimmed;
      slot.at = new Date().toISOString();
    } else {
      arr.push({ id: slotId, start, end, text: trimmed, at: new Date().toISOString() });
    }
    saveState();
    return true;
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
    Object.keys(state.days || {}).forEach((dateStr) => {
      const has = (state.days[dateStr] || []).some((s) => (s.text || '').trim());
      if (has) set.add(dateStr);
    });
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }

  function countDayLoggedHours(dateStr) {
    let hours = 0;
    (state.days[dateStr] || []).forEach((s) => {
      if (!(s.text || '').trim()) return;
      hours += slotDurationHours(s.start, s.end);
    });
    const r = Math.round(hours * 100) / 100;
    return Number.isInteger(r) ? r : r;
  }

  function weekdayForDateStr(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }

  /**
   * Group saved slot texts by case-insensitive key; sum duration (hours) each.
   * @returns {{ display: string, hours: number }[]}
   */
  function aggregateActivityHours() {
    /** @type {Map<string, { display: string, hours: number }>} */
    const map = new Map();
    Object.keys(state.days || {}).forEach((dateStr) => {
      (state.days[dateStr] || []).forEach((slot) => {
        const t = (slot.text || '').trim();
        if (!t) return;
        const dur = slotDurationHours(slot.start, slot.end);
        if (dur <= 0) return;
        const norm = t.toLowerCase();
        const cur = map.get(norm);
        if (cur) {
          cur.hours += dur;
        } else {
          map.set(norm, { display: t, hours: dur });
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => {
      if (b.hours !== a.hours) return b.hours - a.hours;
      return a.display.localeCompare(b.display, undefined, { sensitivity: 'base' });
    });
  }

  function fmtHoursNum(n) {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/\.?0+$/, '');
  }

  function renderActivitySummary() {
    if (!el.activityList || !el.activityEmpty || !el.activityTotal) return;
    const rows = aggregateActivityHours();
    const totalH = rows.reduce((s, r) => s + r.hours, 0);
    if (rows.length === 0) {
      el.activityList.innerHTML = '';
      el.activityEmpty.classList.remove('hidden');
      el.activityTotal.textContent = 'Total logged hours: 0';
      return;
    }
    el.activityEmpty.classList.add('hidden');
    el.activityTotal.textContent = `Total logged hours: ${fmtHoursNum(totalH)} · ${rows.length} distinct activit${rows.length === 1 ? 'y' : 'ies'}`;
    el.activityList.innerHTML = rows
      .map((r) => {
        const pct = totalH > 0 ? Math.round((r.hours / totalH) * 1000) / 10 : 0;
        const pctStr = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
        return `<article class="activity-card">
          <p class="activity-card-name">${escapeHtml(r.display)}</p>
          <dl class="activity-card-stats">
            <div class="activity-stat"><dt>Hours</dt><dd>${fmtHoursNum(r.hours)}</dd></div>
            <div class="activity-stat"><dt>Share</dt><dd>${pctStr}%</dd></div>
          </dl>
        </article>`;
      })
      .join('');
  }

  function destroyActivityChart() {
    if (activityChart) {
      activityChart.destroy();
      activityChart = null;
    }
  }

  function truncateChartLabel(s, maxLen) {
    const m = maxLen || 36;
    if (s.length <= m) return s;
    return s.slice(0, m - 1) + '…';
  }

  function donutColors(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = Math.round((i * 360) / Math.max(n, 1)) % 360;
      out.push(`hsla(${h}, 70%, 52%, 0.88)`);
    }
    return out;
  }

  function renderActivityChart() {
    if (!el.chartCanvas || !el.chartWrap || !el.chartPlaceholder || !el.chartSummary) return;

    const defaultMsg =
      'No data to chart yet. Log hours on <strong>Day log</strong> first.';

    const setPlaceholder = (empty, messageHtml) => {
      if (el.chartMessage) el.chartMessage.innerHTML = messageHtml;
      el.chartPlaceholder.classList.toggle('hidden', !empty);
      el.chartWrap.classList.toggle('hidden', empty);
    };

    if (typeof Chart === 'undefined') {
      el.chartSummary.textContent = '';
      destroyActivityChart();
      setPlaceholder(
        true,
        'Chart library not loaded. Open the app online once so Chart.js can load, then try again.'
      );
      return;
    }

    const rows = aggregateActivityHours();
    const totalH = rows.reduce((s, r) => s + r.hours, 0);

    if (rows.length === 0) {
      destroyActivityChart();
      el.chartSummary.textContent = 'Total logged hours: 0';
      setPlaceholder(true, defaultMsg);
      return;
    }

    setPlaceholder(false, defaultMsg);
    el.chartSummary.textContent = `Total logged hours: ${fmtHoursNum(totalH)} · ${rows.length} distinct activit${rows.length === 1 ? 'y' : 'ies'}`;

    const labels = rows.map((r) => truncateChartLabel(r.display));
    const data = rows.map((r) => r.hours);
    const colors = donutColors(rows.length);

    const muted =
      getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#94a3b8';
    const cardBg =
      getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#1e293b';

    destroyActivityChart();
    const ctx = el.chartCanvas.getContext('2d');
    if (!ctx) return;

    activityChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderColor: cardBg,
            borderWidth: 2,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.15,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: muted,
              boxWidth: 14,
              padding: 10,
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const i = items[0] && items[0].dataIndex;
                if (i == null) return '';
                return rows[i].display;
              },
              label: (item) => {
                const v = Number(item.raw);
                const pct = totalH > 0 ? ((v / totalH) * 100).toFixed(1) : '0';
                return ` ${fmtHoursNum(v)} h (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  function renderHistory() {
    if (!el.historyList) return;
    const dates = collectUniqueDates();
    if (dates.length === 0) {
      el.historyList.innerHTML = '';
      el.historyEmpty.classList.remove('hidden');
      return;
    }
    el.historyEmpty.classList.add('hidden');
    el.historyList.innerHTML = dates
      .map((dateStr) => {
        const filled = countDayLoggedHours(dateStr);
        const filledStr = Number.isInteger(filled) ? String(filled) : filled.toFixed(2).replace(/\.?0+$/, '');
        const wd = weekdayForDateStr(dateStr);
        return `<article class="history-card">
          <div class="history-card-info">
            <div class="history-card-date mono">${escapeHtml(dateStr)}</div>
            <div class="history-card-meta">${escapeHtml(wd)} · ${escapeHtml(filledStr)} h logged</div>
          </div>
          <button type="button" class="btn secondary btn-open-day" data-date="${escapeAttr(dateStr)}">Open day</button>
        </article>`;
      })
      .join('');
  }

  if (el.hourList) {
    el.hourList.addEventListener('input', (e) => {
      const t = e.target;
      if (t && t.classList && (t.classList.contains('slot-start') || t.classList.contains('slot-end'))) {
        updateSlotDurationLabel(t.closest('.hour-card'));
      }
    });

    el.hourList.addEventListener('change', (e) => {
      const inp = e.target.closest('.suggest-input');
      if (!inp) return;
      const card = inp.closest('.hour-card');
      const ta = card && card.querySelector('.hour-input');
      if (!ta) return;
      if (matchesSuggestionLibrary(inp.value)) {
        ta.value = inp.value.trim();
      }
    });

    el.hourList.addEventListener('click', (e) => {
      const dateStr = el.viewDate.value || todayDateStr();

      const rm = e.target.closest('.btn-remove-slot');
      if (rm) {
        const card = rm.closest('.hour-card');
        const id = card && card.getAttribute('data-slot-id');
        if (!id || id === '__draft__') return;
        if (state.days[dateStr]) {
          const idx = state.days[dateStr].findIndex((s) => s.id === id);
          if (idx >= 0) state.days[dateStr].splice(idx, 1);
          if (state.days[dateStr].length === 0) delete state.days[dateStr];
        }
        saveState();
        renderDay();
        renderHistory();
        renderActivitySummary();
        return;
      }

      const btn = e.target.closest('.btn-submit');
      if (!btn) return;
      const card = btn.closest('.hour-card');
      const p = readCardSlot(card);
      if (!p) return;
      const ok = applySlotToState(dateStr, p.id, p.start, p.end, p.text);
      if (!ok) return;
      if (p.text.trim()) addToSuggestionLibrary(p.text.trim());
      renderDay();
      updateDaySummary();
      renderHistory();
      renderActivitySummary();
    });
  }

  if (el.btnAddSlot) {
    el.btnAddSlot.addEventListener('click', () => {
      const dateStr = el.viewDate.value || todayDateStr();
      if (!state.days[dateStr] || state.days[dateStr].length === 0) {
        state.days[dateStr] = [{ id: newId(), start: '09:00', end: '10:00', text: '' }];
      } else {
        const arr = state.days[dateStr];
        const last = arr[arr.length - 1];
        const start = last.end || last.start;
        const end = addMinutesToTimeStr(start, 60);
        arr.push({ id: newId(), start, end, text: '' });
      }
      saveState();
      renderDay();
    });
  }

  if (el.historyList) {
    el.historyList.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-open-day');
      if (!btn) return;
      const d = btn.getAttribute('data-date');
      if (!d) return;
      el.viewDate.value = d;
      renderDay();
      showPanel('log');
    });
  }

  function setPanelVisibility(panel, visible) {
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
    panel.hidden = !visible;
    if ('inert' in HTMLElement.prototype) {
      panel.inert = !visible;
    }
  }

  function showPanel(name) {
    const isLog = name === 'log';
    const isHistory = name === 'history';
    const isActivity = name === 'activity';
    const isCharts = name === 'charts';

    setPanelVisibility(el.panelLog, isLog);
    setPanelVisibility(el.panelHistory, isHistory);
    setPanelVisibility(el.panelActivity, isActivity);
    setPanelVisibility(el.panelCharts, isCharts);

    el.tabBtnLog.classList.toggle('active', isLog);
    el.tabBtnHistory.classList.toggle('active', isHistory);
    if (el.tabBtnActivity) el.tabBtnActivity.classList.toggle('active', isActivity);
    if (el.tabBtnCharts) el.tabBtnCharts.classList.toggle('active', isCharts);

    el.tabBtnLog.setAttribute('aria-selected', isLog ? 'true' : 'false');
    el.tabBtnHistory.setAttribute('aria-selected', isHistory ? 'true' : 'false');
    if (el.tabBtnActivity) el.tabBtnActivity.setAttribute('aria-selected', isActivity ? 'true' : 'false');
    if (el.tabBtnCharts) el.tabBtnCharts.setAttribute('aria-selected', isCharts ? 'true' : 'false');

    if (isHistory) renderHistory();
    if (isActivity) renderActivitySummary();
    if (isCharts) renderActivityChart();
    if (!isCharts) destroyActivityChart();
  }

  el.tabBtnLog.addEventListener('click', () => showPanel('log'));
  el.tabBtnHistory.addEventListener('click', () => showPanel('history'));
  if (el.tabBtnActivity) el.tabBtnActivity.addEventListener('click', () => showPanel('activity'));
  if (el.tabBtnCharts) el.tabBtnCharts.addEventListener('click', () => showPanel('charts'));

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
    doc.text('Activity log — ' + dateStr + ' (' + wd + ')', margin, y);
    y += 28;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text('Generated ' + new Date().toLocaleString(), margin, y);
    y += 24;
    doc.setTextColor(0);

    const slots = (state.days[dateStr] || [])
      .filter((s) => (s.text || '').trim())
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start));

    if (slots.length === 0) {
      doc.setFontSize(11);
      doc.text('No entries for this day.', margin, y);
    } else {
      slots.forEach((slot) => {
        const range = formatRangeLabel(dateStr, slot.start, slot.end);
        const line = slot.text.trim();
        const dur = slotDurationHours(slot.start, slot.end);
        const durStr = Number.isInteger(dur) ? String(dur) : dur.toFixed(2).replace(/\.?0+$/, '');
        const block = range + ' (' + durStr + ' h) — ' + line;
        const lines = doc.splitTextToSize(block, 500);
        if (y > 780) {
          doc.addPage();
          y = margin;
        }
        doc.setFontSize(11);
        doc.text(lines, margin, y);
        y += lines.length * 14 + 6;
      });
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
    return navigator.serviceWorker
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((reg) => {
        try {
          reg.update();
        } catch (_) {}
        return reg;
      })
      .catch(() => null);
  }

  function isStandalonePwa() {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (typeof navigator !== 'undefined' && 'standalone' in navigator && navigator.standalone) return true;
    return false;
  }

  function initInstallUI() {
    if (!el.installCard) return;
    if (isStandalonePwa()) {
      el.installCard.classList.add('hidden');
      if (el.btnInstall) el.btnInstall.classList.add('hidden');
      return;
    }
    el.installCard.classList.remove('hidden');
  }

  function setupInstall() {
    initInstallUI();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      if (el.btnInstall) el.btnInstall.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
      deferredInstall = null;
      if (el.btnInstall) el.btnInstall.classList.add('hidden');
      if (el.installCard) el.installCard.classList.add('hidden');
    });

    if (el.btnInstall) {
      el.btnInstall.addEventListener('click', async () => {
        if (!deferredInstall) return;
        deferredInstall.prompt();
        await deferredInstall.userChoice;
        deferredInstall = null;
        el.btnInstall.classList.add('hidden');
      });
    }
  }

  loadState();
  loadSettings();
  renderSuggestionDatalist();
  el.viewDate.value = todayDateStr();
  setupInstall();
  if (el.btnNotifyAllow) el.btnNotifyAllow.addEventListener('click', onNotifyAllowClick);
  if (el.btnNotifyDisable) el.btnNotifyDisable.addEventListener('click', onNotifyDisableClick);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((r) => {
        if (r) r.update();
      });
    }
    if (
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
