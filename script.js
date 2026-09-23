(() => {
  "use strict";

  // ============================================================
  // SETTINGS
  // ============================================================

  const DEFAULT_IMAGE = "assets/source.jpg";
  const MAX_DIM = 1000;

  // ============================================================
  // ELEMENTS
  // ============================================================

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  const input = document.getElementById("imageInput");
  const replay = document.getElementById("replay");
  const download = document.getElementById("download");

  const loading = document.getElementById("loading");
  const loadingText = document.getElementById("loadingText");
  const statusEl = document.getElementById("status");
  const percentEl = document.getElementById("percent");
  const controls = document.getElementById("controls");
  const hud = document.getElementById("hud");

  // ============================================================
  // ANIMATION STATE
  // ============================================================

  let paths = [];
  let totalPoints = 0;

  let pathIndex = 0;
  let pointIndex = 0;
  let completedPoints = 0;

  let animationFrame = 0;
  let running = false;
  let lastTime = 0;

  // ============================================================
  // HELPERS
  // ============================================================

  const wait = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function setStatus(message, percent = null) {
    if (statusEl) {
      statusEl.textContent = message;
    }

    if (percent !== null && percentEl) {
      percentEl.textContent = Math.round(percent) + "%";
    }
  }

  function clearCanvas() {
    ctx.save();

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.restore();
  }

  function fitSize(width, height) {
    const scale = Math.min(
      1,
      MAX_DIM / Math.max(width, height)
    );

    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);

      image.onerror = () =>
        reject(
          new Error("Could not load image: " + src)
        );

      image.crossOrigin = "anonymous";
      image.src = src;
    });
  }

  function distance(a, b) {
    return Math.hypot(
      a.x - b.x,
      a.y - b.y
    );
  }

  // ============================================================
  // ORGANIZE THE LINE PATHS
  // ============================================================

  function orderPaths(rawPaths) {
    if (!rawPaths.length) {
      return [];
    }

    const remaining = rawPaths.slice();
    const ordered = [];

    let firstIndex = 0;
    let bestStart = Infinity;

    remaining.forEach((path, index) => {
      const first = path[0];

      const value =
        first.x +
        first.y;

      if (value < bestStart) {
        bestStart = value;
        firstIndex = index;
      }
    });

    let current =
      remaining.splice(firstIndex, 1)[0];

    ordered.push(current);

    while (remaining.length) {
      const lastPoint =
        current[current.length - 1];

      let selectedIndex = 0;
      let bestDistance = Infinity;
      let reverse = false;

      for (
        let i = 0;
        i < remaining.length;
        i++
      ) {
        const candidate = remaining[i];

        const startDistance =
          distance(
            lastPoint,
            candidate[0]
          );

        const endDistance =
          distance(
            lastPoint,
            candidate[
              candidate.length - 1
            ]
          );

        const candidateDistance =
          Math.min(
            startDistance,
            endDistance
          );

        if (
          candidateDistance <
          bestDistance
        ) {
          bestDistance =
            candidateDistance;

          selectedIndex = i;

          reverse =
            endDistance <
            startDistance;
        }
      }

      let next =
        remaining.splice(
          selectedIndex,
          1
        )[0];

      if (reverse) {
        next =
          next
            .slice()
            .reverse();
      }

      ordered.push(next);

      current = next;
    }

    return ordered;
  }

  // ============================================================
  // WAIT FOR OPENCV
  // ============================================================

  async function waitForOpenCV() {
    for (let i = 0; i < 180; i++) {
      if (
        window.cv &&
        cv.Mat
      ) {
        return true;
      }

      await wait(100);
    }

    return false;
  }

  // ============================================================
  // CONVERT IMAGE INTO LINE ART
  // ============================================================

  async function makeLineArt(image) {
    cancelAnimationFrame(animationFrame);

    running = false;

    paths = [];

    totalPoints = 0;

    pathIndex = 0;
    pointIndex = 0;
    completedPoints = 0;

    const size =
      fitSize(
        image.naturalWidth ||
          image.width,
        image.naturalHeight ||
          image.height
      );

    canvas.width = size.width;
    canvas.height = size.height;

    clearCanvas();

    if (loading) {
      loading.style.display = "grid";
    }

    if (loadingText) {
      loadingText.textContent =
        "Preparing your drawing…";
    }

    setStatus(
      "Loading line-art engine…",
      0
    );

    // Wait until OpenCV has loaded.
    const ready =
      await waitForOpenCV();

    if (!ready) {
      if (loadingText) {
        loadingText.textContent =
          "OpenCV could not be loaded.";
      }

      setStatus(
        "Check your internet connection",
        0
      );

      return;
    }

    if (loadingText) {
      loadingText.textContent =
        "Converting photo to line art…";
    }

    setStatus(
      "Converting photo to line art…",
      0
    );

    // ==========================================================
    // OFFSCREEN IMAGE
    // ==========================================================

    const work =
      document.createElement("canvas");

    work.width = size.width;
    work.height = size.height;

    const workCtx =
      work.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

    workCtx.fillStyle = "#ffffff";

    workCtx.fillRect(
      0,
      0,
      size.width,
      size.height
    );

    workCtx.drawImage(
      image,
      0,
      0,
      size.width,
      size.height
    );

    // ==========================================================
    // OPENCV PROCESSING
    // ==========================================================

    let src = null;
    let gray = null;
    let smooth = null;
    let edges = null;
    let closed = null;
    let kernel = null;
    let contours = null;
    let hierarchy = null;

    try {
      src = cv.imread(work);

      gray = new cv.Mat();
      smooth = new cv.Mat();
      edges = new cv.Mat();
      closed = new cv.Mat();

      kernel =
        cv.getStructuringElement(
          cv.MORPH_ELLIPSE,
          new cv.Size(2, 2)
        );

      contours =
        new cv.MatVector();

      hierarchy =
        new cv.Mat();

      // Grayscale
      cv.cvtColor(
        src,
        gray,
        cv.COLOR_RGBA2GRAY
      );

      // Smooth small image noise
      cv.bilateralFilter(
        gray,
        smooth,
        7,
        55,
        55,
        cv.BORDER_DEFAULT
      );

      // Detect edges
      cv.Canny(
        smooth,
        edges,
        45,
        125
      );

      // Close tiny gaps
      cv.morphologyEx(
        edges,
        closed,
        cv.MORPH_CLOSE,
        kernel
      );

      // Extract contours
      cv.findContours(
        closed,
        contours,
        hierarchy,
        cv.RETR_LIST,
        cv.CHAIN_APPROX_NONE
      );

      const rawPaths = [];

      for (
        let i = 0;
        i < contours.size();
        i++
      ) {
        const contour =
          contours.get(i);

        if (contour.rows >= 16) {
          const path = [];

          for (
            let j = 0;
            j < contour.rows;
            j++
          ) {
            const point =
              contour.intPtr(j, 0);

            path.push({
              x: point[0],
              y: point[1]
            });
          }

          rawPaths.push(path);
        }

        contour.delete();
      }

      // Longest contours first
      rawPaths.sort(
        (a, b) =>
          b.length - a.length
      );

      // Remove tiny noise
      const filtered =
        rawPaths
          .filter(
            path =>
              path.length >= 16
          )
          .slice(0, 1400);

      // Organize drawing order
      paths =
        orderPaths(filtered);

      totalPoints =
        paths.reduce(
          (total, path) =>
            total + path.length,
          0
        );

    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (smooth) smooth.delete();
      if (edges) edges.delete();
      if (closed) closed.delete();
      if (kernel) kernel.delete();
      if (contours) contours.delete();
      if (hierarchy) hierarchy.delete();
    }

    // ==========================================================
    // START AUTOMATICALLY
    // ==========================================================

    if (loading) {
      loading.style.display = "none";
    }

    clearCanvas();

    if (!paths.length) {
      setStatus(
        "No line detail detected",
        0
      );

      return;
    }

    setStatus(
      "Starting automatically…",
      0
    );

    // Small delay before drawing begins.
    // No button/tap is required.
    await wait(220);

    startAnimation();
  }

  // ============================================================
  // DRAW A PARTIAL PATH
  // ============================================================

  function drawPath(
    path,
    pointCount
  ) {
    if (
      !path.length ||
      pointCount <= 0
    ) {
      return;
    }

    ctx.beginPath();

    ctx.moveTo(
      path[0].x,
      path[0].y
    );

    const count =
      Math.min(
        pointCount,
        path.length
      );

    for (
      let i = 1;
      i < count;
      i++
    ) {
      ctx.lineTo(
        path[i].x,
        path[i].y
      );
    }

    ctx.stroke();
  }

  // ============================================================
  // RENDER CURRENT FRAME
  // ============================================================

  function render() {
    clearCanvas();

    ctx.save();

    ctx.strokeStyle =
      "#202020";

    ctx.lineWidth =
      Math.max(
        0.8,
        Math.min(
          2.2,
          canvas.width / 900
        )
      );

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Completed paths
    for (
      let i = 0;
      i < pathIndex;
      i++
    ) {
      drawPath(
        paths[i],
        paths[i].length
      );
    }

    // Currently drawing path
    if (
      pathIndex <
      paths.length
    ) {
      drawPath(
        paths[pathIndex],
        pointIndex
      );
    }

    ctx.restore();
  }

  // ============================================================
  // START ANIMATION
  // ============================================================

  function startAnimation() {
    if (!paths.length) {
      return;
    }

    cancelAnimationFrame(
      animationFrame
    );

    running = true;
    lastTime = 0;

    if (controls) {
      controls.style.opacity = "1";
    }

    if (hud) {
      hud.style.opacity = "1";
    }

    animationFrame =
      requestAnimationFrame(
        animationFrameLoop
      );
  }

  // ============================================================
  // ANIMATION LOOP
  // ============================================================

  function animationFrameLoop(
    timestamp
  ) {
    if (!running) {
      return;
    }

    if (!lastTime) {
      lastTime = timestamp;
    }

    const delta =
      Math.min(
        50,
        timestamp - lastTime
      );

    lastTime = timestamp;

    // Drawing speed
    let advance =
      Math.max(
        2,
        canvas.width / 170
      ) *
      (delta / 16.67);

    while (
      pathIndex <
        paths.length &&
      advance > 0
    ) {
      const currentPath =
        paths[pathIndex];

      const remaining =
        currentPath.length -
        pointIndex;

      const amount =
        Math.min(
          remaining,
          advance
        );

      pointIndex += amount;
      advance -= amount;

      if (
        pointIndex >=
        currentPath.length
      ) {
        completedPoints +=
          currentPath.length;

        pathIndex++;

        pointIndex = 0;
      }
    }

    render();

    const percentage =
      totalPoints
        ? Math.min(
            100,
            (
              (
                completedPoints +
                pointIndex
              ) /
              totalPoints
            ) * 100
          )
        : 100;

    // ==========================================================
    // FINISHED
    // ==========================================================

    if (
      pathIndex >=
      paths.length
    ) {
      running = false;

      setStatus(
        "Finished",
        100
      );

      if (controls) {
        controls.style.opacity =
          "0.22";
      }

      if (hud) {
        hud.style.opacity =
          "0.22";
      }

      return;
    }

    setStatus(
      "Drawing…",
      percentage
    );

    animationFrame =
      requestAnimationFrame(
        animationFrameLoop
      );
  }

  // ============================================================
  // CHOOSE ANOTHER IMAGE
  // ============================================================
  // Selecting an image automatically starts its animation.

  if (input) {
    input.addEventListener(
      "change",
      async event => {
        const file =
          event.target.files?.[0];

        if (!file) {
          return;
        }

        const objectURL =
          URL.createObjectURL(
            file
          );

        try {
          const image =
            await loadImage(
              objectURL
            );

          await makeLineArt(
            image
          );

        } catch (error) {
          console.error(error);

          setStatus(
            "Could not load selected image",
            0
          );

        } finally {
          URL.revokeObjectURL(
            objectURL
          );

          input.value = "";
        }
      }
    );
  }

  // ============================================================
  // REPLAY
  // ============================================================

  if (replay) {
    replay.addEventListener(
      "click",
      () => {
        if (!paths.length) {
          return;
        }

        cancelAnimationFrame(
          animationFrame
        );

        running = false;

        pathIndex = 0;
        pointIndex = 0;
        completedPoints = 0;

        if (controls) {
          controls.style.opacity =
            "1";
        }

        if (hud) {
          hud.style.opacity =
            "1";
        }

        clearCanvas();

        setStatus(
          "Replaying…",
          0
        );

        setTimeout(
          startAnimation,
          100
        );
      }
    );
  }

  // ============================================================
  // SAVE FINAL LINE ART
  // ============================================================

  if (download) {
    download.addEventListener(
      "click",
      () => {
        const output =
          document.createElement(
            "canvas"
          );

        output.width =
          canvas.width;

        output.height =
          canvas.height;

        const outputCtx =
          output.getContext("2d");

        outputCtx.fillStyle =
          "#ffffff";

        outputCtx.fillRect(
          0,
          0,
          output.width,
          output.height
        );

        outputCtx.strokeStyle =
          "#202020";

        outputCtx.lineWidth =
          Math.max(
            0.8,
            Math.min(
              2.2,
              output.width / 900
            )
          );

        outputCtx.lineCap =
          "round";

        outputCtx.lineJoin =
          "round";

        for (
          const path of paths
        ) {
          if (!path.length) {
            continue;
          }

          outputCtx.beginPath();

          outputCtx.moveTo(
            path[0].x,
            path[0].y
          );

          for (
            let i = 1;
            i < path.length;
            i++
          ) {
            outputCtx.lineTo(
              path[i].x,
              path[i].y
            );
          }

          outputCtx.stroke();
        }

        const link =
          document.createElement(
            "a"
          );

        link.download =
          "line-art.png";

        link.href =
          output.toDataURL(
            "image/png"
          );

        link.click();
      }
    );
  }

  // ============================================================
  // 🚀 AUTOMATIC START — THIS RUNS WHEN THE WEBSITE OPENS
  // ============================================================

  (async () => {
    try {
      const image =
        await loadImage(
          DEFAULT_IMAGE
        );

      // Automatically process image.
      // makeLineArt() automatically calls
      // startAnimation() when processing finishes.
      await makeLineArt(
        image
      );

    } catch (error) {
      console.error(
        "Automatic start failed:",
        error
      );

      if (loadingText) {
        loadingText.textContent =
          "Default image could not be loaded.";
      }

      setStatus(
        "Put your image at assets/source.jpg",
        0
      );
    }
  })();

})();
