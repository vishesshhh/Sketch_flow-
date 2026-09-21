"use strict";


/*
==========================================================
 LINE2IMAGE
 Photo → clean line art → animated drawing
==========================================================
*/


const DEFAULT_IMAGE = "assets/source.jpg";

const MAX_SIZE = 900;


/* ELEMENTS */

const canvas =
  document.getElementById("canvas");

const ctx =
  canvas.getContext("2d");

const loading =
  document.getElementById("loading");

const imageInput =
  document.getElementById("imageInput");

const generateButton =
  document.getElementById("generate");

const drawButton =
  document.getElementById("draw");

const pauseButton =
  document.getElementById("pause");

const resetButton =
  document.getElementById("reset");

const downloadButton =
  document.getElementById("download");

const detail =
  document.getElementById("detail");

const lineWidth =
  document.getElementById("lineWidth");

const speed =
  document.getElementById("speed");

const detailValue =
  document.getElementById("detailValue");

const widthValue =
  document.getElementById("widthValue");

const speedValue =
  document.getElementById("speedValue");

const status =
  document.getElementById("status");

const percentage =
  document.getElementById("percentage");

const progressBar =
  document.getElementById("progressBar");


/* STATE */

let currentImage = null;

let linePaths = [];

let animationFrame = null;

let drawing = false;

let paused = false;

let currentStroke = 0;

let currentPoint = 0;

let totalPoints = 0;

let completedPoints = 0;

let lastTime = 0;


/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */

function setStatus(text) {
  status.textContent = text;
}


function updateProgress(value) {

  value =
    Math.max(
      0,
      Math.min(100, value)
    );

  percentage.textContent =
    Math.round(value) + "%";

  progressBar.style.width =
    value + "%";
}


function clearCanvas() {

  ctx.fillStyle = "#ffffff";

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );
}


function fitImage(width, height) {

  const scale =
    Math.min(
      1,
      MAX_SIZE /
      Math.max(width, height)
    );

  return {
    width:
      Math.round(width * scale),

    height:
      Math.round(height * scale)
  };
}


/* -------------------------------------------------------
   IMAGE LOADING
------------------------------------------------------- */

function loadImage(src) {

  return new Promise(
    (resolve, reject) => {

      const img =
        new Image();

      img.onload =
        () => resolve(img);

      img.onerror =
        reject;

      img.src = src;
    }
  );
}


/* -------------------------------------------------------
   PREPARE IMAGE
------------------------------------------------------- */

function prepareImage(img) {

  currentImage = img;

  const size =
    fitImage(
      img.naturalWidth,
      img.naturalHeight
    );


  canvas.width =
    size.width;

  canvas.height =
    size.height;


  clearCanvas();

  loading.style.display =
    "none";


  createLineArt();
}


/* -------------------------------------------------------
   PHOTO → LINE ART
------------------------------------------------------- */

function createLineArt() {

  if (
    typeof cv === "undefined" ||
    !cv.Mat
  ) {

    setStatus(
      "Waiting for OpenCV…"
    );

    setTimeout(
      createLineArt,
      500
    );

    return;
  }


  setStatus(
    "Analyzing photograph…"
  );


  /*
  Create temporary OpenCV canvas
  */

  const sourceCanvas =
    document.createElement("canvas");

  sourceCanvas.width =
    canvas.width;

  sourceCanvas.height =
    canvas.height;


  const sourceContext =
    sourceCanvas.getContext("2d");


  sourceContext.drawImage(
    currentImage,
    0,
    0,
    canvas.width,
    canvas.height
  );


  let src =
    cv.imread(sourceCanvas);


  /*
  Convert to grayscale
  */

  let gray =
    new cv.Mat();

  cv.cvtColor(
    src,
    gray,
    cv.COLOR_RGBA2GRAY
  );


  /*
  Remove photographic noise.
  */

  let smooth =
    new cv.Mat();

  cv.bilateralFilter(
    gray,
    smooth,
    7,
    55,
    55,
    cv.BORDER_DEFAULT
  );


  /*
  Detail controls edge threshold.
  Lower threshold = more lines.
  */

  const detailValueNumber =
    Number(detail.value);


  const highThreshold =
    180 -
    detailValueNumber;


  const lowThreshold =
    Math.max(
      20,
      highThreshold * 0.45
    );


  /*
  Canny produces clean contours.
  */

  let edges =
    new cv.Mat();

  cv.Canny(
    smooth,
    edges,
    lowThreshold,
    highThreshold
  );


  /*
  Slightly close small breaks.
  This makes individual strokes
  look more like continuous pen lines.
  */

  let kernel =
    cv.getStructuringElement(
      cv.MORPH_ELLIPSE,
      new cv.Size(2, 2)
    );


  let cleaned =
    new cv.Mat();


  cv.morphologyEx(
    edges,
    cleaned,
    cv.MORPH_CLOSE,
    kernel
  );


  /*
  Find contours.
  */

  let contours =
    new cv.MatVector();

  let hierarchy =
    new cv.Mat();


  cv.findContours(
    cleaned,
    contours,
    hierarchy,
    cv.RETR_LIST,
    cv.CHAIN_APPROX_NONE
  );


  linePaths = [];


  /*
  Convert OpenCV contours into
  JavaScript drawing paths.
  */

  for (
    let i = 0;
    i < contours.size();
    i++
  ) {

    const contour =
      contours.get(i);


    if (
      contour.rows < 8
    ) {

      contour.delete();

      continue;
    }


    const points = [];


    for (
      let j = 0;
      j < contour.rows;
      j++
    ) {

      const point =
        contour.intPtr(j, 0);

      points.push({
        x: point[0],
        y: point[1]
      });
    }


    /*
    Remove extremely tiny contours.
    */

    if (
      points.length >= 8
    ) {

      linePaths.push(points);
    }


    contour.delete();
  }


  /*
  Long contours first.

  This gives the animation a much
  more natural drawing order than
  simply revealing random pixels.
  */

  linePaths.sort(
    (a, b) =>
      b.length - a.length
  );


  /*
  Avoid thousands of microscopic
  paths overwhelming mobile devices.
  */

  linePaths =
    linePaths.slice(
      0,
      1200
    );


  totalPoints =
    linePaths.reduce(
      (total, path) =>
        total + path.length,
      0
    );


  completedPoints = 0;

  currentStroke = 0;

  currentPoint = 0;


  /*
  Free OpenCV memory.
  */

  src.delete();
  gray.delete();
  smooth.delete();
  edges.delete();
  cleaned.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();


  /*
  Display initial blank canvas.
  */

  clearCanvas();


  updateProgress(0);


  setStatus(
    `${linePaths.length} drawing strokes prepared`
  );


  drawButton.disabled = false;

}


/* -------------------------------------------------------
   DRAW ONE PATH
------------------------------------------------------- */

function drawPath(
  path,
  endPoint
) {

  if (
    !path ||
    path.length === 0
  ) {
    return;
  }


  ctx.beginPath();


  const first =
    path[0];


  ctx.moveTo(
    first.x,
    first.y
  );


  const limit =
    Math.min(
      endPoint,
      path.length
    );


  for (
    let i = 1;
    i < limit;
    i++
  ) {

    const p =
      path[i];


    ctx.lineTo(
      p.x,
      p.y
    );
  }


  ctx.stroke();
}


/* -------------------------------------------------------
   REDRAW CURRENT FRAME
------------------------------------------------------- */

function renderFrame() {

  clearCanvas();


  ctx.save();


  ctx.strokeStyle =
    "#202020";


  ctx.lineWidth =
    Number(lineWidth.value);


  ctx.lineCap =
    "round";


  ctx.lineJoin =
    "round";


  for (
    let i = 0;
    i < currentStroke;
    i++
  ) {

    drawPath(
      linePaths[i],
      linePaths[i].length
    );
  }


  if (
    currentStroke <
    linePaths.length
  ) {

    drawPath(
      linePaths[currentStroke],
      currentPoint
    );
  }


  ctx.restore();
}


/* -------------------------------------------------------
   ANIMATION
------------------------------------------------------- */

function animate(time) {

  if (
    !drawing ||
    paused
  ) {
    return;
  }


  if (!lastTime) {
    lastTime = time;
  }


  const delta =
    Math.min(
      50,
      time - lastTime
    );


  lastTime = time;


  /*
  Drawing speed.

  Larger speed =
  more points per frame.
  */

  const pointsPerFrame =
    Math.max(
      2,
      5 *
      Number(speed.value)
    );


  currentPoint +=
    pointsPerFrame *
    (delta / 16.67);


  while (
    currentStroke <
    linePaths.length
  ) {

    const path =
      linePaths[currentStroke];


    if (
      currentPoint <
      path.length
    ) {
      break;
    }


    currentPoint -=
      path.length;

    currentStroke++;

    completedPoints +=
      path.length;
  }


  renderFrame();


  const drawn =
    Math.min(
      totalPoints,
      completedPoints +
      currentPoint
    );


  const percent =
    totalPoints
      ? drawn / totalPoints * 100
      : 100;


  updateProgress(percent);


  if (
    currentStroke >=
    linePaths.length
  ) {

    drawing = false;

    paused = false;

    setStatus(
      "Finished — line art complete."
    );

    updateProgress(100);

    drawButton.disabled =
      false;

    pauseButton.textContent =
      "Ⅱ Pause";

    return;
  }


  animationFrame =
    requestAnimationFrame(
      animate
    );
}


/* -------------------------------------------------------
   START
------------------------------------------------------- */

function startDrawing() {

  if (
    !linePaths.length
  ) {

    setStatus(
      "Convert the image to line art first."
    );

    return;
  }


  if (
    currentStroke >=
    linePaths.length
  ) {

    resetDrawing();
  }


  drawing = true;

  paused = false;

  lastTime = 0;


  drawButton.disabled =
    true;


  pauseButton.textContent =
    "Ⅱ Pause";


  setStatus(
    "Drawing…"
  );


  animationFrame =
    requestAnimationFrame(
      animate
    );
}


/* -------------------------------------------------------
   PAUSE
------------------------------------------------------- */

function togglePause() {

  if (!drawing && !paused) {
    return;
  }


  paused =
    !paused;


  if (paused) {

    drawing = false;

    pauseButton.textContent =
      "▶ Resume";

    setStatus(
      "Paused"
    );

    return;
  }


  drawing = true;

  pauseButton.textContent =
    "Ⅱ Pause";

  lastTime = 0;

  setStatus(
    "Drawing…"
  );


  animationFrame =
    requestAnimationFrame(
      animate
    );
}


/* -------------------------------------------------------
   RESET
------------------------------------------------------- */

function resetDrawing() {

  cancelAnimationFrame(
    animationFrame
  );


  drawing = false;

  paused = false;

  currentStroke = 0;

  currentPoint = 0;

  completedPoints = 0;

  lastTime = 0;


  clearCanvas();

  updateProgress(0);


  pauseButton.textContent =
    "Ⅱ Pause";


  drawButton.disabled =
    false;


  setStatus(
    "Ready"
  );
}


/* -------------------------------------------------------
   IMAGE UPLOAD
------------------------------------------------------- */

imageInput.addEventListener(
  "change",
  event => {

    const file =
      event.target.files[0];


    if (!file) {
      return;
    }


    const url =
      URL.createObjectURL(file);


    loadImage(url)
      .then(img => {

        prepareImage(img);

        URL.revokeObjectURL(
          url
        );

      })
      .catch(() => {

        setStatus(
          "Could not load image."
        );

      });
  }
);


/* -------------------------------------------------------
   CONTROLS
------------------------------------------------------- */

detail.addEventListener(
  "input",
  () => {

    detailValue.textContent =
      detail.value;
  }
);


lineWidth.addEventListener(
  "input",
  () => {

    widthValue.textContent =
      Number(
        lineWidth.value
      ).toFixed(1);

    if (
      linePaths.length
    ) {
      renderFrame();
    }
  }
);


speed.addEventListener(
  "input",
  () => {

    speedValue.textContent =
      speed.value + "×";
  }
);


/* -------------------------------------------------------
   BUTTONS
------------------------------------------------------- */

generateButton.addEventListener(
  "click",
  () => {

    if (currentImage) {
      createLineArt();
    }
  }
);


drawButton.addEventListener(
  "click",
  startDrawing
);


pauseButton.addEventListener(
  "click",
  togglePause
);


resetButton.addEventListener(
  "click",
  resetDrawing
);


downloadButton.addEventListener(
  "click",
  () => {

    const link =
      document.createElement("a");

    link.download =
      "line-art.png";

    link.href =
      canvas.toDataURL(
        "image/png"
      );

    link.click();
  }
);


/* -------------------------------------------------------
   DEFAULT IMAGE
------------------------------------------------------- */

async function initialize() {

  try {

    setStatus(
      "Loading default image…"
    );


    const img =
      await loadImage(
        DEFAULT_IMAGE
      );


    prepareImage(img);

  } catch (error) {

    loading.textContent =
      "Default image not found";


    setStatus(
      "Choose an image to begin."
    );
  }
}


initialize();
