/* Saved messages.
   Split out of app.js, lines 3911-4151. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Saved messages ---------- */

/*
 * A saved message is the editor's HTML as it stood, not the serialized
 * markup: it goes back in through the same paste rules, so a message is held
 * to the rules a paste is held to whether or not it came from one. The store
 * is a plain JSON array, which makes an export something a person can read and
 * an import the same file back.
 */
const savedNameLimit = 120;
const savedPreviewLimit = 90;

function newRecordId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stableRecordId(name, html, index) {
    let hash = 2166136261;
    const input = `${index}\0${name}\0${html}`;

    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return `saved-${index}-${(hash >>> 0).toString(36)}`;
}

/*
 * One shape check for a stored row and an imported one. localStorage is the
 * user's to edit and a file is theirs to write, so a row either matches or is
 * dropped: nothing here repairs half a record into one.
 */
function savedRecord(value, index = 0) {
    if (!value || typeof value !== "object") return null;

    const name = typeof value.name === "string" ? value.name.trim() : "";
    const html = typeof value.html === "string" ? value.html.trim() : "";

    if (name === "" || html === "") return null;

    const hasId = typeof value.id === "string" && value.id !== "";

    return {
        id: hasId ? value.id : stableRecordId(name, html, index),
        name: name.slice(0, savedNameLimit),
        html,
        savedAt: Number.isFinite(value.savedAt) ? value.savedAt : Date.now(),
    };
}

function readSaved() {
    const raw = readStoredEntry(storageKeys.savedMessages);

    if (!raw) return [];

    let parsed = null;

    try {
        parsed = JSON.parse(raw);
    } catch {
        /* A store someone edited into nonsense reads as empty. */
        return [];
    }

    if (!Array.isArray(parsed)) return [];

    let hadMissingId = false;
    const records = [];

    parsed.forEach((entry, index) => {
        const record = savedRecord(entry, index);

        if (!record) return;

        if (!entry || typeof entry.id !== "string" || entry.id === "") {
            hadMissingId = true;
        }

        records.push(record);
    });

    if (hadMissingId && storageAvailable()) {
        try {
            window.localStorage.setItem(
                storageKeys.savedMessages,
                JSON.stringify(records),
            );
        } catch {
            /* Stable IDs still match across reads when storage is read-only. */
        }
    }

    return records;
}

/* Reports a refusal rather than letting a save disappear quietly. */
function writeSaved(records) {
    if (!storageAvailable()) {
        showNotice("This browser refuses to store saved messages.", {
            tone: "error",
        });
        return false;
    }

    try {
        window.localStorage.setItem(
            storageKeys.savedMessages,
            JSON.stringify(records),
        );

        updateSavedToggleState(records.length);

        return true;
    } catch {
        showNotice("Saved messages could not be written: the store is full.", {
            tone: "error",
        });

        return false;
    }
}

/*
 * The message's words with a break wherever the markup has one. Text content
 * alone runs blocks together - a heading and the paragraph under it come out
 * as one word - so a break is closed over every block boundary first. It reads
 * a line break as a break too, since that is what the editor means by one.
 */
const messageBreakSelector = `${blockSelector}, br`;
const droppedTagsSelector = [...droppedTags].join(", ");

function messageText(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    for (const element of doc.body.querySelectorAll(droppedTagsSelector)) {
        element.remove();
    }

    for (const element of doc.body.querySelectorAll(messageBreakSelector)) {
        element.after("\n");
    }

    return doc.body.textContent;
}

function savedPreviewFromText(text) {
    return text.length > savedPreviewLimit
        ? `${text.slice(0, savedPreviewLimit).trimEnd()}…`
        : text;
}

function savedPlainText(html) {
    return messageText(html).replace(/\s+/g, " ").trim();
}

/*
 * The row's second line: the message's words flattened onto one line, so two
 * messages that ended up with the same name are still told apart.
 */
function savedPreview(html) {
    return savedPreviewFromText(savedPlainText(html));
}

const savedSearchThreshold = 5;
let renderingSavedMenu = false;

function savedRow(record, entryEmpty, previewText = savedPreview(record.html)) {
    const item = document.createElement("li");
    const insert = document.createElement("button");
    const name = document.createElement("span");
    const preview = document.createElement("span");
    const controls = document.createElement("div");
    const insertAtCaret = document.createElement("button");
    const rename = document.createElement("button");
    const update = document.createElement("button");
    const remove = document.createElement("button");

    item.className = "saved-item";

    insert.type = "button";
    insert.className = "saved-insert";
    insert.dataset.id = record.id;
    insert.title = `Replace current entry with "${record.name}"`;

    name.className = "saved-name";
    name.textContent = record.name;

    preview.className = "saved-preview";
    preview.textContent = previewText;

    insert.append(name, preview);

    controls.className = "saved-row-controls";

    insertAtCaret.type = "button";
    insertAtCaret.className = "saved-row-btn saved-caret-insert";
    insertAtCaret.dataset.id = record.id;
    insertAtCaret.textContent = "+";
    insertAtCaret.setAttribute("aria-label", `Insert "${record.name}" at cursor`);
    insertAtCaret.title = "Insert at cursor";

    rename.type = "button";
    rename.className = "saved-row-btn saved-rename";
    rename.dataset.id = record.id;
    rename.textContent = "✎";
    rename.setAttribute("aria-label", `Rename "${record.name}"`);
    rename.title = "Rename";

    update.type = "button";
    update.className = "saved-row-btn saved-update";
    update.dataset.id = record.id;
    update.textContent = "↻";
    update.disabled = entryEmpty;
    update.setAttribute(
        "aria-label",
        `Update "${record.name}" with current entry`,
    );
    update.title = "Update with current entry";

    remove.type = "button";
    remove.className = "saved-row-btn saved-delete";
    remove.dataset.id = record.id;
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `Delete "${record.name}"`);
    remove.title = "Delete";

    controls.append(insertAtCaret, rename, update, remove);
    item.append(insert, controls);

    return item;
}

function renderSavedMenu() {
    const active = document.activeElement;
    const wasInList = savedList.contains(active);
    const activeId = wasInList ? active?.dataset?.id ?? null : null;
    const activeAction = wasInList
        ? [
              "saved-insert",
              "saved-caret-insert",
              "saved-rename",
              "saved-update",
              "saved-delete",
          ].find((cls) => active.classList.contains(cls))
        : null;
    const activeItem = wasInList ? active?.closest?.(".saved-item") : null;
    const activeIndex = activeItem
        ? [...savedList.children].indexOf(activeItem)
        : -1;

    renderingSavedMenu = true;

    try {
        const records = readSaved();
        const showSearch = records.length >= savedSearchThreshold;

        savedSearchRow.hidden = !showSearch;
        if (!showSearch) savedSearch.value = "";

        const query = showSearch ? savedSearch.value.trim().toLowerCase() : "";
        const entries = records.map((record) => {
            const text = savedPlainText(record.html);

            return {
                record,
                text,
                preview: savedPreviewFromText(text),
            };
        });
        const filtered = query
            ? entries.filter(
                  ({ record, text }) =>
                      record.name.toLowerCase().includes(query) ||
                      text.toLowerCase().includes(query),
              )
            : entries;

        const entryEmpty = editorIsEmpty();

        if (records.length === 0) {
            savedEmpty.textContent = "No saved messages yet. Save one.";
            savedEmpty.hidden = false;
        } else if (filtered.length === 0) {
            savedEmpty.textContent = "No matching saved messages.";
            savedEmpty.hidden = false;
        } else {
            savedEmpty.hidden = true;
        }

        savedList.replaceChildren(
            ...filtered.map(({ record, preview }) =>
                savedRow(record, entryEmpty, preview),
            ),
        );
        savedSaveBtn.disabled = entryEmpty;

        if (wasInList && !savedMenu.hidden) {
            let nextFocus = null;

            if (activeId && activeAction) {
                nextFocus =
                    [...savedList.querySelectorAll(`.${activeAction}`)].find(
                        (button) => button.dataset.id === activeId,
                    ) ?? null;
            }

            if (!nextFocus && activeIndex >= 0) {
                const items = savedList.querySelectorAll(".saved-insert");

                nextFocus =
                    items[Math.min(activeIndex, items.length - 1)] ?? null;
            }

            if (!nextFocus) {
                nextFocus =
                    savedList.querySelector(".saved-insert") ??
                    (!savedSaveBtn.disabled ? savedSaveBtn : null) ??
                    (!savedSearchRow.hidden ? savedSearch : null) ??
                    (!savedToggle.disabled ? savedToggle : null);
            }

            if (nextFocus) nextFocus.focus();
        }
    } finally {
        renderingSavedMenu = false;
    }
}

function updateSavedToggleState(savedCount = readSaved().length) {
    const disabled = editorIsEmpty() && savedCount === 0;

    savedToggle.disabled = disabled;

    if (disabled && !savedMenu.hidden) {
        setSavedMenuOpen(false);
    }
}

function setSavedMenuOpen(open, focusFirst = false) {
    if (open && savedToggle.disabled) return;

    if (open) {
        savedSearch.value = "";
        renderSavedMenu();
    }

    savedMenu.hidden = !open;
    savedToggle.setAttribute("aria-expanded", String(open));

    if (open && focusFirst) {
        if (!savedSearchRow.hidden) {
            savedSearch.focus();
        } else {
            (savedList.querySelector(".saved-insert") ?? savedSaveBtn).focus();
        }
    }
}

savedSearch.addEventListener("input", () => {
    renderSavedMenu();
});

/*
 * The press is kept from moving focus, so the caret a row will insert at is
 * still there when the menu is open.
 */
savedToggle.addEventListener("mousedown", (event) => {
    if (event.button === 0) event.preventDefault();
});

savedToggle.addEventListener("click", (event) => {
    setSavedMenuOpen(savedMenu.hidden, event.detail === 0);
});

/* Arrow keys move across saved rows (and Save current); Tab moves freely across controls. */
savedMenu.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const step = event.key === "ArrowDown" ? 1 : -1;
    const rows = [
        ...savedList.querySelectorAll(".saved-insert"),
        ...(savedSaveBtn.disabled ? [] : [savedSaveBtn]),
    ];

    if (!rows.length) return;

    event.preventDefault();

    const active = document.activeElement;
    const currentRow =
        active?.closest?.(".saved-item")?.querySelector(".saved-insert") ??
        active;
    const index = rows.indexOf(currentRow);
    const next =
        index === -1
            ? step > 0
                ? rows[0]
                : rows[rows.length - 1]
            : rows[(index + step + rows.length) % rows.length];

    next.focus();
});

if (savedDropdown) {
    savedDropdown.addEventListener("focusout", (event) => {
        if (savedMenu.hidden || renderingSavedMenu) return;

        if (
            event.relatedTarget &&
            savedDropdown.contains(event.relatedTarget)
        ) {
            return;
        }

        setSavedMenuOpen(false);
    });
}

/* Clicking empty padding inside the menu should not blur search and close it. */
savedMenu.addEventListener("mousedown", (event) => {
    if (event.button === 0 && !event.target.closest("input, button")) {
        event.preventDefault();
    }
});

/* A row is a press target, and the press must leave the caret alone. */
savedList.addEventListener("mousedown", (event) => {
    if (
        event.button === 0 &&
        event.target.closest(".saved-insert, .saved-caret-insert")
    ) {
        event.preventDefault();
    }
});

savedList.addEventListener("click", (event) => {
    const insert = event.target.closest(".saved-insert");

    if (insert) {
        insertSavedMessage(insert.dataset.id);
        return;
    }

    const caretInsert = event.target.closest(".saved-caret-insert");

    if (caretInsert) {
        insertSavedAtCaret(caretInsert.dataset.id);
        return;
    }

    const rename = event.target.closest(".saved-rename");

    if (rename) {
        renameSavedMessage(rename.dataset.id);
        return;
    }

    const update = event.target.closest(".saved-update");

    if (update) {
        updateSavedMessage(update.dataset.id);
        return;
    }

    const remove = event.target.closest(".saved-delete");

    if (remove) deleteSavedMessage(remove.dataset.id);
});

function insertSavedMessage(id) {
    const record = readSaved().find((entry) => entry.id === id);

    if (!record) return;

    setSavedMenuOpen(false);

    const { html } = sanitizeEntryHtml(record.html);

    if (html === "") {
        showNotice(`"${record.name}" holds nothing to insert.`, {
            tone: "error",
        });
        return;
    }

    /*
     * A saved message replaces the entry, not the caret's surroundings: the
     * field is emptied and the message becomes the whole of it. The change
     * goes through the undo stack like any other, so it is recoverable.
     */
    flushSnapshot();
    editor.innerHTML = html;
    lastEditorCaret = null;
    commitSnapshot();

    render();
    updateToolbarState();
    editor.focus();
    showNotice(`Loaded "${record.name}", ${undoShortcutLabel()} to undo.`);
}

function insertSavedAtCaret(id) {
    const record = readSaved().find((entry) => entry.id === id);

    if (!record) return;

    setSavedMenuOpen(false);

    const { html } = sanitizeEntryHtml(record.html);

    if (html === "") {
        showNotice(`"${record.name}" holds nothing to insert.`, {
            tone: "error",
        });
        return;
    }

    flushSnapshot();
    editor.focus();

    const selection = window.getSelection();
    const inEditor =
        selection.rangeCount > 0 &&
        editor.contains(selection.getRangeAt(0).commonAncestorContainer);

    if (!inEditor) {
        if (!applyCaret(lastEditorCaret)) {
            placeCaretAtEnd(editor);
        }
    }

    insertHtmlAtCursor(html);
    commitSnapshot();
    showNotice(`Inserted "${record.name}".`);
}

function renameSavedMessage(id) {
    const record = readSaved().find((entry) => entry.id === id);

    if (!record) return;

    setSavedMenuOpen(false);
    openRenameDialog(record);
}

function updateSavedMessage(id) {
    if (editorIsEmpty()) return;

    const records = readSaved();
    const index = records.findIndex((entry) => entry.id === id);

    if (index === -1) return;

    const previous = { ...records[index] };

    records[index] = {
        ...previous,
        html: editor.innerHTML,
        savedAt: Date.now(),
    };

    if (!writeSaved(records)) return;

    renderSavedMenu();
    showNotice(`Updated "${previous.name}".`, {
        actionLabel: "Undo",
        onAction: () => {
            const current = readSaved();
            const target = current.findIndex((entry) => entry.id === previous.id);

            if (target === -1) return;

            current[target] = previous;
            if (writeSaved(current)) {
                if (!savedMenu.hidden) renderSavedMenu();
                showNotice(`Reverted "${previous.name}".`);
            }
        },
    });
}

function restoreDeletedSaved(record, index) {
    const records = readSaved();

    if (records.some((entry) => entry.id === record.id)) return;

    const at = Math.min(Math.max(index, 0), records.length);

    records.splice(at, 0, record);

    if (!writeSaved(records)) return;

    if (!savedMenu.hidden) renderSavedMenu();
    showNotice(`Restored "${record.name}".`);
}

function deleteSavedMessage(id) {
    const records = readSaved();
    const index = records.findIndex((entry) => entry.id === id);

    if (index === -1) return;

    const record = records[index];

    if (!writeSaved(records.filter((entry) => entry.id !== id))) return;

    renderSavedMenu();
    showNotice(`Deleted "${record.name}".`, {
        actionLabel: "Undo",
        onAction: () => restoreDeletedSaved(record, index),
    });

    /* The row that held the focus is gone with it. */
    if (!savedMenu.hidden && document.activeElement === document.body) {
        (savedList.querySelector(".saved-insert") ?? savedSaveBtn).focus();
    }
}
