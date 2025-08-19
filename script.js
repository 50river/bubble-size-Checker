(() => {
  const els = {
    canvas: document.querySelector('.canvas'),
    inner: document.getElementById('canvasInner'),
    mega: document.getElementById('megaBubble'),
    gridCols: document.getElementById('gridCols'),
    gridColsOut: document.getElementById('gridColsOut'),
    minSize: document.getElementById('minSize'),
    minSizeOut: document.getElementById('minSizeOut'),
    maxSize: document.getElementById('maxSize'),
    maxSizeOut: document.getElementById('maxSizeOut'),
    minPreview: document.getElementById('minPreview'),
    maxPreview: document.getElementById('maxPreview'),
    minPreviewValue: document.getElementById('minPreviewValue'),
    maxPreviewValue: document.getElementById('maxPreviewValue'),
    groupBtn: document.getElementById('groupBtn')
  };

  const state = {
    cols: Number(els.gridCols.value),
    min: Number(els.minSize.value),
    max: Number(els.maxSize.value),
    count: 200,
    groups: 40,
    mode: 'collapsed', // 'collapsed' | 'grouped' | 'collapsing'
    bubbles: [],
    collapseTimer: null,
    scrollRaf: null,
    lastMin: Number((document.getElementById('minSize')||{value:24}).value),
    lastMax: Number((document.getElementById('maxSize')||{value:72}).value)
  };

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function tuneParams(density, meanR, iterBase, iterMax) {
    density = clamp01(density);
    const pad = Math.max(3, Math.min(Math.max(6, meanR * 0.35), meanR * (0.12 + 0.25 * density)));
    const spring = 0.04 + (1 - density) * 0.08;
    const maxIter = Math.round(iterBase + density * (iterMax - iterBase));
    return { pad, spring, maxIter };
  }

  function syncOutputs() {
    els.gridColsOut.textContent = String(state.cols);
    els.minSizeOut.textContent = String(state.min);
    els.maxSizeOut.textContent = String(state.max);
    els.minPreview.style.setProperty('--size', `${state.min}px`);
    els.maxPreview.style.setProperty('--size', `${state.max}px`);
    els.minPreviewValue.textContent = String(state.min);
    els.maxPreviewValue.textContent = String(state.max);
  }

  function enforceConstraints(from) {
    if (state.min > state.max) {
      if (from === 'min') state.max = state.min; else state.min = state.max;
    }
    state.min = clamp(state.min, Number(els.minSize.min), Number(els.minSize.max));
    state.max = clamp(state.max, Number(els.maxSize.min), Number(els.maxSize.max));
  }

  function buildBubblesIfNeeded() {
    if (state.bubbles.length === state.count) return;
    state.bubbles = [];
    els.inner.replaceChildren();
    for (let i = 0; i < state.count; i++) {
      const t = Math.random();
      const size = Math.round(state.min + t * (state.max - state.min));
      const el = document.createElement('div');
      el.className = 'bubble';
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      // start near top-left in a scattered way
      el.style.left = `${randInt(0, 40)}px`;
      el.style.top = `${randInt(0, 200)}px`;
      els.inner.appendChild(el);
      state.bubbles.push({ el, size, t, group: Math.floor(i / (state.count / state.groups)) });
    }
    state.lastMin = state.min;
    state.lastMax = state.max;
  }

  function updateBubbleSizes(prevMin, prevMax) {
    const pMin = typeof prevMin === 'number' ? prevMin : state.lastMin;
    const pMax = typeof prevMax === 'number' ? prevMax : state.lastMax;
    const denom = Math.max(1, pMax - pMin);
    for (const b of state.bubbles) {
      if (typeof b.t !== 'number') {
        b.t = clamp((b.size - pMin) / denom, 0, 1);
      }
      b.size = Math.round(state.min + b.t * (state.max - state.min));
      b.el.style.width = `${b.size}px`;
      b.el.style.height = `${b.size}px`;
    }
  }

  function layoutGrouped() {
    const innerRect = els.inner.getBoundingClientRect();
    const width = innerRect.width;
    const cols = Math.max(1, state.cols);
    const cellW = width / cols;
    // base cell height. Increased margin for more reliable non-overlap
    const baseH = Math.max(160, state.max + 80);

    // Pre-calc group membership buckets
    const groups = Array.from({ length: state.groups }, () => []);
    for (const b of state.bubbles) groups[b.group].push(b);

    // Estimate required height per group using area heuristic (pad≈8)
    const cellHeights = groups.map(bs => {
      const area = bs.reduce((s, x) => s + Math.PI * Math.pow(x.size / 2, 2), 0);
      const r = Math.sqrt(area / Math.PI) + 8; // minimal circle radius + margin
      return Math.max(baseH, 2 * r + 20); // add margin
    });

    // Use the max per row to compute row heights for a Masonry-like grid
    const rows = Math.ceil(state.groups / cols);
    const rowHeights = Array.from({ length: rows }, (_, r) => {
      let maxH = 0;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i < state.groups) maxH = Math.max(maxH, cellHeights[i]);
      }
      return maxH;
    });
    const rowTops = rowHeights.reduce((acc, h, i) => {
      acc[i + 1] = acc[i] + h; return acc;
    }, [0]);
    els.inner.style.height = `${rowTops[rowTops.length - 1]}px`;

    // For each group, perform simple collision-avoidance packing inside its cell
    for (let gi = 0; gi < state.groups; gi++) {
      const rIndex = Math.floor(gi / cols);
      const cIndex = gi % cols;
      const leftEdge = cIndex * cellW;
      const topEdge = rowTops[rIndex];
      const rightEdge = leftEdge + cellW;
      const bottomEdge = topEdge + rowHeights[rIndex];
      const cx = (leftEdge + rightEdge) / 2;
      const cy = (topEdge + bottomEdge) / 2;
      const items = groups[gi];
      if (!items || items.length === 0) continue;

      // Initialize positions near the center but more spread out
      for (const b of items) {
        const angle = Math.random() * Math.PI * 2;
        const rad = Math.random() * Math.min(cellW, rowHeights[rIndex]) * 0.3;
        b._x = cx + Math.cos(angle) * rad;
        b._y = cy + Math.sin(angle) * rad;
      }

      // Adaptive parameters per group based on density
      const totalArea = items.reduce((s, x) => s + Math.PI * Math.pow(x.size / 2, 2), 0);
      const meanR = items.reduce((s, x) => s + x.size / 2, 0) / items.length;
      const density = clamp01(totalArea / ((rightEdge - leftEdge) * (bottomEdge - topEdge)));
      const { pad, spring, maxIter } = tuneParams(density, meanR, 80, 260);

      // Iterative relaxation to resolve overlaps
      for (let it = 0; it < maxIter; it++) {
        let anyOverlap = false;
        // pairwise collision resolution
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            const ra = a.size / 2, rb = b.size / 2;
            let dx = b._x - a._x;
            let dy = b._y - a._y;
            let dist = Math.hypot(dx, dy);
            const minDist = ra + rb + pad;
            if (dist === 0) { dx = (Math.random() - 0.5) * 0.01; dy = (Math.random() - 0.5) * 0.01; dist = Math.hypot(dx, dy); }
            if (dist < minDist) {
              const overlap = (minDist - dist) / 2;
              const ux = dx / dist, uy = dy / dist;
              a._x -= ux * overlap; a._y -= uy * overlap;
              b._x += ux * overlap; b._y += uy * overlap;
              anyOverlap = true;
            }
          }
        }
        // gentle pull to the group's center
        for (const a of items) {
          a._x += (cx - a._x) * spring;
          a._y += (cy - a._y) * spring;
          const r = a.size / 2;
          // keep within cell bounds
          a._x = clamp(a._x, leftEdge + r + pad, rightEdge - r - pad);
          a._y = clamp(a._y, topEdge + r + pad, bottomEdge - r - pad);
        }
        if (!anyOverlap) break;
      }

      // Apply computed positions
      for (const b of items) {
        b.el.style.left = `${b._x - b.size / 2}px`;
        b.el.style.top = `${b._y - b.size / 2}px`;
        b.el.style.display = 'block';
      }
    }

    // hide mega bubble in grouped mode
    els.mega.style.display = 'none';
    els.mega.setAttribute('aria-hidden', 'true');
  }

  function getViewportCenter() {
    const innerRect = els.inner.getBoundingClientRect();
    const x = innerRect.width / 2;
    const y = els.canvas.scrollTop + els.canvas.clientHeight / 2;
    return { x, y };
  }

  function layoutCollapsed() {
    // Collapsed now means: show a non-overlapping cluster at the viewport center (no mega bubble)
    const { x: cx, y: cy } = getViewportCenter();
    els.inner.style.height = `${Math.max(400, els.canvas.clientHeight)}px`;
    const innerRect = els.inner.getBoundingClientRect();
    const minX = 0, maxX = innerRect.width;
    const minY = 0, maxY = Math.max(parseFloat(getComputedStyle(els.inner).height), els.canvas.clientHeight);

    // Adaptive parameters for central cluster
    const totalArea = state.bubbles.reduce((s, x) => s + Math.PI * Math.pow(x.size / 2, 2), 0);
    const meanR = state.bubbles.reduce((s, x) => s + x.size / 2, 0) / state.bubbles.length;
    const density = clamp01(totalArea / ((maxX - minX) * (maxY - minY)));
    const { pad, spring, maxIter } = tuneParams(density, meanR, 90, 240);

    // initialize positions once if not present
    for (const b of state.bubbles) {
      b.el.style.display = 'block';
      if (typeof b._x !== 'number' || typeof b._y !== 'number') {
        const left = parseFloat(b.el.style.left || '0');
        const top = parseFloat(b.el.style.top || '0');
        b._x = left + b.size / 2;
        b._y = top + b.size / 2;
      }
    }

    // a few iterations to settle into a non-overlapping cluster
    for (let it = 0; it < maxIter; it++) {
      let anyOverlap = false;
      for (let i = 0; i < state.bubbles.length; i++) {
        for (let j = i + 1; j < state.bubbles.length; j++) {
          const a = state.bubbles[i], b = state.bubbles[j];
          const ra = a.size / 2, rb = b.size / 2;
          let dx = b._x - a._x;
          let dy = b._y - a._y;
          let dist = Math.hypot(dx, dy);
          const minDist = ra + rb + pad;
          if (dist === 0) { dx = (Math.random() - 0.5) * 0.01; dy = (Math.random() - 0.5) * 0.01; dist = Math.hypot(dx, dy); }
          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const ux = dx / dist, uy = dy / dist;
            a._x -= ux * overlap; a._y -= uy * overlap;
            b._x += ux * overlap; b._y += uy * overlap;
            anyOverlap = true;
          }
        }
      }
      for (const a of state.bubbles) {
        a._x += (cx - a._x) * spring;
        a._y += (cy - a._y) * spring;
        const r = a.size / 2;
        a._x = clamp(a._x, minX + r + pad, maxX - r - pad);
        a._y = clamp(a._y, minY + r + pad, maxY - r - pad);
      }
      if (!anyOverlap) break;
    }

    for (const b of state.bubbles) {
      b.el.style.left = `${b._x - b.size / 2}px`;
      b.el.style.top = `${b._y - b.size / 2}px`;
      b.el.style.display = 'block';
    }

    // ensure mega bubble stays hidden in collapsed(cluster) mode
    els.mega.style.display = 'none';
    els.mega.setAttribute('aria-hidden', 'true');
  }

  function scatterBeforeCollapse() {
    const { x: cx, y: cy } = getViewportCenter();
    const innerRect = els.inner.getBoundingClientRect();
    const minX = 0, maxX = innerRect.width;
    const minY = 0, maxY = Math.max(parseFloat(getComputedStyle(els.inner).height), els.canvas.clientHeight);
    const rMin = 180, rMax = 300;
    for (const b of state.bubbles) {
      const ang = Math.random() * Math.PI * 2;
      const rad = rMin + Math.random() * (rMax - rMin);
      const x = clamp(cx + Math.cos(ang) * rad, minX + b.size / 2, maxX - b.size / 2);
      const y = clamp(cy + Math.sin(ang) * rad, minY + b.size / 2, maxY - b.size / 2);
      b._x = x; b._y = y;
      b.el.style.left = `${x - b.size / 2}px`;
      b.el.style.top = `${y - b.size / 2}px`;
      b.el.style.display = 'block';
    }
  }

  

  function animateConvergeThenShowMega() {
    // show all bubbles and compute non-overlapping positions converging to a single point
    const { x: cx, y: cy } = getViewportCenter();
    els.inner.style.height = `${Math.max(400, els.canvas.clientHeight)}px`;
    const innerRect = els.inner.getBoundingClientRect();
    const minX = 0, maxX = innerRect.width;
    const minY = 0, maxY = Math.max(parseFloat(getComputedStyle(els.inner).height), els.canvas.clientHeight);
    const pad = 2;

    // initialize positions from last known or styles
    for (const b of state.bubbles) {
      b.el.style.display = 'block';
      if (typeof b._x !== 'number' || typeof b._y !== 'number') {
        const left = parseFloat(b.el.style.left || '0');
        const top = parseFloat(b.el.style.top || '0');
        b._x = left + b.size / 2;
        b._y = top + b.size / 2;
      }
    }

    // iterative non-overlap packing with attraction to center
    const iter = 80;
    const spring = 0.05;
    for (let it = 0; it < iter; it++) {
      // pairwise resolve
      for (let i = 0; i < state.bubbles.length; i++) {
        for (let j = i + 1; j < state.bubbles.length; j++) {
          const a = state.bubbles[i], b = state.bubbles[j];
          const ra = a.size / 2, rb = b.size / 2;
          let dx = b._x - a._x;
          let dy = b._y - a._y;
          let dist = Math.hypot(dx, dy);
          const minDist = ra + rb + pad;
          if (dist === 0) { dx = (Math.random() - 0.5) * 0.01; dy = (Math.random() - 0.5) * 0.01; dist = Math.hypot(dx, dy); }
          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const ux = dx / dist, uy = dy / dist;
            a._x -= ux * overlap; a._y -= uy * overlap;
            b._x += ux * overlap; b._y += uy * overlap;
          }
        }
      }
      // attraction to center and boundary clamp
      for (const a of state.bubbles) {
        a._x += (cx - a._x) * spring;
        a._y += (cy - a._y) * spring;
        const r = a.size / 2;
        a._x = clamp(a._x, minX + r + pad, maxX - r - pad);
        a._y = clamp(a._y, minY + r + pad, maxY - r - pad);
      }
    }

    // apply final positions (CSS transition will animate)
    for (const b of state.bubbles) {
      b.el.style.left = `${b._x - b.size / 2}px`;
      b.el.style.top = `${b._y - b.size / 2}px`;
    }
    // after transition ends, hide individuals and show mega bubble
    if (state.collapseTimer) clearTimeout(state.collapseTimer);
    const fallback = setTimeout(finishCollapse, 700);
    state.collapseTimer = fallback;
    // Prefer transitionend on one element to finish earlier and precisely
    const watchEl = state.bubbles[0]?.el;
    if (watchEl) {
      const onEnd = (e) => {
        if (e.propertyName === 'top' || e.propertyName === 'left') {
          watchEl.removeEventListener('transitionend', onEnd);
          clearTimeout(fallback);
          finishCollapse();
        }
      };
      watchEl.addEventListener('transitionend', onEnd);
    }

    function finishCollapse() {
      state.mode = 'collapsed';
      layoutCollapsed();
      if (els.groupBtn) els.groupBtn.disabled = false;
      if (els.groupBtn) els.groupBtn.textContent = 'グループに分かれる';
      if (state.collapseTimer) { clearTimeout(state.collapseTimer); state.collapseTimer = null; }
    }
  }

  function relayout() {
    if (state.mode === 'grouped') {
      layoutGrouped();
    } else if (state.mode === 'collapsing') {
      // 収束アニメ中は外部イベントで再計算しない（跳ねを防止）
      return;
    } else {
      layoutCollapsed();
    }
  }

  function handleChange(source) {
    enforceConstraints(source);
    els.minSize.value = String(state.min);
    els.maxSize.value = String(state.max);
    syncOutputs();
    if (source === 'min' || source === 'max') {
      const prevMin = state.lastMin;
      const prevMax = state.lastMax;
      updateBubbleSizes(prevMin, prevMax);
      state.lastMin = state.min;
      state.lastMax = state.max;
    }
    relayout();
  }

  // Event listeners
  els.gridCols.addEventListener('input', () => {
    state.cols = Number(els.gridCols.value);
    // update the visible number immediately
    if (els.gridColsOut) els.gridColsOut.textContent = String(state.cols);
    // re-layout (skip if collapsing to avoid jitter)
    if (state.mode !== 'collapsing') relayout();
  });
  els.minSize.addEventListener('input', () => {
    state.min = Number(els.minSize.value);
    handleChange('min');
  });
  els.maxSize.addEventListener('input', () => {
    state.max = Number(els.maxSize.value);
    handleChange('max');
  });
  window.addEventListener('resize', () => relayout());

  if (els.groupBtn) {
    els.groupBtn.addEventListener('click', () => {
      if (state.mode === 'grouped') {
        // Reset to initial center cluster
        if (state.collapseTimer) { clearTimeout(state.collapseTimer); state.collapseTimer = null; }
        state.mode = 'collapsed';
        els.groupBtn.textContent = 'グループに分かれる';
        scatterBeforeCollapse();
        layoutCollapsed();
      } else {
        // Go to grouped layout
        if (state.collapseTimer) { clearTimeout(state.collapseTimer); state.collapseTimer = null; }
        state.mode = 'grouped';
        els.mega.style.display = 'none';
        els.mega.setAttribute('aria-hidden', 'true');
        for (const b of state.bubbles) b.el.style.display = 'block';
        relayout();
        els.groupBtn.textContent = 'リセット';
      }
    });
  }

  // keep cluster centered relative to viewport on scroll by recomputing layout
  els.canvas.addEventListener('scroll', () => {
    if (state.mode !== 'collapsed') return;
    if (state.scrollRaf) return;
    state.scrollRaf = window.requestAnimationFrame(() => {
      state.scrollRaf = null;
      layoutCollapsed();
    });
  });

  // Initial render
  syncOutputs();
  buildBubblesIfNeeded();
  updateBubbleSizes();
  relayout();
})();
