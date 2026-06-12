(() => {
  let currentTab = 'scan';
  let scanResults = [];
  let scanSummary = null;
  let ignoredItems = [];
  let activeSim = null;
  let pickerActive = false;
  let brandColors = [];
  let ignoreRules = [];
  let currentCompare = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function sendToContent(msg) {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) { resolve(null); return; }
        chrome.tabs.sendMessage(tabs[0].id, msg, (res) => {
          resolve(res);
        });
      });
    });
  }

  function switchTab(tab) {
    currentTab = tab;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.panel === tab));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    if (tab === 'report') renderReport();
    if (tab === 'suggest') renderSuggestions();
  }

  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.panel)));

  async function doScan() {
    const resultsEl = $('#scan-results');
    const emptyEl = $('#scan-empty');
    const statsEl = $('#scan-stats');
    resultsEl.innerHTML = '<div class="loading"></div>';
    emptyEl.style.display = 'none';
    statsEl.style.display = 'block';

    const res = await sendToContent({ type: 'scanPage' });
    if (!res) {
      resultsEl.innerHTML = '<div class="empty-state"><p>无法扫描此页面，请刷新后重试</p></div>';
      return;
    }
    scanResults = res.results || [];
    scanSummary = res.summary || {};
    ignoredItems = res.ignored || [];
    $('#stat-total').textContent = scanSummary.total || 0;
    $('#stat-fail').textContent = scanSummary.fail || 0;
    $('#stat-aa').textContent = scanSummary.aa || 0;
    $('#stat-aaa').textContent = scanSummary.aaa || 0;
    renderScanList();
  }

  function renderScanList(filter) {
    const resultsEl = $('#scan-results');
    let items = scanResults;
    if (filter === 'fail') items = items.filter(i => i.level === 'Fail');
    else if (filter === 'aa') items = items.filter(i => i.level === 'AA');
    else if (filter === 'aaa') items = items.filter(i => i.level === 'AAA');

    if (items.length === 0) {
      resultsEl.innerHTML = '<div class="empty-state"><p>没有符合条件的元素</p></div>';
      return;
    }

    resultsEl.innerHTML = `
      <div class="filter-bar">
        <span class="filter-chip ${!filter?'active':''}" data-filter="">全部</span>
        <span class="filter-chip ${filter==='fail'?'active':''}" data-filter="fail">不达标</span>
        <span class="filter-chip ${filter==='aa'?'active':''}" data-filter="aa">AA</span>
        <span class="filter-chip ${filter==='aaa'?'active':''}" data-filter="aaa">AAA</span>
      </div>
      ${items.slice(0, 50).map(item => renderResultItem(item)).join('')}
      ${items.length > 50 ? `<p style="text-align:center;color:var(--text2);font-size:11px;padding:8px;">还有 ${items.length - 50} 个元素未显示...</p>` : ''}
    `;

    resultsEl.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => renderScanList(chip.dataset.filter));
    });
    resultsEl.querySelectorAll('.result-item').forEach(el => {
      el.addEventListener('click', () => {
        sendToContent({ type: 'highlightSingle', selector: el.dataset.selector });
      });
      el.addEventListener('mouseenter', () => {
        sendToContent({ type: 'highlightSingle', selector: el.dataset.selector });
      });
    });
  }

  function renderResultItem(item) {
    const levelClass = item.level === 'AAA' ? 'aaa' : item.level === 'AA' ? 'aa' : 'fail';
    const thumbHtml = (item.level === 'Fail' && item.thumbnail)
      ? `<img class="result-thumb" src="${item.thumbnail}" alt="对比度标注截图" />`
      : '';
    return `
      <div class="result-item level-${levelClass}" data-selector="${escapeAttr(item.selector)}">
        <div class="result-top">
          <div class="color-swatch" style="background:${item.fg}"></div>
          <div class="color-swatch" style="background:${item.bg}"></div>
          <span class="result-ratio">${item.ratio}:1</span>
          <span class="result-level ${levelClass}">${item.level}</span>
        </div>
        <div class="result-text">${escapeHtml(item.text)}</div>
        <div class="result-meta">
          <span>${item.fg} / ${item.bg}</span>
          <span>${item.fontSize}px${item.bold ? ' 粗体' : ''}</span>
        </div>
        ${thumbHtml}
      </div>
    `;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  $('#btn-scan').addEventListener('click', doScan);
  $('#btn-clear').addEventListener('click', () => {
    sendToContent({ type: 'clearHighlights' });
  });

  async function startPicker() {
    pickerActive = true;
    $('#btn-pick').textContent = '⏳ 拾取中…点击页面元素';
    $('#btn-pick').disabled = true;
    await sendToContent({ type: 'startPicker' });
  }

  function stopPicker() {
    pickerActive = false;
    $('#btn-pick').textContent = '🎯 开始拾取';
    $('#btn-pick').disabled = false;
  }

  $('#btn-pick').addEventListener('click', () => {
    if (pickerActive) {
      sendToContent({ type: 'stopPicker' });
      stopPicker();
    } else {
      startPicker();
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'pickerResult') {
      stopPicker();
      renderPickedResult(msg.data);
    }
    if (msg.type === 'pickerCancelled') {
      stopPicker();
    }
  });

  function loadPickerResult() {
    chrome.storage.local.get(['lastPickerResult'], (data) => {
      if (data.lastPickerResult) {
        renderPickedResult(data.lastPickerResult);
      }
    });
  }

  function renderPickedResult(data) {
    if (!data) return;
    $('#pick-empty').style.display = 'none';
    const levelClass = data.level === 'AAA' ? 'aaa' : data.level === 'AA' ? 'aa' : 'fail';
    const el = $('#pick-result');
    el.style.display = 'block';
    el.innerHTML = `
      <div class="picked-result">
        <div class="picked-colors">
          <div class="color-pair">
            <div class="swatch" style="background:${data.fg}"></div>
            <span style="font-size:12px;font-family:monospace">${data.fg}</span>
            <span class="on">on</span>
            <div class="swatch" style="background:${data.bg}"></div>
            <span style="font-size:12px;font-family:monospace">${data.bg}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin:8px 0;">
          <span style="font-size:20px;font-weight:700;">${data.ratio}:1</span>
          <span class="result-level ${levelClass}" style="font-size:12px;padding:4px 10px;">${data.level}</span>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">
          字号: ${data.fontSize}px ${data.bold ? '(粗体)' : ''} | ${data.text ? '文本: ' + escapeHtml(data.text.slice(0,40)) : ''}
        </div>
        <div style="font-size:10px;color:var(--text2);margin-bottom:8px;">
          选择器: <code style="background:var(--surface2);padding:2px 6px;border-radius:3px;">${escapeHtml(data.selector)}</code>
        </div>
        ${!data.pass ? renderInlineSuggestion(data) : ''}
      </div>
    `;
  }

  function renderInlineSuggestion(data) {
    const fgRgb = data.fgRgb;
    const bgRgb = data.bgRgb;
    const suggestFg = computeSuggestColor(fgRgb, bgRgb);
    if (!suggestFg) return '';
    const suggestHex = rgbToHex(suggestFg.r, suggestFg.g, suggestFg.b);
    return `
      <div style="background:rgba(59,130,246,.08);border-radius:6px;padding:8px;margin-top:8px;">
        <div style="font-size:11px;color:var(--accent);font-weight:600;margin-bottom:4px;">💡 建议替换</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="swatch" style="background:${data.fg};width:22px;height:22px;"></div>
          <span style="color:var(--text2);">→</span>
          <div class="swatch" style="background:${suggestHex};width:22px;height:22px;"></div>
          <span style="font-family:monospace;font-size:12px;">${suggestHex}</span>
        </div>
      </div>
    `;
  }

  function computeSuggestColor(fg, bg) {
    const bgLum = relativeLuminance(bg.r, bg.g, bg.b);
    for (let l = 0; l <= 100; l++) {
      const lightness = bgLum > 0.5 ? l : 100 - l;
      const r = lightness * 2.55;
      const candidate = { r: Math.round(r), g: Math.round(r), b: Math.round(r) };
      const ratio = contrastRatio(candidate, bg);
      if (ratio >= 4.5) return candidate;
    }
    return null;
  }

  function relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function contrastRatio(c1, c2) {
    const l1 = relativeLuminance(c1.r, c1.g, c1.b);
    const l2 = relativeLuminance(c2.r, c2.g, c2.b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  function renderReport() {
    if (currentCompare) {
      renderCompareView();
      return;
    }
    if (!scanResults.length) {
      $('#report-content').innerHTML = '<div class="empty-state"><p>请先执行页面扫描</p></div>';
      $('#history-compare').style.display = 'none';
      return;
    }
    loadHistorySelectors();
    const failItems = scanResults.filter(i => i.level === 'Fail');
    const aaItems = scanResults.filter(i => i.level === 'AA');
    const aaaItems = scanResults.filter(i => i.level === 'AAA');
    const passRate = scanResults.length ? Math.round((aaItems.length + aaaItems.length) / scanResults.length * 100) : 0;

    const ignoredHtml = ignoredItems.length ? `
      <h3 style="margin-top:14px;">被忽略项 (${ignoredItems.length})</h3>
      ${ignoredItems.slice(0, 20).map(item => {
        const rule = item.ignoredBecause || {};
        return `
          <div class="ignored-item">
            <div style="display:flex;align-items:center;gap:6px;">
              <div class="color-swatch" style="background:${item.fg}"></div>
              <div class="color-swatch" style="background:${item.bg}"></div>
              <span style="font-weight:600;">${item.ratio}:1</span>
              <span class="result-level fail" style="font-size:10px;">${item.level}</span>
              ${rule.scope ? `<span style="background:rgba(59,130,246,.15);color:var(--accent);font-size:10px;padding:1px 6px;border-radius:3px;">${escapeHtml(rule.scope)}</span>` : ''}
            </div>
            <div class="result-text">${escapeHtml(item.text)}</div>
            <div class="ignored-reason">📌 忽略原因：${rule.type === 'color' ? rule.fg+'/'+rule.bg : rule.value}${rule.note ? ' — ' + escapeHtml(rule.note) : ''}</div>
          </div>
        `;
      }).join('')}
    ` : '';

    $('#report-content').innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="num">${passRate}%</div><div class="label">达标率</div></div>
        <div class="stat-card fail"><div class="num">${failItems.length}</div><div class="label">需修复</div></div>
      </div>
      <h3 style="margin-top:12px;">低可读文本列表</h3>
      ${failItems.length === 0 ? '<p style="color:var(--green);font-size:12px;padding:8px;">✅ 所有文本均达标！</p>' :
        failItems.slice(0, 30).map(item => {
          const thumbHtml = item.thumbnail
            ? `<img class="result-thumb" src="${item.thumbnail}" alt="对比度标注截图" />`
            : '';
          return `
          <div class="result-item" data-selector="${escapeAttr(item.selector)}" style="margin-bottom:4px;padding:8px;">
            <div class="result-top">
              <div class="color-swatch" style="background:${item.fg}"></div>
              <div class="color-swatch" style="background:${item.bg}"></div>
              <span class="result-ratio" style="font-size:12px;">${item.ratio}:1</span>
              <span class="result-level fail">${item.level}</span>
            </div>
            <div class="result-text">${escapeHtml(item.text)}</div>
            ${thumbHtml}
          </div>
        `;
        }).join('')
      }
      ${ignoredHtml}
      <div style="margin-top:12px;">
        <h3>分布概览</h3>
        <div style="background:var(--surface);border-radius:8px;overflow:hidden;height:24px;display:flex;">
          ${failItems.length ? `<div style="width:${failItems.length/scanResults.length*100}%;background:var(--red);"></div>` : ''}
          ${aaItems.length ? `<div style="width:${aaItems.length/scanResults.length*100}%;background:var(--yellow);"></div>` : ''}
          ${aaaItems.length ? `<div style="width:${aaaItems.length/scanResults.length*100}%;background:var(--green);"></div>` : ''}
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:10px;color:var(--text2);">
          <span><span style="color:var(--red);">●</span> 不达标 ${failItems.length}</span>
          <span><span style="color:var(--yellow);">●</span> AA ${aaItems.length}</span>
          <span><span style="color:var(--green);">●</span> AAA ${aaaItems.length}</span>
          ${scanSummary && scanSummary.ignored ? `<span><span style="color:#64748b;">●</span> 已忽略 ${scanSummary.ignored}</span>` : ''}
        </div>
      </div>
    `;

    $('#report-content').querySelectorAll('.result-item').forEach(el => {
      el.addEventListener('click', () => {
        sendToContent({ type: 'highlightSingle', selector: el.dataset.selector });
      });
    });
  }

  function loadHistorySelectors() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabUrl = tabs[0]?.url;
      if (!tabUrl) return;
      chrome.storage.local.get(['scanHistory'], (data) => {
        const history = data.scanHistory || {};
        const list = history[tabUrl] || [];
        if (list.length >= 2) {
          $('#history-compare').style.display = 'block';
          const options = list.map(h => {
            const t = new Date(h.timestamp);
            const label = `${t.toLocaleString('zh-CN')} — Fail:${h.summary.fail}/AA:${h.summary.aa}/AAA:${h.summary.aaa}`;
            return `<option value="${h.id}">${label}</option>`;
          }).join('');
          $('#history-a').innerHTML = options;
          $('#history-b').innerHTML = options;
          if (list.length >= 2) {
            $('#history-a').selectedIndex = 0;
            $('#history-b').selectedIndex = 1;
          }
        } else {
          $('#history-compare').style.display = 'none';
        }
      });
    });
  }

  $('#btn-do-compare').addEventListener('click', () => {
    const idA = $('#history-a').value;
    const idB = $('#history-b').value;
    if (idA === idB) { alert('请选择两次不同的扫描'); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabUrl = tabs[0]?.url;
      if (!tabUrl) return;
      chrome.storage.local.get(['scanHistory'], (data) => {
        const history = data.scanHistory || {};
        const list = history[tabUrl] || [];
        const a = list.find(h => h.id === idA);
        const b = list.find(h => h.id === idB);
        if (a && b) {
          currentCompare = { a, b };
          renderCompareView();
        }
      });
    });
  });

  let expandedDiffKeys = new Set();

  function renderCompareView() {
    if (!currentCompare) return;
    const { a, b } = currentCompare;
    const diff = computeDiff(a.results, b.results);
    $('#report-content').innerHTML = `
      <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.3);border-radius:8px;padding:8px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div>
          <div style="font-size:11px;color:#64748b;">对比中</div>
          <div style="font-size:11px;">A: ${new Date(a.timestamp).toLocaleString('zh-CN')} → B: ${new Date(b.timestamp).toLocaleString('zh-CN')}</div>
        </div>
        <button class="btn btn-sm btn-outline" id="btn-cancel-compare">取消对比</button>
      </div>
      <div class="stat-row">
        <div class="stat-card"><div class="num" style="color:#22c55e;">${diff.improved.length}</div><div class="label">改善</div></div>
        <div class="stat-card"><div class="num" style="color:#ef4444;">${diff.regressed.length}</div><div class="label">退化</div></div>
        <div class="stat-card"><div class="num" style="color:#3b82f6;">${diff.added.length}</div><div class="label">新增</div></div>
        <div class="stat-card"><div class="num" style="color:#64748b;">${diff.removed.length}</div><div class="label">移除</div></div>
      </div>
      ${renderDiffSection('改善项', diff.improved, 'diff-improved', '↑', '#22c55e', 'improved')}
      ${renderDiffSection('退化项', diff.regressed, 'diff-regressed', '↓', '#f97316', 'regressed')}
      ${renderDiffSection('新增元素', diff.added, 'diff-added', '＋', '#22c55e', 'added')}
      ${renderDiffSection('移除元素', diff.removed, 'diff-removed', '−', '#ef4444', 'removed')}
    `;
    const btnCancel = $('#btn-cancel-compare');
    if (btnCancel) btnCancel.addEventListener('click', () => { currentCompare = null; expandedDiffKeys.clear(); renderReport(); });
    $('#report-content').querySelectorAll('.diff-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('input,button,textarea,a')) return;
        const key = row.dataset.key;
        if (!key) return;
        if (expandedDiffKeys.has(key)) expandedDiffKeys.delete(key);
        else expandedDiffKeys.add(key);
        renderCompareView();
      });
    });
  }

  function renderDiffSection(title, items, cls, badge, color, groupName) {
    if (items.length === 0) return '';
    return `
      <h3 style="margin-top:14px;color:${color};display:flex;align-items:center;justify-content:space-between;">
        <span>${title} <small style="color:#64748b;font-weight:400;">(${items.length})</small></span>
        <small style="font-size:10px;color:#94a3b8;font-weight:400;">点击条目查看详情</small>
      </h3>
      ${items.slice(0, 50).map((d, i) => {
        const key = `${groupName}-${d.selector || ('x'+i)}-${i}`;
        const open = expandedDiffKeys.has(key);
        const hasOld = d.oldRatio !== undefined;
        return `
        <div class="diff-row ${cls}" data-key="${key}" style="cursor:pointer;${open ? 'background:rgba(248,250,252,0.9);' : ''}">
          <div class="diff-badge">${badge}</div>
          <div style="flex:1;min-width:0;">
            ${hasOld && d.oldRatio ? `<div class="diff-old">${d.oldRatio}:1 (${d.oldLevel})</div>` : ''}
            <div class="diff-new" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.text ? escapeHtml(d.text.slice(0, 26)) : escapeHtml(d.selector || '').slice(0, 30)}</div>
          </div>
          <div>
            ${d.newRatio ? `<span class="result-level ${d.newLevel === 'Fail' ? 'fail' : d.newLevel === 'AA' ? 'aa' : 'aaa'}" style="font-size:10px;">${d.newRatio}:1 ${d.newLevel}</span>` : d.oldLevel ? `<span class="result-level fail" style="font-size:10px;">${d.oldLevel}</span>` : ''}
            <span style="margin-left:4px;font-size:10px;color:#94a3b8;">${open ? '▲' : '▼'}</span>
          </div>
        </div>
        ${open ? renderDiffDetail(d, cls, badge, color) : ''}
      `;
      }).join('')}
    `;
  }

  function renderDiffDetail(d, cls, badge, color) {
    const oldItem = d._old;
    const newItem = d._new;
    const colBlock = (item, label, side) => {
      if (!item) return `<div style="flex:1;min-width:0;"><div style="font-size:11px;color:#64748b;margin-bottom:6px;">${label}</div><div style="background:#f8fafc;border-radius:6px;padding:10px;border:1px dashed #cbd5e1;text-align:center;color:#94a3b8;font-size:11px;">${side === 'A' ? '已不存在于当前版本' : '上一版本不存在此元素'}</div></div>`;
      return `
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600;">${label}</div>
          ${item.thumbnail ? `<img src="${item.thumbnail}" style="width:100%;max-height:100px;object-fit:contain;border-radius:6px;border:1px solid #e2e8f0;background:#fff;margin-bottom:6px;" />` : ''}
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">
            <span style="display:inline-flex;align-items:center;gap:3px;"><span class="color-swatch" style="background:${item.fg};width:14px;height:14px;"></span><code style="font-size:10px;color:#475569;">${item.fg}</code></span>
            <span style="font-size:10px;color:#94a3b8;">on</span>
            <span style="display:inline-flex;align-items:center;gap:3px;"><span class="color-swatch" style="background:${item.bg};width:14px;height:14px;"></span><code style="font-size:10px;color:#475569;">${item.bg}</code></span>
          </div>
          <div style="margin-bottom:4px;"><span class="result-level ${item.level === 'Fail' ? 'fail' : item.level === 'AA' ? 'aa' : 'aaa'}" style="font-size:10px;">${item.ratio}:1 ${item.level}</span> <span style="font-size:10px;color:#64748b;">${item.fontSize}px${item.bold ? ' · 粗体' : ''}</span></div>
          ${item.suggestFg ? `<div style="font-size:11px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:4px 6px;margin:4px 0;"><span style="color:#16a34a;">💡 建议前景色 </span><span style="display:inline-flex;align-items:center;gap:3px;"><span class="color-swatch" style="background:${item.suggestFg};width:12px;height:12px;"></span><code style="font-size:10px;">${item.suggestFg}</code></span> <span style="color:#16a34a;">→ ${item.suggestRatio}:1</span></div>` : ''}
          <div style="font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeAttr(item.text || '')}">${escapeHtml((item.text || '').slice(0, 40))}</div>
          ${item.region ? `<div style="margin-top:4px;font-size:10px;"><span style="background:rgba(59,130,246,.1);color:var(--accent);padding:1px 5px;border-radius:3px;">${escapeHtml(item.region)}</span></div>` : ''}
        </div>
      `;
    };
    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin:-3px 0 6px 36px;box-shadow:0 1px 2px rgba(0,0,0,.04);">
        <div style="display:flex;gap:10px;align-items:stretch;">
          ${colBlock(oldItem, '👈 上一版本 (A)', 'A')}
          <div style="width:1px;background:#e2e8f0;flex-shrink:0;"></div>
          ${colBlock(newItem, '👉 当前版本 (B)', 'B')}
        </div>
        ${newItem?.ignoredBecause || oldItem?.ignoredBecause ? `
        <div style="margin-top:8px;padding:6px 8px;background:rgba(100,116,139,.08);border-left:3px solid #64748b;border-radius:4px;font-size:11px;">
          📌 忽略规则：${escapeHtml(
            (newItem?.ignoredBecause?.note || oldItem?.ignoredBecause?.note || '') +
            (newItem?.ignoredBecause?.scope || oldItem?.ignoredBecause?.scope ? `[${newItem?.ignoredBecause?.scope || oldItem?.ignoredBecause?.scope}]` : '')
          ) || '已命中忽略规则'}
        </div>
        ` : ''}
      </div>
    `;
  }

  function computeDiff(oldResults, newResults) {
    const aMap = new Map();
    oldResults.forEach(r => aMap.set(r.selector, r));
    const bMap = new Map();
    newResults.forEach(r => bMap.set(r.selector, r));
    const improved = [];
    const regressed = [];
    const added = [];
    const removed = [];
    const levelRank = { 'Fail': 0, 'AA': 1, 'AAA': 2 };

    oldResults.forEach(a => {
      const b = bMap.get(a.selector);
      if (!b) {
        removed.push({ selector: a.selector, text: a.text, oldRatio: a.ratio, oldLevel: a.level, _old: a, _new: null });
        return;
      }
      const rankDelta = levelRank[b.level] - levelRank[a.level];
      const pushData = (arr) => arr.push({
        selector: a.selector,
        text: b.text || a.text,
        oldRatio: a.ratio, oldLevel: a.level,
        newRatio: b.ratio, newLevel: b.level,
        _old: a, _new: b
      });
      if (rankDelta > 0 || (b.ratio - a.ratio >= 0.5 && levelRank[b.level] >= levelRank[a.level])) {
        if (levelRank[b.level] > levelRank[a.level]) pushData(improved);
        else if (rankDelta === 0 && b.ratio - a.ratio >= 0.5) pushData(improved);
      } else if (rankDelta < 0 || a.ratio - b.ratio >= 0.5) {
        if (levelRank[b.level] < levelRank[a.level]) pushData(regressed);
        else if (rankDelta === 0 && a.ratio - b.ratio >= 0.5) pushData(regressed);
      }
    });

    newResults.forEach(b => {
      if (!aMap.has(b.selector)) {
        added.push({ selector: b.selector, text: b.text, newRatio: b.ratio, newLevel: b.level, _old: null, _new: b });
      }
    });

    return { improved, regressed, added, removed };
  }

  function initSimGrid() {
    const sims = [
      { key: 'protanopia', name: '红盲', desc: '无法感知红色' },
      { key: 'deuteranopia', name: '绿盲', desc: '无法感知绿色' },
      { key: 'tritanopia', name: '蓝盲', desc: '无法感知蓝色' },
      { key: 'achromatopsia', name: '全色盲', desc: '完全无法感知色彩' },
      { key: 'protanomaly', name: '红弱', desc: '红色感知减弱' },
      { key: 'deuteranomaly', name: '绿弱', desc: '绿色感知减弱' }
    ];
    const grid = $('#sim-grid');
    grid.innerHTML = sims.map(s => {
      const previewStyle = s.key === 'achromatopsia' ? 'background:linear-gradient(90deg,#333,#999,#333)' :
        s.key === 'protanopia' ? 'background:linear-gradient(90deg,#8b8b00,#4a4a00,#006464)' :
        s.key === 'deuteranopia' ? 'background:linear-gradient(90deg,#8b6200,#4a3600,#004a64)' :
        s.key === 'tritanopia' ? 'background:linear-gradient(90deg,#8b0000,#640000,#006400)' :
        s.key === 'protanomaly' ? 'background:linear-gradient(90deg,#b8860b,#556b2f,#2e8b57)' :
        'background:linear-gradient(90deg,#cd853f,#6b8e23,#4682b4)';
      return `
        <div class="sim-card ${activeSim === s.key ? 'active' : ''}" data-sim="${s.key}">
          <div class="sim-preview" style="${previewStyle}"></div>
          <div class="sim-name">${s.name}</div>
          <div class="sim-desc">${s.desc}</div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.sim-card').forEach(card => {
      card.addEventListener('click', async () => {
        const sim = card.dataset.sim;
        if (activeSim === sim) {
          activeSim = null;
          await sendToContent({ type: 'simulateColorBlind', simType: 'none' });
        } else {
          activeSim = sim;
          await sendToContent({ type: 'simulateColorBlind', simType: sim });
        }
        initSimGrid();
      });
    });
  }
  initSimGrid();

  $('#btn-sim-reset').addEventListener('click', async () => {
    activeSim = null;
    await sendToContent({ type: 'simulateColorBlind', simType: 'none' });
    initSimGrid();
  });

  function renderSuggestions() {
    const failItems = scanResults.filter(i => i.level !== 'AAA');
    if (!failItems.length) {
      $('#suggest-content').innerHTML = '<div class="empty-state"><p>✅ 所有文本已达到 AAA 标准</p></div>';
      return;
    }
    const suggestions = failItems.slice(0, 15).map(item => {
      const fgRgb = hexToRgb(item.fg);
      const bgRgb = hexToRgb(item.bg);
      if (!fgRgb || !bgRgb) return null;
      const target = item.level === 'Fail' ? 4.5 : 7;
      const suggest = computeSuggestColor(fgRgb, bgRgb);
      if (!suggest) return null;
      const suggestHex = rgbToHex(suggest.r, suggest.g, suggest.b);
      const newRatio = contrastRatio(suggest, bgRgb);
      return { ...item, suggestFg: suggestHex, suggestRatio: Math.round(newRatio * 100) / 100 };
    }).filter(Boolean);

    $('#suggest-content').innerHTML = suggestions.map(s => `
      <div class="suggest-item">
        <div class="suggest-original">
          <div class="color-swatch" style="background:${s.fg}"></div>
          <span style="font-size:11px;font-family:monospace;">${s.fg}</span>
          <span style="font-size:10px;color:var(--text2);">on</span>
          <div class="color-swatch" style="background:${s.bg}"></div>
          <span style="font-size:11px;font-family:monospace;">${s.bg}</span>
          <span class="result-level ${s.level === 'Fail' ? 'fail' : 'aa'}" style="font-size:10px;">${s.ratio}:1</span>
        </div>
        <div class="suggest-new">
          <span class="suggest-arrow">→</span>
          <div class="suggest-color-box" style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:6px;">
            <div class="color-swatch" style="background:${s.suggestFg}"></div>
            <span class="hex">${s.suggestFg}</span>
            <span class="ratio" style="color:var(--green);">${s.suggestRatio}:1</span>
          </div>
        </div>
        <div class="result-text" style="margin-top:6px;">${escapeHtml(s.text)}</div>
      </div>
    `).join('');
  }

  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return {
      r: parseInt(hex.slice(0,2), 16),
      g: parseInt(hex.slice(2,4), 16),
      b: parseInt(hex.slice(4,6), 16)
    };
  }

  function loadBrandColors() {
    chrome.storage.local.get(['brandColors'], (data) => {
      brandColors = data.brandColors || [];
      renderBrandColors();
    });
  }

  function renderBrandColors() {
    const container = $('#brand-colors');
    container.innerHTML = brandColors.map((c, i) => `
      <div class="brand-chip" data-index="${i}">
        <div class="swatch" style="background:${c}"></div>
        <span>${c}</span>
        <span class="remove" data-index="${i}">×</span>
      </div>
    `).join('');

    container.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        brandColors.splice(idx, 1);
        chrome.storage.local.set({ brandColors });
        renderBrandColors();
      });
    });

    container.querySelectorAll('.brand-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const hex = brandColors[parseInt(chip.dataset.index)];
        navigator.clipboard.writeText(hex);
      });
    });
  }

  $('#btn-add-brand').addEventListener('click', () => {
    const input = $('#brand-input');
    const val = input.value.trim();
    if (/^#[0-9a-fA-F]{3,6}$/.test(val)) {
      if (!brandColors.includes(val)) {
        brandColors.push(val);
        chrome.storage.local.set({ brandColors });
        renderBrandColors();
      }
      input.value = '';
    }
  });

  function loadIgnoreRules() {
    chrome.storage.local.get(['ignoreRules'], (data) => {
      ignoreRules = data.ignoreRules || [];
      renderIgnoreList();
    });
  }

  function renderIgnoreList() {
    const container = $('#ignore-list');
    container.innerHTML = ignoreRules.map((rule, i) => `
      <div class="ignored-item" style="margin-bottom:6px;padding:8px;border-left:3px solid #64748b;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <strong style="font-size:11px;">${rule.type === 'color' ? '🎨 ' + rule.fg + '/' + rule.bg : '🔍 ' + rule.value}</strong>
            ${rule.scope ? `<span style="background:rgba(59,130,246,.15);color:var(--accent);font-size:10px;padding:1px 6px;border-radius:3px;">${escapeHtml(rule.scope)}</span>` : ''}
          </div>
          <button class="btn btn-sm btn-danger" data-index="${i}" style="padding:2px 8px;">删除</button>
        </div>
        ${rule.note ? `<div class="ignored-reason" style="margin-top:4px;">📝 ${escapeHtml(rule.note)}</div>` : ''}
      </div>
    `).join('');

    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        ignoreRules.splice(idx, 1);
        chrome.storage.local.set({ ignoreRules });
        sendToContent({ type: 'setIgnoreRules', rules: ignoreRules });
        renderIgnoreList();
      });
    });
  }

  $('#btn-add-ignore').addEventListener('click', () => {
    const type = $('#ignore-type').value;
    const val = $('#ignore-value').value.trim();
    const scope = $('#ignore-scope').value.trim();
    const note = $('#ignore-note').value.trim();
    if (!val) return;
    if (type === 'color') {
      const parts = val.split('/');
      if (parts.length === 2) {
        ignoreRules.push({
          type: 'color',
          fg: parts[0].trim(),
          bg: parts[1].trim(),
          scope,
          note,
          createdAt: Date.now()
        });
      }
    } else {
      ignoreRules.push({
        type: 'selector',
        value: val,
        scope,
        note,
        createdAt: Date.now()
      });
    }
    chrome.storage.local.set({ ignoreRules });
    sendToContent({ type: 'setIgnoreRules', rules: ignoreRules });
    renderIgnoreList();
    $('#ignore-value').value = '';
    $('#ignore-scope').value = '';
    $('#ignore-note').value = '';
  });

  function getScanUrl() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['lastUrl'], (data) => {
        if (data.lastUrl) { resolve(data.lastUrl); return; }
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs[0]?.url || '');
        });
      });
    });
  }

  function getScanTime() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['lastScanTime'], (data) => {
        resolve(data.lastScanTime ? new Date(data.lastScanTime).toISOString() : new Date().toISOString());
      });
    });
  }

  function getScanDiffSummary() {
    if (currentCompare) {
      const diff = computeDiff(currentCompare.a.results, currentCompare.b.results);
      return {
        fromScanId: currentCompare.a.id,
        toScanId: currentCompare.b.id,
        fromTime: currentCompare.a.timestamp,
        toTime: currentCompare.b.timestamp,
        improved: diff.improved.length,
        regressed: diff.regressed.length,
        added: diff.added.length,
        removed: diff.removed.length,
        details: diff
      };
    }
    return null;
  }

  $('#btn-export-json').addEventListener('click', async () => {
    if (!scanResults.length) return;
    const url = await getScanUrl();
    const scanTime = await getScanTime();
    const diffSummary = getScanDiffSummary();
    const suggestions = scanResults
      .filter(i => i.level !== 'AAA')
      .slice(0, 30)
      .map(item => {
        const fgRgb = hexToRgb(item.fg);
        const bgRgb = hexToRgb(item.bg);
        const suggest = computeSuggestColor(fgRgb, bgRgb);
        if (!suggest) return null;
        const suggestHex = rgbToHex(suggest.r, suggest.g, suggest.b);
        return {
          selector: item.selector,
          text: item.text,
          originalFg: item.fg,
          originalBg: item.bg,
          originalRatio: item.ratio,
          originalLevel: item.level,
          suggestedFg: suggestHex,
          suggestedRatio: Math.round(contrastRatio(suggest, bgRgb) * 100) / 100
        };
      }).filter(Boolean);
    const payload = {
      summary: scanSummary,
      url,
      scanTime,
      results: scanResults,
      ignored: ignoredItems,
      suggestions,
      diffSummary,
      exportedAt: new Date().toISOString(),
      exportedBy: 'Color A11y Checker v1.0'
    };
    const data = JSON.stringify(payload, null, 2);
    downloadFile(data, 'a11y-report.json', 'application/json');
  });

  $('#btn-export-csv').addEventListener('click', async () => {
    if (!scanResults.length) return;
    const url = await getScanUrl();
    const scanTime = await getScanTime();
    const diff = getScanDiffSummary();
    const diffMeta = diff ? `${diff.improved}改善/${diff.regressed}退化/${diff.added}新增/${diff.removed}移除` : '';
    const header = '类别,文本,选择器,前景色,背景色,对比度,等级,字号,粗体,网页地址,扫描时间,截图,变化摘要\n';
    const resultRows = scanResults.map(r =>
      `检查项,"${r.text.replace(/"/g,'""')}","${r.selector}","${r.fg}","${r.bg}",${r.ratio},${r.level},${r.fontSize},${r.bold},"${url}","${scanTime}","${r.thumbnail || ''}","${diffMeta}"`
    ).join('\n');
    const ignoredRows = ignoredItems.map(r => `被忽略项,"${r.text.replace(/"/g,'""')}","${r.selector}","${r.fg}","${r.bg}",${r.ratio},${r.level},${r.fontSize},${r.bold},"${url}","${scanTime}","${r.thumbnail || ''}","${(r.ignoredBecause?.note || '').replace(/"/g,'""')}"`).join('\n');
    const allRows = resultRows + (ignoredRows ? '\n' + ignoredRows : '');
    downloadFile('\uFEFF' + header + allRows, 'a11y-report.csv', 'text/csv;charset=utf-8');
  });

  $('#btn-export-html').addEventListener('click', async () => {
    if (!scanResults.length) { alert('请先扫描页面再导出 HTML 报告'); return; }
    const url = await getScanUrl();
    const scanTime = await getScanTime();
    const diffSummary = getScanDiffSummary();
    const html = buildHtmlReport(scanResults, scanSummary, ignoredItems, url, scanTime, diffSummary, currentCompare);
    downloadFile(html, 'a11y-report.html', 'text/html;charset=utf-8');
  });

  function generateReviewViewScript() {
    return `
(function(){
  function md5Hash(s){var h=0;for(var i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return 'h'+('0000000'+(h>>>0).toString(36)).slice(-7);}
  var DATA_KEY = null;
  function initKey(){
    var url = document.getElementById('report-url')?.textContent || location.href;
    var ts = document.getElementById('report-time')?.textContent || '';
    DATA_KEY = 'a11y_review_' + md5Hash(url + '|' + ts);
    return DATA_KEY;
  }
  function load(){try{return JSON.parse(localStorage.getItem(initKey())||'{}');}catch(e){return {};}}
  function save(d){try{localStorage.setItem(initKey(), JSON.stringify(d));}catch(e){}}
  function makeId(item, idx){return (item.selector || md5Hash(item.text + item.fg + item.bg)) + '_' + idx;}
  function regionName(r){var map={'header':'页头','nav':'导航','menu':'菜单','sidebar':'侧栏','aside':'侧栏','main':'主内容','hero':'首屏','banner':'横幅','content':'正文','toolbar':'工具栏','breadcrumb':'面包屑','footer':'页脚'};return map[r]||r||'正文';}
  window.renderReviewView = function(allItems, regions){
    initKey();
    var state = load();
    var filters = state.filters || {region:'all', level:'all', status:'all'};
    var comments = state.comments || {};
    var statuses = state.statuses || {};

    var container = document.getElementById('review-root');
    if(!container) return;

    function unique(arr){var seen={};return arr.filter(function(x){if(x in seen)return false;seen[x]=1;return true;});}
    var allRegions = unique(regions.filter(Boolean));
    allRegions.sort();
    var levelOpts = [['all','全部'],['Fail','仅不达标'],['AA','仅 AA 达标'],['AAA','仅 AAA 达标']];
    var statusOpts = [['all','全部'],['pending','待评审'],['approved','已通过'],['rejected','需修改'],['discussed','已讨论']];

    function buildFilter(){
      return '<div class="review-filters">' +
        '<label><span>区域</span><select id="f-region">' +
          ['<option value="all">全部区域</option>'].concat(allRegions.map(function(r){return '<option value="'+r+'">'+regionName(r)+'</option>';})).join('') +
        '</select></label>' +
        '<label><span>等级</span><select id="f-level">' +
          levelOpts.map(function(o){return '<option value="'+o[0]+'">'+o[1]+'</option>';}).join('') +
        '</select></label>' +
        '<label><span>评审状态</span><select id="f-status">' +
          statusOpts.map(function(o){return '<option value="'+o[0]+'">'+o[1]+'</option>';}).join('') +
        '</select></label>' +
        '<span class="review-count" id="review-count"></span>' +
      '</div>';
    }

    function statusChip(s){
      if(!s||s==='pending') return '<span class="st pending">待评审</span>';
      var map={'approved':['st approved','已通过'],'rejected':['st rejected','需修改'],'discussed':['st discussed','已讨论']};
      var m = map[s]||['st pending','待评审'];
      return '<span class="'+m[0]+'">'+m[1]+'</span>';
    }

    function buildCard(item, idx){
      var id = makeId(item, idx);
      var c = comments[id] || '';
      var s = statuses[id] || 'pending';
      var ign = !!item._ignored;
      if(filters.region!=='all' && item.region!==filters.region) return '';
      if(filters.level!=='all' && item.level!==filters.level) return '';
      if(filters.status!=='all' && s!==filters.status) return '';
      var rule = item._ignoredRule || {};
      return '<div class="rv-card" data-id="'+id+'" data-idx="'+idx+'"'+(ign?' data-ignored="1"':'')+'>' +
        (item.thumbnail ? '<img class="rv-thumb" src="'+item.thumbnail+'" />' : '<div class="rv-thumb-placeholder">无截图</div>') +
        '<div class="rv-body">' +
          '<div class="rv-top">' +
            '<div class="swatches" style="margin:0;">' +
              '<span class="sw" style="background:'+item.fg+'"></span><code>'+item.fg+'</code>' +
              '<span class="on">on</span>' +
              '<span class="sw" style="background:'+item.bg+'"></span><code>'+item.bg+'</code>' +
              '<span class="badge '+(item.level==='Fail'?'fail':item.level==='AA'?'aa':'pass')+'">'+item.ratio+':1 '+item.level+'</span>' +
              (item.region ? '<span class="rv-region">'+regionName(item.region)+'</span>' : '') +
            '</div>' +
            statusChip(s) +
          '</div>' +
          '<div class="rv-text">'+(item.text||'(无文本)')+'</div>' +
          '<div class="rv-meta"><code>'+(item.selector||'')+'</code> · '+item.fontSize+'px'+(item.bold?' · 粗体':'')+'</div>' +
          (item.suggestFg ? '<div class="rv-suggest">💡 建议前景色 <span class="sw" style="background:'+item.suggestFg+';display:inline-block;vertical-align:middle;"></span> <code>'+item.suggestFg+'</code> → <b style="color:#22c55e;">'+item.suggestRatio+':1</b></div>' : '') +
          (ign ? '<div class="rv-ignored">📌 已忽略 · 规则: '+(rule.type==='color'?rule.fg+'/'+rule.bg:rule.value)+(rule.scope?' ['+rule.scope+']':'')+(rule.note?' · '+rule.note:'')+'</div>' : '') +
          '<div class="rv-actions">' +
            '<select class="st-select" data-id="'+id+'">' +
              statusOpts.map(function(o){return '<option value="'+o[0]+'"'+(s===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('') +
            '</select>' +
            '<textarea class="rv-comment" placeholder="写评审意见（如：需调整对比度、保留品牌色、改为AA即可）…" rows="2" data-id="'+id+'">'+(c||'').replace(/</g,'&lt;')+'</textarea>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function render(){
      var html = buildFilter();
      var shown = 0;
      var cardsHtml = '';
      allItems.forEach(function(it, idx){
        var c = buildCard(it, idx);
        if(c){shown++;cardsHtml += c;}
      });
      html += '<div style="margin:10px 0 6px;font-size:12px;color:#64748b;">共显示 <b>'+shown+'</b> / '+allItems.length+' 条</div>';
      if(shown === 0) html += '<div style="padding:40px;background:#fff;border:1px dashed #cbd5e1;border-radius:8px;text-align:center;color:#94a3b8;">没有符合当前筛选条件的条目</div>';
      else html += '<div class="rv-grid">'+cardsHtml+'</div>';
      container.innerHTML = html;

      document.getElementById('f-region').value = filters.region;
      document.getElementById('f-level').value = filters.level;
      document.getElementById('f-status').value = filters.status;

      var persistTimer = null;
      function persist(){if(persistTimer)clearTimeout(persistTimer);persistTimer=setTimeout(function(){save({filters,comments,statuses});}, 150);}

      ['f-region','f-level','f-status'].forEach(function(fid){
        document.getElementById(fid).addEventListener('change', function(e){
          var key = fid==='f-region'?'region':fid==='f-level'?'level':'status';
          filters[key] = e.target.value;
          persist();
          render();
        });
      });

      document.querySelectorAll('.rv-card .st-select').forEach(function(sel){
        sel.addEventListener('change', function(e){
          statuses[sel.dataset.id] = e.target.value;
          persist();
          render();
        });
      });

      document.querySelectorAll('.rv-card .rv-comment').forEach(function(ta){
        ta.addEventListener('input', function(e){
          comments[ta.dataset.id] = ta.value;
          persist();
        });
      });
    }

    render();
  };
})();
`;
  }

  function buildHtmlReport(results, summary, ignored, url, scanTime, diff, compare) {
    const failItems = results.filter(i => i.level === 'Fail');
    const aaItems = results.filter(i => i.level === 'AA');
    const aaaItems = results.filter(i => i.level === 'AAA');
    const passRate = results.length ? Math.round((aaItems.length + aaaItems.length) / results.length * 100) : 0;

    const suggestions = results
      .filter(i => i.level !== 'AAA')
      .slice(0, 25)
      .map(item => {
        const fgRgb = hexToRgb(item.fg);
        const bgRgb = hexToRgb(item.bg);
        const suggest = computeSuggestColor(fgRgb, bgRgb);
        if (!suggest) return null;
        const suggestHex = rgbToHex(suggest.r, suggest.g, suggest.b);
        const newRatio = Math.round(contrastRatio(suggest, bgRgb) * 100) / 100;
        return { ...item, suggestFg: suggestHex, suggestRatio: newRatio };
      }).filter(Boolean);

    const failHtml = failItems.slice(0, 50).map(item => `
      <div class="report-item fail">
        ${item.thumbnail ? `<img src="${item.thumbnail}" class="thumb" />` : ''}
        <div class="info">
          <div class="swatches">
            <span class="sw" style="background:${item.fg}"></span>
            <span class="sw" style="background:${item.bg}"></span>
            <span class="ratio">${item.ratio}:1</span>
            <span class="badge fail">${item.level}</span>
          </div>
          <div class="text">${escapeHtml(item.text)}</div>
          <div class="meta">${escapeHtml(item.selector)} · ${item.fontSize}px${item.bold ? ' · 粗体' : ''}</div>
        </div>
      </div>
    `).join('');

    const suggestionsHtml = suggestions.map(s => `
      <div class="suggest-card">
        <div class="suggest-row">
          <span class="sw" style="background:${s.fg}"></span>
          <span style="font-family:monospace;font-size:12px;">${s.fg}</span>
          <span class="on">on</span>
          <span class="sw" style="background:${s.bg}"></span>
          <span style="font-family:monospace;font-size:12px;">${s.bg}</span>
          <span class="badge ${s.level === 'Fail' ? 'fail' : 'aa'}">${s.ratio}:1</span>
          <span class="arrow">→</span>
          <span class="sw" style="background:${s.suggestFg}"></span>
          <span style="font-family:monospace;font-size:12px;color:#22c55e;">${s.suggestFg}</span>
          <span class="badge pass">${s.suggestRatio}:1</span>
        </div>
        <div class="text" style="margin-top:6px;">${escapeHtml(s.text)}</div>
      </div>
    `).join('');

    const ignoredHtml = ignored && ignored.length ? `
      <section>
        <h2>被忽略项 (${ignored.length})</h2>
        ${ignored.slice(0, 30).map(item => {
          const rule = item.ignoredBecause || {};
          return `
            <div class="ignored-card">
              <div class="swatches">
                <span class="sw" style="background:${item.fg}"></span>
                <span class="sw" style="background:${item.bg}"></span>
                <span class="ratio">${item.ratio}:1</span>
                <span class="badge fail">${item.level}</span>
              </div>
              <div class="text">${escapeHtml(item.text)}</div>
              <div class="ignored-reason">忽略原因：${rule.type === 'color' ? rule.fg + '/' + rule.bg : rule.value}${rule.note ? ' — ' + escapeHtml(rule.note) : ''}${rule.scope ? ' [' + escapeHtml(rule.scope) + ']' : ''}</div>
            </div>
          `;
        }).join('')}
      </section>
    ` : '';

    let compareHtml = '';
    if (diff && compare) {
      const d = diff.details;
      const fmt = t => new Date(t).toLocaleString('zh-CN');
      const sectionDiff = (title, arr, cls, badge) => arr.length === 0 ? '' : `
        <h3>${title} (${arr.length})</h3>
        ${arr.slice(0, 40).map(x => `
          <div class="diff-row ${cls}">
            <span class="diff-badge">${badge}</span>
            <div>
              ${x.oldRatio ? `<span class="diff-old">${x.oldRatio}:1 (${x.oldLevel})</span>` : ''}
              <span class="diff-new">${escapeHtml((x.text || x.selector || '').slice(0, 30))}</span>
            </div>
            ${x.newRatio ? `<span class="badge ${x.newLevel === 'Fail' ? 'fail' : x.newLevel === 'AA' ? 'aa' : 'pass'}">${x.newRatio}:1 ${x.newLevel}</span>` : ''}
          </div>
        `).join('')}
      `;
      compareHtml = `
        <section>
          <h2>🔀 前后对比</h2>
          <p style="font-size:13px;color:#64748b;margin-bottom:12px;">
            <strong>${fmt(compare.a.timestamp)}</strong> → <strong>${fmt(compare.b.timestamp)}</strong>
          </p>
          <div class="diff-stats">
            <div class="stat green">${d.improved.length}<span>改善</span></div>
            <div class="stat orange">${d.regressed.length}<span>退化</span></div>
            <div class="stat blue">${d.added.length}<span>新增</span></div>
            <div class="stat gray">${d.removed.length}<span>移除</span></div>
          </div>
          ${sectionDiff('改善项', d.improved, 'imp', '↑')}
          ${sectionDiff('退化项', d.regressed, 'reg', '↓')}
          ${sectionDiff('新增项', d.added, 'add', '＋')}
          ${sectionDiff('移除项', d.removed, 'rmv', '−')}
        </section>
      `;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>颜色无障碍检查报告</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,'PingFang SC',sans-serif;background:#f8fafc;color:#0f172a;line-height:1.5;padding:32px;max-width:960px;margin:0 auto}
h1{font-size:24px;margin-bottom:4px}
h1 .sub{font-size:14px;color:#64748b;font-weight:400;margin-left:12px}
h2{font-size:18px;margin:28px 0 12px;padding-bottom:8px;border-bottom:1px solid #e2e8f0}
h3{font-size:14px;margin:16px 0 8px;color:#334155}
.url{font-size:12px;color:#64748b;margin-bottom:20px;word-break:break-all}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}
.stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.stat-card .n{font-size:28px;font-weight:700;line-height:1.2}
.stat-card .l{font-size:11px;color:#64748b;margin-top:4px}
.stat-card.fail .n{color:#ef4444}
.stat-card.aa .n{color:#f59e0b}
.stat-card.aaa .n{color:#22c55e}
.stat-card.ignored .n{color:#64748b}
.bar{height:24px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;display:flex;margin:6px 0 10px}
.bar div{height:100%}
.legend{display:flex;gap:16px;font-size:12px;color:#64748b;margin-bottom:16px}
.legend span::before{content:'●';margin-right:4px}
.legend .f::before{color:#ef4444}.legend .a::before{color:#f59e0b}.legend .t::before{color:#22c55e}
.report-item{display:flex;gap:12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:6px;border-left:3px solid #ef4444;align-items:flex-start}
.report-item.fail{border-left-color:#ef4444}
.report-item .thumb{width:160px;height:auto;border-radius:4px;border:1px solid #e2e8f0;flex-shrink:0}
.report-item .info{flex:1;min-width:0}
.swatches{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
.sw{width:18px;height:18px;border-radius:3px;border:1px solid #e2e8f0;display:inline-block}
.ratio{font-weight:700;font-size:13px;margin-left:4px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.badge.fail{background:#fef2f2;color:#ef4444}
.badge.aa{background:#fffbeb;color:#f59e0b}
.badge.pass{background:#f0fdf4;color:#22c55e}
.text{font-size:12px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:2px 0}
.meta{font-size:11px;color:#94a3b8}
.suggest-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:6px}
.suggest-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.arrow{color:#94a3b8;margin:0 4px}
.on{font-size:11px;color:#94a3b8;margin:0 2px}
.ignored-card{background:#fff;border:1px dashed #cbd5e1;border-radius:8px;padding:10px;margin-bottom:6px;border-left:3px solid #64748b}
.ignored-reason{font-size:11px;color:#64748b;margin-top:4px;font-style:italic}
.diff-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
.diff-stats .stat{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center;font-size:22px;font-weight:700}
.diff-stats .stat span{display:block;font-size:11px;font-weight:500;color:#64748b;margin-top:2px}
.diff-stats .green{color:#22c55e}.diff-stats .orange{color:#f97316}.diff-stats .blue{color:#3b82f6}.diff-stats .gray{color:#64748b}
.diff-row{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin-bottom:4px;font-size:12px}
.diff-row.imp{border-left:3px solid #22c55e}
.diff-row.reg{border-left:3px solid #f97316}
.diff-row.add{border-left:3px solid #3b82f6}
.diff-row.rmv{border-left:3px solid #ef4444}
.diff-badge{text-align:center;font-size:14px}
.diff-old{color:#94a3b8;font-size:10px;text-decoration:line-through;display:block}
.diff-new{font-weight:600}
.review-filters{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px;}
.review-filters label{display:flex;flex-direction:column;font-size:11px;color:#64748b;gap:4px;}
.review-filters select{padding:6px 8px;font-size:13px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;color:#0f172a;min-width:120px;}
.review-count{margin-left:auto;font-size:12px;color:#64748b;}
.rv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px;}
.rv-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;display:flex;gap:10px;flex-direction:column;}
.rv-card[data-ignored="1"]{opacity:.85;background:#fcfcfc;}
.rv-thumb{width:100%;max-height:120px;object-fit:contain;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;}
.rv-thumb-placeholder{width:100%;height:90px;background:repeating-linear-gradient(45deg,#f1f5f9 25%,#e2e8f0 0 50%,#f1f5f9 0 75%,#e2e8f0 0);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;}
.rv-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
.rv-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.rv-region{display:inline-block;background:rgba(59,130,246,.1);color:#1d4ed8;font-size:10px;padding:1px 6px;border-radius:3px;margin-left:2px;}
.rv-text{font-size:13px;color:#334155;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rv-meta{font-size:11px;color:#94a3b8;margin:0;}
.rv-meta code{background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:10px;}
.rv-suggest{font-size:11px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:4px 6px;margin-top:4px;color:#15803d;}
.rv-suggest code{background:#ffffff80;padding:0 3px;border-radius:2px;font-size:10px;}
.rv-ignored{font-size:11px;background:rgba(100,116,139,.06);border-left:3px solid #64748b;padding:4px 6px;margin-top:4px;border-radius:3px;color:#475569;}
.rv-actions{display:flex;flex-direction:column;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0;}
.st-select{padding:4px 6px;font-size:11px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;}
.rv-comment{width:100%;padding:6px;font-size:12px;border:1px solid #cbd5e1;border-radius:4px;resize:vertical;}
.st{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;}
.st.pending{background:#f1f5f9;color:#475569;}
.st.approved{background:#f0fdf4;color:#16a34a;}
.st.rejected{background:#fef2f2;color:#dc2626;}
.st.discussed{background:#eff6ff;color:#2563eb;}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#475569;}
.footer{margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center}
</style>
</head>
<body>
<h1>🌈 颜色无障碍检查报告<span class="sub">Color A11y Checker</span></h1>
<div class="url">📄 页面：<a id="report-url" href="${escapeHtml(url)}">${escapeHtml(url)}</a><br>⏱️ 扫描时间：<span id="report-time">${new Date(scanTime).toISOString()}</span> · ${new Date(scanTime).toLocaleString('zh-CN')}</div>

<section>
<h2>📊 总览</h2>
<div class="stats">
  <div class="stat-card"><div class="n">${results.length}</div><div class="l">文本元素</div></div>
  <div class="stat-card fail"><div class="n">${failItems.length}</div><div class="l">不达标</div></div>
  <div class="stat-card aa"><div class="n">${aaItems.length}</div><div class="l">AA</div></div>
  <div class="stat-card aaa"><div class="n">${aaaItems.length}</div><div class="l">AAA</div></div>
  ${ignored && ignored.length ? `<div class="stat-card ignored"><div class="n">${ignored.length}</div><div class="l">已忽略</div></div>` : ''}
</div>
<p style="font-size:13px;"><strong>达标率：${passRate}%</strong></p>
<div class="bar">
  ${failItems.length ? `<div style="width:${failItems.length/results.length*100}%;background:#ef4444"></div>` : ''}
  ${aaItems.length ? `<div style="width:${aaItems.length/results.length*100}%;background:#f59e0b"></div>` : ''}
  ${aaaItems.length ? `<div style="width:${aaaItems.length/results.length*100}%;background:#22c55e"></div>` : ''}
</div>
<div class="legend"><span class="f">不达标 ${failItems.length}</span><span class="a">AA ${aaItems.length}</span><span class="t">AAA ${aaaItems.length}</span></div>
</section>

${compareHtml}

<section>
<h2>⚠️ 低可读文本 (${failItems.length})</h2>
${failItems.length === 0 ? '<p style="color:#22c55e;padding:16px;text-align:center;background:#f0fdf4;border-radius:8px;">✅ 所有文本均达标！</p>' : failHtml}
</section>

<section>
<h2>💡 修复建议 (${suggestions.length})</h2>
${suggestionsHtml}
</section>

${ignoredHtml}

<section>
<h2>🗂️ 评审视图 <small style="font-size:11px;color:#64748b;font-weight:400;">（按区域/等级筛选 · 写评审意见 · 自动保存）</small></h2>
<div id="review-root"></div>
</section>

<script>
(function(){
  ${generateReviewViewScript()}
  var ALL_ITEMS = (function(){
    var norm = function(list, isIgnored, ignoredRuleFrom){
      return (list||[]).map(function(it, i){
        var obj = JSON.parse(JSON.stringify(it));
        if(isIgnored){ obj._ignored = true; obj._ignoredRule = ignoredRuleFrom ? (ignoredRuleFrom[it.selector] || it.ignoredBecause || {}) : (it.ignoredBecause || {}); }
        return obj;
      });
    };
    var all = norm(${JSON.stringify(results)}, false)
      .concat(norm(${JSON.stringify(ignored||[])}, true));
    all.sort(function(a,b){return (a.ratio||0)-(b.ratio||0);});
    return all;
  })();
  var REGIONS = ALL_ITEMS.map(function(it){return it.region||'content';});
  if(window.renderReviewView){ setTimeout(function(){ window.renderReviewView(ALL_ITEMS, REGIONS); }, 0); }
})();
</script>

<div class="footer">本报告由 Color A11y Checker 生成 · 导出于 ${new Date().toLocaleString('zh-CN')} · 设计师无需安装插件即可查看 · 评审意见自动保存于浏览器 localStorage</div>
</body>
</html>`;
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function checkRestorable() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['lastResults', 'lastSummary', 'lastUrl', 'lastScanTime', 'lastIgnored'], (data) => {
        if (data.lastResults && data.lastResults.length > 0) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabUrl = tabs[0]?.url;
            if (tabUrl && data.lastUrl === tabUrl) {
              $('#restore-bar').style.display = 'flex';
              $('#btn-restore').addEventListener('click', () => {
                scanResults = data.lastResults;
                scanSummary = data.lastSummary;
                ignoredItems = data.lastIgnored || [];
                $('#scan-stats').style.display = 'block';
                $('#stat-total').textContent = scanSummary.total || 0;
                $('#stat-fail').textContent = scanSummary.fail || 0;
                $('#stat-aa').textContent = scanSummary.aa || 0;
                $('#stat-aaa').textContent = scanSummary.aaa || 0;
                $('#scan-empty').style.display = 'none';
                renderScanList();
                $('#restore-bar').style.display = 'none';
              });
              resolve(true);
            } else {
              resolve(false);
            }
          });
        } else {
          resolve(false);
        }
      });
    });
  }

  loadBrandColors();
  loadIgnoreRules();
  loadPickerResult();
  checkRestorable();
})();
