(() => {
  let scanResults = [];
  let pickerMode = false;
  let hoverEl = null;
  let badgeEl = null;
  let ignoreRules = [];

  function createBadge() {
    if (badgeEl) badgeEl.remove();
    badgeEl = document.createElement('div');
    badgeEl.className = 'a11y-badge';
    document.body.appendChild(badgeEl);
    return badgeEl;
  }

  function removeBadge() {
    if (badgeEl) { badgeEl.remove(); badgeEl = null; }
  }

  function getVisibleTextElements() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.parentElement) return NodeFilter.FILTER_REJECT;
          const tag = node.parentElement.tagName;
          if (['SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME'].includes(tag)) return NodeFilter.FILTER_REJECT;
          if (node.textContent.trim().length === 0) return NodeFilter.FILTER_REJECT;
          const rect = node.parentElement.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
          const style = getComputedStyle(node.parentElement);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const elements = [];
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!seen.has(el)) {
        seen.add(el);
        elements.push(el);
      }
    }
    return elements;
  }

  function isIgnored(fgHex, bgHex, selector) {
    return ignoreRules.some(rule => {
      if (rule.type === 'color' && rule.fg === fgHex && rule.bg === bgHex) return true;
      if (rule.type === 'selector' && selector && selector.includes(rule.value)) return true;
      return false;
    });
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) { selector = '#' + current.id; path.unshift(selector); break; }
      if (current.className && typeof current.className === 'string') {
        const cls = current.className.trim().split(/\s+/).filter(c => !c.startsWith('a11y-')).slice(0,2).join('.');
        if (cls) selector += '.' + cls;
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.slice(0, 4).join(' > ');
  }

  function generateThumbnail(item) {
    try {
      const canvas = document.createElement('canvas');
      const w = 180, h = 48;
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.fillStyle = item.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = item.fg;
      const fontSize = Math.min(item.fontSize, 18);
      ctx.font = `${item.bold ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
      const text = item.text.slice(0, 18);
      ctx.fillText(text, 6, fontSize + 4);
      ctx.strokeStyle = item.pass ? '#22c55e' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
      const labelColor = item.pass ? '#22c55e' : '#ef4444';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const labelText = `${item.ratio}:1 ${item.level}`;
      ctx.font = 'bold 10px system-ui';
      const tw = ctx.measureText(labelText).width;
      ctx.fillRect(w - tw - 12, h - 16, tw + 8, 14);
      ctx.fillStyle = labelColor;
      ctx.fillText(labelText, w - tw - 8, h - 5);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  function scanPage() {
    const elements = getVisibleTextElements();
    scanResults = [];
    elements.forEach(el => {
      try {
        const colors = ColorUtils.getElementColors(el);
        const { size, bold } = ColorUtils.getFontSize(el);
        const ratio = ColorUtils.contrastRatio(colors.fg, colors.bg);
        const level = ColorUtils.wcagLevel(ratio, size, bold);
        const fgHex = ColorUtils.rgbToHex(colors.fg.r, colors.fg.g, colors.fg.b);
        const bgHex = ColorUtils.rgbToHex(colors.bg.r, colors.bg.g, colors.bg.b);
        const selector = getSelector(el);
        if (isIgnored(fgHex, bgHex, selector)) return;
        scanResults.push({
          text: el.textContent.trim().slice(0, 80),
          selector,
          fg: fgHex,
          bg: bgHex,
          fgRgb: colors.fg,
          bgRgb: colors.bg,
          ratio: Math.round(ratio * 100) / 100,
          level: level.level,
          pass: level.pass,
          fontSize: size,
          bold,
          rect: {
            top: el.getBoundingClientRect().top + window.scrollY,
            left: el.getBoundingClientRect().left + window.scrollX,
            width: el.getBoundingClientRect().width,
            height: el.getBoundingClientRect().height
          }
        });
      } catch(e) {}
    });
    scanResults.forEach(item => { item.thumbnail = generateThumbnail(item); });
    scanResults.sort((a, b) => a.ratio - b.ratio);
    return scanResults;
  }

  function scanElement(el) {
    if (!el) return null;
    const colors = ColorUtils.getElementColors(el);
    const { size, bold } = ColorUtils.getFontSize(el);
    const ratio = ColorUtils.contrastRatio(colors.fg, colors.bg);
    const level = ColorUtils.wcagLevel(ratio, size, bold);
    const fgHex = ColorUtils.rgbToHex(colors.fg.r, colors.fg.g, colors.fg.b);
    const bgHex = ColorUtils.rgbToHex(colors.bg.r, colors.bg.g, colors.bg.b);
    const result = {
      text: el.textContent.trim().slice(0, 80),
      selector: getSelector(el),
      fg: fgHex,
      bg: bgHex,
      fgRgb: colors.fg,
      bgRgb: colors.bg,
      ratio: Math.round(ratio * 100) / 100,
      level: level.level,
      pass: level.pass,
      fontSize: size,
      bold,
      rect: {
        top: el.getBoundingClientRect().top + window.scrollY,
        left: el.getBoundingClientRect().left + window.scrollX,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height
      }
    };
    result.thumbnail = generateThumbnail(result);
    return result;
  }

  function highlightElements(items) {
    clearHighlights();
    items.forEach(item => {
      try {
        const els = document.querySelectorAll(item.selector);
        els.forEach(el => {
          el.classList.add('a11y-highlight-overlay');
          if (item.pass) {
            el.classList.add(item.level === 'AAA' ? 'a11y-highlight-pass' : 'a11y-highlight-aa');
          }
        });
      } catch(e) {}
    });
  }

  function highlightSingle(selector) {
    clearHighlights();
    try {
      const els = document.querySelectorAll(selector);
      els.forEach(el => el.classList.add('a11y-highlight-overlay'));
      if (els.length > 0) {
        els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch(e) {}
  }

  function clearHighlights() {
    document.querySelectorAll('.a11y-highlight-overlay').forEach(el => {
      el.classList.remove('a11y-highlight-overlay', 'a11y-highlight-pass', 'a11y-highlight-aa');
    });
  }

  function startPicker() {
    pickerMode = true;
    document.body.classList.add('a11y-picker-cursor');
    document.addEventListener('mouseover', onPickerHover, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerEsc, true);
  }

  function stopPicker() {
    pickerMode = false;
    document.body.classList.remove('a11y-picker-cursor');
    document.removeEventListener('mouseover', onPickerHover, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerEsc, true);
    if (hoverEl) { hoverEl.classList.remove('a11y-hover-outline'); hoverEl = null; }
    removeBadge();
  }

  function onPickerHover(e) {
    if (hoverEl) hoverEl.classList.remove('a11y-hover-outline');
    const el = e.target;
    if (el.closest('.a11y-badge') || el.id?.startsWith('a11y-')) return;
    hoverEl = el;
    el.classList.add('a11y-hover-outline');
    const result = scanElement(el);
    if (result) {
      const badge = createBadge();
      badge.textContent = `${result.fg} / ${result.bg} — ${result.ratio}:1 (${result.level})`;
      const rect = el.getBoundingClientRect();
      badge.style.top = (rect.top - 28) + 'px';
      badge.style.left = rect.left + 'px';
    }
  }

  function onPickerClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (el.closest('.a11y-badge') || el.id?.startsWith('a11y-')) return;
    const result = scanElement(el);
    stopPicker();
    if (result) {
      chrome.storage.local.set({ lastPickerResult: result });
      chrome.runtime.sendMessage({ type: 'pickerResult', data: result });
    }
  }

  function onPickerEsc(e) {
    if (e.key === 'Escape') {
      stopPicker();
      chrome.runtime.sendMessage({ type: 'pickerCancelled' });
    }
  }

  function captureScreenshot(selector) {
    return new Promise((resolve) => {
      try {
        const el = document.querySelector(selector);
        if (!el) { resolve(null); return; }
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        setTimeout(() => {
          const rect = el.getBoundingClientRect();
          const canvas = document.createElement('canvas');
          const scale = 2;
          canvas.width = rect.width * scale;
          canvas.height = rect.height * scale;
          const ctx = canvas.getContext('2d');
          ctx.scale(scale, scale);
          const result = scanResults.find(r => r.selector === selector);
          if (result) {
            ctx.fillStyle = result.bg;
            ctx.fillRect(0, 0, rect.width, rect.height);
            ctx.fillStyle = result.fg;
            ctx.font = `${result.bold ? 'bold ' : ''}${result.fontSize}px system-ui`;
            ctx.fillText(result.text.slice(0, 50), 8, result.fontSize + 8);
            ctx.strokeStyle = result.pass ? '#22c55e' : '#ff4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, rect.width - 2, rect.height - 2);
            ctx.fillStyle = result.pass ? '#22c55e' : '#ff4444';
            ctx.font = 'bold 14px system-ui';
            ctx.fillText(`${result.ratio}:1 ${result.level}`, 8, rect.height - 8);
          }
          resolve(canvas.toDataURL('image/png'));
        }, 300);
      } catch(e) { resolve(null); }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch(msg.type) {
      case 'scanPage': {
        const results = scanPage();
        const summary = {
          total: results.length,
          fail: results.filter(r => r.level === 'Fail').length,
          aa: results.filter(r => r.level === 'AA').length,
          aaa: results.filter(r => r.level === 'AAA').length
        };
        chrome.storage.local.set({ lastResults: results, lastSummary: summary, lastUrl: location.href, lastScanTime: Date.now() });
        sendResponse({ results, summary });
        break;
      }
      case 'scanElement': {
        const result = scanElement(document.querySelector(msg.selector));
        sendResponse({ result });
        break;
      }
      case 'startPicker': {
        startPicker();
        sendResponse({ ok: true });
        break;
      }
      case 'stopPicker': {
        stopPicker();
        sendResponse({ ok: true });
        break;
      }
      case 'highlightElements': {
        highlightElements(msg.items || []);
        sendResponse({ ok: true });
        break;
      }
      case 'highlightSingle': {
        highlightSingle(msg.selector);
        sendResponse({ ok: true });
        break;
      }
      case 'clearHighlights': {
        clearHighlights();
        sendResponse({ ok: true });
        break;
      }
      case 'simulateColorBlind': {
        const type = msg.simType;
        if (type === 'none') {
          ColorBlindSim.removeSimulation();
        } else {
          ColorBlindSim.simulatePage(type);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'captureScreenshot': {
        captureScreenshot(msg.selector).then(data => sendResponse({ data }));
        return true;
      }
      case 'setIgnoreRules': {
        ignoreRules = msg.rules || [];
        sendResponse({ ok: true });
        break;
      }
      case 'getIgnoreRules': {
        sendResponse({ rules: ignoreRules });
        break;
      }
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  });

  chrome.storage.local.get(['ignoreRules'], (data) => {
    if (data.ignoreRules) ignoreRules = data.ignoreRules;
  });
})();
