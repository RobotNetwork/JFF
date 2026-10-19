/* Element references, custom undo/redo history, caret and DOM helpers.
   Split out of app.js, lines 1-280. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

const editor = document.getElementById("editor");
const mirror = document.getElementById("mirror");
const mirrorBody = document.getElementById("mirrorBody");
const journalTime = document.getElementById("journalTime");
const previewDialog = document.getElementById("previewDialog");
const previewBtn = document.getElementById("previewBtn");
const toolbarCopyBtn = document.getElementById("toolbarCopyBtn");
const toolbar = document.getElementById("toolbar");
const notice = document.getElementById("notice");
const saveState = document.getElementById("saveState");
const headingToggle = document.getElementById("headingToggle");
const headingMenu = document.getElementById("headingMenu");
const linkDialog = document.getElementById("linkDialog");
const linkForm = document.getElementById("linkForm");
const linkUrl = document.getElementById("linkUrl");
const linkText = document.getElementById("linkText");
const linkTextRow = document.getElementById("linkTextRow");
const linkError = document.getElementById("linkError");
const linkCancel = document.getElementById("linkCancel");
const linkRemove = document.getElementById("linkRemove");
const shortcutList = document.getElementById("shortcutList");
const savedDropdown = document.getElementById("savedDropdown");
const savedToggle = document.getElementById("savedToggle");
const savedMenu = document.getElementById("savedMenu");
const savedEmpty = document.getElementById("savedEmpty");
const savedList = document.getElementById("savedList");
const savedSaveBtn = document.getElementById("savedSaveBtn");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const importFile = document.getElementById("importFile");
const nameDialog = document.getElementById("nameDialog");
const nameForm = document.getElementById("nameForm");
const nameInput = document.getElementById("nameInput");
const nameCancel = document.getElementById("nameCancel");
const nameSubmit = document.getElementById("nameSubmit");
const settingsBtn = document.getElementById("settingsBtn");
const settingsDialog = document.getElementById("settingsDialog");
const settingsNav = document.getElementById("settingsNav");
const settingsClose = document.getElementById("settingsClose");
const accentInput = document.getElementById("accentInput");
const clearAfterCopyInput = document.getElementById("clearAfterCopyInput");

/*
 * The toolbar's Copy button is the one copy control. render() disables it
 * while the entry holds nothing to copy.
 */
const copyButtons = [toolbarCopyBtn];

/*
 * Whether the preview is on screen. It is the one thing that decides whether
 * the field is rendered at all: it is closed until it is asked for, and a
 * closed dialog is not what the entry is written into.
 */
let previewOpen = false;

/* ---------- Custom undo/redo history ---------- */

const snapshotLimit = 100;
const snapshotDebounce = 300;

let undoStack = [];
let undoIndex = -1;
let undoTimer = null;

/*
 * The caret the toolbar last read. A press can clear a selection the browser
 * has nowhere to paint, such as a caret inside an empty inline code span, and
 * the press then has to put it back before the command runs.
 */
let lastEditorCaret = null;

function flushSnapshot() {
    if (!undoTimer) return;

    clearTimeout(undoTimer);
    undoTimer = null;
    commitSnapshot();
}

function commitSnapshot() {
    const html = editor.innerHTML;

    if (undoStack[undoIndex] && undoStack[undoIndex].html === html) {
        return;
    }

    undoStack = undoStack.slice(0, undoIndex + 1);
    undoStack.push({ html, caret: captureCaret() });

    if (undoStack.length > snapshotLimit) {
        undoStack.shift();
    }

    undoIndex = undoStack.length - 1;
}

function queueSnapshot() {
    clearTimeout(undoTimer);

    undoTimer = setTimeout(() => {
        undoTimer = null;
        commitSnapshot();
    }, snapshotDebounce);
}

/*
 * Steps are relative because a pending snapshot is committed first, which
 * appends an entry and moves undoIndex.
 */
function restore(step) {
    flushSnapshot();

    const index = undoIndex + step;

    if (index < 0 || index >= undoStack.length) return;

    undoIndex = index;
    editor.innerHTML = undoStack[index].html;

    if (!applyCaret(undoStack[index].caret)) {
        placeCaretAtEnd(editor);
    }

    render();
    updateToolbarState();
}

function nodeOffset(node) {
    return node.nodeType === Node.TEXT_NODE
        ? node.data.length
        : node.childNodes.length;
}

function nodePath(node) {
    const path = [];

    while (node && node !== editor) {
        path.unshift([...node.parentNode.childNodes].indexOf(node));
        node = node.parentNode;
    }

    return path;
}

function nodeAtPath(path) {
    let node = editor;

    for (const index of path) {
        node = node.childNodes[index];

        if (!node) return null;
    }

    return node;
}

function captureCaret() {
    const selection = window.getSelection();

    if (!selection.rangeCount) return null;

    const range = selection.getRangeAt(0);

    if (
        !editor.contains(range.startContainer) ||
        !editor.contains(range.endContainer)
    ) {
        return null;
    }

    return {
        start: nodePath(range.startContainer),
        startOffset: range.startOffset,
        end: nodePath(range.endContainer),
        endOffset: range.endOffset,
    };
}

function applyCaret(caret) {
    if (!caret) return false;

    const start = nodeAtPath(caret.start);
    const end = nodeAtPath(caret.end);

    if (!start || !end) return false;

    const range = document.createRange();

    try {
        range.setStart(
            start,
            Math.min(caret.startOffset, nodeOffset(start)),
        );
        range.setEnd(end, Math.min(caret.endOffset, nodeOffset(end)));
    } catch {
        return false;
    }

    const selection = window.getSelection();

    selection.removeAllRanges();
    selection.addRange(range);

    return true;
}

/* ---------- General DOM helpers ---------- */

function closestElement(node) {
    if (!node) return null;

    return node.nodeType === Node.ELEMENT_NODE
        ? node
        : node.parentElement;
}

function getSelectedElement() {
    const selection = window.getSelection();

    if (!selection.rangeCount) return null;

    const element = closestElement(selection.anchorNode);

    if (!element || !editor.contains(element)) {
        return null;
    }

    return element;
}

function placeCaret(element) {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
}

function placeCaretAtEnd(element) {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);
}

function insertHtmlAtCursor(html) {
    const selection = window.getSelection();

    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    /*
     * The toolbar keeps the selection alive with preventDefault, so it can
     * still sit outside the editor. Editing it would delete unrelated page
     * content and insert markup that is never serialized.
     */
    if (!editor.contains(range.commonAncestorContainer)) return;

    range.deleteContents();

    const fragment = range.createContextualFragment(html);
    const lastNode = fragment.lastChild;

    range.insertNode(fragment);

    if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);

        selection.removeAllRanges();
        selection.addRange(range);
    }

    queueSnapshot();
    render();
    updateToolbarState();
}
