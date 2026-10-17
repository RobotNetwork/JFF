/* Tab handling and the editor placeholder.
   Split out of app.js, lines 2627-2740. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Tab handling ---------- */

function insertTab() {
    document.execCommand("insertText", false, "\t");
}

function removeIndentBeforeCaret() {
    const selection = window.getSelection();

    if (!selection.rangeCount || !selection.isCollapsed) {
        return false;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;

    if (node.nodeType !== Node.TEXT_NODE) {
        return false;
    }

    const before = node.textContent.slice(0, offset);
    const match = before.match(/(?:\t| {1,4})$/);

    if (!match) return false;

    node.deleteData(offset - match[0].length, match[0].length);

    range.setStart(node, offset - match[0].length);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);

    return true;
}

function handleTab(shiftKey) {
    const items = listItemsInSelection();

    if (items.length === 0) {
        if (shiftKey) {
            removeIndentBeforeCaret();
        } else {
            insertTab();
        }

        return;
    }

    /*
     * Outdenting walks backwards: each item lands directly after its parent
     * item, so the ones already moved stay ahead of the ones still to move.
     * Nesting walks forwards, since moving an item out of the list makes the
     * item above it the previous sibling of the next one.
     */
    const order = shiftKey ? [...items].reverse() : items;
    let moved = false;

    for (const item of order) {
        const changed = shiftKey
            ? outdentListItem(item)
            : nestListItem(item);

        if (changed) moved = true;
    }

    /*
     * Each move restores the caret to the item it moved, which collapses a
     * multi-item selection onto the last one. Rebuilding the range over every
     * item keeps the next Tab acting on all of them.
     */
    if (moved && items.length > 1) {
        const range = document.createRange();

        range.setStartBefore(items[0]);
        range.setEndAfter(items[items.length - 1]);

        const selection = window.getSelection();

        selection.removeAllRanges();
        selection.addRange(range);
    }
}

/* ---------- Editor placeholder ---------- */

/*
 * A block that draws something of its own - a code box, a list marker, a quote
 * bar, a heading's spacing - is not an empty document even though it holds no
 * text. A plain paragraph, a bare <br>, and the caret anchor are all invisible,
 * so they do not count. Clear entry and the placeholder read the same
 * question, so they share the test.
 */
const structureSelector = [
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    ...headingLevels,
].join(", ");

function editorIsEmpty() {
    return (
        editor.textContent.replace(/\u200b/g, "").trim() === "" &&
        !editor.querySelector(structureSelector)
    );
}

function updatePlaceholder() {
    editor.classList.toggle("is-empty", editorIsEmpty());
}
