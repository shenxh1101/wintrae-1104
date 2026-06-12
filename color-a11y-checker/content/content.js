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

  function normalizeFgBg(fg, bg) {
    const n = ColorUtils.normalizeHex;
    return [n(fg), n(bg)];
  }

  function isIgnored(fgHex, bgHex, selector, url) {
    return !!findIgnoreRule(fgHex, bgHex, selector, url || location.href);
  }

  function ruleScopeMatches(rule, url) {
    if (!rule || !rule.scope) return true;
    const s = String(rule.scope).trim();
    if (!s || s === '全站' || s === '全局' || /^(all|site|global|全站)$/i.test(s)) return true;
    if (s === '本页' || /^(this|page|本页)$/i.test(s)) return true;
    try {
      const u = new URL(url || location.href);
      if (s.startsWith('http://') || s.startsWith('https://')) {
        try {
          const target = new URL(s);
          return u.origin === target.origin && (
            u.pathname === target.pathname ||
            u.pathname.startsWith(target.pathname.replace(/\/$/, '') + '/')
          );
        } catch(e) {
          return false;
        }
      }
      if (s.includes('*') || s.includes('/')) {
        const pattern = s
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\//g, '\\/');
        const re = new RegExp('^' + pattern + '$', 'i');
        return re.test(url || location.href);
      }
      if (u.hostname.includes(s) || (u.pathname + u.search).includes(s)) return true;
    } catch(e) {}
    return true;
  }

  function findIgnoreRule(fgHex, bgHex, selector, url) {
    const [nFg, nBg] = normalizeFgBg(fgHex, bgHex);
    for (let i = 0; i < ignoreRules.length; i++) {
      const rule = ignoreRules[i];
      if (!ruleScopeMatches(rule, url || location.href)) continue;
      if (rule.type === 'color') {
        const [rFg, rBg] = normalizeFgBg(rule.fg, rule.bg);
        if (rFg === nFg && rBg === nBg) return rule;
      }
      if (rule.type === 'selector' && selector && (
        selector === rule.value ||
        selector.includes(rule.value) ||
        rule.value.includes('*') && (new RegExp('^' + String(rule.value).replace(/\./g,'\\.').replace(/\*/g,'.*') + '$')).test(selector)
      )) return rule;
    }
    return null;
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

  function renderElementToCanvas(el) {
    try {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      let w = Math.max(60, Math.min(rect.width, 420));
      let h = Math.max(32, Math.min(rect.height, 180));
      const scale = w / rect.width;
      const canvas = document.createElement('canvas');
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);

      const colors = ColorUtils.getElementColors(el);
      const { size, bold } = ColorUtils.getFontSize(el);
      const ratio = ColorUtils.contrastRatio(colors.fg, colors.bg);
      const level = ColorUtils.wcagLevel(ratio, size, bold);
      const fgHex = ColorUtils.rgbToHex(colors.fg.r, colors.fg.g, colors.fg.b);
      const bgHex = ColorUtils.rgbToHex(colors.bg.r, colors.bg.g, colors.bg.b);
      const pass = level.pass;

      ctx.fillStyle = bgHex;
      ctx.fillRect(0, 0, w, h);

      const borderRadius = Math.min(parseFloat(style.borderRadius || 0), h / 2) * scale;
      const tag = el.tagName.toLowerCase();
      const inner = el.innerHTML || '';
      const hasImg = /<img/i.test(inner) || tag === 'img';
      const isBtn = tag === 'button' || style.display === 'inline-block' && /pointer|button/i.test(style.cursor + ' ' + style.appearance);
      const isNav = tag === 'nav' || /nav|menu/i.test(style.className || el.className || '');
      const isTable = ['table','tr','td','th'].includes(tag);
      const isInput = ['input','textarea','select'].includes(tag);

      if (isTable) {
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 1;
        const cellW = w / Math.min(4, Math.max(2, inner.split(/\s+/).filter(Boolean).length || 3));
        for (let cx = 1; cx < 4; cx++) {
          ctx.beginPath(); ctx.moveTo(cx * cellW, 0); ctx.lineTo(cx * cellW, h); ctx.stroke();
        }
        for (let cy = 1; cy < 3; cy++) {
          const y = cy * h / 3;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
      } else if (isNav) {
        const items = (el.textContent || '').split(/[\s,，|\/\\]+/).filter(Boolean).slice(0, 5);
        const itemW = items.length ? w / items.length : w;
        for (let k = 0; k < items.length; k++) {
          const ix = k * itemW + 8;
          const iy = h * 0.35;
          ctx.fillStyle = fgHex;
          const fs = Math.max(9, Math.min(14, size * scale));
          ctx.font = `${bold ? 'bold' : 'normal'} ${fs}px system-ui, sans-serif`;
          const t = items[k].slice(0, 6);
          if (ctx.measureText(t).width > itemW - 12) ctx.fillText(t.slice(0, Math.max(1, Math.floor((itemW - 12) / fs * 1.6))) + '…', ix, iy + fs);
          else ctx.fillText(t, ix, iy + fs);
        }
      } else if (hasImg || tag === 'img') {
        const imgIconX = 8, imgIconY = 8, imgIconW = Math.min(24, w * 0.12);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(imgIconX, imgIconY, imgIconW, imgIconW);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(imgIconX + 0.5, imgIconY + 0.5, imgIconW - 1, imgIconW - 1);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.font = `${Math.min(12, imgIconW * 0.55)}px system-ui`;
        ctx.fillText('🖼', imgIconX + 2, imgIconY + imgIconW - 4);
      } else if (isInput) {
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        ctx.fillRect(4, h * 0.1, w - 8, h * 0.8);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(4.5, h * 0.1 + 0.5, w - 9, h * 0.8 - 1);
        if (tag === 'select') {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.font = '10px system-ui';
          ctx.fillText('▼', w - 14, h / 2 + 4);
        }
      } else if (isBtn) {
        if (borderRadius > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-in';
          roundRect(ctx, 0, 0, w, h, borderRadius);
          ctx.fill();
          ctx.restore();
        }
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, 'rgba(255,255,255,0.15)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.04)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      const borderWidth = Math.min(parseFloat(style.borderTopWidth || 0), 4);
      if (borderWidth > 0) {
        ctx.strokeStyle = style.borderTopColor;
        ctx.lineWidth = borderWidth;
        roundRect(ctx, borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth, Math.max(0, borderRadius - borderWidth / 2));
        ctx.stroke();
      }

      const padL = Math.min(parseFloat(style.paddingLeft || 0), w * 0.25) * scale;
      const padT = Math.min(parseFloat(style.paddingTop || 0), h * 0.25) * scale;

      ctx.fillStyle = fgHex;
      const textContent = (el.textContent || '').trim();
      const fontSize = Math.max(10, Math.min(22, size * scale));
      const weight = bold ? 'bold' : (parseInt(style.fontWeight) >= 600 ? '600' : 'normal');
      const family = style.fontFamily.split(',')[0].replace(/"/g, '');
      ctx.font = `${weight} ${fontSize}px ${family}, system-ui, sans-serif`;
      ctx.textBaseline = 'top';

      let displayText;
      if (tag === 'button') {
        displayText = textContent.slice(0, 18);
      } else if (tag === 'a') {
        displayText = textContent.slice(0, 22);
      } else if (tag === 'input' || tag === 'textarea') {
        displayText = (el.value || textContent || '').slice(0, 18);
      } else if (tag === 'img') {
        displayText = (el.alt || '[image]').slice(0, 22);
      } else if (isTable) {
        displayText = textContent.replace(/\s+/g, ' ').slice(0, 20);
      } else if (isNav) {
        displayText = textContent.replace(/\s+/g, ' · ').slice(0, 24);
      } else {
        displayText = textContent.slice(0, 28);
      }
      if (!displayText) displayText = '[...]';

      const x = padL + 6 + (hasImg ? Math.min(32, w * 0.12) : 0);
      const y = Math.min(h / 2 - fontSize / 2, padT + 6);
      const maxWidth = w - x - 8;
      let textToDraw = displayText;
      if (ctx.measureText(textToDraw).width > maxWidth) {
        while (textToDraw.length > 1 && ctx.measureText(textToDraw + '…').width > maxWidth) {
          textToDraw = textToDraw.slice(0, -1);
        }
        textToDraw += '…';
      }
      ctx.fillText(textToDraw, x, y);

      ctx.strokeStyle = pass ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)';
      ctx.lineWidth = 2;
      roundRect(ctx, 2, 2, w - 4, h - 4, Math.max(2, borderRadius - 1));
      ctx.stroke();
      ctx.strokeStyle = pass ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.setLineDash([]);

      const label = `${Math.round(ratio*100)/100}:1 ${level.level}`;
      const labelFont = 11;
      ctx.font = `bold ${labelFont}px system-ui, sans-serif`;
      const labelPad = 5;
      const labelW = ctx.measureText(label).width + labelPad * 2;
      const labelH = labelFont + 6;
      const lx = w - labelW - 6;
      const ly = 6;
      ctx.fillStyle = pass ? 'rgba(34,197,94,0.96)' : 'rgba(239,68,68,0.96)';
      roundRect(ctx, lx, ly, labelW, labelH, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + labelPad, ly + labelH / 2);

      return {
        canvas,
        data: {
          text: textContent.slice(0, 80),
          fg: fgHex, bg: bgHex, ratio: Math.round(ratio*100)/100,
          level: level.level, pass: level.pass, fontSize: size, bold
        }
      };
    } catch (e) {
      return null;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function generateThumbnail(item, el) {
    try {
      let canvas;
      if (el) {
        const rendered = renderElementToCanvas(el);
        if (rendered) canvas = rendered.canvas;
      }
      if (!canvas) {
        canvas = document.createElement('canvas');
        const w = 200, h = 56;
        canvas.width = w * 2;
        canvas.height = h * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
        ctx.fillStyle = item.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = item.fg;
        const fontSize = Math.min(item.fontSize || 14, 18);
        ctx.font = `${item.bold ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
        const text = (item.text || '').slice(0, 22);
        ctx.fillText(text, 8, h / 2 + fontSize / 3);
        ctx.strokeStyle = item.pass ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 2;
        roundRect(ctx, 2, 2, w - 4, h - 4, 4);
        ctx.stroke();
        ctx.strokeStyle = item.pass ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(6, 6, w - 12, h - 12);
        ctx.setLineDash([]);
        const labelColor = item.pass ? '#22c55e' : '#ef4444';
        ctx.fillStyle = labelColor;
        const labelText = `${item.ratio}:1 ${item.level}`;
        ctx.font = 'bold 10px system-ui';
        const tw = ctx.measureText(labelText).width;
        roundRect(ctx, w - tw - 18, h - 22, tw + 10, 16, 3);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, w - tw - 13, h - 10);
      }
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  function attachSuggestion(item) {
    try {
      const fgRgb = ColorUtils.hexToRgb(item.fg);
      const bgRgb = ColorUtils.hexToRgb(item.bg);
      const suggest = ColorUtils.suggestColor(fgRgb, bgRgb, 4.5);
      if (suggest) {
        const sHex = ColorUtils.rgbToHex(suggest.r, suggest.g, suggest.b);
        const sRatio = ColorUtils.contrastRatio(suggest, bgRgb);
        item.suggestFg = sHex;
        item.suggestRatio = Math.round(sRatio * 100) / 100;
      }
    } catch(e) {}
  }

  function getRegion(el) {
    let cur = el;
    let depth = 0;
    while (cur && depth < 5 && cur !== document.body) {
      const tag = cur.tagName?.toLowerCase();
      if (cur.id && /header|nav|menu|sidebar|aside|footer|content|main|hero|banner/i.test(cur.id)) {
        const m = cur.id.match(/(header|nav|menu|sidebar|aside|footer|content|main|hero|banner)/i);
        if (m) return m[1].toLowerCase();
      }
      if (cur.className && typeof cur.className === 'string' && /header|nav|menu|sidebar|aside|footer|content|main|hero|banner|toolbar|breadcrumb/i.test(cur.className)) {
        const m = cur.className.match(/(header|nav|menu|sidebar|aside|footer|content|main|hero|banner|toolbar|breadcrumb)/i);
        if (m) return m[1].toLowerCase();
      }
      if (['header','nav','aside','footer','main'].includes(tag)) return tag;
      cur = cur.parentElement;
      depth++;
    }
    return 'content';
  }

  function scanPage() {
    const elements = getVisibleTextElements();
    scanResults = [];
    const ignoredItems = [];
    const elementMap = [];
    elements.forEach(el => {
      try {
        const colors = ColorUtils.getElementColors(el);
        const { size, bold } = ColorUtils.getFontSize(el);
        const ratio = ColorUtils.contrastRatio(colors.fg, colors.bg);
        const level = ColorUtils.wcagLevel(ratio, size, bold);
        const fgHex = ColorUtils.rgbToHex(colors.fg.r, colors.fg.g, colors.fg.b);
        const bgHex = ColorUtils.rgbToHex(colors.bg.r, colors.bg.g, colors.bg.b);
        const selector = getSelector(el);
        const rect = el.getBoundingClientRect();
        const region = getRegion(el);
        const item = {
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
          region,
          rect: {
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
            height: rect.height
          }
        };
        const matchedRule = findIgnoreRule(fgHex, bgHex, selector, location.href);
        if (matchedRule) {
          ignoredItems.push({ ...item, ignoredBecause: matchedRule });
        } else {
          scanResults.push(item);
          elementMap.push(el);
        }
      } catch(e) {}
    });
    scanResults.forEach((item, idx) => {
      attachSuggestion(item);
      item.thumbnail = generateThumbnail(item, elementMap[idx]);
    });
    ignoredItems.forEach(item => attachSuggestion(item));
    scanResults.sort((a, b) => a.ratio - b.ratio);
    return { results: scanResults, ignored: ignoredItems };
  }

  function scanElement(el) {
    if (!el) return null;
    const colors = ColorUtils.getElementColors(el);
    const { size, bold } = ColorUtils.getFontSize(el);
    const ratio = ColorUtils.contrastRatio(colors.fg, colors.bg);
    const level = ColorUtils.wcagLevel(ratio, size, bold);
    const fgHex = ColorUtils.rgbToHex(colors.fg.r, colors.fg.g, colors.fg.b);
    const bgHex = ColorUtils.rgbToHex(colors.bg.r, colors.bg.g, colors.bg.b);
    const rect = el.getBoundingClientRect();
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
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height
      }
    };
    result.thumbnail = generateThumbnail(result, el);
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
        const { results, ignored } = scanPage();
        const summary = {
          total: results.length,
          fail: results.filter(r => r.level === 'Fail').length,
          aa: results.filter(r => r.level === 'AA').length,
          aaa: results.filter(r => r.level === 'AAA').length,
          ignored: ignored.length
        };
        const scanData = {
          id: 'scan_' + Date.now(),
          timestamp: Date.now(),
          url: location.href,
          summary,
          results,
          ignored
        };
        chrome.storage.local.get(['scanHistory'], (storage) => {
          const history = storage.scanHistory || {};
          const urlKey = location.href;
          if (!history[urlKey]) history[urlKey] = [];
          history[urlKey].unshift(scanData);
          if (history[urlKey].length > 15) history[urlKey] = history[urlKey].slice(0, 15);
          chrome.storage.local.set({
            lastResults: results,
            lastSummary: summary,
            lastIgnored: ignored,
            lastUrl: location.href,
            lastScanTime: scanData.timestamp,
            lastScanId: scanData.id,
            scanHistory: history
          });
        });
        sendResponse({ results, summary, ignored });
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
