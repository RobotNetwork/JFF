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

    const active = settingsNav.querySelector(`[data-panel="${name}"]`);

    if (active) active.focus();
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

/* Inline on the root, so it outranks both the dark and light palettes. */
function applyAccent(hex) {
    applyAccentRoot(hex);
    accentInput.value = hex;
}

function persistAccent(hex) {
    if (!storageAvailable()) return;

    try {
        window.localStorage.setItem(storageKeys.accent, hex);
    } catch {
        /* A full store is not worth interrupting the picker over. */
    }
}

function restoreAccent() {
    const stored = readStoredEntry(storageKeys.accent);

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
        window.localStorage.removeItem(storageKeys.accent);
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

let clearAfterCopyEnabled = false;

function setClearAfterCopy(enabled) {
    clearAfterCopyEnabled = enabled;
    clearAfterCopyInput.checked = enabled;
}

function persistClearAfterCopy(enabled) {
    if (!storageAvailable()) return;

    try {
        window.localStorage.setItem(
            storageKeys.clearAfterCopy,
            String(enabled),
        );
    } catch {
        /* A full store is not worth interrupting the preference over. */
    }
}

function restoreClearAfterCopy() {
    setClearAfterCopy(readStoredEntry(storageKeys.clearAfterCopy) === "true");
}

clearAfterCopyInput.addEventListener("change", () => {
    setClearAfterCopy(clearAfterCopyInput.checked);
    persistClearAfterCopy(clearAfterCopyInput.checked);
});
