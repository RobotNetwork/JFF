/* Element references, custom undo/redo history, caret and DOM helpers.
   Split out of app.js, lines 1-280. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

const editor = document.getElementById("editor");
const mirror = document.getElementById("mirror");
const mirrorBody = document.getElementById("mirrorBody");
const journalEntry = document.getElementById("journalEntry");
const journalField = document.getElementById("journalField");
const journalTime = document.getElementById("journalTime");
const journalAccent = document.getElementById("journalAccent");
const previewDialog = document.getElementById("previewDialog");
const previewBox = previewDialog.querySelector(".preview-box");
const previewTabs = document.getElementById("previewTabs");
const previewRaw = document.getElementById("previewRaw");
const previewCopy = document.getElementById("previewCopy");
const previewClose = document.getElementById("previewClose");
const previewBtn = document.getElementById("previewBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const toolbar = document.getElementById("toolbar");
const editorActions = document.getElementById("editorActions");
const notice = document.getElementById("notice");
const saveState = document.getElementById("saveState");
const headingToggle = document.getElementById("headingToggle");
const headingMenu = document.getElementById("headingMenu");
const linkDialog = document.getElementById("linkDialog");
const linkDialogTitle = document.getElementById("linkDialogTitle");
const linkForm = document.getElementById("linkForm");
const linkUrl = document.getElementById("linkUrl");
const linkText = document.getElementById("linkText");
const linkTextRow = document.getElementById("linkTextRow");
const linkError = document.getElementById("linkError");
const linkCancel = document.getElementById("linkCancel");
const linkRemove = document.getElementById("linkRemove");
const linkSubmit = document.getElementById("linkSubmit");
const shortcutList = document.getElementById("shortcutList");
const gestureList = document.getElementById("gestureList");
const savedDropdown = document.getElementById("savedDropdown");
const savedToggle = document.getElementById("savedToggle");
const savedMenu = document.getElementById("savedMenu");
const savedSearchRow = document.getElementById("savedSearchRow");
const savedSearch = document.getElementById("savedSearch");
const savedEmpty = document.getElementById("savedEmpty");
const savedList = document.getElementById("savedList");
const savedSaveBtn = document.getElementById("savedSaveBtn");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const importFile = document.getElementById("importFile");
const nameDialog = document.getElementById("nameDialog");
const nameDialogTitle = document.getElementById("nameDialogTitle");
const nameForm = document.getElementById("nameForm");
const nameInput = document.getElementById("nameInput");
const nameDuplicateRow = document.getElementById("nameDuplicateRow");
const nameOverwrite = document.getElementById("nameOverwrite");
const nameCancel = document.getElementById("nameCancel");
const nameSubmit = document.getElementById("nameSubmit");
const settingsBtn = document.getElementById("settingsBtn");
const settingsDialog = document.getElementById("settingsDialog");
const settingsNav = document.getElementById("settingsNav");
const settingsPanels = settingsDialog.querySelector(".settings-panels");
const settingsClose = document.getElementById("settingsClose");
const accentInput = document.getElementById("accentInput");
const accentResetBtn = document.getElementById("accentResetBtn");
const clearAfterCopyInput = document.getElementById("clearAfterCopyInput");
const tutorialDialog = document.getElementById("tutorialDialog");
const tutorialBody = document.getElementById("tutorialBody");
const tutorialCounter = document.getElementById("tutorialCounter");
const tutorialClose = document.getElementById("tutorialClose");
const tutorialBack = document.getElementById("tutorialBack");
const tutorialNext = document.getElementById("tutorialNext");
const tutorialHideInput = document.getElementById("tutorialHideInput");
const tutorialStartInput = document.getElementById("tutorialStartInput");
const tutorialOpenBtn = document.getElementById("tutorialOpenBtn");
const tutorialCopyShortcut = document.getElementById("tutorialCopyShortcut");

/*
 * Copy buttons in the action row and Preview header. render() disables them
 * while the entry holds nothing to copy.
 */
const copyButtons = [copyBtn, previewCopy];

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
    lastEditorCaret = null;

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

function fragmentHasBlockElement(root) {
    for (const element of root.querySelectorAll("*")) {
        if (blockLevelTags.has(element.tagName.toLowerCase())) {
            return true;
        }
    }

    return false;
}

function singleInlineParagraph(fragment) {
    const meaningful = [...fragment.childNodes].filter(
        (node) =>
            node.nodeType === Node.ELEMENT_NODE ||
            (node.nodeType === Node.TEXT_NODE && node.data !== ""),
    );

    if (meaningful.length !== 1) return null;

    const only = meaningful[0];

    if (only.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = only.tagName.toLowerCase();

    if (tag !== "p" && tag !== "div") return null;

    return fragmentHasBlockElement(only) ? null : only;
}

function enclosingInsertBlock(node) {
    let cur = closestElement(node);

    while (cur && cur !== editor) {
        const tag = cur.tagName.toLowerCase();

        if (tag === "p" || tag === "div" || headingLevels.includes(tag)) {
            return cur;
        }

        if (tag === "li" || tag === "blockquote" || tag === "pre") {
            return null;
        }

        cur = cur.parentElement;
    }

    return null;
}

function topInlineInEditor(node) {
    let cur = closestElement(node);
    let top = null;

    while (cur && cur !== editor) {
        if (blockLevelTags.has(cur.tagName.toLowerCase())) return null;
        top = cur;
        cur = cur.parentElement;
    }

    return top;
}

function hasMeaningfulContent(root) {
    if (root.textContent.replace(/\u200b/g, "") !== "") return true;

    return Boolean(root.querySelector("*:not(br)"));
}

function placeCaretAfterInserted(node, selection) {
    if (!node) return;

    if (
        node.nodeType === Node.ELEMENT_NODE &&
        blockLevelTags.has(node.tagName.toLowerCase())
    ) {
        placeCaretAtEnd(node);
        return;
    }

    const range = document.createRange();

    range.setStartAfter(node);
    range.collapse(true);
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
    const singlePara = singleInlineParagraph(fragment);

    /*
     * A single-paragraph paste (such as inline Markdown `code` or a one-line
     * saved snippet) inserted inside an existing line or block unwraps to
     * inline nodes rather than nesting a <p> inside the line.
     */
    if (singlePara && range.startContainer !== editor) {
        const host = enclosingInsertBlock(range.startContainer);

        if (
            host &&
            host.childNodes.length === 1 &&
            host.firstChild.nodeName === "BR"
        ) {
            host.firstChild.remove();
            range.setStart(host, 0);
            range.collapse(true);
        }

        singlePara.replaceWith(...singlePara.childNodes);
    }

    let lastNode = fragment.lastChild;

    if (fragmentHasBlockElement(fragment)) {
        const hostBlock = enclosingInsertBlock(range.startContainer);
        const topInline = hostBlock
            ? null
            : topInlineInEditor(range.startContainer);

        if (hostBlock) {
            const tailRange = document.createRange();

            tailRange.setStart(range.startContainer, range.startOffset);
            tailRange.setEnd(hostBlock, hostBlock.childNodes.length);

            const tail = tailRange.extractContents();

            stripEmptyInlineWrappers(tail);
            stripEmptyInlineWrappers(hostBlock);

            hostBlock.after(fragment);

            if (hasMeaningfulContent(tail)) {
                const tailBlock = document.createElement(
                    hostBlock.tagName.toLowerCase() === "div" ? "div" : "p",
                );

                tailBlock.appendChild(tail);
                lastNode.after(tailBlock);
            }

            if (!hasMeaningfulContent(hostBlock)) {
                hostBlock.remove();
            }

            placeCaretAfterInserted(lastNode, selection);
        } else if (topInline) {
            const tailRange = document.createRange();

            tailRange.setStart(range.startContainer, range.startOffset);
            tailRange.setEndAfter(topInline);

            const tail = tailRange.extractContents();

            stripEmptyInlineWrappers(tail);
            stripEmptyInlineWrappers(topInline);

            topInline.after(fragment);

            if (hasMeaningfulContent(tail)) {
                lastNode.after(tail);
            }

            if (!hasMeaningfulContent(topInline)) {
                topInline.remove();
            }

            placeCaretAfterInserted(lastNode, selection);
        } else {
            range.insertNode(fragment);
            placeCaretAfterInserted(lastNode, selection);
        }
    } else {
        range.insertNode(fragment);
        placeCaretAfterInserted(lastNode, selection);
    }

    queueSnapshot();
    render();
    updateToolbarState();
}
