/* Saving the current entry.
   Split out of app.js, lines 4152-4226. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Saving the current entry ---------- */

/*
 * The prefill: the entry's first line, which is what a message is usually
 * named after. Taken from the editor's words rather than the markup, so the
 * name is the words rather than the tags around them.
 */
function firstLineOfEntry() {
    const line = messageText(editor.innerHTML)
        .replace(/\u200b/g, "")
        .split("\n")
        .map((part) => part.trim())
        .find((part) => part !== "");

    return (line ?? "").slice(0, 40);
}

function updateNameSubmit() {
    nameSubmit.disabled = nameInput.value.trim() === "";
}

function openNameDialog() {
    nameInput.value = firstLineOfEntry();
    updateNameSubmit();

    if (!nameDialog.open) nameDialog.showModal();

    /* The prefill is a suggestion, so typing replaces it and Enter accepts it. */
    nameInput.select();
}

savedSaveBtn.addEventListener("click", () => {
    setSavedMenuOpen(false);
    openNameDialog();
});

nameInput.addEventListener("input", updateNameSubmit);

nameCancel.addEventListener("click", () => {
    nameDialog.close();
});

nameForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = nameInput.value.trim().slice(0, savedNameLimit);

    if (name === "") return;

    const records = readSaved();

    records.push({
        id: newRecordId(),
        name,
        html: editor.innerHTML,
        savedAt: Date.now(),
    });

    if (writeSaved(records)) showNotice(`Saved "${name}".`);

    nameDialog.close();
});

closeOnBackdrop(nameDialog, () => {
    nameDialog.close();
});

/*
 * The dialog took the focus, and a save leaves the entry exactly as it was, so
 * the caret goes back to where it was rather than to the menu it came from.
 */
nameDialog.addEventListener("close", () => {
    editor.focus();
});
