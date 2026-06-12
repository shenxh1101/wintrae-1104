const ColorUtils = (() => {
  function parseRgba(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }

  function parseRgb(str) {
    const c = parseRgba(str);
    if (!c) return null;
    return { r: c.r, g: c.g, b: c.b };
  }

  function normalizeHex(hex) {
    if (!hex || typeof hex !== 'string') return hex;
    let h = hex.trim().replace(/^#/, '').toLowerCase();
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length === 6) return '#' + h;
    return hex;
  }

  function hexToRgb(hex) {
    const h = normalizeHex(hex);
    const clean = h.replace('#', '');
    return {
      r: parseInt(clean.slice(0,2), 16),
      g: parseInt(clean.slice(2,4), 16),
      b: parseInt(clean.slice(4,6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, s, l = (max+min)/2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d/(2-max-min) : d/(max+min);
      switch(max) {
        case r: h = ((g-b)/d + (g<b?6:0))/6; break;
        case g: h = ((b-r)/d + 2)/6; break;
        case b: h = ((r-g)/d + 4)/6; break;
      }
    }
    return { h: h*360, s: s*100, l: l*100 };
  }

  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p, q, t) => {
        if (t<0) t+=1; if (t>1) t-=1;
        if (t<1/6) return p+(q-p)*6*t;
        if (t<1/2) return q;
        if (t<2/3) return p+(q-p)*(2/3-t)*6;
        return p;
      };
      const q = l<0.5 ? l*(1+s) : l+s-l*s;
      const p = 2*l-q;
      r = hue2rgb(p,q,h+1/3);
      g = hue2rgb(p,q,h);
      b = hue2rgb(p,q,h-1/3);
    }
    return { r: Math.round(r*255), g: Math.round(g*255), b: Math.round(b*255) };
  }

  function relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c /= 255;
      return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
    });
    return 0.2126*rs + 0.7152*gs + 0.0722*bs;
  }

  function contrastRatio(rgb1, rgb2) {
    const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
    const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function wcagLevel(ratio, fontSize, bold) {
    const largeText = fontSize >= 18 || (fontSize >= 14 && bold);
    if (ratio >= 7) return { level: 'AAA', pass: true };
    if (ratio >= 4.5) return largeText ? { level: 'AAA', pass: true } : { level: 'AA', pass: true };
    if (ratio >= 3) return largeText ? { level: 'AA', pass: true } : { level: 'Fail', pass: false };
    return { level: 'Fail', pass: false };
  }

  function getElementColors(el) {
    const style = getComputedStyle(el);
    let fgColor = parseRgb(style.color);
    if (!fgColor) fgColor = { r: 0, g: 0, b: 0 };

    const ancestors = [];
    let cur = el;
    while (cur) {
      ancestors.unshift(cur);
      if (cur === document.documentElement) break;
      cur = cur.parentElement;
    }

    let bgColor = { r: 255, g: 255, b: 255 };
    const rootBg = parseRgba(getComputedStyle(document.documentElement).backgroundColor);
    const body = document.body;
    const bodyBg = body ? parseRgba(getComputedStyle(body).backgroundColor) : null;

    if (rootBg && rootBg.a > 0) {
      if (bodyBg && bodyBg.a > 0) {
        const rootLum = relativeLuminance(rootBg.r, rootBg.g, rootBg.b);
        const bodyLum = relativeLuminance(bodyBg.r, bodyBg.g, bodyBg.b);
        if (Math.abs(rootLum - bodyLum) > 0.02 || rootBg.a < 0.99) {
          bgColor = blendColors(rootBg, bgColor, rootBg.a);
          bgColor = blendColors(bodyBg, bgColor, bodyBg.a);
        } else {
          bgColor = blendColors(bodyBg, bgColor, bodyBg.a);
        }
      } else {
        bgColor = blendColors(rootBg, bgColor, rootBg.a);
      }
    } else if (bodyBg && bodyBg.a > 0) {
      bgColor = blendColors(bodyBg, bgColor, bodyBg.a);
    }

    const startIdx = ancestors.findIndex(n => n === body) >= 0 ? ancestors.findIndex(n => n === body) + 1 : 0;
    for (let i = startIdx; i < ancestors.length; i++) {
      const node = ancestors[i];
      if (node === body || node === document.documentElement) continue;
      const bg = parseRgba(getComputedStyle(node).backgroundColor);
      if (!bg || bg.a === 0) continue;
      bgColor = blendColors(bg, bgColor, bg.a);
    }

    return { fg: fgColor, bg: bgColor };
  }

  function blendColors(over, under, alpha) {
    return {
      r: Math.round(over.r * alpha + under.r * (1 - alpha)),
      g: Math.round(over.g * alpha + under.g * (1 - alpha)),
      b: Math.round(over.b * alpha + under.b * (1 - alpha))
    };
  }

  function suggestColor(fg, bg, targetRatio, preferLight) {
    const fgHsl = rgbToHsl(fg.r, fg.g, fg.b);
    const bgLum = relativeLuminance(bg.r, bg.g, bg.b);
    let bestColor = null;
    let bestDiff = Infinity;
    for (let l = 0; l <= 100; l += 1) {
      const candidate = hslToRgb(fgHsl.h, fgHsl.s, l);
      const ratio = contrastRatio(candidate, bg);
      if (ratio >= targetRatio) {
        const diff = Math.abs(l - fgHsl.l);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestColor = candidate;
        }
      }
    }
    if (!bestColor) {
      const targetLum = bgLum > 0.5
        ? ((bgLum + 0.05) * targetRatio - 0.05)
        : ((bgLum + 0.05) / targetRatio - 0.05);
      const lightness = targetLum > 0.5 ? 95 : 5;
      bestColor = hslToRgb(fgHsl.h, fgHsl.s * 0.7, lightness);
    }
    return bestColor;
  }

  function getFontSize(el) {
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight) >= 700 || style.fontWeight === 'bold';
    return { size, bold };
  }

  return {
    parseRgb, parseRgba, hexToRgb, rgbToHex, normalizeHex, rgbToHsl, hslToRgb,
    relativeLuminance, contrastRatio, wcagLevel,
    getElementColors, blendColors, suggestColor, getFontSize
  };
})();

if (typeof window !== 'undefined') window.ColorUtils = ColorUtils;
