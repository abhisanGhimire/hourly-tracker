(function () {
  'use strict';

  const STORAGE_KEY = 'hourlyActivityLog_v1';

  /** @type {{ entries: Record<string, { text: string, skipped?: boolean, at?: string }> }} */
  let state = { entries: {} };

  let deferredInstall = null;
  let persistDebounceTimer = null;
  let pendingPersist = null;

  const el = {
    viewDate: document.getElementById('view-date'),
    hourTbody: document.getElementById('hour-tbody'),
    daySummary: document.getElementById('day-summary'),
    btnToday: document.getElementById('btn-today'),
    btnPdf: document.getElementById('btn-pdf'),
    btnInstall: document.getElementById('btn-install'),
    panelLog: document.getElementById('panel-log'),
    panelHistory: document.getElementById('panel-history'),
    tabBtnLog: document.getElementById('tab-btn-log'),
    tabBtnHistory: document.getElementById('tab-btn-history'),
    historyTbody: document.getElementById('history-tbody'),
    historyEmpty: document.getElementById('history-empty')
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

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.entries === 'object') state = parsed;
      }
    } catch (_) {
      state = { entries: {} };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function hasResolvedEntry(key) {
    const e = state.entries[key];
    if (!e) return false;
    if (e.skipped) return true;
    return typeof e.text === 'string' && e.text.trim().length > 0;
  }

  function hourLabel12(h) {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    return `${pad2(h12)}:00 ${ampm}`;
  }

  function getEntryForSlot(key) {
    return state.entries[key] || { text: '', skipped: false };
  }

  function persistSlot(key, text, skipped) {
    const trimmed = (text || '').trim();
    if (!trimmed && !skipped) {
      delete state.entries[key];
    } else {
      state.entries[key] = {
        text: skipped ? '' : trimmed,
        skipped: !!skipped,
        at: new Date().toISOString()
      };
    }
    saveState();
  }

  function updateDaySummary() {
    const dateStr = el.viewDate.value || todayDateStr();
    let filled = 0;
    let skipped = 0;
    for (let h = 0; h < 24; h++) {
      const key = slotKeyFromDateHour(dateStr, h);
      if (hasResolvedEntry(key)) {
        if (state.entries[key]?.skipped) skipped++;
        else filled++;
      }
    }
    el.daySummary.textContent = `${dateStr} · ${filled} hours with notes · ${skipped} marked skip · ${24 - filled - skipped} empty`;
  }

  function refreshRowAppearance(tr) {
    if (!tr) return;
    const key = tr.getAttribute('data-slot');
    if (!key) return;
    const resolved = hasResolvedEntry(key);
    tr.classList.toggle('row-done', resolved);
    tr.classList.toggle('row-pending', !resolved);
  }

  function flushPersist() {
    if (!pendingPersist) return;
    const { key, text, skipped } = pendingPersist;
    pendingPersist = null;
    persistSlot(key, text, skipped);
  }

  function renderDay() {
    const dateStr = el.viewDate.value || todayDateStr();
    let filled = 0;
    let skipped = 0;
    const rows = [];
    for (let h = 0; h < 24; h++) {
      const key = slotKeyFromDateHour(dateStr, h);
      const entry = getEntryForSlot(key);
      const resolved = hasResolvedEntry(key);
      if (resolved) {
        if (entry.skipped) skipped++;
        else filled++;
      }
      const text = entry.skipped ? '' : (entry.text || '');
      rows.push({
        key,
        label: hourLabel12(h),
        text,
        skipped: !!entry.skipped,
        resolved
      });
    }

    updateDaySummary();

    el.hourTbody.innerHTML = rows
      .map((r) => {
        const checked = r.skipped ? ' checked' : '';
        return `<tr class="${r.resolved ? 'row-done' : 'row-pending'}" data-slot="${escapeAttr(r.key)}">
          <td class="cell-hour"><span class="hour-label">${escapeHtml(r.label)}</span></td>
          <td class="cell-activity">
            <textarea class="hour-input" data-slot="${escapeAttr(r.key)}" rows="2" maxlength="4000" placeholder="What did you do this hour?"${r.skipped ? ' disabled' : ''}></textarea>
          </td>
          <td class="cell-skip">
            <label class="skip-label"><input type="checkbox" class="hour-skip" data-slot="${escapeAttr(r.key)}"${checked} /> <span class="skip-txt">Skip</span></label>
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

  function summarizeDay(dateStr) {
    let filled = 0;
    const parts = [];
    for (let h = 0; h < 24; h++) {
      const key = slotKeyFromDateHour(dateStr, h);
      const e = state.entries[key];
      if (!e) continue;
      if (e.skipped) continue;
      const t = (e.text || '').trim();
      if (!t) continue;
      filled++;
      parts.push(`${hourLabel12(h)}: ${t}`);
    }
    const preview = parts.length ? parts.join(' · ') : '';
    const short = preview.length > 160 ? preview.slice(0, 157) + '…' : preview;
    return { filled, preview: short };
  }

  function weekdayForDateStr(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { weekday: 'long' });
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
        const { filled, preview } = summarizeDay(dateStr);
        const wd = weekdayForDateStr(dateStr);
        const prev = preview || '—';
        return `<tr>
          <td class="mono">${escapeHtml(dateStr)}</td>
          <td>${escapeHtml(wd)}</td>
          <td class="num">${filled}</td>
          <td class="preview">${escapeHtml(prev)}</td>
          <td class="cell-open"><button type="button" class="btn secondary btn-open-day" data-date="${escapeAttr(dateStr)}">Open</button></td>
        </tr>`;
      })
      .join('');
  }

  function handleHourInput(e) {
    const ta = e.target.closest('.hour-input');
    if (!ta) return;
    const key = ta.getAttribute('data-slot');
    if (!key) return;
    const row = ta.closest('tr');
    const skipEl = row && row.querySelector('.hour-skip');
    const skipped = !!(skipEl && skipEl.checked);
    pendingPersist = { key, text: ta.value, skipped };
    if (persistDebounceTimer) clearTimeout(persistDebounceTimer);
    persistDebounceTimer = setTimeout(() => {
      persistDebounceTimer = null;
      flushPersist();
      updateDaySummary();
      renderHistory();
      refreshRowAppearance(row);
    }, 450);
  }

  function handleHourSkip(e) {
    const cb = e.target.closest('.hour-skip');
    if (!cb) return;
    const key = cb.getAttribute('data-slot');
    if (!key) return;
    const row = cb.closest('tr');
    const ta = row && row.querySelector('.hour-input');
    if (persistDebounceTimer) {
      clearTimeout(persistDebounceTimer);
      persistDebounceTimer = null;
    }
    pendingPersist = null;
    if (cb.checked) {
      if (ta) {
        ta.disabled = true;
        ta.value = '';
      }
      persistSlot(key, '', true);
    } else {
      if (ta) ta.disabled = false;
      persistSlot(key, ta ? ta.value : '', false);
    }
    updateDaySummary();
    renderHistory();
    refreshRowAppearance(row);
  }

  el.hourTbody.addEventListener('input', handleHourInput);
  el.hourTbody.addEventListener('change', handleHourSkip);

  el.hourTbody.addEventListener(
    'blur',
    (e) => {
      const ta = e.target.closest('.hour-input');
      if (!ta) return;
      const key = ta.getAttribute('data-slot');
      if (!key) return;
      const row = ta.closest('tr');
      const skipEl = row && row.querySelector('.hour-skip');
      const skipped = !!(skipEl && skipEl.checked);
      if (persistDebounceTimer) {
        clearTimeout(persistDebounceTimer);
        persistDebounceTimer = null;
      }
      pendingPersist = null;
      persistSlot(key, ta.value, skipped);
      updateDaySummary();
      renderHistory();
      refreshRowAppearance(row);
    },
    true
  );

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
    el.panelLog.classList.toggle('hidden', !isLog);
    el.panelLog.hidden = !isLog;
    el.panelHistory.classList.toggle('hidden', isLog);
    el.panelHistory.hidden = isLog;
    el.tabBtnLog.classList.toggle('active', isLog);
    el.tabBtnHistory.classList.toggle('active', !isLog);
    el.tabBtnLog.setAttribute('aria-selected', isLog ? 'true' : 'false');
    el.tabBtnHistory.setAttribute('aria-selected', !isLog ? 'true' : 'false');
    if (!isLog) renderHistory();
  }

  el.tabBtnLog.addEventListener('click', () => showPanel('log'));
  el.tabBtnHistory.addEventListener('click', () => showPanel('history'));

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
      let line = '';
      if (entry?.skipped) line = '(skipped)';
      else if (entry?.text?.trim()) line = entry.text.trim();
      else line = '—';
      const timeLabel = hourLabel12(h);
      const block = timeLabel + ' — ' + line;
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
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
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
  el.viewDate.value = todayDateStr();
  registerSW();
  setupInstall();
  renderDay();
  renderHistory();
})();
