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

let renamingRecordId = null;

function findSavedByName(records, name, excludeId = null) {
    const needle = name.trim().toLowerCase();

    if (needle === "") return null;

    return (
        records.find(
            (entry) =>
                entry.id !== excludeId &&
                entry.name.trim().toLowerCase() === needle,
        ) ?? null
    );
}

function updateNameSubmit() {
    const name = nameInput.value.trim();

    nameSubmit.disabled = name === "";

    if (renamingRecordId) {
        nameDuplicateRow.hidden = true;
        nameOverwrite.checked = false;
        nameSubmit.textContent = "Rename";
        return;
    }

    const duplicate = findSavedByName(readSaved(), name);

    nameDuplicateRow.hidden = !duplicate;
    if (!duplicate) nameOverwrite.checked = false;

    nameSubmit.textContent =
        duplicate && nameOverwrite.checked ? "Overwrite" : "Save";
}

function openNameDialog() {
    renamingRecordId = null;
    nameDialogTitle.textContent = "Save message";
    nameOverwrite.checked = false;
    nameInput.value = firstLineOfEntry();
    updateNameSubmit();

    if (!nameDialog.open) nameDialog.showModal();

    /* The prefill is a suggestion, so typing replaces it and Enter accepts it. */
    nameInput.select();
}

function openRenameDialog(record) {
    renamingRecordId = record.id;
    nameDialogTitle.textContent = "Rename message";
    nameOverwrite.checked = false;
    nameInput.value = record.name;
    updateNameSubmit();

    if (!nameDialog.open) nameDialog.showModal();

    nameInput.select();
}

savedSaveBtn.addEventListener("click", () => {
    setSavedMenuOpen(false);
    openNameDialog();
});

nameInput.addEventListener("input", updateNameSubmit);
nameOverwrite.addEventListener("change", updateNameSubmit);

nameCancel.addEventListener("click", () => {
    nameDialog.close();
});

nameForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = nameInput.value.trim().slice(0, savedNameLimit);

    if (name === "") return;

    const records = readSaved();

    if (renamingRecordId) {
        const index = records.findIndex(
            (entry) => entry.id === renamingRecordId,
        );

        if (index !== -1) {
            records[index] = { ...records[index], name };
            if (writeSaved(records)) showNotice(`Renamed to "${name}".`);
        }

        nameDialog.close();
        return;
    }

    const duplicate = findSavedByName(records, name);

    if (duplicate && nameOverwrite.checked) {
        const index = records.findIndex((entry) => entry.id === duplicate.id);
        const previous = { ...records[index] };

        records[index] = {
            ...previous,
            name,
            html: editor.innerHTML,
            savedAt: Date.now(),
        };

        if (writeSaved(records)) {
            showNotice(`Updated "${name}".`, {
                actionLabel: "Undo",
                onAction: () => {
                    const current = readSaved();
                    const target = current.findIndex(
                        (entry) => entry.id === previous.id,
                    );

                    if (target === -1) return;

                    current[target] = previous;
                    if (writeSaved(current)) {
                        if (!savedMenu.hidden) renderSavedMenu();
                        showNotice(`Reverted "${previous.name}".`);
                    }
                },
            });
        }

        nameDialog.close();
        return;
    }

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
    renamingRecordId = null;
    nameOverwrite.checked = false;
    nameDuplicateRow.hidden = true;
    editor.focus();
});
