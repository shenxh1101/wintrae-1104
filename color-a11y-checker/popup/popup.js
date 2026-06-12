(() => {
  let currentTab = 'scan';
  let scanResults = [];
  let scanSummary = null;
  let activeSim = null;
  let pickerActive = false;
  let brandColors = [];
  let ignoreRules = [];

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
    if (!scanResults.length) {
      $('#report-content').innerHTML = '<div class="empty-state"><p>请先执行页面扫描</p></div>';
      return;
    }
    const failItems = scanResults.filter(i => i.level === 'Fail');
    const aaItems = scanResults.filter(i => i.level === 'AA');
    const aaaItems = scanResults.filter(i => i.level === 'AAA');
    const passRate = scanResults.length ? Math.round((aaItems.length + aaaItems.length) / scanResults.length * 100) : 0;

    $('#report-content').innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="num">${passRate}%</div><div class="label">达标率</div></div>
        <div class="stat-card fail"><div class="num">${failItems.length}</div><div class="label">需修复</div></div>
      </div>
      <h3 style="margin-top:12px;">低可读文本列表</h3>
      ${failItems.length === 0 ? '<p style="color:var(--green);font-size:12px;padding:8px;">✅ 所有文本均达标！</p>' :
        failItems.slice(0, 30).map(item => `
          <div class="result-item" data-selector="${escapeAttr(item.selector)}" style="margin-bottom:4px;padding:8px;">
            <div class="result-top">
              <div class="color-swatch" style="background:${item.fg}"></div>
              <div class="color-swatch" style="background:${item.bg}"></div>
              <span class="result-ratio" style="font-size:12px;">${item.ratio}:1</span>
              <span class="result-level fail">${item.level}</span>
            </div>
            <div class="result-text">${escapeHtml(item.text)}</div>
          </div>
        `).join('')
      }
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
        </div>
      </div>
    `;

    $('#report-content').querySelectorAll('.result-item').forEach(el => {
      el.addEventListener('click', () => {
        sendToContent({ type: 'highlightSingle', selector: el.dataset.selector });
      });
    });
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
      <div class="ignore-item">
        <span>${rule.type === 'color' ? rule.fg + '/' + rule.bg : rule.value}</span>
        <button class="btn btn-sm btn-danger" data-index="${i}" style="padding:2px 8px;">删除</button>
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
    if (!val) return;
    if (type === 'color') {
      const parts = val.split('/');
      if (parts.length === 2) {
        ignoreRules.push({ type: 'color', fg: parts[0].trim(), bg: parts[1].trim() });
      }
    } else {
      ignoreRules.push({ type: 'selector', value: val });
    }
    chrome.storage.local.set({ ignoreRules });
    sendToContent({ type: 'setIgnoreRules', rules: ignoreRules });
    renderIgnoreList();
    $('#ignore-value').value = '';
  });

  $('#btn-export-json').addEventListener('click', () => {
    if (!scanResults.length) return;
    const data = JSON.stringify({ summary: scanSummary, results: scanResults, url: location.href, exportedAt: new Date().toISOString() }, null, 2);
    downloadFile(data, 'a11y-report.json', 'application/json');
  });

  $('#btn-export-csv').addEventListener('click', () => {
    if (!scanResults.length) return;
    const header = '文本,选择器,前景色,背景色,对比度,等级,字号,粗体\n';
    const rows = scanResults.map(r =>
      `"${r.text.replace(/"/g,'""')}","${r.selector}","${r.fg}","${r.bg}",${r.ratio},${r.level},${r.fontSize},${r.bold}`
    ).join('\n');
    downloadFile('\uFEFF' + header + rows, 'a11y-report.csv', 'text/csv;charset=utf-8');
  });

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
      chrome.storage.local.get(['lastResults', 'lastSummary', 'lastUrl', 'lastScanTime'], (data) => {
        if (data.lastResults && data.lastResults.length > 0) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabUrl = tabs[0]?.url;
            if (tabUrl && data.lastUrl === tabUrl) {
              $('#restore-bar').style.display = 'flex';
              $('#btn-restore').addEventListener('click', () => {
                scanResults = data.lastResults;
                scanSummary = data.lastSummary;
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
  checkRestorable();
})();
