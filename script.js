(() => {
  "use strict";

  const DEFAULT_IMAGE = "assets/source.jpg";
  const MAX_DIM = 900;

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const fileInput = document.getElementById("fileInput");
  const empty = document.getElementById("emptyState");
  const speedEl = document.getElementById("speed");
  const thresholdEl = document.getElementById("threshold");
  const brushEl = document.getElementById("brush");
  const colorEl = document.getElementById("lineColor");
  const speedOut = document.getElementById("speedOut");
  const thresholdOut = document.getElementById("thresholdOut");
  const brushOut = document.getElementById("brushOut");
  const statusEl = document.getElementById("status");
  const progressEl = document.getElementById("progress");
  const progressBar = document.getElementById("progressBar");
  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const resetBtn = document.getElementById("resetBtn");
  const downloadBtn = document.getElementById("downloadBtn");

  let sourceImage = null;
  let paths = [];
  let drawing = false;
  let paused = false;
  let raf = 0;
  let totalSteps = 0;
  let currentStep = 0;
  let lastTime = 0;
  let imagePixels = null;

  function setStatus(s) { statusEl.textContent = s; }
  function setProgress(v) {
    const p = Math.max(0, Math.min(100, v));
    progressEl.textContent = `${Math.round(p)}%`;
    progressBar.style.width = `${p}%`;
  }

  function fitSize(w, h) {
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  function drawWhiteBackground() {
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
  }

  // Sobel-style edge score. Works especially well for line-art images,
  // while still accepting ordinary photos through the upload control.
  function edgeMap(w, h, data, threshold) {
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    const edges = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx =
          -gray[i-w-1] + gray[i-w+1] +
          -2*gray[i-1] + 2*gray[i+1] +
          -gray[i+w-1] + gray[i+w+1];
        const gy =
          -gray[i-w-1] - 2*gray[i-w] - gray[i-w+1] +
           gray[i+w-1] + 2*gray[i+w] + gray[i+w+1];
        const mag = Math.sqrt(gx*gx + gy*gy);
        edges[i] = mag >= threshold ? 1 : 0;
      }
    }
    return edges;
  }

  function neighborIndex(i, dx, dy, w) {
    return i + dy * w + dx;
  }

  // Turn the binary edge field into ordered pen strokes. Each component is
  // walked through adjacent edge pixels; components are then joined by the
  // nearest endpoint so the animation behaves like one traveling pen.
  function tracePaths(edges, w, h) {
    const visited = new Uint8Array(edges.length);
    const components = [];
    const dirs = [
      [-1,-1],[0,-1],[1,-1],[1,0],
      [1,1],[0,1],[-1,1],[-1,0]
    ];

    const inBounds = (x,y) => x >= 0 && y >= 0 && x < w && y < h;

    for (let sy = 1; sy < h - 1; sy++) {
      for (let sx = 1; sx < w - 1; sx++) {
        const start = sy*w + sx;
        if (!edges[start] || visited[start]) continue;

        const q = [start];
        visited[start] = 1;
        const comp = [];

        while (q.length) {
          const cur = q.pop();
          comp.push(cur);
          const cx = cur % w, cy = (cur / w) | 0;
          for (const [dx,dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (!inBounds(nx,ny)) continue;
            const ni = ny*w + nx;
            if (edges[ni] && !visited[ni]) {
              visited[ni] = 1;
              q.push(ni);
            }
          }
        }
        if (comp.length >= 3) components.push(comp);
      }
    }

    // Remove tiny noise and convert each component into a walk. A greedy
    // local walk keeps the pen moving along the actual contour instead of
    // producing a random pixel reveal.
    const paths = [];
    for (const comp of components) {
      const set = new Set(comp);
      let start = comp[0];
      let bestDegree = 99;

      for (const idx of comp) {
        const x = idx % w, y = (idx / w) | 0;
        let degree = 0;
        for (const [dx,dy] of dirs) {
          const nx=x+dx, ny=y+dy;
          if (inBounds(nx,ny) && set.has(ny*w+nx)) degree++;
        }
        if (degree <= 2) { start = idx; bestDegree = degree; break; }
        if (degree < bestDegree) { bestDegree = degree; start = idx; }
      }

      const used = new Set();
      const path = [];
      let cur = start;
      let prev = -1;

      while (cur !== -1 && !used.has(cur)) {
        used.add(cur);
        path.push(cur);
        const x = cur % w, y = (cur / w) | 0;
        let next = -1;
        let best = Infinity;

        for (const [dx,dy] of dirs) {
          const nx=x+dx, ny=y+dy;
          if (!inBounds(nx,ny)) continue;
          const ni=ny*w+nx;
          if (!set.has(ni) || used.has(ni)) continue;
          const back = prev >= 0 && ni === prev ? 10 : 0;
          const score = back + Math.abs(dx) + Math.abs(dy);
          if (score < best) { best=score; next=ni; }
        }

        prev = cur;
        cur = next;
      }

      if (path.length >= 3) paths.push(path);
    }

    // Large strokes first. This makes the main silhouette appear early.
    paths.sort((a,b) => b.length - a.length);

    // Keep the animation practical on mobile by sampling extremely dense
    // contours while preserving their shape.
    return paths.map(path => {
      const maxPts = 5000;
      if (path.length <= maxPts) return path;
      const step = path.length / maxPts;
      const out = [];
      for (let i=0; i<path.length; i+=step) out.push(path[Math.floor(i)]);
      return out;
    });
  }

  function prepare(img) {
    cancelAnimationFrame(raf);
    drawing = false;
    paused = false;
    currentStep = 0;
    setProgress(0);
    setStatus("Analyzing image…");

    const size = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
    canvas.width = size.w;
    canvas.height = size.h;

    const work = document.createElement("canvas");
    work.width = size.w;
    work.height = size.h;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    wctx.fillStyle = "#fff";
    wctx.fillRect(0,0,size.w,size.h);
    wctx.drawImage(img,0,0,size.w,size.h);

    const data = wctx.getImageData(0,0,size.w,size.h);
    imagePixels = data;
    const edges = edgeMap(size.w,size.h,data.data,Number(thresholdEl.value));
    paths = tracePaths(edges,size.w,size.h);
    totalSteps = paths.reduce((n,p) => n + p.length, 0);

    drawWhiteBackground();
    empty.style.display = "none";
    setStatus(`${paths.length} pen strokes ready`);
  }

  function pointFromIndex(i) {
    return { x: i % canvas.width, y: (i / canvas.width) | 0 };
  }

  function redraw(stepLimit) {
    drawWhiteBackground();
    ctx.save();
    ctx.strokeStyle = colorEl.value;
    ctx.lineWidth = Number(brushEl.value);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let remaining = stepLimit;
    let drawn = 0;

    for (const path of paths) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, path.length);
      if (take > 0) {
        ctx.beginPath();
        let p = pointFromIndex(path[0]);
        ctx.moveTo(p.x,p.y);
        for (let j=1;j<take;j++) {
          p = pointFromIndex(path[j]);
          ctx.lineTo(p.x,p.y);
        }
        if (take === 1) ctx.lineTo(p.x + 0.01,p.y + 0.01);
        ctx.stroke();
        drawn += take;
        remaining -= take;
      }
    }
    ctx.restore();
    return drawn;
  }

  function animate(now) {
    if (!drawing || paused) return;
    const dt = Math.min(50, now - (lastTime || now));
    lastTime = now;

    const base = Math.max(25, totalSteps / 55);
    currentStep = Math.min(totalSteps, currentStep + base * Number(speedEl.value) * (dt / 16.67));
    redraw(Math.floor(currentStep));

    const pct = totalSteps ? (currentStep / totalSteps) * 100 : 100;
    setProgress(pct);

    if (currentStep >= totalSteps) {
      drawing = false;
      setStatus("Finished — the complete line art is drawn.");
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      return;
    }
    raf = requestAnimationFrame(animate);
  }

  function start() {
    if (!paths.length) return;
    if (currentStep >= totalSteps) currentStep = 0;
    drawing = true;
    paused = false;
    pauseBtn.disabled = false;
    startBtn.disabled = true;
    setStatus(currentStep ? "Continuing the pen stroke…" : "Drawing…");
    lastTime = 0;
    raf = requestAnimationFrame(animate);
  }

  function pause() {
    paused = !paused;
    if (paused) {
      drawing = false;
      pauseBtn.textContent = "▶ Resume";
      startBtn.disabled = false;
      setStatus("Paused");
    } else {
      pauseBtn.textContent = "Ⅱ Pause";
      start();
    }
  }

  function reset() {
    cancelAnimationFrame(raf);
    drawing = false;
    paused = false;
    currentStep = 0;
    redraw(0);
    setProgress(0);
    pauseBtn.disabled = true;
    pauseBtn.textContent = "Ⅱ Pause";
    startBtn.disabled = false;
    setStatus("Ready — press Start drawing");
  }

  async function loadAndPrepare(img) {
    sourceImage = img;
    prepare(img);
  }

  fileInput.addEventListener("change", async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      await loadAndPrepare(img);
      URL.revokeObjectURL(url);
    } catch {
      setStatus("Could not load that image.");
    }
  });

  [speedEl,thresholdEl,brushEl].forEach(el => {
    el.addEventListener("input", () => {
      speedOut.textContent = `${Number(speedEl.value).toFixed(2).replace(/0$/,"")}×`;
      thresholdOut.textContent = thresholdEl.value;
      brushOut.textContent = Number(brushEl.value).toFixed(2).replace(/0$/,"");
      if (el === thresholdEl && sourceImage) prepare(sourceImage);
      else if (el === brushEl && paths.length) redraw(Math.floor(currentStep));
    });
  });

  colorEl.addEventListener("input", () => {
    if (paths.length) redraw(Math.floor(currentStep));
  });

  startBtn.addEventListener("click", start);
  pauseBtn.addEventListener("click", pause);
  resetBtn.addEventListener("click", reset);
  downloadBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "line2image.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  pauseBtn.disabled = true;

  (async () => {
    try {
      const img = await loadImage(DEFAULT_IMAGE);
      await loadAndPrepare(img);
    } catch {
      empty.style.display = "block";
      setStatus("Default image not found. Use Choose another image.");
    }
  })();
})();
