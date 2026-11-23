/* Horizontal drag-to-resize on the editor card.
   Split out for the card's two edge strips. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Editor width ---------- */

/*
 * Dragging either edge widens the card by twice the drag distance, so the
 * opposite edge moves out by the same amount and the card stays centred. The
 * width is written onto main's max-width, which is what the centred column
 * already reads, so the card reflows in place without extra positioning.
 */
const editorMain = document.querySelector("main");

/*
 * The resting width: an 840px main cap leaves an 800px card after the 20px
 * side gutters, which is the width the preview dialog opens at. The card
 * cannot be dragged narrower than this.
 */
const MIN_MAIN_MAX_WIDTH = 840;

function clampMainWidth(width) {
    const upper = Math.max(MIN_MAIN_MAX_WIDTH, window.innerWidth);

    return Math.round(Math.min(Math.max(MIN_MAIN_MAX_WIDTH, width), upper));
}

function persistEditorWidth(width) {
    try {
        if (width === null || width <= MIN_MAIN_MAX_WIDTH) {
            window.localStorage.removeItem(storageKeys.editorWidth);
        } else {
            window.localStorage.setItem(
                storageKeys.editorWidth,
                String(Math.round(width)),
            );
        }
    } catch {
        /* A blocked store still lets the user drag-resize for this visit. */
    }
}

function restoreEditorWidth() {
    try {
        const raw = window.localStorage.getItem(storageKeys.editorWidth);
        const parsed = parseFloat(raw);

        if (Number.isFinite(parsed) && parsed > MIN_MAIN_MAX_WIDTH) {
            editorMain.style.maxWidth = `${clampMainWidth(parsed)}px`;
        }
    } catch {
        /* Ignore unreadable storage. */
    }
}

function resetEditorWidth() {
    editorMain.style.removeProperty("max-width");
    persistEditorWidth(null);
}

function editorMainMaxWidth() {
    const inline = parseFloat(editorMain.style.maxWidth);

    if (Number.isFinite(inline)) return clampMainWidth(inline);

    const computed = getComputedStyle(editorMain).maxWidth;

    /* The compact layout drops the cap, so the rendered width is the floor. */
    return clampMainWidth(
        computed === "none"
            ? editorMain.getBoundingClientRect().width
            : parseFloat(computed),
    );
}

restoreEditorWidth();

for (const handle of document.querySelectorAll(".resize-handle")) {
    handle.addEventListener("dblclick", (event) => {
        event.preventDefault();
        resetEditorWidth();
    });

    handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();

        const startX = event.clientX;
        const startMax = editorMainMaxWidth();
        /* The right strip widens on a rightward drag, the left on a leftward. */
        const sign = handle.classList.contains("resize-handle-right") ? 1 : -1;
        let currentWidth = startMax;

        if (typeof handle.setPointerCapture === "function") {
            try {
                handle.setPointerCapture(event.pointerId);
            } catch {
                /* Synthetic pointer events may have no active pointer. */
            }
        }

        handle.classList.add("is-resizing");
        document.body.classList.add("is-resizing");

        const move = (moveEvent) => {
            const dx = moveEvent.clientX - startX;

            currentWidth = clampMainWidth(startMax + 2 * sign * dx);
            editorMain.style.maxWidth = `${currentWidth}px`;
        };

        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);

            handle.classList.remove("is-resizing");
            document.body.classList.remove("is-resizing");

            if (
                typeof handle.hasPointerCapture === "function" &&
                handle.hasPointerCapture(event.pointerId)
            ) {
                handle.releasePointerCapture(event.pointerId);
            }

            persistEditorWidth(currentWidth);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    });
}
