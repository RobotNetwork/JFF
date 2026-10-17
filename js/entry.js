/* Entry lifecycle: saving and restoring the editor.
   Split out of app.js, lines 2741-2874. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Entry lifecycle ---------- */

/*
 * The entry survives a reload. What is worth keeping is the editor DOM, and
 * it is already sanitised on the way in, so it is stored as HTML and put back
 * through the same sanitiser on the way out: whatever is in storage is held to
 * the rules a paste is held to, whether or not it came from one.
 */
const storageKey = "jff.entry.v1";
const saveDelay = 400;

let saveTimer = null;

function storageAvailable() {
    try {
        return Boolean(window.localStorage);
    } catch {
        /* A blocked cookie store throws on the property, not on the write. */
        return false;
    }
}

/* Says so rather than leaving the entry to be lost silently at the reload. */
function setSaveState(failed) {
    saveState.hidden = !failed;
}

function saveEntry() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    if (!storageAvailable()) {
        setSaveState(true);
        return;
    }

    try {
        window.localStorage.setItem(storageKey, editor.innerHTML);
        setSaveState(false);
    } catch {
        /*
         * A full or read-only store is not worth interrupting the edit for,
         * but it does mean the entry is not being kept.
         */
        setSaveState(true);
    }
}

function queueSave() {
    if (!storageAvailable()) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveEntry, saveDelay);
}

/*
 * The debounce would otherwise drop the last keystrokes when the page is
 * hidden or unloaded, which is the one case the entry is being kept for.
 */
function flushSave() {
    if (saveTimer) saveEntry();
}

function restoreEntry() {
    const stored = readStoredEntry(storageKey);

    if (!stored) return false;

    const doc = parseStoredEntry(stored);

    if (doc.body.textContent.trim() === "" && !doc.body.querySelector("pre")) {
        return false;
    }

    editor.innerHTML = doc.body.innerHTML;

    return true;
}

/*
 * Anything out of storage goes through the clipboard rules whether or not it
 * came from a clipboard: an entry written by an older build, or one a drop
 * put there, is held to the rules a paste is held to.
 */
function parseStoredEntry(stored) {
    const doc = new DOMParser().parseFromString(stored, "text/html");

    sanitizeRichText(doc);
    wrapOrphanListItems(doc.body);

    return doc;
}

/*
 * Storage is read through the same guard as the write, so a browser that
 * refuses the property simply starts with an empty editor.
 */
function readStoredEntry(key) {
    if (!storageAvailable()) return "";

    try {
        return window.localStorage.getItem(key) || "";
    } catch {
        return "";
    }
}

/*
 * Emptying the entry is a content change like any other, so it goes through
 * the undo stack rather than past it and the entry is recoverable with Ctrl+Z.
 * Its one caller is Copy with Clear after copy on: clearing the entry the
 * markup was just taken from is a step of the copy, not an action of its own.
 */
function clearEntry() {
    if (editorIsEmpty()) return;

    flushSnapshot();

    editor.innerHTML = "";
    commitSnapshot();

    render();
    updateToolbarState();
    editor.focus();
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
});

window.addEventListener("pagehide", flushSave);
