/* Paste and drop handling.
   Split out of app.js, lines 3348-3549. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Paste and drop ---------- */

/*
 * Elements whose content the editor cannot hold. They are removed rather than
 * unwrapped, so they leave nothing behind to notice afterwards, which is why
 * a paste that was only a screenshot has to be reported as it happens.
 */
const droppedMediaSelector =
    "img, svg, iframe, video, audio, canvas, object, embed";

const noticeDelay = 5000;

let noticeTimer = null;

function showNotice(message) {
    clearTimeout(noticeTimer);

    notice.textContent = message;
    notice.classList.add("is-visible");

    noticeTimer = setTimeout(() => {
        noticeTimer = null;
        notice.classList.remove("is-visible");
    }, noticeDelay);
}

/*
 * Rich HTML held to the paste rules and returned as editor content. Reports
 * how much of it held a picture, and whether anything was left: clipboard HTML
 * can carry structure but no content - a lone <meta> tag, or an image the
 * sanitizer drops, which is the payload a screenshot paste arrives as.
 */
function sanitizeEntryHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    /* Counted before sanitizing, which removes these elements outright. */
    const dropped = doc.body.querySelectorAll(droppedMediaSelector).length;

    /*
     * Clipboard metadata varies between editors and versions, and every
     * editor that is not a Microsoft one still carries formatting as inline
     * styles, so the whole path runs for all rich HTML.
     */
    normalizeInlineStyles(doc);

    sanitizeRichText(doc);

    wrapOrphanListItems(doc.body);

    normalizeRichTextWhitespace(doc.body);

    if (doc.body.textContent.trim() === "") {
        return { html: "", dropped };
    }

    return { html: doc.body.innerHTML, dropped };
}

/*
 * Rich clipboard HTML inserted at the caret. Reports how much of it held a
 * picture, and whether anything was left to insert.
 */
function insertRichText(html) {
    const { html: clean, dropped } = sanitizeEntryHtml(html);

    if (clean === "") return { inserted: false, dropped };

    insertHtmlAtCursor(clean);

    return { inserted: true, dropped };
}

function reportDropped(media, files) {
    const parts = [];

    if (media) parts.push(`${media} image${media === 1 ? "" : "s"}`);
    if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);

    if (parts.length === 0) return;

    showNotice(`${parts.join(" and ")} dropped: entries hold text only.`);
}

/*
 * One path for both ways content arrives, because a drop carries the same
 * DataTransfer a paste does. A drop used to reach the editor with no
 * sanitizer behind it at all: the browser inserted whatever was dragged, and
 * the editor then showed formatting the output could never carry.
 */
function insertClipboard(dataTransfer) {
    const html = dataTransfer.getData("text/html");
    let dropped = 0;

    if (html) {
        const result = insertRichText(html);

        dropped = result.dropped;

        if (result.inserted) {
            normalizeCodeBlocks(editor);
            reportDropped(dropped, 0);
            return;
        }
    }

    const text = dataTransfer.getData("text/plain");

    if (text) {
        if (looksLikeMarkdown(text)) {
            insertHtmlAtCursor(markdownToHtml(text));
        } else {
            insertHtmlAtCursor(escapeHtml(text).replace(/\r?\n/g, "<br>"));
        }

        normalizeCodeBlocks(editor);
        reportDropped(dropped, 0);
        return;
    }

    /* Nothing to insert, so what was dropped is all there is to report. */
    reportDropped(dropped, dataTransfer.files ? dataTransfer.files.length : 0);
}

editor.addEventListener("paste", (event) => {
    event.preventDefault();
    flushSnapshot();

    insertClipboard(event.clipboardData);
});

/* ---------- Drop handling ---------- */

/*
 * Dragging a selection inside the editor raises dragstart here. That drag is
 * the browser's own move, and it has to keep its default or the text would be
 * copied to the drop point instead of moved.
 */
let draggingWithinEditor = false;

editor.addEventListener("dragstart", () => {
    draggingWithinEditor = true;
});

editor.addEventListener("dragend", () => {
    draggingWithinEditor = false;
});

function draggableContent(dataTransfer) {
    if (draggingWithinEditor || !dataTransfer) return false;

    /* getData is empty during a drag, so the types are what says a drop is
       worth taking. */
    return dataTransfer.types.length > 0 || dataTransfer.files.length > 0;
}

/*
 * The caret the browser is showing at the drop point. A drop does not move
 * the selection on its own, and the insert has to land where the pointer is
 * rather than wherever the caret was left.
 */
function rangeFromPoint(event) {
    const position = document.caretPositionFromPoint
        ? document.caretPositionFromPoint(event.clientX, event.clientY)
        : null;

    if (position) {
        const range = document.createRange();

        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);

        return range;
    }

    return document.caretRangeFromPoint
        ? document.caretRangeFromPoint(event.clientX, event.clientY)
        : null;
}

editor.addEventListener("dragover", (event) => {
    /* Without this the browser refuses the drop and inserts nothing. */
    if (draggableContent(event.dataTransfer)) event.preventDefault();
});

editor.addEventListener("drop", (event) => {
    if (!draggableContent(event.dataTransfer)) return;

    event.preventDefault();
    flushSnapshot();

    const point = rangeFromPoint(event);

    if (point && editor.contains(point.startContainer)) {
        const selection = window.getSelection();

        selection.removeAllRanges();
        selection.addRange(point);
    }

    insertClipboard(event.dataTransfer);
});
