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
const noticeActionDelay = 7000;
const noticeHideTransitionDelay = 260;

let noticeTimer = null;
let noticeFrame = null;
let noticePopoverTimer = null;

function openNoticePopover() {
    if (typeof notice.showPopover !== "function") return;

    try {
        if (notice.matches(":popover-open")) notice.hidePopover();
        notice.showPopover();
    } catch {
        /* Fallback to fixed positioning when popover promotion is unavailable. */
    }
}

function closeNoticePopover() {
    if (typeof notice.hidePopover !== "function") return;

    try {
        if (notice.matches(":popover-open")) notice.hidePopover();
    } catch {
        /* Already closed or unsupported. */
    }
}

function hideNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = null;
    clearTimeout(noticePopoverTimer);
    noticePopoverTimer = null;
    if (noticeFrame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(noticeFrame);
        noticeFrame = null;
    }
    notice.classList.remove("is-visible", "has-action");
    closeNoticePopover();
}

function showNotice(
    message,
    { tone = "status", actionLabel = "", onAction = null } = {},
) {
    const isError = tone === "error";
    const hasAction = Boolean(actionLabel && typeof onAction === "function");

    clearTimeout(noticeTimer);
    clearTimeout(noticePopoverTimer);
    noticePopoverTimer = null;
    if (noticeFrame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(noticeFrame);
        noticeFrame = null;
    }

    openNoticePopover();

    notice.setAttribute("role", isError ? "alert" : "status");
    notice.setAttribute("aria-live", isError ? "assertive" : "polite");
    notice.classList.toggle("is-error", isError);
    notice.classList.toggle("has-action", hasAction);
    notice.textContent = "";

    const commit = () => {
        noticeFrame = null;

        if (!hasAction) {
            notice.textContent = message;
        } else {
            const text = document.createElement("span");
            const button = document.createElement("button");

            text.className = "notice-text";
            text.textContent = message;

            button.type = "button";
            button.className = "notice-action";
            button.textContent = actionLabel;
            button.addEventListener("click", () => {
                hideNotice();
                onAction();
            });

            notice.replaceChildren(text, button);
        }

        notice.classList.add("is-visible");
    };

    if (typeof requestAnimationFrame === "function") {
        noticeFrame = requestAnimationFrame(commit);
    } else {
        commit();
    }

    noticeTimer = setTimeout(() => {
        noticeTimer = null;
        notice.classList.remove("is-visible", "has-action");
        noticePopoverTimer = setTimeout(() => {
            noticePopoverTimer = null;
            closeNoticePopover();
        }, noticeHideTransitionDelay);
    }, hasAction ? noticeActionDelay : noticeDelay);
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

    if (isEmptyContent(doc.body)) {
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

/*
 * The href a paste should turn a selection into, or an empty string. Only a
 * clipboard holding nothing but the link counts, so text that happens to
 * mention a URL still pastes as text. The href rules are the dialog's, since
 * a link pasted here and one typed into Ctrl K have to end up the same.
 */
function pastedLinkHref(dataTransfer) {
    const text = dataTransfer.getData("text/plain").trim();

    if (text !== "" && !/\s/.test(text)) {
        const href = normalizeHref(text);

        if (href && isAbsoluteHref(href)) return href;
    }

    const html = dataTransfer.getData("text/html");

    if (!html) return "";

    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = doc.body.querySelectorAll("a[href]");

    if (anchors.length !== 1) return "";

    /*
     * A page copy arrives as the anchor plus its text. Anything else around
     * it means the clipboard is more than a link, so it takes the ordinary
     * paste path instead.
     */
    if (doc.body.textContent.trim() !== anchors[0].textContent.trim()) {
        return "";
    }

    const href = normalizeHref(anchors[0].getAttribute("href") || "");

    return isAbsoluteHref(href) ? href : "";
}

/*
 * Selection text replaced by a link, which is what Ctrl K over the same
 * selection would produce. A selection already inside a link has its href
 * rewritten rather than a second anchor nested inside the first.
 */
function linkSelection(href, range) {
    const existing = linkInRange(range);

    if (existing) {
        existing.setAttribute("href", href);
        return true;
    }

    return document.execCommand("createLink", false, href);
}

function reportDropped(media, files) {
    const parts = [];

    if (media) parts.push(`${media} image${media === 1 ? "" : "s"}`);
    if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);

    if (parts.length === 0) return;

    showNotice(`${parts.join(" and ")} dropped: entries hold text only.`);
}

function isSelectionInPre() {
    const selection = window.getSelection();

    if (!selection.rangeCount) return false;

    const range = selection.getRangeAt(0);

    if (
        !editor.contains(range.startContainer) ||
        !editor.contains(range.endContainer)
    ) {
        return false;
    }

    const startPre = closestElement(range.startContainer)?.closest("pre");
    const endPre = closestElement(range.endContainer)?.closest("pre");

    return Boolean(startPre && startPre === endPre && editor.contains(startPre));
}

function insertPlainTextInPre(text) {
    const selection = window.getSelection();

    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) return;

    range.deleteContents();

    const textNode = document.createTextNode(text.replace(/\r\n?/g, "\n"));

    range.insertNode(textNode);
    range.setStart(textNode, textNode.data.length);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);

    queueSnapshot();
    render();
    updateToolbarState();
}

/*
 * One path for both ways content arrives, because a drop carries the same
 * DataTransfer a paste does. A drop used to reach the editor with no
 * sanitizer behind it at all: the browser inserted whatever was dragged, and
 * the editor then showed formatting the output could never carry.
 */
function insertClipboard(dataTransfer) {
    if (isSelectionInPre()) {
        const text = dataTransfer.getData("text/plain");

        if (text) {
            insertPlainTextInPre(text);
            return;
        }

        const html = dataTransfer.getData("text/html");

        if (html) {
            const doc = new DOMParser().parseFromString(html, "text/html");
            const dropped = doc.body.querySelectorAll(droppedMediaSelector).length;
            const plain = doc.body.textContent || "";

            if (plain) {
                insertPlainTextInPre(plain);
                reportDropped(dropped, 0);
                return;
            }

            reportDropped(dropped, dataTransfer.files ? dataTransfer.files.length : 0);
            return;
        }

        reportDropped(0, dataTransfer.files ? dataTransfer.files.length : 0);
        return;
    }

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
    const selection = window.getSelection();
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;

    /*
     * A URL pasted over selected text links it, the way Ctrl K does. Both
     * ends have to sit in the editor, or the command would rewrite whatever
     * selection the page happened to hold.
     */
    if (
        range &&
        !selection.isCollapsed &&
        !isSelectionInPre() &&
        editor.contains(range.startContainer) &&
        editor.contains(range.endContainer)
    ) {
        const href = pastedLinkHref(event.clipboardData);

        if (href) {
            event.preventDefault();
            flushSnapshot();

            /* A browser that refuses the command leaves the paste alone. */
            if (!linkSelection(href, range)) {
                insertClipboard(event.clipboardData);
                return;
            }

            queueSnapshot();
            render();
            updateToolbarState();
            return;
        }
    }

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
    editor.focus();

    const point = rangeFromPoint(event);

    if (point && editor.contains(point.startContainer)) {
        const selection = window.getSelection();

        selection.removeAllRanges();
        selection.addRange(point);
    } else {
        placeCaretAtEnd(editor);
    }

    insertClipboard(event.dataTransfer);
});
