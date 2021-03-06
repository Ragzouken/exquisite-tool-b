/** @type {{ drawings: any[], [key: string]: any }} */
let project;
let palette = { default: 0 };
/** @type {string} */
let activeBrushId;

const wheel = new ColorWheel({});
const dataId = "exquisite-tool-d-data";

class DrawingView {
    /**
     * @param {any} drawing
     * @param {HTMLCanvasElement} canvas
     * @param {CanvasRenderingContext2D} rendering 
     */
    constructor(drawing, canvas, rendering) {
        this.drawing = drawing;
        this.canvas = canvas;
        this.rendering = rendering;
        this.matrix = new DOMMatrixReadOnly();
    }

    /**
     * @param {DOMMatrix} matrix 
     */
    setMatrix(matrix) {
        this.matrix = matrix;
        this.matrixInv = matrix.inverse();
        this.canvas.style.setProperty("transform", this.matrix.toString());
    }
}

async function start() {
    const sceneContainer = document.getElementById("scene-container");
    sceneContainer.innerHTML = "";

    document.getElementById("color-container").appendChild(wheel.root);
    wheel.root.addEventListener("input", () => refreshSpecialBrush());

    const importInput = html("input", { "type": "file", "hidden": "true", "accept": ".html" });
    const importDrawingInput = html("input", { "type": "file", "hidden": "true", "accept": "image/*" });
    document.body.appendChild(importInput);
    document.body.appendChild(importDrawingInput);
    const importButton = document.getElementById("import-button");
    importButton.addEventListener("click", () => importInput.click());

    importInput.addEventListener("change", async () => {
        const files = Array.from((importInput.files || []));

        async function importFile(file) {
            const text = await textFromFile(file);
            const html = await htmlFromText(text);
            const json = html.querySelector("#" + dataId).innerHTML;
            const data = JSON.parse(json);

            const existing = new Set(project.drawings.map((drawing) => drawing.image));
            const extra = data.drawings.filter((drawing) => !existing.has(drawing.image));

            project.drawings.push(...extra);
        }

        await Promise.all(files.map(importFile));
        await reloadAllDrawings();
        importInput.value = "";
    });

    importDrawingInput.addEventListener("change", async () => {
        const files = Array.from((importDrawingInput.files || []));

        async function importFile(file) {
            const drawing = {
                id: nanoid(),
                name: file.name,
                image: await dataURLFromFile(file),
            };
            project.drawings.push(drawing);
            return drawing;
        }

        const [drawing] = await Promise.all(files.map(importFile));
        await reloadAllDrawings();
        setActiveDrawing(drawing);
    });

    const drawingPanel = document.getElementById("drawing-settings-panel");
    const brushPanel = document.getElementById("brush-settings-panel");
    document.getElementById("select-mode-button").addEventListener("click", () => {
        mode = "select";
        drawingPanel.hidden = false;
        brushPanel.hidden = true;
        sceneContainer.classList.toggle("draw", false);
    });

    document.getElementById("draw-mode-button").addEventListener("click", () => {
        mode = "draw";
        drawingPanel.hidden = true;
        brushPanel.hidden = false;
        sceneContainer.classList.toggle("draw", true);
    })

    const panel = getDrawingSettingsPanel();
    panel.importButton.addEventListener("click", () => {
        importDrawingInput.click();
    });
    panel.nameInput.addEventListener("input", () => {
        activeDrawing.name = panel.nameInput.value;
    });
    panel.resizeButton.addEventListener("click", () => {
        resizeRendering2D(
            drawingToRendering2d.get(activeDrawing),
            parseInt(panel.widthInput.value, 10),
            parseInt(panel.heightInput.value, 10),
        );
        setActiveDrawing(activeDrawing);
    });
    panel.cloneButton.addEventListener("click", () => {
        const clone = JSON.parse(JSON.stringify(activeDrawing))
        clone.position.x += 8;
        clone.position.y += 8;
        clone.name += " copy";

        project.drawings.push(clone);
        const rendering = copyRendering2D(getActiveRendering());
        
        addDrawingFromRendering(clone, rendering);

        setActiveDrawing(clone);
        refreshScene();
        refreshDrawingSelect();
    });
    panel.exportButton.addEventListener("click", () => {
        getActiveRendering().canvas.toBlob(blob => {
            if (blob) saveAs(blob, `${activeDrawing.name}.png`);
        });
    });
    panel.clearButton.addEventListener("click", () => {
        fillRendering2D(getActiveRendering());
    });
    panel.deleteButton.addEventListener("click", () => {
        if (project.drawings.length === 0) return;

        const index = project.drawings.indexOf(activeDrawing);
        project.drawings.splice(index, 1);

        const container = document.getElementById("scene-container");
        container.removeChild(getActiveRendering().canvas);
        drawingToRendering2d.delete(activeDrawing);
        const first = Array.from(drawingToRendering2d.keys())[0];
        setActiveDrawing(first);
        refreshDrawingSelect();
    });

    makeScenePannable();
    await setProjectFromJson(document.getElementById(dataId).innerHTML);
}

async function setProjectFromJson(json) {
    project = JSON.parse(json);
    await reloadAllDrawings();
}

/** @type { Map<any, CanvasRenderingContext2D> } */
const drawingToRendering2d = new Map();
/** @type { Map<any, DrawingView> } */
const drawingToDrawingView = new Map();

function refreshScene() {
    project.drawings.forEach((drawing) => {
        const view = drawingToDrawingView.get(drawing);
        drawing.position = drawing.position || { x: 0, y: 0 };

        const transform = (new DOMMatrix()).translate(drawing.position.x, drawing.position.y);
        const matrix = sceneTransform.multiply(transform);

        view.setMatrix(matrix);
    });
}

/**
 * @param {CanvasRenderingContext2D} rendering 
 */
function addDrawingFromRendering(drawing, rendering) {
    const drawingContainer = document.getElementById("scene-container");
    const view = new DrawingView(drawing, rendering.canvas, rendering);

    drawingContainer.appendChild(rendering.canvas);
    drawingToRendering2d.set(drawing, rendering);
    drawingToDrawingView.set(drawing, view);
    makeDrawable(view);
}

async function reloadAllDrawings() {
    const drawingContainer = document.getElementById("scene-container");
    removeAllChildren(drawingContainer);

    activeDrawing = undefined;
    drawingToRendering2d.clear();
    drawingToDrawingView.clear();

    async function reload(drawing) {
        const image = await loadImage(drawing.image);
        const rendering = imageToRendering2D(image);
        addDrawingFromRendering(drawing, rendering);
    };

    await Promise.all(project.drawings.map(reload));
    drawingContainer.appendChild(cursor.canvas);

    const first = Array.from(drawingToRendering2d.keys())[0];
    setActiveDrawing(first);
    activeBrush = first;

    refreshScene();
    refreshDrawingSelect();
}

const specialRendering = createRendering2D(1, 1);
const specialToggle = specialRendering.canvas;
const specialBrush = {
    id: "",
    name: "color brush",
    image: "",
}
specialToggle.setAttribute("title", "color brush");
specialToggle.classList.add("brush-toggle")
function refreshSpecialBrush() {
    drawingToRendering2d.set(specialBrush, specialRendering);
    const { r, g, b } = HSVtoRGB(wheel.color);
    fillRendering2D(specialRendering, `rgb(${r} ${g} ${b})`);
}

const colorContainer = document.getElementById("color-container");

function refreshDrawingSelect() {
    const brushesContainer = document.getElementById("brushes-container");
    const brushToggles = /** @type {Map<any, HTMLElement>} */ (new Map());
    removeAllChildren(brushesContainer);

    brushesContainer.appendChild(specialToggle);
    refreshSpecialBrush();

    specialToggle.onclick = function() {
        activeBrush = specialBrush;
        colorContainer.hidden = false;
        specialToggle.classList.toggle("active", true);
        brushToggles.forEach((toggle, drawing_) => toggle.classList.toggle("active", false));
    };

    project.drawings.forEach((drawing) => {
        const toggle = copyRendering2D(drawingToRendering2d.get(drawing)).canvas;
        toggle.setAttribute("title", drawing.name);
        toggle.classList.add("brush-toggle");
        toggle.classList.toggle("active", drawing === brushToggles);
        brushToggles.set(drawing, toggle);
        toggle.addEventListener("click", () => {
            activeBrush = drawing;
            colorContainer.hidden = true;
            specialToggle.classList.toggle("active", false);
            brushToggles.forEach((toggle, drawing_) => toggle.classList.toggle("active", drawing === drawing_));
        });
        brushesContainer.appendChild(toggle);
    });
}

function getDrawingSettingsPanel() {
    const importButton = document.getElementById("import-drawing");
    const nameInput = document.getElementById("drawing-name");

    const widthInput = document.getElementById("resize-width");
    const heightInput = document.getElementById("resize-height");
    const resizeButton = document.getElementById("resize-submit");

    const cloneButton = document.getElementById("clone-button");
    const exportButton = document.getElementById("export-drawing");
    const clearButton = document.getElementById("clear-button");
    const deleteButton = document.getElementById("delete-button");

    return { 
        importButton, nameInput,
        widthInput, heightInput, resizeButton,
        cloneButton, exportButton,
        clearButton, deleteButton,
    }
}

/** @type { "select" | "draw" } */
let mode = "select";
let activeDrawing, activeBrush;
function getActiveRendering() { return drawingToRendering2d.get(activeDrawing); }

const cursor = createRendering2D(8, 8);
cursor.canvas.setAttribute("id", "cursor");

function setActiveDrawing(drawing) {
    activeDrawing = drawing;
    const rendering = drawingToRendering2d.get(drawing);

    drawingToRendering2d.forEach((rendering, drawing_) => {
        rendering.canvas.classList.toggle("active", drawing === drawing_);
    })

    const panel = getDrawingSettingsPanel();
    panel.widthInput.value = rendering.canvas.width.toString();
    panel.heightInput.value = rendering.canvas.height.toString();
    panel.nameInput.value = drawing.name;
}

const eraseToggle = document.getElementById("erase-toggle");

/**
 * @typedef {Object} Brush
 * @property {string} brushId
 * @property {HTMLElement} toggle
 * @property {HTMLCanvasElement} canvas
 * @property {CanvasRenderingContext2D} context
 * @property {HTMLElement} dataElement
 */

let sceneTransform = new DOMMatrix();
sceneTransform.scaleSelf(4, 4);

function makeScenePannable() {
    const sceneContainer = document.getElementById("scene-container");

    let grab = undefined;

    function mouseEventToContainerMatrix(event) {
        const rect = sceneContainer.getBoundingClientRect();
        const [sx, sy] = [event.clientX - rect.x, event.clientY - rect.y];
        const matrix = (new DOMMatrixReadOnly()).translate(sx, sy);
        return matrix;
    }

    sceneContainer.addEventListener("pointerdown", (event) => {
        killEvent(event);

        // determine and save the relationship between mouse and scene
        // G = M1^ . S (scene relative to mouse)
        const mouse = mouseEventToContainerMatrix(event);
        grab = mouse.invertSelf().multiplySelf(sceneTransform);
        sceneContainer.classList.toggle("grabbing", true);
    });

    document.addEventListener("pointermove", (event) => {
        if (!grab) return;

        // preserve the relationship between mouse and scene
        // D2 = M2 . G (drawing relative to scene)
        const mouse = mouseEventToContainerMatrix(event);
        sceneTransform = mouse.multiply(grab);
        refreshScene();
    });

    document.addEventListener("pointerup", (event) => {
        grab = undefined;
        sceneContainer.classList.toggle("grabbing", false);
    });

    function getScale(matrix) {
        return matrix.transformPoint(new DOMPoint(1, 0)).x;
    }

    sceneContainer.addEventListener('wheel', (event) => {
        const mouse = mouseEventToContainerMatrix(event);
        const origin = (sceneTransform.inverse().multiply(mouse)).transformPoint();
        const deltaScale = Math.pow(2, event.deltaY * 0.01);
        sceneTransform.scaleSelf(
            deltaScale, deltaScale, deltaScale,
            origin.x, origin.y, origin.z,
        );
        refreshScene();
    });
}

/**
 * @param {DrawingView} drawingView 
 */
function makeDrawable(drawingView) {
    const drawingContainer = document.getElementById("scene-container");

    const rendering = drawingView.rendering;
    let prevCursor = undefined;
    /** @type { DOMMatrix | undefined } */
    let grabCursor = undefined;

    function draw(x, y, target = rendering) {
        const brush = getActiveBrush().canvas;
        const [ox, oy] = [brush.width / 2, brush.height / 2];
        target.globalCompositeOperation = (eraseToggle.checked && target === rendering ) ? "destination-out" : "source-over";
        target.drawImage(brush, Math.round(x - ox), Math.round(y - oy));
    }

    function mouseEventToSceneMatrix(event) {
        const rect = drawingContainer.getBoundingClientRect();
        const [sx, sy] = [event.clientX - rect.x, event.clientY - rect.y];
        const matrix = (new DOMMatrixReadOnly()).translate(sx, sy);
        return sceneTransform.inverse().multiply(matrix);
    }

    /**
     * @param {MouseEvent} event 
     */
    function mouseToDrawingPixel(event) {
        const rect = drawingContainer.getBoundingClientRect();
        const [sx, sy] = [event.clientX - rect.x, event.clientY - rect.y];
        const pos = drawingView.matrixInv.transformPoint(new DOMPointReadOnly(sx, sy));

        return [pos.x|0, pos.y|0];
    }

    rendering.canvas.addEventListener('pointerdown', (event) => {
        killEvent(event);

        if (mode === "draw") {
            const [x1, y1] = mouseToDrawingPixel(event);
            draw(x1, y1);
            prevCursor = [x1, y1];
        } else {
            setActiveDrawing(drawingView.drawing);

            // determine and save the relationship between mouse and drawing
            // D1 = S^ . W1 (drawing relative to scene)
            const drawingScene = sceneTransform.inverse().multiply(drawingView.matrix);
            // G = M1^ . D1 (drawing relative to mouse)
            const mouseScene = mouseEventToSceneMatrix(event);
            grabCursor = mouseScene.invertSelf().multiplySelf(drawingScene);
            drawingView.canvas.classList.toggle("grabbing", true);
        }
    });
    document.addEventListener('pointermove', (event) => {
        cursor.canvas.hidden = mode !== "draw";
        
        if (mode === "draw") {  
            const [x1, y1] = mouseToDrawingPixel(event);
            const inside = x1 >= 0 && y1 >= 0 && x1 < rendering.canvas.width && y1 < rendering.canvas.height;
            if (prevCursor || inside) {
                fillRendering2D(cursor);
                resizeRendering2D(cursor, drawingView.canvas.width, drawingView.canvas.height);
                cursor.canvas.style.setProperty("transform", drawingView.matrix.toString());
                draw(x1, y1, cursor);
            }
            if (prevCursor === undefined) return;
            
            const [x0, y0] = prevCursor;  
            lineplot(x0, y0, x1, y1, draw);
            prevCursor = [x1, y1];
        } else if (grabCursor) {
            // preserve the relationship between mouse and drawing
            // D2 = M2 . G (drawing relative to scene)
            const drawingScene = mouseEventToSceneMatrix(event).multiplySelf(grabCursor);
            // W2 = S . D2 (drawing relative to container)
            drawingView.setMatrix(sceneTransform.multiply(drawingScene));

            const position = drawingScene.transformPoint();
            drawingView.drawing.position.x = position.x;
            drawingView.drawing.position.y = position.y;
        }
    });
    document.addEventListener('pointerup', (event) => {
        prevCursor = undefined;
        grabCursor = undefined;
        drawingView.canvas.classList.toggle("grabbing", false);
    });
}

function getActiveBrush() {
    return drawingToRendering2d.get(activeBrush);
}

function exportEditor() {
    project.drawings.forEach((drawing) => {
        drawing.image = drawingToRendering2d.get(drawing).canvas.toDataURL("image/png");
    });

    const dataElement = document.getElementById(dataId);
    dataElement.innerHTML = JSON.stringify(project);

    const clone = /** @type {HTMLElement} */ (document.documentElement.cloneNode(true));
    const blob = new Blob([clone.outerHTML], {type: "text/html"});
    saveAs(blob, "exquisite-tool.html");
}
