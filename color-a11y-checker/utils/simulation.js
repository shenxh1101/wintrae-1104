const ColorBlindSim = (() => {
  function protanopia(r, g, b) {
    return {
      r: Math.round(0.567*r + 0.433*g + 0.000*b),
      g: Math.round(0.558*r + 0.442*g + 0.000*b),
      b: Math.round(0.000*r + 0.242*g + 0.758*b)
    };
  }

  function deuteranopia(r, g, b) {
    return {
      r: Math.round(0.625*r + 0.375*g + 0.000*b),
      g: Math.round(0.700*r + 0.300*g + 0.000*b),
      b: Math.round(0.000*r + 0.300*g + 0.700*b)
    };
  }

  function tritanopia(r, g, b) {
    return {
      r: Math.round(0.950*r + 0.050*g + 0.000*b),
      g: Math.round(0.000*r + 0.433*g + 0.567*b),
      b: Math.round(0.000*r + 0.475*g + 0.525*b)
    };
  }

  function achromatopsia(r, g, b) {
    const gray = Math.round(0.299*r + 0.587*g + 0.114*b);
    return { r: gray, g: gray, b: gray };
  }

  function protanomaly(r, g, b) {
    const p = protanopia(r,g,b);
    return {
      r: Math.round(r*0.6 + p.r*0.4),
      g: Math.round(g*0.6 + p.g*0.4),
      b: Math.round(b*0.6 + p.b*0.4)
    };
  }

  function deuteranomaly(r, g, b) {
    const d = deuteranopia(r,g,b);
    return {
      r: Math.round(r*0.6 + d.r*0.4),
      g: Math.round(g*0.6 + d.g*0.4),
      b: Math.round(b*0.6 + d.b*0.4)
    };
  }

  const SIMULATIONS = {
    protanopia: { fn: protanopia, name: '红色盲 (Protanopia)', short: '红盲' },
    deuteranopia: { fn: deuteranopia, name: '绿色盲 (Deuteranopia)', short: '绿盲' },
    tritanopia: { fn: tritanopia, name: '蓝色盲 (Tritanopia)', short: '蓝盲' },
    achromatopsia: { fn: achromatopsia, name: '全色盲 (Achromatopsia)', short: '全盲' },
    protanomaly: { fn: protanomaly, name: '红色弱 (Protanomaly)', short: '红弱' },
    deuteranomaly: { fn: deuteranomaly, name: '绿色弱 (Deuteranomaly)', short: '绿弱' }
  };

  function simulate(rgb, type) {
    const sim = SIMULATIONS[type];
    if (!sim) return rgb;
    const result = sim.fn(rgb.r, rgb.g, rgb.b);
    result.r = Math.max(0, Math.min(255, result.r));
    result.g = Math.max(0, Math.min(255, result.g));
    result.b = Math.max(0, Math.min(255, result.b));
    return result;
  }

  function simulatePage(type) {
    const overlay = document.getElementById('a11y-cb-overlay');
    if (overlay) overlay.remove();

    const canvas = document.createElement('canvas');
    canvas.id = 'a11y-cb-canvas';
    const ctx = canvas.getContext('2d');

    document.body.style.filter = 'none';

    const svgFilter = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgFilter.setAttribute('style', 'position:absolute;width:0;height:0');
    svgFilter.innerHTML = '<defs><filter id="a11y-nofilter"></filter></defs>';
    document.body.appendChild(svgFilter);

    const overlayEl = document.createElement('div');
    overlayEl.id = 'a11y-cb-overlay';
    overlayEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;background:transparent;';

    const label = document.createElement('div');
    label.style.cssText = 'position:fixed;top:8px;right:8px;background:rgba(0,0,0,0.8);color:#fff;padding:6px 14px;border-radius:6px;font-size:13px;z-index:2147483647;pointer-events:none;font-family:system-ui;';
    label.textContent = SIMULATIONS[type]?.name || type;
    overlayEl.appendChild(label);

    document.body.appendChild(overlayEl);

    if (type === 'achromatopsia') {
      document.body.style.filter = 'grayscale(1)';
    } else {
      document.body.style.filter = `url('#a11y-cb-filter-${type}')`;
      const filterSvg = createSvgFilter(type);
      document.body.appendChild(filterSvg);
    }

    return type;
  }

  function createSvgFilter(type) {
    const matrices = {
      protanopia: [0.567,0.433,0,0,0, 0.558,0.442,0,0,0, 0,0.242,0.758,0,0, 0,0,0,1,0],
      deuteranopia: [0.625,0.375,0,0,0, 0.700,0.300,0,0,0, 0,0.300,0.700,0,0, 0,0,0,1,0],
      tritanopia: [0.950,0.050,0,0,0, 0,0.433,0.567,0,0, 0,0.475,0.525,0,0, 0,0,0,1,0],
      protanomaly: [0.817,0.183,0,0,0, 0.335,0.665,0,0,0, 0,0.125,0.875,0,0, 0,0,0,1,0],
      deuteranomaly: [0.800,0.200,0,0,0, 0.258,0.742,0,0,0, 0,0.142,0.858,0,0, 0,0,0,1,0]
    };
    const m = matrices[type] || matrices.deuteranopia;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('style', 'position:absolute;width:0;height:0');
    const filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id', `a11y-cb-filter-${type}`);
    const matrix = document.createElementNS(ns, 'feColorMatrix');
    matrix.setAttribute('type', 'matrix');
    matrix.setAttribute('values', m.join(' '));
    filter.appendChild(matrix);
    svg.appendChild(filter);
    svg.id = `a11y-cb-svg-${type}`;
    return svg;
  }

  function removeSimulation() {
    document.body.style.filter = 'none';
    const overlay = document.getElementById('a11y-cb-overlay');
    if (overlay) overlay.remove();
    document.querySelectorAll('[id^="a11y-cb-svg-"]').forEach(el => el.remove());
    document.querySelectorAll('[id="a11y-cb-canvas"]').forEach(el => el.remove());
  }

  return { SIMULATIONS, simulate, simulatePage, removeSimulation };
})();

if (typeof window !== 'undefined') window.ColorBlindSim = ColorBlindSim;
