/* Settings dialog and the preferences it edits.
   Load order matters: keep the <script> tag for this file where index.html
   puts it. It uses closeOnBackdrop from dialogs.js, so it must load after it.
   restoreAccent and restoreClearAfterCopy are called from io.js start-up,
   after entry.js has defined the storage helpers they read through. */

/* ---------- Settings ---------- */

/*
 * The nav and the panes are paired by their data-panel value, so a section
 * is one name, not two lookups. The nav item carries aria-current, which is
 * what draws the selected state; the pane's [hidden] is what swaps the
 * content, and the non-hidden state is what the two rules in styles.css
 * outrank the user agent's display:none for.
 */
function showSettingsPanel(name) {
    for (const item of settingsNav.querySelectorAll("[data-panel]")) {
        item.setAttribute("aria-current", String(item.dataset.panel === name));
    }

    for (const panel of document.querySelectorAll(".settings-panel")) {
        panel.hidden = panel.dataset.panel !== name;
    }
}

/* showModal throws on a dialog that is already open. */
function openSettingsDialog() {
    /* The tutorial checkbox is the inverse of the one in the walkthrough. */
    syncTutorialPreference();

    if (!settingsDialog.open) settingsDialog.showModal();
}

/* The help chord lands on the reference list, not the Appearance panel. */
function openSettingsDialogAt(name) {
    showSettingsPanel(name);
    openSettingsDialog();
}

settingsBtn.addEventListener("click", openSettingsDialog);

settingsNav.addEventListener("click", (event) => {
    const item = event.target.closest("[data-panel]");

    if (item) showSettingsPanel(item.dataset.panel);
});

settingsClose.addEventListener("click", () => {
    settingsDialog.close();
});

closeOnBackdrop(settingsDialog, () => settingsDialog.close());

/* ---------- Accent colour ---------- */

const defaultAccent = "#1a7f37";
const accentKey = "jff.accent.v1";

/* The wheel and the store both speak a six-digit hex colour, nothing else. */
function validAccent(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/*
 * The ink sits on an accent fill (a primary dialog button, the pressed
 * toolbar state), so it is derived rather than chosen: black or white,
 * whichever clears WCAG by more against the accent's relative luminance.
 */
function accentInk(hex) {
    const value = hex.slice(1);

    const linear = (start) => {
        const c = parseInt(value.slice(start, start + 2), 16) / 255;

        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };

    const luminance =
        0.2126 * linear(0) + 0.7152 * linear(2) + 0.0722 * linear(4);

    const againstBlack = (luminance + 0.05) / 0.05;
    const againstWhite = 1.05 / (luminance + 0.05);

    return againstBlack >= againstWhite ? "#111" : "#fff";
}

/* Inline on the root, so it outranks both the dark and light palettes. */
function applyAccent(hex) {
    document.documentElement.style.setProperty("--accent", hex);
    document.documentElement.style.setProperty("--accent-ink", accentInk(hex));
    accentInput.value = hex;
}

function persistAccent(hex) {
    if (!storageAvailable()) return;

    try {
        window.localStorage.setItem(accentKey, hex);
    } catch {
        /* A full store is not worth interrupting the picker over. */
    }
}

function restoreAccent() {
    const stored = readStoredEntry(accentKey);

    applyAccent(validAccent(stored) ? stored : defaultAccent);
}

/*
 * Reset drops the stored choice rather than writing the default into it, so
 * an unset accent keeps following the default if it ever changes. The colour
 * applies whether or not the store can be reached.
 */
function resetAccent() {
    applyAccent(defaultAccent);

    if (!storageAvailable()) return;

    try {
        window.localStorage.removeItem(accentKey);
    } catch {
        /* The default applies now; the stored choice only returns on reload. */
    }
}

accentInput.addEventListener("input", () => {
    applyAccent(accentInput.value);
    persistAccent(accentInput.value);
});

accentResetBtn.addEventListener("click", resetAccent);

/* ---------- Clear after copy ---------- */

const clearAfterCopyKey = "jff.clearAfterCopy.v1";

let clearAfterCopyEnabled = false;

function setClearAfterCopy(enabled) {
    clearAfterCopyEnabled = enabled;
    clearAfterCopyInput.checked = enabled;
}

function persistClearAfterCopy(enabled) {
    if (!storageAvailable()) return;

    try {
        window.localStorage.setItem(clearAfterCopyKey, String(enabled));
    } catch {
        /* A full store is not worth interrupting the preference over. */
    }
}

function restoreClearAfterCopy() {
    setClearAfterCopy(readStoredEntry(clearAfterCopyKey) === "true");
}

clearAfterCopyInput.addEventListener("change", () => {
    setClearAfterCopy(clearAfterCopyInput.checked);
    persistClearAfterCopy(clearAfterCopyInput.checked);
});
