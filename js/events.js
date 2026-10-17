/* Editor input, selection and click events.
   Split out of app.js, lines 3619-3705. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Events ---------- */

editor.addEventListener("input", (event) => {
    /*
     * A marker is only complete once its trailing space is in the DOM, so the
     * conversion runs from the input event rather than from keydown, where
     * the space has not been inserted yet.
     */
    if (event.inputType === "insertText" && event.data === " ") {
        applyTypedMarker();
    }

    queueSnapshot();
    render();
    updateToolbarState();
});

editor.addEventListener("keyup", updateToolbarState);
editor.addEventListener("mouseup", updateToolbarState);
editor.addEventListener("focus", updateToolbarState);

/*
 * A link in the editor is inert, because a click has to place the caret for
 * the words to be edited. Following one is the mouse gesture the browser
 * reserves for it - Ctrl (Cmd) with the left button, or the middle button -
 * and it opens the href in a new tab.
 */
function linkOpenGesture(event) {
    if (!linkAt(event.target)) return false;

    return (
        event.button === 1 ||
        (event.button === 0 && (event.ctrlKey || event.metaKey))
    );
}

function followLink(event) {
    event.preventDefault();

    window.open(linkAt(event.target).href, "_blank", "noopener");
}

/* The press is what moves the caret, so it is the event that must not. */
editor.addEventListener("mousedown", (event) => {
    if (linkOpenGesture(event)) event.preventDefault();
});

editor.addEventListener("click", (event) => {
    if (linkOpenGesture(event)) followLink(event);
});

editor.addEventListener("auxclick", (event) => {
    if (linkOpenGesture(event)) followLink(event);
});

document.addEventListener("selectionchange", () => {
    requestAnimationFrame(updateToolbarState);
});

