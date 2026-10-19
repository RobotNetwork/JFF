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
 * The resting width: an 800px main cap leaves a 760px card after the 20px
 * side gutters, which is the width the preview dialog opens at. The card
 * cannot be dragged narrower than this.
 */
const MIN_MAIN_MAX_WIDTH = 800;

function editorMainMaxWidth() {
    const inline = parseFloat(editorMain.style.maxWidth);

    if (Number.isFinite(inline)) return inline;

    const computed = getComputedStyle(editorMain).maxWidth;

    /* The compact layout drops the cap, so the rendered width is the floor. */
    return computed === "none"
        ? editorMain.getBoundingClientRect().width
        : parseFloat(computed);
}

for (const handle of document.querySelectorAll(".resize-handle")) {
    handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();

        const startX = event.clientX;
        const startMax = editorMainMaxWidth();
        /* The right strip widens on a rightward drag, the left on a leftward. */
        const sign = handle.classList.contains("resize-handle-right") ? 1 : -1;

        const move = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const next = Math.max(
                MIN_MAIN_MAX_WIDTH,
                startMax + 2 * sign * dx,
            );

            editorMain.style.maxWidth = `${next}px`;
        };

        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    });
}
