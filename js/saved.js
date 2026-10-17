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
const savedKey = "jff.saved.v1";
const savedNameLimit = 120;
const savedPreviewLimit = 90;

function newRecordId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/*
 * One shape check for a stored row and an imported one. localStorage is the
 * user's to edit and a file is theirs to write, so a row either matches or is
 * dropped: nothing here repairs half a record into one.
 */
function savedRecord(value) {
    if (!value || typeof value !== "object") return null;

    const name = typeof value.name === "string" ? value.name.trim() : "";
    const html = typeof value.html === "string" ? value.html.trim() : "";

    if (name === "" || html === "") return null;

    return {
        id:
            typeof value.id === "string" && value.id !== ""
                ? value.id
                : newRecordId(),
        name: name.slice(0, savedNameLimit),
        html,
        savedAt: Number.isFinite(value.savedAt) ? value.savedAt : Date.now(),
    };
}

function readSaved() {
    const raw = readStoredEntry(savedKey);

    if (!raw) return [];

    let parsed = null;

    try {
        parsed = JSON.parse(raw);
    } catch {
        /* A store someone edited into nonsense reads as empty. */
        return [];
    }

    if (!Array.isArray(parsed)) return [];

    return parsed.map(savedRecord).filter(Boolean);
}

/* Reports a refusal rather than letting a save disappear quietly. */
function writeSaved(records) {
    if (!storageAvailable()) {
        showNotice("This browser refuses to store saved messages.");
        return false;
    }

    try {
        window.localStorage.setItem(savedKey, JSON.stringify(records));

        return true;
    } catch {
        showNotice("Saved messages could not be written: the store is full.");

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

function messageText(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    for (const element of doc.body.querySelectorAll(messageBreakSelector)) {
        element.after("\n");
    }

    return doc.body.textContent;
}

/*
 * The row's second line: the message's words flattened onto one line, so two
 * messages that ended up with the same name are still told apart.
 */
function savedPreview(html) {
    const text = messageText(html).replace(/\s+/g, " ").trim();

    return text.length > savedPreviewLimit
        ? `${text.slice(0, savedPreviewLimit).trimEnd()}…`
        : text;
}

function savedRow(record) {
    const item = document.createElement("li");
    const insert = document.createElement("button");
    const name = document.createElement("span");
    const preview = document.createElement("span");
    const remove = document.createElement("button");

    item.className = "saved-item";

    insert.type = "button";
    insert.className = "saved-insert";
    insert.dataset.id = record.id;

    name.className = "saved-name";
    name.textContent = record.name;

    preview.className = "saved-preview";
    preview.textContent = savedPreview(record.html);

    insert.append(name, preview);

    remove.type = "button";
    remove.className = "saved-delete";
    remove.dataset.id = record.id;
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `Delete "${record.name}"`);

    item.append(insert, remove);

    return item;
}

function renderSavedMenu() {
    const records = readSaved();

    savedEmpty.hidden = records.length > 0;
    savedList.replaceChildren(...records.map(savedRow));
    savedSaveBtn.disabled = editorIsEmpty();
}

function setSavedMenuOpen(open, focusFirst = false) {
    if (open) renderSavedMenu();

    savedMenu.hidden = !open;
    savedToggle.setAttribute("aria-expanded", String(open));

    if (open && focusFirst) {
        (savedList.querySelector(".saved-insert") ?? savedSaveBtn).focus();
    }
}

/*
 * The press is kept from moving focus, so the caret a row will insert at is
 * still there when the menu is open.
 */
savedToggle.addEventListener("mousedown", (event) => {
    event.preventDefault();
});

savedToggle.addEventListener("click", (event) => {
    setSavedMenuOpen(savedMenu.hidden, event.detail === 0);
});

/* Tab moves on rather than staying in a menu that no longer has the point. */
savedMenu.addEventListener("keydown", (event) => {
    if (event.key === "Tab") setSavedMenuOpen(false);
});

/* A row is a press target, and the press must leave the caret alone. */
savedList.addEventListener("mousedown", (event) => {
    if (event.target.closest(".saved-insert")) event.preventDefault();
});

savedList.addEventListener("click", (event) => {
    const insert = event.target.closest(".saved-insert");

    if (insert) {
        insertSavedMessage(insert.dataset.id);
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
        showNotice(`"${record.name}" holds nothing to insert.`);
        return;
    }

    /*
     * A saved message replaces the entry, not the caret's surroundings: the
     * field is emptied and the message becomes the whole of it. The change
     * goes through the undo stack like any other, so it is recoverable.
     */
    flushSnapshot();
    editor.innerHTML = html;
    commitSnapshot();

    render();
    updateToolbarState();
    editor.focus();
}

function deleteSavedMessage(id) {
    const records = readSaved();
    const record = records.find((entry) => entry.id === id);

    if (!record) return;

    if (!writeSaved(records.filter((entry) => entry.id !== id))) return;

    renderSavedMenu();
    showNotice(`Deleted "${record.name}".`);

    /* The row that held the focus is gone with it. */
    if (!savedMenu.hidden && document.activeElement === document.body) {
        (savedList.querySelector(".saved-insert") ?? savedSaveBtn).focus();
    }
}
