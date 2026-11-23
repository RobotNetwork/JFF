/* Copy.
   Split out of app.js, lines 3706-3854. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Copy ---------- */

/*
 * The legacy command is the fallback for navigator.clipboard being undefined
 * on a non-secure origin, and for a rejected write. It works from a temporary
 * selection, so the reader's own selection is left alone.
 */
function copyViaExecCommand(text) {
    const active = document.activeElement;
    const selection = window.getSelection();
    const savedRanges = [];

    for (let i = 0; i < selection.rangeCount; i++) {
        savedRanges.push(selection.getRangeAt(i).cloneRange());
    }

    const area = document.createElement("textarea");

    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.top = "-1000px";

    document.body.appendChild(area);
    area.select();

    let copied = false;

    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }

    area.remove();

    if (active && typeof active.focus === "function" && active.isConnected) {
        active.focus({ preventScroll: true });
    }

    selection.removeAllRanges();
    for (const range of savedRanges) {
        selection.addRange(range);
    }

    return copied;
}

/*
 * Reached by the button and by the chord, so the copy itself is not the
 * button's handler. Whether the entry is cleared after copying is the
 * clear-after-copy preference in Settings.
 */
async function copyOutput() {
    const text = serializedBody();

    if (text === "") return;

    let copied = false;

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            copied = true;
        }
    } catch {
        copied = false;
    }

    if (!copied) copied = copyViaExecCommand(text);

    showNotice(
        copied
            ? "Copied to clipboard!"
            : "Could not copy formatted markup to clipboard.",
    );

    /* The one-step loop: copy and the entry resets itself for the next one. */
    if (copied && clearAfterCopyEnabled) clearEntry();
}
