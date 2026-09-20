(() => {

"use strict";


/* =========================================
   SETTINGS
========================================= */

const DEFAULT_IMAGE =
    "assets/source.jpg";

const MAX_SIZE = 900;


/* =========================================
   ELEMENTS
========================================= */

const canvas =
    document.getElementById("canvas");

const ctx =
    canvas.getContext(
        "2d",
        {
            willReadFrequently: true
        }
    );


const fileInput =
    document.getElementById("file");

const loading =
    document.getElementById("loading");

const status =
    document.getElementById("status");

const percentage =
    document.getElementById("pct");

const progressBar =
    document.getElementById("bar");


const detail =
    document.getElementById("detail");

const threshold =
    document.getElementById("threshold");

const lineWidth =
    document.getElementById("width");

const speed =
    document.getElementById("speed");


const drawButton =
    document.getElementById("draw");

const pauseButton =
    document.getElementById("pause");


/* =========================================
   STATE
========================================= */

let currentImage = null;

let strokes = [];

let totalSteps = 0;

let currentStep = 0;

let animationFrame = 0;

let drawing = false;

let paused = false;


/* =========================================
   HELPERS
========================================= */

function setProgress(value) {

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


function getSize(width, height) {

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


/* =========================================
   GRAYSCALE
========================================= */

function convertToGray(
    pixels,
    width,
    height
) {

    const gray =
        new Float32Array(
            width * height
        );


    for (
        let i = 0, p = 0;
        i < gray.length;
        i++, p += 4
    ) {

        gray[i] =
            0.299 * pixels[p] +
            0.587 * pixels[p + 1] +
            0.114 * pixels[p + 2];

    }


    return gray;

}


/* =========================================
   SMALL BLUR
========================================= */

function blurImage(
    gray,
    width,
    height
) {

    const result =
        new Float32Array(
            width * height
        );


    for (
        let y = 0;
        y < height;
        y++
    ) {

        for (
            let x = 0;
            x < width;
            x++
        ) {

            let sum = 0;

            let count = 0;


            for (
                let dy = -1;
                dy <= 1;
                dy++
            ) {

                for (
                    let dx = -1;
                    dx <= 1;
                    dx++
                ) {

                    const xx =
                        x + dx;

                    const yy =
                        y + dy;


                    if (
                        xx >= 0 &&
                        yy >= 0 &&
                        xx < width &&
                        yy < height
                    ) {

                        sum +=
                            gray[
                                yy * width + xx
                            ];

                        count++;

                    }

                }

            }


            result[
                y * width + x
            ] =
                sum / count;

        }

    }


    return result;

}


/* =========================================
   EDGE / INK DETECTION
========================================= */

function createInkMask(
    pixels,
    width,
    height
) {

    const gray =
        convertToGray(
            pixels,
            width,
            height
        );


    const smooth =
        blurImage(
            gray,
            width,
            height
        );


    const mask =
        new Uint8Array(
            width * height
        );


    const detailValue =
        Number(detail.value);

    const thresholdValue =
        Number(threshold.value);


    /*
       Higher detail = more lines.

       The formula is intentionally
       conservative so photographic
       noise does not become thousands
       of random lines.
    */

    const required =
        thresholdValue +
        (90 - detailValue) * 0.55;


    for (
        let y = 1;
        y < height - 1;
        y++
    ) {

        for (
            let x = 1;
            x < width - 1;
            x++
        ) {

            const i =
                y * width + x;


            const gx =
                -smooth[i - width - 1] +
                smooth[i - width + 1] +

                -2 * smooth[i - 1] +
                2 * smooth[i + 1] +

                -smooth[i + width - 1] +
                smooth[i + width + 1];


            const gy =
                -smooth[i - width - 1] -
                2 * smooth[i - width] -
                smooth[i - width + 1] +

                smooth[i + width - 1] +
                2 * smooth[i + width] +
                smooth[i + width + 1];


            const magnitude =
                Math.hypot(
                    gx,
                    gy
                );


            if (
                magnitude >=
                required
            ) {

                mask[i] = 1;

            }

        }

    }


    /*
       Remove isolated noise.
    */

    const cleaned =
        new Uint8Array(mask);


    for (
        let y = 1;
        y < height - 1;
        y++
    ) {

        for (
            let x = 1;
            x < width - 1;
            x++
        ) {

            const i =
                y * width + x;


            if (!mask[i])
                continue;


            let neighbours = 0;


            for (
                let dy = -1;
                dy <= 1;
                dy++
            ) {

                for (
                    let dx = -1;
                    dx <= 1;
                    dx++
                ) {

                    if (
                        dx === 0 &&
                        dy === 0
                    )
                        continue;


                    if (
                        mask[
                            (y + dy) *
                            width +
                            (x + dx)
                        ]
                    ) {

                        neighbours++;

                    }

                }

            }


            if (
                neighbours < 2
            ) {

                cleaned[i] = 0;

            }

        }

    }


    return cleaned;

}


/* =========================================
   TRACE CONNECTED STROKES
========================================= */

function traceStrokes(
    mask,
    width,
    height
) {

    const visited =
        new Uint8Array(
            mask.length
        );


    const directions = [

        [-1, -1],
        [0, -1],
        [1, -1],

        [1, 0],

        [1, 1],
        [0, 1],
        [-1, 1],

        [-1, 0]

    ];


    const components = [];


    function valid(x, y) {

        return (
            x > 0 &&
            y > 0 &&
            x < width - 1 &&
            y < height - 1
        );

    }


    /*
       First find connected line
       components.
    */

    for (
        let y = 1;
        y < height - 1;
        y++
    ) {

        for (
            let x = 1;
            x < width - 1;
            x++
        ) {

            const start =
                y * width + x;


            if (
                !mask[start] ||
                visited[start]
            )
                continue;


            const queue = [start];

            const component = [];


            visited[start] = 1;


            while (
                queue.length
            ) {

                const current =
                    queue.pop();


                component.push(
                    current
                );


                const cx =
                    current % width;

                const cy =
                    Math.floor(
                        current / width
                    );


                for (
                    const [dx, dy]
                    of directions
                ) {

                    const nx =
                        cx + dx;

                    const ny =
                        cy + dy;


                    if (
                        !valid(nx, ny)
                    )
                        continue;


                    const next =
                        ny * width + nx;


                    if (
                        mask[next] &&
                        !visited[next]
                    ) {

                        visited[next] = 1;

                        queue.push(
                            next
                        );

                    }

                }

            }


            /*
               Ignore tiny components.
            */

            if (
                component.length >= 5
            ) {

                components.push(
                    component
                );

            }

        }

    }


    /*
       Main contours first.
    */

    components.sort(
        (a, b) =>
            b.length - a.length
    );


    const result = [];


    /*
       Convert each component into
       an ordered pen path.
    */

    for (
        const component
        of components
    ) {

        const points =
            new Set(component);

        const used =
            new Set();


        const path = [];


        let current =
            component[0];

        let previous = -1;


        while (
            current >= 0 &&
            !used.has(current)
        ) {

            used.add(current);

            path.push(current);


            const x =
                current % width;

            const y =
                Math.floor(
                    current / width
                );


            let next = -1;

            let bestScore =
                Infinity;


            for (
                const [dx, dy]
                of directions
            ) {

                const nx =
                    x + dx;

                const ny =
                    y + dy;


                if (
                    !valid(nx, ny)
                )
                    continue;


                const index =
                    ny * width + nx;


                if (
                    !points.has(index) ||
                    used.has(index)
                )
                    continue;


                let score =
                    Math.abs(dx) +
                    Math.abs(dy);


                if (
                    index === previous
                ) {

                    score += 20;

                }


                if (
                    score <
                    bestScore
                ) {

                    bestScore =
                        score;

                    next =
                        index;

                }

            }


            previous =
                current;

            current =
                next;

        }


        if (
            path.length >= 5
        ) {

            result.push(path);

        }

    }


    return result;

}


/* =========================================
   DRAW PART OF THE IMAGE
========================================= */

function render(
    amount
) {

    clearCanvas();


    ctx.save();


    ctx.strokeStyle =
        "#242424";


    ctx.lineWidth =
        Number(lineWidth.value);


    ctx.lineCap =
        "round";


    ctx.lineJoin =
        "round";


    let remaining =
        amount;


    for (
        const stroke
        of strokes
    ) {

        if (
            remaining <= 0
        )
            break;


        const count =
            Math.min(
                remaining,
                stroke.length
            );


        if (
            count < 1
        )
            continue;


        ctx.beginPath();


        let first =
            stroke[0];


        let x =
            first % canvas.width;

        let y =
            Math.floor(
                first / canvas.width
            );


        ctx.moveTo(
            x,
            y
        );


        for (
            let i = 1;
            i < count;
            i++
        ) {

            const point =
                stroke[i];


            x =
                point %
                canvas.width;


            y =
                Math.floor(
                    point /
                    canvas.width
                );


            ctx.lineTo(
                x,
                y
            );

        }


        ctx.stroke();


        remaining -=
            count;

    }


    ctx.restore();

}


/* =========================================
   PREPARE IMAGE
========================================= */

async function prepareImage(
    source
) {

    cancelAnimationFrame(
        animationFrame
    );


    drawing = false;

    paused = false;

    currentStep = 0;


    setProgress(0);


    status.textContent =
        "Converting photo to clean line art…";


    const size =
        getSize(
            source.naturalWidth ||
            source.width,

            source.naturalHeight ||
            source.height
        );


    canvas.width =
        size.width;

    canvas.height =
        size.height;


    /*
       Work on a smaller canvas for
       smooth Android performance.
    */

    const work =
        document.createElement(
            "canvas"
        );


    work.width =
        size.width;

    work.height =
        size.height;


    const workCtx =
        work.getContext(
            "2d",
            {
                willReadFrequently:
                    true
            }
        );


    workCtx.fillStyle =
        "#ffffff";


    workCtx.fillRect(
        0,
        0,
        size.width,
        size.height
    );


    workCtx.drawImage(
        source,
        0,
        0,
        size.width,
        size.height
    );


    const imageData =
        workCtx.getImageData(
            0,
            0,
            size.width,
            size.height
        );


    const mask =
        createInkMask(
            imageData.data,
            size.width,
            size.height
        );


    strokes =
        traceStrokes(
            mask,
            size.width,
            size.height
        );


    totalSteps =
        strokes.reduce(
            (total, stroke) =>
                total +
                stroke.length,
            0
        );


    clearCanvas();


    loading.style.display =
        "none";


    status.textContent =
        `${strokes.length} clean strokes ready`;

}


/* =========================================
   PROGRESS
========================================= */

function updateProgress(
    value
) {

    setProgress(
        totalSteps
            ? value /
              totalSteps *
              100
            : 100
    );

}


/* =========================================
   ANIMATION
========================================= */

function animate() {

    if (
        !drawing ||
        paused
    )
        return;


    const speedValue =
        Number(speed.value);


    const drawingRate =
        Math.max(
            20,
            totalSteps / 70
        ) *
        speedValue;


    currentStep =
        Math.min(
            totalSteps,

            currentStep +
            drawingRate / 60
        );


    render(
        Math.floor(
            currentStep
        )
    );


    updateProgress(
        currentStep
    );


    if (
        currentStep >=
        totalSteps
    ) {

        drawing = false;


        drawButton.disabled =
            false;


        pauseButton.disabled =
            true;


        status.textContent =
            "Finished — line art complete.";


        return;

    }


    animationFrame =
        requestAnimationFrame(
            animate
        );

}


/* =========================================
   START DRAWING
========================================= */

drawButton.onclick =
    () => {

        if (
            !strokes.length
        )
            return;


        if (
            currentStep >=
            totalSteps
        ) {

            currentStep = 0;

        }


        drawing = true;

        paused = false;


        drawButton.disabled =
            true;


        pauseButton.disabled =
            false;


        pauseButton.textContent =
            "Ⅱ Pause";


        status.textContent =
            "Drawing…";


        animationFrame =
            requestAnimationFrame(
                animate
            );

    };


/* =========================================
   PAUSE / RESUME
========================================= */

pauseButton.onclick =
    () => {

        if (
            drawing
        ) {

            drawing = false;

            paused = true;


            pauseButton.textContent =
                "▶ Resume";


            drawButton.disabled =
                false;


            status.textContent =
                "Paused";


        } else {

            drawing = true;

            paused = false;


            pauseButton.textContent =
                "Ⅱ Pause";


            drawButton.disabled =
                true;


            animationFrame =
                requestAnimationFrame(
                    animate
                );

        }

    };


/* =========================================
   RESET
========================================= */

document
    .getElementById("reset")
    .onclick = () => {

        cancelAnimationFrame(
            animationFrame
        );


        drawing = false;

        paused = false;

        currentStep = 0;


        render(0);


        setProgress(0);


        drawButton.disabled =
            false;


        pauseButton.disabled =
            true;


        pauseButton.textContent =
            "Ⅱ Pause";


        status.textContent =
            "Ready — press Draw";

    };


/* =========================================
   SAVE PNG
========================================= */

document
    .getElementById("save")
    .onclick = () => {

        const link =
            document.createElement(
                "a"
            );


        link.download =
            "line-art.png";


        link.href =
            canvas.toDataURL(
                "image/png"
            );


        link.click();

    };


/* =========================================
   CONTROLS
========================================= */

detail.oninput =
    () => {

        document
            .getElementById(
                "detailV"
            )
            .textContent =
            detail.value;


        if (
            currentImage
        ) {

            prepareImage(
                currentImage
            );

        }

    };


threshold.oninput =
    () => {

        document
            .getElementById(
                "thresholdV"
            )
            .textContent =
            threshold.value;


        if (
            currentImage
        ) {

            prepareImage(
                currentImage
            );

        }

    };


lineWidth.oninput =
    () => {

        document
            .getElementById(
                "widthV"
            )
            .textContent =
            Number(
                lineWidth.value
            ).toFixed(1);


        render(
            Math.floor(
                currentStep
            )
        );

    };


speed.oninput =
    () => {

        document
            .getElementById(
                "speedV"
            )
            .textContent =
            Number(
                speed.value
            )
            .toFixed(2)
            .replace(
                /0$/,
                ""
            ) + "×";

    };


/* =========================================
   CUSTOM IMAGE UPLOAD
========================================= */

fileInput.onchange =
    async event => {

        const file =
            event.target
                .files?.[0];


        if (!file)
            return;


        const url =
            URL.createObjectURL(
                file
            );


        try {

            const image =
                await loadImage(
                    url
                );


            currentImage =
                image;


            await prepareImage(
                image
            );


        } catch {

            status.textContent =
                "Could not load image.";

        } finally {

            URL.revokeObjectURL(
                url
            );

        }

    };


/* =========================================
   LOAD DEFAULT IMAGE
========================================= */

(async () => {

    try {

        currentImage =
            await loadImage(
                DEFAULT_IMAGE
            );


        await prepareImage(
            currentImage
        );


    } catch {

        loading.textContent =
            "Default image missing";


        status.textContent =
            "Choose an image to begin.";

    }

})();


})();
