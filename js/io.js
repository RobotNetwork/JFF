/* Import, export and start-up.
   Split out of app.js, lines 4227-4332. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Import and export ---------- */

importBtn.addEventListener("click", () => {
    /* Cleared first, so choosing the same file twice still fires a change. */
    importFile.value = "";
    importFile.click();
});

importFile.addEventListener("change", async () => {
    const [file] = importFile.files ?? [];

    if (file) await importSaved(file);
});

async function importSaved(file) {
    /* The confirmation lands on the page, so the dialog is out of the way. */
    settingsDialog.close();

    let incoming = null;

    try {
        const parsed = JSON.parse(await file.text());

        if (!Array.isArray(parsed)) throw new Error("not a list");

        incoming = parsed.map(savedRecord).filter(Boolean);
    } catch {
        showNotice("That file is not a saved-messages export.");
        return;
    }

    if (incoming.length === 0) {
        showNotice("That file holds no saved messages.");
        return;
    }

    const merged = new Map(readSaved().map((record) => [record.id, record]));

    /*
     * A record naming an id already held replaces it, so importing the same
     * export twice leaves the store as it was the second time.
     */
    for (const record of incoming) merged.set(record.id, record);

    if (!writeSaved([...merged.values()])) return;

    showNotice(
        `Imported ${incoming.length} message${incoming.length === 1 ? "" : "s"}.`,
    );
}

exportBtn.addEventListener("click", () => {
    settingsDialog.close();

    const records = readSaved();

    if (records.length === 0) {
        showNotice("There is nothing saved to export yet.");
        return;
    }

    const url = URL.createObjectURL(
        new Blob([JSON.stringify(records, null, 2)], {
            type: "application/json",
        }),
    );
    const link = document.createElement("a");

    link.href = url;
    link.download = "journal-messages.json";
    link.click();

    /* Held for a moment, so the download has the blob before it is released. */
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showNotice(
        `Exported ${records.length} message${records.length === 1 ? "" : "s"}.`,
    );
});

/*
 * Formatting commands are captured as tags rather than as inline styles: the
 * serializer and the sanitizer both understand <b>, <i>, <u>, and <strike>,
 * and a style attribute would be stripped on the way in.
 */
document.execCommand("styleWithCSS", false, false);

/* The tab title follows the heading, so the name is written once. */
document.title = document.querySelector("header h1").textContent.trim();

checkCommandCoverage();
buildTooltips();
buildShortcutList();
restoreAccent();
restoreClearAfterCopy();

/*
 * A restored entry is the baseline the undo stack starts from, so it is in
 * place before the first snapshot is taken.
 */
restoreEntry();

commitSnapshot();
render();
updateToolbarState();

/* The tool's one job is a paste, so the caret is waiting for it. A phone gets
   no focus: a keyboard popped open on load is worse there than the one tap it
   saves. */
if (matchMedia("(min-width: 801px)").matches) editor.focus();
