const editor = document.getElementById("editor");
const output = document.getElementById("output");
const copyBtn = document.getElementById("copyBtn");
const outputStats = document.getElementById("outputStats");
const toolbar = document.getElementById("toolbar");
const restoreBtn = document.getElementById("restoreBtn");
const notice = document.getElementById("notice");
const saveState = document.getElementById("saveState");
const mainEl = document.querySelector("main");
const viewTabs = [...document.querySelectorAll(".view-tabs button")];
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
const clearBtn = document.getElementById("clearBtn");
const shortcutBtn = document.getElementById("shortcutBtn");
const shortcutsDialog = document.getElementById("shortcutsDialog");
const shortcutList = document.getElementById("shortcutList");
const shortcutsClose = document.getElementById("shortcutsClose");
const splitDivider = document.getElementById("splitDivider");
const hideOutputBtn = document.getElementById("hideOutputBtn");
const showOutputBtn = document.getElementById("showOutputBtn");
const toolbarCopyBtn = document.getElementById("toolbarCopyBtn");
const toolbarCopySep = document.getElementById("toolbarCopySep");
const toolbarCopyDropdown = document.getElementById("toolbarCopyDropdown");
const copyDropdowns = [...document.querySelectorAll(".copy-dropdown")];
const clearAfterCopyItems = [
    ...document.querySelectorAll(".clear-after-copy-item"),
];

/*
 * Two buttons run the copy command: the one beside the output, and the one
 * that replaces it in the toolbar while the output is collapsed. Exactly one
 * is visible at a time, so the flash and the disabled state are written to
 * both and the hidden one simply carries the change unseen.
 */
const copyButtons = [copyBtn, toolbarCopyBtn];

/* ---------- Custom undo/redo history ---------- */

const snapshotLimit = 100;
const snapshotDebounce = 300;

let undoStack = [];
let undoIndex = -1;
let undoTimer = null;

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

/* ---------- Toolbar ---------- */

toolbar.addEventListener("mousedown", (event) => {
    if (event.target.closest("#headingToggle")) {
        /*
         * The press is kept from moving focus so the editor selection
         * survives, and the menu opens without stealing it.
         */
        event.preventDefault();
        setHeadingMenuOpen(headingMenu.hidden);
        return;
    }

    const button = event.target.closest("button[data-cmd]");

    if (!button) return;

    /*
     * Keeping the default would move focus out of the editor and collapse
     * the selection the command needs, so a mouse press is handled here.
     */
    event.preventDefault();
    runToolbarCommand(button);

    /* A menu choice has been made, so the menu closes with it. */
    if (button.closest(".dropdown-menu")) closeHeadingMenu();
});

/*
 * Enter or Space on a focused toolbar button raises a click with detail 0
 * and never raises mousedown, so keyboard activation needs its own path. A
 * real mouse click also raises click, with a non-zero detail, and is already
 * handled above.
 */
toolbar.addEventListener("click", (event) => {
    if (event.target.closest("#headingToggle")) {
        if (event.detail !== 0) return;

        /*
         * Keyboard activation opens the menu onto the item in use, so an
         * arrow key or a second Enter acts on it immediately.
         */
        setHeadingMenuOpen(headingMenu.hidden, true);
        return;
    }

    const button = event.target.closest("button[data-cmd]");

    if (!button || event.detail !== 0) return;

    /*
     * Keyboard activation moved focus to the button; the caret is restored
     * to the editor so the command has something to act on.
     */
    editor.focus();
    runToolbarCommand(button);

    if (button.closest(".dropdown-menu")) closeHeadingMenu();
});

function runToolbarCommand(button) {
    flushSnapshot();

    const { cmd, val } = button.dataset;

    /*
     * A command that defers to the link dialog owns focus until the dialog
     * closes, so the caret restore and redraw are left to it.
     */
    if (applyCommand(cmd, val)) return;

    editor.focus();
    queueSnapshot();
    render();

    requestAnimationFrame(updateToolbarState);
}

function execCommand(cmd, value) {
    document.execCommand(cmd, false, value ?? null);

    return false;
}

function queryCommandState(cmd) {
    try {
        return document.queryCommandState(cmd);
    } catch {
        return false;
    }
}

/*
 * Every command a toolbar button or a shortcut can name, with how it runs and
 * how the toolbar reads its pressed state. Those were two switches over the
 * same names, so a new button could work and never light up; one entry per
 * command makes the pair impossible to separate, and checkCommandCoverage
 * reports a name this table does not know.
 *
 * run() takes the button's data-val and returns true when the command has
 * handed the rest of the turn to the link dialog. isActive() reads the
 * element at the caret, and its absence - Clear formatting - means the
 * command has no pressed state to show.
 */
const commands = {
    /*
     * Undo and redo walk the snapshot stack rather than running a document
     * command: the browser's own history does not survive setting innerHTML,
     * which is what restoring a snapshot does.
     */
    undo: {
        run: () => {
            restore(-1);

            return false;
        },
    },
    redo: {
        run: () => {
            restore(1);

            return false;
        },
    },
    bold: {
        run: () => execCommand("bold"),
        isActive: () => queryCommandState("bold"),
    },
    italic: {
        run: () => execCommand("italic"),
        isActive: () => queryCommandState("italic"),
    },
    underline: {
        run: () => execCommand("underline"),
        isActive: () => queryCommandState("underline"),
    },
    strikeThrough: {
        run: () => execCommand("strikeThrough"),
        isActive: () => queryCommandState("strikeThrough"),
    },
    insertUnorderedList: {
        run: () => execCommand("insertUnorderedList"),
        isActive: () => queryCommandState("insertUnorderedList"),
    },
    insertOrderedList: {
        run: () => execCommand("insertOrderedList"),
        isActive: () => queryCommandState("insertOrderedList"),
    },
    formatBlock: {
        run: (value) => execCommand("formatBlock", value),
        isActive: (value) =>
            normalizeBlockName(document.queryCommandValue("formatBlock")) ===
            normalizeBlockName(value),
    },
    inlineCode: {
        run: () => {
            wrapInlineCode();

            return false;
        },
        isActive: (value, element) =>
            Boolean(element.closest("code")) && !element.closest("pre"),
    },
    codeBlock: {
        run: () => {
            document.execCommand("formatBlock", false, "pre");
            normalizeCodeBlocks(editor);

            return false;
        },
        isActive: (value, element) => Boolean(element.closest("pre")),
    },
    link: {
        run: () => insertLink(),
        isActive: (value, element) => Boolean(element.closest("a")),
    },
    removeFormat: { run: () => execCommand("removeFormat") },
    /*
     * Neither of these changes the entry. They are commands so the shortcut
     * table can name them, which is what puts them in the reference dialog,
     * and their buttons live outside the toolbar the table drives.
     */
    help: {
        run: () => {
            openShortcutsDialog();

            return true;
        },
    },
    copyOutput: {
        run: () => {
            copyOutput();

            return true;
        },
    },
};

/*
 * Single entry point for the toolbar buttons and the keyboard shortcuts, so
 * a command behaves the same whichever way it is reached. The return value
 * reports a command that finishes later, out of the caller's turn.
 */
function applyCommand(cmd, value) {
    return commands[cmd].run(value);
}

/*
 * The toolbar markup, the shortcut table and the command table all name the
 * same commands, and nothing in the language makes them agree. This is the
 * guard the comment on the shortcut table promises: a name no command answers
 * to fails at load rather than becoming a control that quietly does nothing.
 */
function checkCommandCoverage() {
    for (const button of toolbar.querySelectorAll("button[data-cmd]")) {
        const { cmd } = button.dataset;

        if (!commands[cmd]) {
            throw new Error(`Toolbar button names no command: ${cmd}`);
        }
    }

    for (const { cmd } of editingShortcuts) {
        if (!commands[cmd]) {
            throw new Error(`Shortcut names no command: ${cmd}`);
        }
    }
}

/*
 * The heading levels, in order. Every list of h1 to h6 - the two selectors,
 * the sanitizer's allowlist, the serializer's switch, the typed and markdown
 * marker patterns - derives from this, so the set has one definition.
 */
const headingLevels = ["h1", "h2", "h3", "h4", "h5", "h6"];
const headingSelector = headingLevels.join(", ");
const headingHashPattern = new RegExp(
    `^(#{1,${headingLevels.length}})\\s+(.*)$`,
);
const headingMarkerPattern = new RegExp(
    `^(#{1,${headingLevels.length}}) $`,
);

/*
 * The element that starts a line, for deciding whether a range stays inside
 * one block. A range that crosses blocks would wrap the blocks themselves,
 * which [code] cannot hold.
 */
const blockSelector = [
    "p",
    "div",
    "li",
    "blockquote",
    "pre",
    "ul",
    "ol",
    ...headingLevels,
].join(", ");

function blockOf(node) {
    const element = closestElement(node);
    const block = element ? element.closest(blockSelector) : null;

    return block && editor.contains(block) ? block : editor;
}

function rangeCrossesBlocks(range) {
    return blockOf(range.startContainer) !== blockOf(range.endContainer);
}

function wrapInlineCode() {
    const selection = window.getSelection();

    if (!selection.rangeCount || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) return;

    /*
     * surroundContents throws when the range only partly covers an element,
     * and the extract fallback would put block content inside the code span.
     * A selection that crosses blocks is left alone instead.
     */
    if (rangeCrossesBlocks(range)) return;

    const code = document.createElement("code");

    try {
        range.surroundContents(code);
    } catch {
        code.appendChild(range.extractContents());
        range.insertNode(code);
    }

    const selectedRange = document.createRange();

    selectedRange.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(selectedRange);
}

/* The link an element sits in, or null. */
function linkAt(node) {
    const element = closestElement(node);
    const anchor = element ? element.closest("a") : null;

    return anchor && editor.contains(anchor) ? anchor : null;
}

/*
 * The link the command was invoked on: either the whole selection sits inside
 * one anchor, or the selection is that link's own words with nothing beside
 * them but whitespace. That link is being edited or removed rather than a
 * second one being built over the same words.
 *
 * The second shape is the common one, and how the browser expresses it is its
 * own business: Firefox reports a double-clicked link through the text on
 * either side of it rather than inside it, and a drag that overshoots the
 * link takes the space after it. Both reach outside the anchor, so the
 * containers of the two edges cannot be what is compared, and the words are.
 */
function linkInRange(range) {
    const anchor = linkAt(range.startContainer);

    if (anchor && anchor === linkAt(range.endContainer)) return anchor;

    const covered = [...editor.querySelectorAll("a")].filter((candidate) =>
        range.intersectsNode(candidate),
    );

    if (covered.length !== 1) return null;

    const words = range.toString().trim();

    return words !== "" && words === covered[0].textContent.trim()
        ? covered[0]
        : null;
}

/*
 * The dialog takes focus, and both createLink and the caret restore need the
 * selection the command was invoked on, so the range is cloned up front and
 * the caller is told the command has been handed over. It reports false when
 * there is no selection in the editor to build a link from, leaving the
 * caller with the ordinary path.
 */
function insertLink() {
    const selection = window.getSelection();

    const source =
        selection.rangeCount &&
        editor.contains(selection.getRangeAt(0).commonAncestorContainer)
            ? selection.getRangeAt(0)
            : null;

    if (!source) return false;

    openLinkDialog(source.cloneRange(), linkInRange(source));

    return true;
}

/* ---------- Link dialog ---------- */

/*
 * The link being built or edited while the dialog is open. Null outside it.
 * The range is the cloned selection, editing is the link the command was run
 * on, and href stays empty until the form is submitted, which is what
 * separates a confirmed link from a cancelled one.
 */
let pendingLink = null;

/*
 * A press that starts on the dialog box rather than on the form is a press on
 * the backdrop: the box is transparent and unpadded, so anything between the
 * form and the edge is backdrop. Tracking where the press began keeps a text
 * selection dragged out of a field, or off the shortcut list, from being read
 * as a click outside, which would close the dialog and throw the field away.
 */
function closeOnBackdrop(dialog, close) {
    let pressed = false;

    dialog.addEventListener("pointerdown", (event) => {
        pressed = event.target === dialog;
    });

    dialog.addEventListener("click", (event) => {
        if (pressed && event.target === dialog) close();

        pressed = false;
    });

    /* Escape and the dialog's own buttons close it too, and a press that was
       in flight when they did must not be judged later. */
    dialog.addEventListener("close", () => {
        pressed = false;
    });
}

function openLinkDialog(range, anchor) {
    const href = anchor ? normalizeHref(anchor.getAttribute("href") || "") : "";

    pendingLink = {
        range,
        collapsed: range.collapsed,
        editing: anchor,
        remove: false,
        href: "",
        text: "",
    };

    linkError.hidden = true;
    linkUrl.value = href;
    linkText.value = "";

    /* An existing selection already supplies the link text. */
    linkTextRow.hidden = !range.collapsed;

    /* There is only something to remove when a link was run on. */
    linkRemove.hidden = !anchor;

    linkDialog.showModal();
    linkUrl.focus();

    /* The caret lands after the URL rather than on all of it, so a correction
       does not start by wiping the value. */
    linkUrl.setSelectionRange(href.length, href.length);
}

function restoreLinkSelection(range) {
    editor.focus();

    const selection = window.getSelection();

    selection.removeAllRanges();
    selection.addRange(range);
}

/*
 * Removing a link keeps the text it held. The range the dialog was opened
 * with points into the children, which survive the unwrap, so the caret is
 * already sitting where the link was.
 */
function removeLink(anchor) {
    if (!anchor || !anchor.isConnected) return;

    anchor.replaceWith(...anchor.childNodes);
}

function closeLinkDialog() {
    if (linkDialog.open) linkDialog.close();
}

linkForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!pendingLink) return;

    const href = normalizeHref(linkUrl.value);

    if (!href) {
        linkError.hidden = false;
        linkUrl.focus();
        return;
    }

    /*
     * The URL is validated before it reaches the DOM, so the editor never
     * holds a link the serializer would have to reject anyway.
     */
    pendingLink.href = href;
    pendingLink.text = linkText.value.trim();

    closeLinkDialog();
});

linkCancel.addEventListener("click", closeLinkDialog);

/* Removal is a decision of its own, so it leaves through the same close path
   as Insert rather than sharing the form's submit validation. */
linkRemove.addEventListener("click", () => {
    if (!pendingLink) return;

    pendingLink.remove = true;
    closeLinkDialog();
});

closeOnBackdrop(linkDialog, closeLinkDialog);

/*
 * The dialog is already closed by the time this runs, whether it went
 * through the form, Escape, or the backdrop, so the editor can take focus
 * back and the deferred command can finish.
 */
linkDialog.addEventListener("close", () => {
    const pending = pendingLink;

    pendingLink = null;
    linkError.hidden = true;

    if (!pending) return;

    restoreLinkSelection(pending.range);

    if (pending.remove) {
        removeLink(pending.editing);

        queueSnapshot();
        render();
        updateToolbarState();
        return;
    }

    if (!pending.href) return;

    /*
     * The command was run on a link, so that link's href is replaced rather
     * than a second one built around the selection: the words being looked
     * at already belong to the link, and createLink would build another one
     * over them.
     */
    if (pending.editing) {
        pending.editing.setAttribute("href", pending.href);

        queueSnapshot();
        render();
        updateToolbarState();
        return;
    }

    if (pending.collapsed) {
        const text = pending.text || pending.href;

        insertHtmlAtCursor(
            `<a href="${escapeAttr(pending.href)}">${escapeHtml(text)}</a>&nbsp;`,
        );
        return;
    }

    document.execCommand("createLink", false, pending.href);

    queueSnapshot();
    render();
    updateToolbarState();
});

/* ---------- Shortcut reference ---------- */

/*
 * The reference is built from editingShortcuts, so a chord recorded there
 * appears here without a second edit, and the name comes from the toolbar
 * button that runs the same command, so a command has one name.
 */
const extraShortcuts = [
    // example:
    // {
    //     keys: "KEY",
    //     label: "description",
    // },
];

/* A code names the physical key, which is not the character it produces. */
const chordKeys = {
    Digit1: "1",
    Digit2: "2",
    Digit3: "3",
    Digit4: "4",
    Digit5: "5",
    Digit6: "6",
    Digit7: "7",
    Digit8: "8",
    Backquote: "`",
    Backslash: "\\",
    Period: ">",
    Slash: "/",
};

/*
 * The name of a shortcut: the label of the control that runs the same
 * command, so a command has one name. A shortcut with no control - undo and
 * redo - carries its own.
 */
function shortcutName(shortcut) {
    if (shortcut.label) return shortcut.label;

    const selector = shortcut.val
        ? `button[data-cmd="${shortcut.cmd}"][data-val="${shortcut.val}"]`
        : `button[data-cmd="${shortcut.cmd}"]:not([data-val])`;
    /* Copy and Help sit outside the toolbar, so the search is not limited to
       it; the label on whichever button runs the command is its name. */
    const button = document.querySelector(selector);

    return (
        (button && button.getAttribute("aria-label")) || shortcut.cmd
    );
}

function chordLabel(shortcut) {
    const parts = ["Ctrl"];

    if (shortcut.shift) parts.push("Shift");
    if (shortcut.alt) parts.push("Alt");

    parts.push(
        shortcut.code
            ? chordKeys[shortcut.code] || shortcut.code
            : shortcut.key.toUpperCase(),
    );

    return parts.join("+");
}

function buildShortcutList() {
    const rows = [
        ...editingShortcuts.map((shortcut) => [
            chordLabel(shortcut),
            shortcutName(shortcut),
        ]),
        ...extraShortcuts.map(({ keys, label }) => [keys, label]),
    ];

    for (const [keys, label] of rows) {
        const item = document.createElement("li");
        const chord = document.createElement("span");
        const name = document.createElement("span");

        chord.className = "shortcut-keys";
        chord.textContent = keys;
        name.textContent = label;

        item.append(chord, name);
        shortcutList.append(item);
    }
}

/*
 * The entry recording a command, or null. The value narrows it: Ctrl+Alt+1 is
 * the h1 command, not the blockquote one.
 */
function shortcutFor(cmd, value) {
    return editingShortcuts.find(
        (entry) =>
            entry.cmd === cmd &&
            (value === undefined
                ? entry.val === undefined
                : entry.val === value),
    );
}

/*
 * The hover text of every button that carries an aria-label: the label names
 * it, and the chord comes from the table the dialog is built from. Tooltips
 * used to spell the chords out by hand, so rebinding one in the table left
 * the tooltip advertising the old key.
 */
function buildTooltips() {
    for (const button of document.querySelectorAll("button[aria-label]")) {
        const { cmd, val } = button.dataset;
        const shortcut = cmd ? shortcutFor(cmd, val) : null;
        const name = button.getAttribute("aria-label");

        button.title = shortcut ? `${name} (${chordLabel(shortcut)})` : name;
    }

    /*
     * Clear is not a formatting command, so the table has no entry for it,
     * but its tooltip points at the undo chord, which does come from there.
     */
    const clearLabel = clearBtn.getAttribute("aria-label");
    const undo = chordLabel(shortcutFor("undo"));

    clearBtn.title = `${clearLabel} and start again (${undo} to undo)`;

    /*
     * Restore keeps what it replaces, so the cleared entry and the current
     * one swap places rather than one of them being lost.
     */
    restoreBtn.title = `${restoreBtn.getAttribute("aria-label")} (the two entries swap)`;
}

/*
 * showModal throws on a dialog that is already open, and the chord and the
 * button both arrive here, so the open state is checked rather than assumed.
 */
function openShortcutsDialog() {
    if (!shortcutsDialog.open) shortcutsDialog.showModal();
}

shortcutBtn.addEventListener("click", openShortcutsDialog);

shortcutsClose.addEventListener("click", () => {
    shortcutsDialog.close();
});

closeOnBackdrop(shortcutsDialog, () => shortcutsDialog.close());

/* ---------- Toolbar active state ---------- */

function setButtonActive(button, active) {
    button.setAttribute("aria-pressed", String(active));
}

function normalizeBlockName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[<>]/g, "");
}

function updateToolbarState() {
    const selectedElement = getSelectedElement();

    for (const button of toolbar.querySelectorAll("button")) {
        /* The heading control is a switch over levels, not an inline toggle. */
        if (button.closest(".dropdown")) continue;

        const { cmd, val } = button.dataset;
        const command = commands[cmd];

        /*
         * Clear formatting carries no pressed state, and a button naming a
         * command nobody knows is checkCommandCoverage's to report rather
         * than something to push back to a false press here.
         */
        if (!command?.isActive) continue;

        setButtonActive(
            button,
            selectedElement ? command.isActive(val, selectedElement) : false,
        );
    }

    /*
     * The heading label and the menu check mark follow the block at the
     * caret. Skipped while the menu is open, when focus sits on a menu item
     * and the selection would read as no heading at all.
     */
    if (headingMenu.hidden) updateHeadingControl();

    /* Last: a control that cannot be reached cannot hold the tab stop. */
    syncToolbarTabStops();
}

/*
 * A toolbar is one tab stop rather than a dozen: the arrows move between its
 * controls and Tab leaves it, which is what role="toolbar" promises. The
 * heading menu's items are reached with the arrows from the toggle, so they
 * are not part of this ring.
 */
function toolbarControls() {
    return [...toolbar.querySelectorAll("button")].filter(
        (button) => !button.closest(".dropdown-menu"),
    );
}

/*
 * A control that is disabled or not on screen cannot be reached, so neither
 * kind is part of the ring the arrow keys walk.
 */
function enabledToolbarControls() {
    return toolbarControls().filter(
        (button) => !button.disabled && !button.closest("[hidden]"),
    );
}

function syncToolbarTabStops() {
    const controls = toolbarControls();
    const enabled = enabledToolbarControls();
    const stop = enabled.find((button) => button.tabIndex === 0) ?? enabled[0];

    for (const button of controls) {
        button.tabIndex = button === stop ? 0 : -1;
    }
}

toolbar.addEventListener("keydown", (event) => {
    /* The heading menu runs its own arrow handling. */
    if (event.target.closest(".dropdown-menu")) return;

    const step =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const edge =
        event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : "";

    if (!step && !edge) return;

    const controls = enabledToolbarControls();
    const index = controls.indexOf(document.activeElement);

    if (index === -1) return;

    event.preventDefault();

    const next = edge
        ? edge === "first"
            ? controls[0]
            : controls[controls.length - 1]
        : controls[(index + step + controls.length) % controls.length];

    next.focus();
});

/* ---------- Heading dropdown ---------- */

/*
 * One button in place of six. Its label carries the level the caret is on
 * and the menu marks the same item, so the control always shows what is in
 * use without spending a button per level.
 */
function headingLevelInUse() {
    const element = getSelectedElement();
    const heading = element ? element.closest(headingSelector) : null;

    return heading && editor.contains(heading)
        ? heading.tagName.toLowerCase()
        : "";
}

function updateHeadingControl() {
    const level = headingLevelInUse();

    headingToggle.textContent = level ? level.toUpperCase() : "Heading";
    headingToggle.classList.toggle("is-active", Boolean(level));

    for (const item of headingMenu.querySelectorAll("button[data-val]")) {
        item.setAttribute(
            "aria-checked",
            String(item.dataset.val === level),
        );
    }
}

function setHeadingMenuOpen(open, focusItem = false) {
    headingMenu.hidden = !open;
    headingToggle.setAttribute("aria-expanded", String(open));

    if (open && focusItem) {
        const checked = headingMenu.querySelector('[aria-checked="true"]');
        const target = checked ?? headingMenu.firstElementChild;

        if (target) target.focus();
    }
}

function closeHeadingMenu() {
    if (headingMenu.hidden) return;

    setHeadingMenuOpen(false);
}

/*
 * A menu is a list of choices rather than a tab stop, so the arrows move
 * between them and Escape returns to the toggle. Tab closes and moves on.
 */
headingMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        event.preventDefault();
        closeHeadingMenu();
        headingToggle.focus();
        return;
    }

    if (event.key === "Tab") {
        closeHeadingMenu();
        return;
    }

    const step =
        event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;

    if (!step) return;

    event.preventDefault();

    const items = [...headingMenu.querySelectorAll("button[data-val]")];
    const index = items.indexOf(document.activeElement);
    const next = items[(index + step + items.length) % items.length];

    next.focus();
});

/*
 * A press anywhere outside the control dismisses the menu. The toolbar
 * listener runs first and keeps the editor selection for its own commands,
 * so this only ever closes an open menu.
 */
document.addEventListener("mousedown", (event) => {
    if (!headingMenu.hidden && !event.target.closest("#headingDropdown")) {
        closeHeadingMenu();
    }

    for (const dropdown of copyDropdowns) {
        const menu = dropdown.querySelector(".copy-menu");

        if (!menu.hidden && !dropdown.contains(event.target)) {
            setCopyMenuOpen(menu, dropdown.querySelector(".copy-toggle"), false);
        }
    }
});

/* ---------- Markdown to HTML ---------- */

function markdownToHtml(markdown) {
    const lines = markdown.split(/\r?\n/);
    const result = [];
    let list = null;
    let fence = null;

    const closeList = () => {
        if (!list) return;

        result.push(`</${list}>`);
        list = null;
    };

    const closeFence = () => {
        result.push(
            `<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`,
        );

        fence = null;
    };

    const inline = (text) => {
        const tokens = [];

        const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;

        /*
         * Code spans and links are held as placeholders so the emphasis
         * passes cannot rewrite text inside them, and so link URLs are
         * escaped exactly once. Emphasis delimiters are anchored to word
         * boundaries so that prose containing bare asterisks survives. NUL
         * is the placeholder delimiter, so any that arrived in the text is
         * removed before tokenizing, and an index that does not resolve
         * falls back to the literal match rather than to undefined.
         */
        const held = text
            .replace(/\u0000/g, "")
            .replace(
                /`([^`]+)`/g,
                (_, code) => hold(`<code>${escapeHtml(code)}</code>`),
            )
            .replace(
                /\[([^\]]+)\]\(([^\s)]+?(?:\([^)]*\)[^\s)]*)*)\)/g,
                (_, label, url) => {
                    const href = normalizeHref(url);

                    if (!href) return label;

                    return hold(
                        `<a href="${escapeAttr(href)}">${escapeHtml(
                            label,
                        )}</a>`,
                    );
                },
            );

        return escapeHtml(held)
            .replace(
                /(^|[^*\w])\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*(?![\w*])/g,
                "$1<b>$2</b>",
            )
            .replace(
                /(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g,
                "$1<em>$2</em>",
            )
            .replace(/~~([^~]+)~~/g, "<strike>$1</strike>")
            .replace(
                /\u0000(\d+)\u0000/g,
                (match, index) => tokens[Number(index)] ?? match,
            );
    };

    for (const line of lines) {
        let match;

        /*
         * Fenced code is consumed line by line. A single regular expression
         * over the whole document cannot tell a fence that opens a block
         * from a run of backticks inside a sentence.
         */
        if (fence) {
            if (/^\s*```\s*$/.test(line)) {
                closeFence();
            } else {
                fence.push(line);
            }

            continue;
        }

        if (/^\s*```[\w-]*\s*$/.test(line)) {
            closeList();
            fence = [];
        } else if ((match = line.match(headingHashPattern))) {
            /*
             * ServiceNow renders each heading level as written, so the hash
             * count maps straight to the tag rather than collapsing to h3.
             */
            closeList();

            const level = match[1].length;

            result.push(`<h${level}>${inline(match[2])}</h${level}>`);
        } else if ((match = line.match(/^>\s?(.*)$/))) {
            closeList();
            result.push(
                `<blockquote>${inline(match[1])}</blockquote>`,
            );
        } else if ((match = line.match(/^[-*+]\s+(.*)$/))) {
            if (list !== "ul") {
                closeList();
                result.push("<ul>");
                list = "ul";
            }

            result.push(`<li>${inline(match[1])}</li>`);
        } else if ((match = line.match(/^\d+[.)]\s+(.*)$/))) {
            if (list !== "ol") {
                closeList();
                result.push("<ol>");
                list = "ol";
            }

            result.push(`<li>${inline(match[1])}</li>`);
        } else if (line.trim() === "") {
            closeList();
            result.push("");
        } else {
            closeList();
            result.push(`<p>${inline(line)}</p>`);
        }
    }

    if (fence) closeFence();

    closeList();

    return result.join("");
}

/* ---------- Rich text normalization ---------- */

const boldTags = new Set(["b", "strong"]);
const italicTags = new Set(["i", "em"]);
const strikeTags = new Set(["s", "strike", "del"]);
const underlineTags = new Set(["u", "ins"]);

/*
 * Elements that carry line structure. They decide where a line ends and
 * where an inline wrapper has to be pushed down onto what it surrounds.
 */
const blockLevelTags = new Set([
    "p",
    "div",
    "li",
    "blockquote",
    "pre",
    "ul",
    "ol",
    ...headingLevels,
]);

const inlineFormatTags = [
    ...boldTags,
    ...italicTags,
    ...strikeTags,
    ...underlineTags,
    "code",
    "a",
];

const inlineFormatSelector = inlineFormatTags.join(", ");

function wrapElementContents(element, tagName) {
    const wrapper = element.ownerDocument.createElement(tagName);

    while (element.firstChild) {
        wrapper.appendChild(element.firstChild);
    }

    element.appendChild(wrapper);
}

function unwrapElement(element) {
    element.replaceWith(...element.childNodes);
}

function hasBoldStyle(style) {
    const weight = style.fontWeight.trim().toLowerCase();

    return (
        weight === "bold" ||
        weight === "bolder" ||
        (/^\d+$/.test(weight) && Number(weight) >= 600)
    );
}

function hasItalicStyle(style) {
    return style.fontStyle.trim().toLowerCase() === "italic";
}

function hasStrikeStyle(style) {
    return `${style.textDecoration} ${style.textDecorationLine}`
        .toLowerCase()
        .includes("line-through");
}

function hasUnderlineStyle(style) {
    return `${style.textDecoration} ${style.textDecorationLine}`
        .toLowerCase()
        .includes("underline");
}

/*
 * Editors spell "this run is not bold" as an explicit normal value rather
 * than by leaving the wrapper out. Google Docs wraps a whole document in
 * <b style="font-weight:normal">, so reading only the on values would paste
 * that document entirely bold.
 */
function isBoldOff(style) {
    const weight = style.fontWeight.trim().toLowerCase();

    return weight === "normal" || weight === "400";
}

function isItalicOff(style) {
    return style.fontStyle.trim().toLowerCase() === "normal";
}

function isStrikeOff(style) {
    return (
        style.textDecoration.trim().toLowerCase() === "none" ||
        style.textDecorationLine.trim().toLowerCase() === "none"
    );
}

function isUnderlineOff(style) {
    return (
        style.textDecoration.trim().toLowerCase() === "none" ||
        style.textDecorationLine.trim().toLowerCase() === "none"
    );
}

/*
 * Word writes its bullet and number glyphs into the clipboard HTML as text,
 * one <span style="mso-list:Ignore"> per item, padded with &nbsp; out to the
 * width of the marker column. That padding is typesetting rather than
 * content, and the whitespace pass no longer collapses it, so reduce the
 * marker to the single space that separates it from the item.
 */
function collapseListMarkers(root) {
    for (const marker of root.querySelectorAll(
        '[style*="mso-list:ignore" i]',
    )) {
        marker.textContent = marker.textContent.replace(/\s+/g, " ");
    }
}

/*
 * Inline styles are how every editor carries formatting across the
 * clipboard: Word and OneNote use font-weight and friends, Google Docs and
 * LibreOffice use the same properties on spans. Only the marker comments
 * differ, so this runs for all rich HTML rather than for the payloads that
 * happen to look like OneNote.
 */
function normalizeInlineStyles(doc) {
    collapseListMarkers(doc.body);

    for (const element of [...doc.body.querySelectorAll("*")]) {
        const tag = element.tagName.toLowerCase();
        const style = element.style;

        const formatsOff =
            (boldTags.has(tag) && isBoldOff(style)) ||
            (italicTags.has(tag) && isItalicOff(style)) ||
            (strikeTags.has(tag) && isStrikeOff(style)) ||
            (underlineTags.has(tag) && isUnderlineOff(style));

        if (formatsOff) {
            unwrapElement(element);
            continue;
        }

        if (hasBoldStyle(style) && !boldTags.has(tag)) {
            wrapElementContents(element, "strong");
        }

        if (hasItalicStyle(style) && !italicTags.has(tag)) {
            wrapElementContents(element, "em");
        }

        if (hasStrikeStyle(style) && !strikeTags.has(tag)) {
            wrapElementContents(element, "strike");
        }

        if (hasUnderlineStyle(style) && !underlineTags.has(tag)) {
            wrapElementContents(element, "u");
        }
    }

    distributeFormattingOverBlocks(doc.body);
}

/*
 * A wrapper around part of a line is applied to its contents, but a wrapper
 * around whole blocks cannot stay: [code] holds no block structure, so the
 * paragraphs inside would serialize as one joined line. Google Docs puts
 * such a wrapper around the entire document, so push it down onto each
 * block instead of dropping the formatting.
 */
function distributeFormattingOverBlocks(root) {
    const wrappers = [...root.querySelectorAll(inlineFormatSelector)];

    /*
     * Deepest first: pushing a block out of a nested wrapper can leave the
     * wrapper around that one holding blocks too.
     */
    for (let index = wrappers.length - 1; index >= 0; index--) {
        const wrapper = wrappers[index];

        const children = [...wrapper.childNodes].filter(
            (node) =>
                node.nodeType === Node.ELEMENT_NODE ||
                node.textContent.trim() !== "",
        );

        const wrapsOnlyBlocks =
            children.length > 0 &&
            children.every(
                (node) =>
                    node.nodeType === Node.ELEMENT_NODE &&
                    blockLevelTags.has(node.tagName.toLowerCase()),
            );

        if (!wrapsOnlyBlocks) continue;

        for (const block of children) {
            const copy = wrapper.cloneNode(false);

            while (block.firstChild) {
                copy.appendChild(block.firstChild);
            }

            block.appendChild(copy);
            wrapper.parentNode.insertBefore(block, wrapper);
        }

        wrapper.remove();
    }
}

function hasBlockChild(element) {
    return [...element.children].some((child) =>
        blockLevelTags.has(child.tagName.toLowerCase()),
    );
}

function hasContentBefore(node) {
    for (
        let sibling = node.previousSibling;
        sibling;
        sibling = sibling.previousSibling
    ) {
        if (sibling.nodeType === Node.ELEMENT_NODE) return true;
        if (sibling.textContent.trim() !== "") return true;
    }

    return false;
}

function hasContentAfter(node) {
    for (
        let sibling = node.nextSibling;
        sibling;
        sibling = sibling.nextSibling
    ) {
        if (sibling.nodeType === Node.ELEMENT_NODE) return true;
        if (sibling.textContent.trim() !== "") return true;
    }

    return false;
}

/*
 * A whitespace run that spans a newline is the markup's own line wrapping.
 * HTML would collapse it, and this editor renders with white-space:
 * pre-wrap, so it has to be collapsed before insertion. Runs of plain
 * spaces are content: Word and OneNote indent with &nbsp;, and that
 * indentation is what makes a pasted snippet usable as code.
 *
 * A collapsed run at the edge of a text node becomes a space only when
 * there is content beside it, since a run at the edge of a paragraph would
 * otherwise indent the paragraph.
 */
function collapseSourceWrapping(text, before, after) {
    const leading = text.match(/^\s*\n\s*/);
    const trailing = text.match(/\s*\n\s*$/);

    let start = 0;
    let end = text.length;
    let head = "";
    let tail = "";

    if (leading) {
        start = leading[0].length;
        head = before ? " " : "";
    }

    if (trailing) {
        /*
         * A node that holds nothing but wrapping matches both patterns, and
         * the leading match has already consumed it.
         */
        if (trailing[0].length <= text.length - start) {
            end = text.length - trailing[0].length;
            tail = after ? " " : "";
        } else {
            end = start;
        }
    }

    const middle = text.slice(start, end).replace(/\s*\n\s*/g, " ");

    return head + middle + tail;
}

function normalizeRichTextWhitespace(root) {
    /*
     * Indentation-only text nodes exist so that the markup between block
     * elements is readable. They surface as stray spaces as soon as the
     * element around them is unwrapped, so drop them first.
     */
    for (const parent of [root, ...root.querySelectorAll("*")]) {
        if (!hasBlockChild(parent)) continue;

        for (const child of [...parent.childNodes]) {
            if (
                child.nodeType === Node.TEXT_NODE &&
                child.textContent.trim() === ""
            ) {
                child.remove();
            }
        }
    }

    const walker = root.ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
    );

    const textNodes = [];
    let node = null;

    while ((node = walker.nextNode())) {
        textNodes.push(node);
    }

    for (const textNode of textNodes) {
        const parent = textNode.parentElement;

        if (!parent || parent.closest("pre")) continue;

        const text = textNode.data.replace(/\u00a0/g, " ");

        textNode.data = collapseSourceWrapping(
            text,
            hasContentBefore(textNode),
            hasContentAfter(textNode),
        );
    }

    root.normalize();
}

/*
 * Code blocks are stored as plain text with real newlines. Paste can drop
 * <br> elements or whole blocks into a <pre>, which renders identically but
 * serializes to a single joined line, so flatten it back to newlines.
 */
function normalizeCodeBlocks(root) {
    const selection = window.getSelection();
    const anchor =
        selection.rangeCount > 0 ? selection.anchorNode : null;

    for (const pre of root.querySelectorAll("pre")) {
        if (!pre.querySelector(codeBreakSelector)) continue;

        const caretWasInside = Boolean(anchor && pre.contains(anchor));

        pre.textContent = codeText(pre).replace(/^\n+|\n+$/g, "");

        if (caretWasInside) {
            placeCaretAtEnd(pre);
        }
    }
}

/*
 * Elements whose text is not content. Every other disallowed element is
 * unwrapped, which is what the editor wants for layout wrappers, but
 * unwrapping these would paste their text into the entry.
 */
const droppedTags = new Set([
    "style",
    "script",
    "title",
    "meta",
    "link",
    "base",
    "head",
    "noscript",
    "template",
    "iframe",
    "object",
    "embed",
    "svg",
]);

/*
 * Clipboard HTML carries comments: the StartFragment markers that Word and
 * OneNote wrap their payload in, and Word's conditional comments around
 * list bullets. They hold no content and would otherwise stay in the
 * editor DOM and in every undo snapshot.
 */
function removeComments(root) {
    const walker = root.ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_COMMENT,
    );

    const comments = [];
    let node = null;

    while ((node = walker.nextNode())) {
        comments.push(node);
    }

    for (const comment of comments) {
        comment.remove();
    }
}

function sanitizeRichText(doc) {
    const allowed = [
        "b",
        "strong",
        "i",
        "em",
        "s",
        "strike",
        "del",
        "u",
        "ins",
        "code",
        "pre",
        "blockquote",
        "a",
        "ul",
        "ol",
        "li",
        ...headingLevels,
        "br",
        "p",
        "div",
    ].join(",");

    removeComments(doc.body);

    doc.body
        .querySelectorAll([...droppedTags].join(","))
        .forEach((element) => element.remove());

    /*
     * Scope sanitization to the body. Unwrapping document root elements
     * can throw HierarchyRequestError.
     */
    doc.body
        .querySelectorAll(`*:not(${allowed})`)
        .forEach((element) => {
            element.replaceWith(...element.childNodes);
        });

    doc.body.querySelectorAll("*").forEach((element) => {
        for (const attribute of [...element.attributes]) {
            /*
             * A link is kept only if the serializer would keep it, so an
             * href that reaches the editor is one the output can carry.
             */
            const isAllowedHref =
                element.tagName === "A" &&
                attribute.name.toLowerCase() === "href" &&
                normalizeHref(attribute.value) !== "";

            if (!isAllowedHref) {
                element.removeAttribute(attribute.name);
            }
        }
    });
}

/*
 * Clipboard fragments can hold <li> elements with no list around them, which
 * the serializer would otherwise flatten into one line. Every run of adjacent
 * loose items is wrapped in an unordered list so the editor DOM is well
 * formed before editing begins.
 */
function wrapOrphanListItems(root) {
    for (const parent of [root, ...root.querySelectorAll("*")]) {
        const tag = parent.tagName;

        if (tag === "UL" || tag === "OL") continue;

        let list = null;

        for (const child of [...parent.childNodes]) {
            if (
                child.nodeType === Node.ELEMENT_NODE &&
                child.tagName === "LI"
            ) {
                if (!list) {
                    list = root.ownerDocument.createElement("ul");
                    parent.insertBefore(list, child);
                }

                list.appendChild(child);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                list = null;
            }
        }
    }
}

/* ---------- Keyboard shortcuts ---------- */

/*
 * Every shortcut is Ctrl (Cmd on macOS) plus the chord below. Letters and
 * digits match the character the layout produces, so they follow the
 * keyboard; the shifted chords match the physical key instead, since
 * Ctrl+Shift+8 produces a different character on a different layout.
 *
 * The table is the reference for what the editor can do without a mouse, so
 * it covers every toolbar button, and undo and redo, which have no button.
 * checkCommandCoverage rejects a name here that the command table does not
 * know.
 */
const editingShortcuts = [
    { key: "b", cmd: "bold" },
    { key: "i", cmd: "italic" },
    { key: "u", cmd: "underline" },
    { key: "k", cmd: "link" },
    { key: "x", shift: true, cmd: "strikeThrough" },
    { code: "Digit7", shift: true, cmd: "insertOrderedList" },
    { code: "Digit8", shift: true, cmd: "insertUnorderedList" },
    { code: "Period", shift: true, cmd: "formatBlock", val: "blockquote" },
    { code: "Backquote", cmd: "inlineCode" },
    { code: "Backquote", shift: true, cmd: "codeBlock" },
    { code: "Backslash", cmd: "removeFormat" },
    /* Ctrl+Alt+1 through Ctrl+Alt+6, one per level in headingLevels order. */
    ...headingLevels.map((level, index) => ({
        code: `Digit${index + 1}`,
        alt: true,
        cmd: "formatBlock",
        val: level,
    })),
    /*
     * Undo and redo are the one pair with no control of their own: the
     * keyboard is the only way to reach them, so they carry their own name
     * rather than borrowing one from a button.
     */
    { key: "z", cmd: "undo", label: "Undo" },
    { key: "y", cmd: "redo", label: "Redo" },
    { key: "z", shift: true, cmd: "redo", label: "Redo" },
    { key: "c", alt: true, cmd: "copyOutput" },
    { code: "Slash", cmd: "help" },
];

function matchesShortcut(shortcut, event) {
    const chord = shortcut.code
        ? shortcut.code === event.code
        : shortcut.key === event.key.toLowerCase();

    return (
        chord &&
        Boolean(shortcut.shift) === event.shiftKey &&
        Boolean(shortcut.alt) === event.altKey
    );
}

/* ---------- Leaving a block ---------- */

/*
 * What `element` holds up to, or from, the caret. The clone is read with
 * codeText rather than Range.toString(), which ignores <br> and the line a
 * block child ends, and those are how a break reaches the DOM.
 */
function contentBeforeCaret(element, range) {
    const before = document.createRange();

    before.selectNodeContents(element);
    before.setEnd(range.startContainer, range.startOffset);

    return before.cloneContents();
}

function contentAfterCaret(element, range) {
    const after = document.createRange();

    after.selectNodeContents(element);
    after.setStart(range.endContainer, range.endOffset);

    return after.cloneContents();
}

/* Whether a caret's worth of content holds line structure and nothing else. */
function isBlankContent(node) {
    return (
        codeText(node).replace(/\n/g, "").trim() === "" &&
        !node.querySelector("*:not(br)")
    );
}

/* The child of the editor that holds `node`. */
function editorChild(node) {
    let current = node;

    while (current.parentNode && current.parentNode !== editor) {
        current = current.parentNode;
    }

    return current;
}

/*
 * The inline code span the caret sits in, or null. A <code> inside a <pre>
 * is the code block's own element, and the code block rules own that one.
 */
function inlineCodeElement(node) {
    const element = closestElement(node);
    const code = element ? element.closest("code") : null;

    return code && !code.closest("pre") && editor.contains(code) ? code : null;
}

/*
 * The character that gives a caret a place of its own beside a code span.
 * Chrome reads a caret at the boundary between a span and the text next to it
 * as being inside the span, so a character typed there joins the code even
 * when the caret has just been walked out. A text node of its own is read as
 * prose, and this character is invisible, so the caret looks like it sits
 * where it was put. It never reaches the output.
 */
const caretAnchor = "\u200b";

/*
 * Where a caret leaving the span belongs. Prose at the edge already holds a
 * caret, and an anchor is added only where there is no text node to hold one,
 * so a span at the start or the end of its line is the only case that writes
 * to the document. The snapshot is committed here, before that write.
 */
function inlineCodeEscapePoint(code, forward) {
    const sibling = forward ? code.nextSibling : code.previousSibling;
    const text = sibling && sibling.nodeType === Node.TEXT_NODE ? sibling : null;

    if (!forward && text && text.data) {
        return { node: text, offset: text.data.length };
    }

    if (forward && text && text.data.startsWith(caretAnchor)) {
        return { node: text, offset: 1 };
    }

    flushSnapshot();

    const anchor = document.createTextNode(caretAnchor);

    if (forward) {
        code.after(anchor);
    } else {
        code.before(anchor);
    }

    return { node: anchor, offset: 1 };
}

/*
 * Arrow keys step out of an inline code span at either edge. Chrome keeps a
 * caret inside the span when there is nowhere else on the line to put it, so
 * a span that ends its block traps the caret and the next character typed
 * joins the code. Only the edge that has nowhere to go is taken over, and
 * the caret is given one step, never two.
 */
function stepOutOfInlineCode(direction) {
    const selection = window.getSelection();

    if (!selection.rangeCount || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const code = inlineCodeElement(range.startContainer);

    if (!code) return false;

    const forward = direction > 0;
    const atEdge = forward
        ? range.endOffset >= nodeOffset(range.endContainer)
        : range.startOffset === 0;

    if (!atEdge) return false;

    const beyond = forward
        ? contentAfterCaret(code, range)
        : contentBeforeCaret(code, range);

    if (!isBlankContent(beyond)) return false;

    const point = inlineCodeEscapePoint(code, forward);
    const target = document.createRange();

    target.setStart(point.node, point.offset);
    target.collapse(true);

    selection.removeAllRanges();
    selection.addRange(target);

    return true;
}

/*
 * Enter inside inline code would put the break in the span, which [code]
 * cannot hold, and Chrome's own paragraph command copies the span into the
 * block below when it is the last thing in its block. Everything after the
 * span moves into a new block of the same shape instead, so the break lands
 * on the far side of it and the span stays whole.
 */
function splitBlockAfterInlineCode(code) {
    const block = blockOf(code);
    const anchor = block === editor ? editorChild(code) : block;
    const paragraph = document.createElement(
        block === editor ? "p" : anchor.tagName.toLowerCase(),
    );

    while (code.nextSibling) paragraph.appendChild(code.nextSibling);

    if (!paragraph.firstChild) paragraph.innerHTML = "<br>";

    anchor.after(paragraph);
    placeCaret(paragraph);
}

/*
 * The line the caret sits on inside a quote: the block-level child holding
 * it, or the quote itself when the caret sits in the quote's own text, which
 * is the shape both the toolbar command and a typed ">" leave behind.
 */
function quoteLineAt(quote, range) {
    let node = range.startContainer;

    while (node && node.parentNode !== quote) node = node.parentNode;

    if (!node || node === quote || node.nodeType !== Node.ELEMENT_NODE) {
        return quote;
    }

    return blockLevelTags.has(node.tagName.toLowerCase()) ? node : quote;
}

/*
 * Whether nothing but line structure follows `line` inside `quote`.
 */
function blankAfterLine(quote, line) {
    const rest = document.createRange();

    rest.selectNodeContents(quote);
    rest.setStartAfter(line);

    return isBlankContent(rest.cloneContents());
}

/*
 * An empty line at the end of a quote is the way out of it, as it is at the
 * end of a code block: the caret has to be on that line, at the end of the
 * quote, with nothing but line breaks ahead of it.
 */
function quoteExitIsReady(quote, range) {
    const line = quoteLineAt(quote, range);
    const beyond = contentAfterCaret(line, range);

    if (!isBlankContent(beyond)) return false;

    if (line !== quote && !blankAfterLine(quote, line)) return false;

    return /(^|\n)$/.test(codeText(contentBeforeCaret(line, range)));
}

/*
 * The empty line that triggered the exit goes with the quote, and the quote
 * itself goes when nothing is left in it, so the caret's new paragraph never
 * lands under an empty quote box.
 */
function exitBlockquote(quote, line) {
    const paragraph = document.createElement("p");

    paragraph.innerHTML = "<br>";
    quote.after(paragraph);

    if (line !== quote) {
        line.remove();
    } else if (quote.lastChild && quote.lastChild.nodeName === "BR") {
        quote.lastChild.remove();
    }

    if (isBlankContent(quote)) quote.remove();

    placeCaret(paragraph);
}

editor.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;

    if (event.key === "Tab") {
        const selection = window.getSelection();
        const anchor = selection.rangeCount
            ? closestElement(selection.anchorNode)
            : null;
        const handled =
            anchor &&
            editor.contains(anchor) &&
            (anchor.closest("li") || anchor.closest("pre"));

        /*
         * Tab is only captured where it does something: nesting a list item
         * or indenting a code block. Everywhere else it keeps its default,
         * so it moves focus out of the editor instead of trapping it (WCAG
         * 2.1.2).
         */
        if (!handled) return;

        event.preventDefault();
        flushSnapshot();
        handleTab(event.shiftKey);
        queueSnapshot();
        render();
        updateToolbarState();
        return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        /*
         * The caret leaves an inline code span at either edge, so the span
         * cannot swallow what is typed after it. The default would add its
         * own step on top of the one just taken, so it is suppressed.
         */
        if (
            !mod &&
            !event.shiftKey &&
            stepOutOfInlineCode(event.key === "ArrowRight" ? 1 : -1)
        ) {
            event.preventDefault();
            queueSnapshot();
            render();
            updateToolbarState();
            return;
        }
    }

    if (event.key === "Enter" && !mod && !event.shiftKey) {
        const selection = window.getSelection();

        if (selection.rangeCount) {
            const range = selection.getRangeAt(0);
            const element = closestElement(range.startContainer);
            const pre = element ? element.closest("pre") : null;

            if (pre) {
                /*
                 * Enter inside a pre produces <br>, and Range.toString()
                 * ignores those, so the line the caret sits on has to be read
                 * from the DOM instead.
                 */
                const caretAtEnd = isBlankContent(
                    contentAfterCaret(pre, range),
                );
                const currentLineEmpty = /(^|\n)$/.test(
                    codeText(contentBeforeCaret(pre, range)),
                );

                if (selection.isCollapsed && caretAtEnd && currentLineEmpty) {
                    event.preventDefault();
                    flushSnapshot();

                    /*
                     * The empty final line that triggered the exit goes with
                     * it, whether it was a <br> or a lone newline.
                     */
                    if (pre.lastChild && pre.lastChild.nodeName === "BR") {
                        pre.lastChild.remove();
                    } else {
                        pre.textContent = pre.textContent.replace(
                            /\n$/,
                            "",
                        );
                    }

                    const paragraph = document.createElement("p");

                    paragraph.innerHTML = "<br>";
                    pre.after(paragraph);
                    placeCaret(paragraph);

                    queueSnapshot();
                    render();
                    updateToolbarState();
                    return;
                }
            } else {
                const code = inlineCodeElement(range.startContainer);

                /*
                 * A break inside inline code is not something [code] can hold,
                 * so the break goes after the span and the span stays whole.
                 * Chrome's own paragraph command would copy the span into the
                 * block below, or drop it entirely when its contents are
                 * selected, which is the selection the toolbar leaves behind.
                 */
                if (code && code.contains(range.endContainer)) {
                    event.preventDefault();
                    flushSnapshot();
                    splitBlockAfterInlineCode(code);
                    queueSnapshot();
                    render();
                    updateToolbarState();
                    return;
                }

                /*
                 * A blockquote traps the caret the way a code block does, and
                 * it gets the same way out: an empty line at its end.
                 */
                const quote = element ? element.closest("blockquote") : null;

                if (
                    selection.isCollapsed &&
                    quote &&
                    quoteExitIsReady(quote, range)
                ) {
                    event.preventDefault();
                    flushSnapshot();
                    exitBlockquote(quote, quoteLineAt(quote, range));
                    queueSnapshot();
                    render();
                    updateToolbarState();
                    return;
                }
            }
        }
    }

    if (!mod) return;

    const shortcut = editingShortcuts.find((entry) =>
        matchesShortcut(entry, event),
    );

    if (!shortcut) return;

    event.preventDefault();

    flushSnapshot();

    /* The same deferral as the toolbar: the link dialog takes it from here. */
    if (applyCommand(shortcut.cmd, shortcut.val)) return;

    queueSnapshot();
    render();
    updateToolbarState();
});

/* ---------- List editing ---------- */

/*
 * A marker at the start of a line: bullets from -, * and +, and numbers from
 * a "1." or "1)" prefix, each followed by the space that was just typed.
 */
const listMarkerPattern = /^[ \t\u00a0]*(?:[-*+]|\d+[.)]) $/;

/*
 * The other two markers an editor recognises. They are anchored to the line
 * with no leading whitespace: indentation is the nesting signal for a list,
 * but a heading or a quote indented by accident stays text. The heading one
 * is built from headingLevels, up with the rest of the levels.
 */
const quoteMarkerPattern = /^> $/;

/*
 * The block the caret belongs to: the list item holding it, or the element
 * that starts a line in the editor.
 */
function caretBlock(node) {
    const element = closestElement(node);
    const item = element?.closest("li");

    if (item) return item;

    let block = element;

    while (block && block !== editor && block.parentElement !== editor) {
        block = block.parentElement;
    }

    return block;
}

function textBefore(element, range) {
    const prefix = document.createRange();

    prefix.selectNodeContents(element);
    prefix.setEnd(range.startContainer, range.startOffset);

    return prefix.toString();
}

/*
 * The end of the item's own text, which is its content without the nested
 * lists that hang off it.
 */
function caretToItem(item) {
    const texts = [...item.childNodes].filter(
        (node) => node.nodeType === Node.TEXT_NODE,
    );
    const target = texts.length ? texts[texts.length - 1] : item;
    const range = document.createRange();

    range.setStart(target, nodeOffset(target));
    range.collapse(true);

    const selection = window.getSelection();

    selection.removeAllRanges();
    selection.addRange(range);
}

/*
 * Moving a list item with appendChild drops the selection to the editable in
 * Chrome, so the range is captured and re-applied around the move. The range
 * holds node references rather than a path, and the nodes travel with the
 * item, so it lands back on the same character.
 */
function preservingSelection(item, move) {
    const selection = window.getSelection();
    const range =
        selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    const result = move();

    if (range && editor.contains(range.startContainer)) {
        selection.removeAllRanges();
        selection.addRange(range);
    }

    /*
     * A caret that sat between nodes rather than in text is reported against
     * the parent element, which leaves it outside the item once the item has
     * moved.
     */
    if (!selection.anchorNode || !item.contains(selection.anchorNode)) {
        caretToItem(item);
    }

    return result;
}

/*
 * Chrome wraps the list rather than nesting the item when it indents, which
 * leaves a <ul> directly inside a <ul>. Moving the item into a list under the
 * item above it is the structure ServiceNow renders, and what an indent
 * means.
 */
function nestListItem(item) {
    return preservingSelection(item, () => {
        const list = item.parentElement;
        const previous = item.previousElementSibling;
        const tag = list ? list.tagName.toLowerCase() : "";

        if (!list || !previous || previous.tagName !== "LI") return false;

        /*
         * A bare <li> sits directly in the editor, whose tag is not a list,
         * so nesting it would build a stray <div> wrapper.
         */
        if (tag !== "ul" && tag !== "ol") return false;

        let sublist = previous.lastElementChild;

        if (!sublist || sublist.tagName.toLowerCase() !== tag) {
            sublist = document.createElement(tag);
            previous.appendChild(sublist);
        }

        sublist.appendChild(item);

        return true;
    });
}

function outdentListItem(item) {
    return preservingSelection(item, () => {
        const sublist = item.parentElement;

        if (!sublist) return false;

        const parentItem = sublist.parentElement;

        if (!parentItem || parentItem.tagName !== "LI") return false;

        const parentList = parentItem.parentElement;

        if (!parentList) return false;

        parentList.insertBefore(item, parentItem.nextElementSibling);

        /*
         * An empty list left behind renders as a stray bullet once its item
         * is gone, so it goes with it.
         */
        if (!sublist.querySelector("li")) sublist.remove();

        return true;
    });
}

function listItemsInSelection() {
    const selection = window.getSelection();

    if (!selection.rangeCount) return [];

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
        const item = closestElement(range.startContainer)?.closest("li");

        return item ? [item] : [];
    }

    return [...editor.querySelectorAll("ul, ol")].flatMap((list) =>
        [...list.querySelectorAll(":scope > li")].filter((item) =>
            range.intersectsNode(item),
        ),
    );
}

/*
 * The line the caret sits on becomes the first item of a new list. A line is
 * a block element; in an empty editor it is a bare text node, which moves
 * into the item whole rather than handing over children it does not have.
 */
function listifyLine(line, tag) {
    const list = document.createElement(tag);
    const item = document.createElement("li");
    const parent = line.parentNode;
    const position = line.nextSibling;
    const isText = line.nodeType === Node.TEXT_NODE;

    if (isText) {
        item.appendChild(line);
    } else {
        while (line.firstChild) item.appendChild(line.firstChild);
    }

    /*
     * An empty item leaves the caret nowhere to sit, so it carries an empty
     * text node to hold it.
     */
    if (!item.firstChild) item.appendChild(document.createTextNode(""));

    list.appendChild(item);

    if (isText) {
        parent.insertBefore(list, position);
    } else {
        line.replaceWith(list);
    }

    return item;
}

/*
 * The line the caret sits on. That is the block holding it, except in an
 * editor that holds nothing but text, where the line is a bare text node.
 * A caret between children is reported against the editor element itself,
 * and the line is then the child in front of it.
 */
function caretLine(block, range) {
    if (block !== editor) return block;

    if (range.startContainer !== editor) return range.startContainer;

    return editor.childNodes[range.startOffset - 1] || null;
}

/*
 * Typing a marker at the start of a line turns that line into the block it
 * names, the way a word processor does. Bullets and numbers build a list item,
 * a run of hashes builds a heading of that level, and a ">" builds a
 * blockquote. These are the markers the paste parser reads, so a marker that
 * works in pasted markdown works when it is typed.
 *
 * The list is built here rather than with execCommand, which Chrome ignores
 * for the length of the input event this runs in.
 */
function applyTypedMarker() {
    const selection = window.getSelection();

    if (!selection.rangeCount || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const block = caretBlock(range.startContainer);

    /* A marker inside code is code, not markup. */
    if (!block || block.closest("pre")) return false;

    const prefix = textBefore(block, range);
    const heading = prefix.match(headingMarkerPattern);
    const quote = quoteMarkerPattern.test(prefix);

    if (!heading && !quote && !listMarkerPattern.test(prefix)) return false;

    const line = caretLine(block, range);

    // The editor is not a line, and replacing it would take the page apart.
    if (!line || line === editor) return false;

    const blockMarker = Boolean(heading || quote);

    /*
     * Rebuilding a list item as a heading or a quote would take the list with
     * it, so a marker typed inside one stays text.
     */
    if (blockMarker && block.closest("li")) return false;

    flushSnapshot();

    if (blockMarker) {
        removeMarker(line, range, prefix);
        formatLine(line, heading ? `h${heading[1].length}` : "blockquote");
        return true;
    }

    const existing = block.closest("li");
    const nested = /^[ \t\u00a0]/.test(prefix);
    const tag = /^[ \t\u00a0]*[-*+]/.test(prefix) ? "ul" : "ol";

    removeMarker(line, range, prefix);

    const item = existing || listifyLine(line, tag);

    placeCaret(item);

    if (nested) nestListItem(item);

    return true;
}

/*
 * The marker is markup, not content, so it never reaches the block. A bare
 * text node is trimmed in place rather than deleted, since it is about to
 * become the block's content, and the marker is its entire text up to the
 * caret.
 */
function removeMarker(line, range, prefix) {
    if (line.nodeType === Node.TEXT_NODE) {
        line.deleteData(0, prefix.length);
        return;
    }

    const marker = document.createRange();

    marker.selectNodeContents(line);
    marker.setEnd(range.startContainer, range.startOffset);
    marker.deleteContents();
}

/*
 * The line is rebuilt as the block it becomes, rather than handed to
 * formatBlock. The command reads the block from the selection, and deleting
 * the marker can leave the selection in an empty block, where the command
 * promotes the line above instead. Moving the children across touches nothing
 * but the line the marker was typed on.
 */
function formatLine(line, tag) {
    if (
        line.nodeType === Node.ELEMENT_NODE &&
        line.tagName.toLowerCase() === tag
    ) {
        placeCaret(line);
        return;
    }

    const element = document.createElement(tag);

    if (line.nodeType === Node.TEXT_NODE) {
        /*
         * A bare text node is not a block, so it moves into the element whole
         * rather than handing over children it does not have.
         */
        line.replaceWith(element);
        element.appendChild(line);
    } else {
        while (line.firstChild) element.appendChild(line.firstChild);

        line.replaceWith(element);
    }

    /*
     * Chrome will not keep a caret in a block that holds nothing, and sends
     * the next keystroke to the line above. Deleting the marker leaves the
     * line with an empty text node at best, so the block is given the <br>
     * the browser itself leaves behind when the same block is made with the
     * heading menu.
     */
    if (!element.textContent && !element.querySelector("br")) {
        element.replaceChildren(document.createElement("br"));
    }

    placeCaret(element);
}

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

/* ---------- Entry lifecycle ---------- */

/*
 * The entry survives a reload. What is worth keeping is the editor DOM, and
 * it is already sanitised on the way in, so it is stored as HTML and put back
 * through the same sanitiser on the way out: whatever is in storage is held to
 * the rules a paste is held to, whether or not it came from one.
 */
const storageKey = "jff.entry.v1";

/*
 * The entry that the last Clear replaced. Clearing is a content change and
 * undo brings it back, but only until the next thing typed replaces the
 * entry, so the one that was cleared is kept beside it as well.
 */
const previousKey = "jff.entry.previous.v1";
const saveDelay = 400;

let saveTimer = null;

function storageAvailable() {
    try {
        return Boolean(window.localStorage);
    } catch {
        /* A blocked cookie store throws on the property, not on the write. */
        return false;
    }
}

/* Says so rather than leaving the entry to be lost silently at the reload. */
function setSaveState(failed) {
    saveState.hidden = !failed;
}

function saveEntry() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    if (!storageAvailable()) {
        setSaveState(true);
        return;
    }

    try {
        window.localStorage.setItem(storageKey, editor.innerHTML);
        setSaveState(false);
    } catch {
        /*
         * A full or read-only store is not worth interrupting the edit for,
         * but it does mean the entry is not being kept.
         */
        setSaveState(true);
    }
}

function queueSave() {
    if (!storageAvailable()) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveEntry, saveDelay);
}

/*
 * The debounce would otherwise drop the last keystrokes when the page is
 * hidden or unloaded, which is the one case the entry is being kept for.
 */
function flushSave() {
    if (saveTimer) saveEntry();
}

function restoreEntry() {
    const stored = readStoredEntry(storageKey);

    if (!stored) return false;

    const doc = parseStoredEntry(stored);

    if (doc.body.textContent.trim() === "" && !doc.body.querySelector("pre")) {
        return false;
    }

    editor.innerHTML = doc.body.innerHTML;

    return true;
}

/*
 * Anything out of storage goes through the clipboard rules whether or not it
 * came from a clipboard: an entry written by an older build, or one a drop
 * put there, is held to the rules a paste is held to.
 */
function parseStoredEntry(stored) {
    const doc = new DOMParser().parseFromString(stored, "text/html");

    sanitizeRichText(doc);
    wrapOrphanListItems(doc.body);

    return doc;
}

/*
 * Storage is read through the same guard as the write, so a browser that
 * refuses the property simply starts with an empty editor.
 */
function readStoredEntry(key) {
    if (!storageAvailable()) return "";

    try {
        return window.localStorage.getItem(key) || "";
    } catch {
        return "";
    }
}

function storePrevious(html) {
    if (!storageAvailable()) return;

    try {
        window.localStorage.setItem(previousKey, html);
    } catch {
        /* As in saveEntry: a store that refuses the write is not the edit's
           problem, and the entry in the editor is untouched by the failure. */
    }
}

/*
 * The slot is empty until an entry is cleared, which is the one state where
 * the button has nothing to do. It is hidden rather than disabled, so the
 * toolbar offers the recovery only while there is one to offer.
 */
function updateRestoreButton() {
    restoreBtn.hidden = readStoredEntry(previousKey) === "";
}

/*
 * Clearing is a content change like any other, so it goes through the undo
 * stack rather than past it: the entry is recoverable with Ctrl+Z. It is put
 * beside the entry as well, so it is still there after the undo window.
 */
function clearEntry() {
    if (editorIsEmpty()) return;

    flushSnapshot();
    storePrevious(editor.innerHTML);

    editor.innerHTML = "";
    commitSnapshot();

    render();
    updateToolbarState();
    updateRestoreButton();
    editor.focus();
}

/*
 * The cleared entry and the current one change places, so the button is its
 * own undo: a second press puts back what the first one replaced.
 */
function restorePrevious() {
    const stored = readStoredEntry(previousKey);

    if (!stored) return;

    flushSnapshot();

    const current = editor.innerHTML;

    editor.innerHTML = parseStoredEntry(stored).body.innerHTML;
    storePrevious(current);

    commitSnapshot();

    render();
    updateToolbarState();
    updateRestoreButton();
    editor.focus();
}

clearBtn.addEventListener("click", clearEntry);
restoreBtn.addEventListener("click", restorePrevious);

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
});

window.addEventListener("pagehide", flushSave);

/* ---------- ServiceNow serializer ---------- */

const inlineTags = new Set([
    "b",
    "strong",
    "i",
    "em",
    "s",
    "strike",
    "del",
    "u",
    "ins",
    "code",
    "a",
]);

const blockTags = new Set([
    "pre",
    "blockquote",
    "ul",
    "ol",
    ...headingLevels,
]);

/*
 * Elements that end a line inside a code block. Clipboard paste carries
 * line structure as <br>, rich text paste carries it as whole blocks, and
 * neither survives textContent.
 */
const codeBreakTags = new Set([
    "br",
    "p",
    "div",
    "li",
    "blockquote",
    ...headingLevels,
]);

const codeBreakSelector = [...codeBreakTags].join(", ");

/*
 * The delimiter ServiceNow reads as a code region. The three places that
 * spell it out - minting it in wrapCode, splitting it back out in codeRegion,
 * and breaking one typed as prose in serializeText - all derive from these,
 * so the wire format has one definition and no site can drift alone.
 */
const codeTag = "code";
const codeOpen = `[${codeTag}]`;
const codeClose = `[/${codeTag}]`;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function wrapCode(html) {
    return html ? `${codeOpen}${html}${codeClose}` : "";
}

function normalizeHref(value) {
    const href = value.trim();

    if (/^(https?:|mailto:|tel:)/i.test(href)) return href;

    if (href.startsWith("#")) return href;

    /*
     * A single leading slash is a same-site path. Two of them, or a slash
     * followed by a backslash, is resolved off-host by the browser.
     */
    if (
        href.startsWith("/") &&
        !href.startsWith("//") &&
        !href.startsWith("/\\")
    ) {
        return href;
    }

    return "";
}

/*
 * Word and Outlook autocorrect run before the paste reaches the browser, so
 * a code sample arrives with typographic punctuation: curly quotes, en and
 * em dashes, an ellipsis. Those characters break the code once it is pasted
 * out of ServiceNow, and inside [code] a straight ASCII character is what
 * was meant. Outside it the journal shows the text as written, which is
 * proper typography in prose, so this is scoped to code.
 */
const codeTypography = [
    [/\u200b|\u200c|\u200d|\ufeff/g, ""],
    [/\u00a0/g, " "],
    [/\u2018|\u2019|\u201b/g, "'"],
    [/\u201c|\u201d|\u201f/g, '"'],
    [/\u2026/g, "..."],
    [/\u2013/g, "-"],
    [/\u2014/g, "--"],
];

function normalizeCodePunctuation(text) {
    return codeTypography.reduce(
        (value, [pattern, replacement]) =>
            value.replace(pattern, replacement),
        text,
    );
}

function serializeText(node, insideCode) {
    const text = node.textContent.replace(/\u00a0/g, " ");

    if (insideCode) {
        /*
         * Inside [code] ServiceNow renders HTML, so literal characters must
         * be escaped.
         */
        return escapeHtml(normalizeCodePunctuation(text));
    }

    /*
     * Outside [code] the journal shows the text as written, so escaping
     * there would display entities instead of the characters typed. A
     * delimiter written as literal prose would still mint a live region
     * downstream, though, so a zero-width space after the bracket breaks it
     * for the renderer while staying invisible. The zero-width spaces that
     * hold a caret beside an inline code span are invisible too, and they are
     * dropped before the delimiters are rewritten. This runs in the prose
     * branch only: the regions the app builds are minted later by wrapCode
     * and are left untouched.
     */
    return text
        .replace(/\u200b/g, "")
        .replace(typedCodeDelimiter, (delimiter) =>
            delimiter.replace("[", "[\u200b"),
        );
}

/*
 * A paragraph-like block inside [code]: its own end supplies the line break,
 * so no separator is needed between blocks of another kind.
 */
function isParagraphBlock(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;

    const tag = node.tagName.toLowerCase();

    return tag === "p" || tag === "div";
}

/*
 * Inside [code] line structure is explicit: ServiceNow strips newlines and
 * <br>, so a paragraph is separated from its siblings by an empty <p></p>
 * rather than by a newline. Outside [code] the newline each block appends is
 * the break, and no separator is inserted.
 */
function serializeChildren(node, insideCode) {
    let html = "";
    let previous = null;

    for (const child of node.childNodes) {
        const part = serializeNode(child, insideCode);

        if (
            insideCode &&
            previous &&
            part !== "" &&
            !html.endsWith("<p></p>") &&
            (isParagraphBlock(previous) || isParagraphBlock(child))
        ) {
            html += "<p></p>";
        }

        html += part;

        if (part !== "") previous = child;
    }

    return html;
}

function codeText(element) {
    let text = "";

    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.data;
            continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = node.tagName.toLowerCase();

        if (tag === "br") {
            text += "\n";
        } else if (codeBreakTags.has(tag)) {
            if (text && !text.endsWith("\n")) {
                text += "\n";
            }

            text += `${codeText(node)}\n`;
        } else {
            text += codeText(node);
        }
    }

    return text;
}

function serializeHtmlElement(element) {
    const tag = element.tagName.toLowerCase();

    if (tag === "pre") {
        /*
         * codeText descends through a <code> child and over <br> and block
         * children, so a pre keeps every sibling of its code child instead
         * of dropping all but the first. Computing it here also avoids a
         * full child walk that the switch would otherwise discard.
         */
        const text = normalizeCodePunctuation(
            codeText(element).replace(/^\n+|\n+$/g, ""),
        );

        return `<pre><code>${escapeHtml(text)}</code></pre>`;
    }

    const inner = serializeChildren(element, true);

    /*
     * ServiceNow keeps the level it is given, so an h1 stays an h1 instead of
     * being rewritten to h3 or demoted to bold.
     */
    if (headingLevels.includes(tag)) {
        return `<${tag}>${inner}</${tag}>`;
    }

    switch (tag) {
        case "b":
        case "strong":
            return `<b>${inner}</b>`;

        case "i":
        case "em":
            return `<em>${inner}</em>`;

        case "s":
        case "strike":
        case "del":
            return `<strike>${inner}</strike>`;

        case "u":
        case "ins":
            return `<u>${inner}</u>`;

        case "code":
            // Intentionally bold inline code for ServiceNow readability.
            return `<b><code>${inner}</code></b>`;

        case "blockquote":
            return `<blockquote>${inner}</blockquote>`;

        case "a": {
            const href = normalizeHref(
                element.getAttribute("href") || "",
            );

            if (!href) return inner;

            return `<a href="${escapeAttr(href)}">${inner}</a>`;
        }

        case "ul":
        case "ol":
            return `<${tag}>${inner}</${tag}>`;

        case "li":
            return `<li>${inner}</li>`;

        case "br":
            /*
             * ServiceNow strips ordinary newlines and <br> inside [code].
             * This is one of the few places where <p></p> is necessary.
             */
            return "<p></p>";

        case "p":
        case "div":
            return inner;

        default:
            return inner;
    }
}

function serializeNode(node, insideCode = false) {
    if (node.nodeType === Node.TEXT_NODE) {
        return serializeText(node, insideCode);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    const tag = node.tagName.toLowerCase();

    if (insideCode) {
        return serializeHtmlElement(node);
    }

    if (tag === "p" || tag === "div") {
        const content = serializeChildren(node, false);

        if (!content) return "\n";

        /*
         * A block that already ends with a child's newline - a list or a
         * blockquote wrapped in a paragraph - must not add a second one,
         * which would show up as a blank line before whatever follows.
         */
        return content.endsWith("\n") ? content : `${content}\n`;
    }

    /*
     * A list item outside a list carries its own line, so a fragment of bare
     * <li> elements does not serialize as one joined line.
     */
    if (tag === "li") {
        const content = serializeChildren(node, false);

        return content ? `${content}\n` : "\n";
    }

    if (tag === "br") {
        return "\n";
    }

    if (inlineTags.has(tag) || blockTags.has(tag)) {
        const html = serializeHtmlElement(node);
        const suffix = blockTags.has(tag) ? "\n" : "";

        return `${wrapCode(html)}${suffix}`;
    }

    return serializeChildren(node, false);
}

/*
 * split() keeps the captured [code] regions at odd indices. Only the prose
 * is tidied, so code keeps its trailing whitespace and blank lines.
 */
const codeRegion = new RegExp(
    `(${escapeRegExp(codeOpen)}[\\s\\S]*?${escapeRegExp(codeClose)})`,
);

/* A delimiter typed as prose, whole, so it can be broken in the middle. */
const typedCodeDelimiter = new RegExp(
    `${escapeRegExp(codeOpen)}|${escapeRegExp(codeClose)}`,
    "gi",
);

function tidyProse(text) {
    return text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
}

/* ---------- Output size ---------- */

/*
 * The length of the entry as it will be pasted. A journal field is a
 * multi-line text field and is cut at its own length, and ServiceNow's own
 * guidance is to show how much room is left rather than let a paste be
 * truncated. Instances differ, so the length is one constant.
 */
const journalCharLimit = 4000;

function updateOutputStats(body) {
    if (body === "") {
        outputStats.textContent = "";
        outputStats.classList.remove("is-over");
        outputStats.title = "";
        return;
    }

    const lines = body.split("\n").length;
    const over = body.length > journalCharLimit;

    outputStats.textContent =
        `${body.length.toLocaleString()} / ${journalCharLimit.toLocaleString()} chars` +
        ` · ${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`;

    outputStats.classList.toggle("is-over", over);

    outputStats.title = over
        ? `Over the ${journalCharLimit.toLocaleString()} character limit by ${(
              body.length - journalCharLimit
          ).toLocaleString()}`
        : "";
}

/*
 * Only the [code] regions are coloured, so the markup stands out from the
 * prose at a glance. The colour sits on a span, and a copy takes textContent,
 * so what is pasted is plain text with no formatting attached.
 */
function paintOutput(body) {
    const fragment = document.createDocumentFragment();

    body.split(codeRegion).forEach((part, index) => {
        if (part === "") return;

        if (index % 2 === 0) {
            fragment.append(document.createTextNode(part));
            return;
        }

        const region = document.createElement("span");
        region.className = "code-region";
        region.textContent = part;
        fragment.append(region);
    });

    output.replaceChildren(fragment);
}

function render() {
    /*
     * Blank lines at either end come from an empty first or last block and
     * are dropped, but the indentation of the first line is not: it is what
     * survives of a pasted snippet's leading whitespace.
     */
    const body = serializeChildren(editor, false)
        .split(codeRegion)
        .map((part, index) => (index % 2 ? part : tidyProse(part)))
        .join("")
        .replace(/^[ \t]*\n+/, "")
        .replace(/\n+[ \t]*$/, "")
        .replace(/[ \t]+$/, "");

    paintOutput(body);
    output.classList.toggle("is-empty", body === "");
    for (const button of copyButtons) button.disabled = body === "";

    updateOutputStats(body);

    /*
     * render() is the one hook every content change already runs, so the
     * placeholder, the Clear button and the saved entry are refreshed here
     * rather than at each call site.
     */
    updatePlaceholder();
    clearBtn.disabled = editorIsEmpty();
    queueSave();
}

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
    notice.hidden = false;

    noticeTimer = setTimeout(() => {
        noticeTimer = null;
        notice.hidden = true;
    }, noticeDelay);
}

/*
 * Rich clipboard HTML as editor content. Reports how much of it held a
 * picture, and whether anything was left to insert: clipboard HTML can carry
 * structure but no content - a lone <meta> tag, or an image the sanitizer
 * drops, which is the payload a screenshot paste arrives as.
 */
function insertRichText(html) {
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
        return { inserted: false, dropped };
    }

    insertHtmlAtCursor(doc.body.innerHTML);

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

/* ---------- Helpers ---------- */

function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/*
 * A line that carries code rather than prose: punctuation that only appears
 * in code, a language keyword, a call, an assignment, or indentation.
 */
const codeShapes = [
    /[;{}]|=>|==|!=|:=|<=|>=/,
    /\b(?:def|function|class|return|import|from|const|let|var|public|private|protected|static|void|int|float|double|bool|string|true|false|null|nil|print|printf|echo|console|require|await|async|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|GROUP|ORDER)\b/i,
    /[A-Za-z_$][\w$]*\s*\(/,
    /\w\s*[=<>!]=?\s*\S/,
    /^\s+\S/,
];

const codeComments = /^\s*(?:#|\/\/|--|;|%)/;

/*
 * A plain-text paste that is really a code sample should not be run through
 * the markdown parser, whatever its comment lines look like. It counts as
 * code when there are at least two lines and every non-empty line is either
 * a comment or one of the shapes above, with at least one shape rather than
 * only comments.
 */
function looksLikeCode(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");

    if (lines.length < 2) return false;

    let definite = false;

    for (const line of lines) {
        if (codeComments.test(line)) continue;

        if (!codeShapes.some((pattern) => pattern.test(line))) {
            return false;
        }

        definite = true;
    }

    return definite;
}

function looksLikeMarkdown(text) {
    const blockMarker = new RegExp(
        `^(#{1,${headingLevels.length}}\\s|[-*+]\\s|\\d+[.)]\\s|>\\s|\`\`\`)`,
        "m",
    );
    const inlineMarker =
        /(\*\*[^*]+\*\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/;

    if (!blockMarker.test(text) && !inlineMarker.test(text)) {
        return false;
    }

    return !looksLikeCode(text);
}

/* ---------- Events ---------- */

editor.addEventListener("input", (event) => {
    /*
     * A marker is only complete once its trailing space is in the DOM, so the
     * conversion runs from the input event rather than from keydown, where
     * the space has not been inserted yet.
     */
    if (event.inputType === "insertText" && event.data === " ") {
        applyTypedMarker();
    }

    queueSnapshot();
    render();
    updateToolbarState();
});

editor.addEventListener("keyup", updateToolbarState);
editor.addEventListener("mouseup", updateToolbarState);
editor.addEventListener("focus", updateToolbarState);

/*
 * A link in the editor is inert, because a click has to place the caret for
 * the words to be edited. Following one is the mouse gesture the browser
 * reserves for it - Ctrl (Cmd) with the left button, or the middle button -
 * and it opens the href in a new tab.
 */
function linkOpenGesture(event) {
    if (!linkAt(event.target)) return false;

    return (
        event.button === 1 ||
        (event.button === 0 && (event.ctrlKey || event.metaKey))
    );
}

function followLink(event) {
    event.preventDefault();

    window.open(linkAt(event.target).href, "_blank", "noopener");
}

/* The press is what moves the caret, so it is the event that must not. */
editor.addEventListener("mousedown", (event) => {
    if (linkOpenGesture(event)) event.preventDefault();
});

editor.addEventListener("click", (event) => {
    if (linkOpenGesture(event)) followLink(event);
});

editor.addEventListener("auxclick", (event) => {
    if (linkOpenGesture(event)) followLink(event);
});

document.addEventListener("selectionchange", () => {
    requestAnimationFrame(updateToolbarState);
});

const copyLabelDelay = 1200;

/* The label the flash returns to is the button's own, so it is written once. */
const copyLabel = copyBtn.textContent.trim();

let copyLabelTimer = null;

function flashCopyLabel(text, failed) {
    /*
     * A stored handle means a second click cannot be cut short by the first
     * click's timer resetting the label.
     */
    clearTimeout(copyLabelTimer);

    for (const button of copyButtons) {
        button.textContent = text;
        button.classList.toggle("error", Boolean(failed));
    }

    copyLabelTimer = setTimeout(() => {
        copyLabelTimer = null;
        for (const button of copyButtons) {
            button.textContent = copyLabel;
            button.classList.remove("error");
        }
    }, copyLabelDelay);
}

/* ---------- Copy settings menu ---------- */

/*
 * The one copy preference is a checkable item in each Copy button's menu
 * rather than a checkbox of its own. It is held here and mirrored onto every
 * item's aria-checked, which is also what draws the checkmark.
 */
let clearAfterCopyEnabled = false;

function setClearAfterCopy(enabled) {
    clearAfterCopyEnabled = enabled;

    for (const item of clearAfterCopyItems) {
        item.setAttribute("aria-checked", String(enabled));
    }
}

function setCopyMenuOpen(menu, toggle, open, focusItem = false) {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));

    if (open && focusItem) {
        menu.querySelector(".clear-after-copy-item").focus();
    }
}

function closeCopyMenus() {
    for (const { menu, toggle } of copyMenuControls) {
        if (!menu.hidden) setCopyMenuOpen(menu, toggle, false);
    }
}

/*
 * Two Copy buttons run the one command, and the output pane's hides with the
 * pane while the toolbar's takes its place, so each carries its own menu and
 * they share the setting between them. Both toggles are wired directly: the
 * toolbar's is not the heading toggle, which the toolbar handler owns.
 */
const copyMenuControls = copyDropdowns.map((dropdown) => {
    const toggle = dropdown.querySelector(".copy-toggle");
    const menu = dropdown.querySelector(".copy-menu");
    const item = dropdown.querySelector(".clear-after-copy-item");

    toggle.addEventListener("click", (event) => {
        const opening = menu.hidden;

        closeCopyMenus();

        /* Keyboard activation opens onto the item, so a second Enter may toggle it. */
        if (opening) setCopyMenuOpen(menu, toggle, true, event.detail === 0);
    });

    item.addEventListener("click", () => {
        setClearAfterCopy(!clearAfterCopyEnabled);
        setCopyMenuOpen(menu, toggle, false);
        toggle.focus();
    });

    /* Escape returns to the toggle; Tab closes and moves on, as with the toolbar. */
    menu.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            setCopyMenuOpen(menu, toggle, false);
            toggle.focus();
            return;
        }

        if (event.key === "Tab") setCopyMenuOpen(menu, toggle, false);
    });

    return { menu, toggle };
});

/*
 * The legacy command is the fallback for navigator.clipboard being undefined
 * on a non-secure origin, and for a rejected write. It works from a temporary
 * selection, since the output pane is not selectable for this purpose.
 */
function copyViaExecCommand(text) {
    const area = document.createElement("textarea");

    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.top = "-1000px";

    document.body.appendChild(area);
    area.select();

    let copied = false;

    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }

    area.remove();

    return copied;
}

/*
 * Reached by the button and by the chord, so the copy itself is not the
 * button's handler.
 */
async function copyOutput() {
    closeCopyMenus();

    const text = output.textContent;

    let copied = false;

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            copied = true;
        }
    } catch {
        copied = false;
    }

    if (!copied) copied = copyViaExecCommand(text);

    flashCopyLabel(copied ? "Copied!" : "Copy failed", !copied);

    /* The one-step loop: copy and the entry resets itself for the next one. */
    if (copied && clearAfterCopyEnabled) clearEntry();
}

copyBtn.addEventListener("click", copyOutput);

/* ---------- Pane split and collapse ---------- */

const splitKey = "jff.split.v1";
const outputVisibleKey = "jff.outputVisible.v1";

let splitRatio = Number.parseFloat(readStoredEntry(splitKey));
if (!Number.isFinite(splitRatio) || splitRatio < 0.2 || splitRatio > 0.8) {
    splitRatio = 0.5;
}

/* Defaults to visible, since an empty slot predates the toggle. */
let outputVisible = readStoredEntry(outputVisibleKey) !== "0";

function applySplit() {
    const width = mainEl.getBoundingClientRect().width;

    mainEl.style.setProperty("--editor-w", `${Math.round(width * splitRatio)}px`);
}

function storeSplit() {
    if (!storageAvailable()) return;

    try {
        window.localStorage.setItem(splitKey, String(splitRatio));
    } catch {
        /* A store that refuses the write changes nothing, as with the entry. */
    }
}

splitDivider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    splitDivider.setPointerCapture(event.pointerId);
    splitDivider.classList.add("is-dragging");
});

splitDivider.addEventListener("pointermove", (event) => {
    if (!splitDivider.hasPointerCapture(event.pointerId)) return;

    const rect = mainEl.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;

    splitRatio = Math.min(0.8, Math.max(0.2, ratio));
    applySplit();
});

splitDivider.addEventListener("pointerup", (event) => {
    if (!splitDivider.hasPointerCapture(event.pointerId)) return;

    splitDivider.releasePointerCapture(event.pointerId);
    splitDivider.classList.remove("is-dragging");
    storeSplit();
});

splitDivider.addEventListener("pointercancel", () => {
    splitDivider.classList.remove("is-dragging");
});

window.addEventListener("resize", () => {
    if (outputVisible) applySplit();

    /* Crossing the breakpoint changes which layout decides the pane, and with
       it where Copy sits. */
    syncCopyPlacement();
});

/* The breakpoint the stylesheet uses: above it the output collapses to a
   column, at or below it the view tabs show one pane at a time. */
const narrowLayout = matchMedia("(max-width: 800px)");

/*
 * Copy is one control that moves, not two that show at once. It belongs in the
 * output head while that pane is on screen, and in the toolbar the moment it
 * is not, so this asks whichever layout is live which pane is showing rather
 * than reading either flag on its own: the wide layout collapses the pane with
 * outputVisible, the narrow one swaps panes with the view tabs.
 */
function syncCopyPlacement() {
    const paneOnScreen = narrowLayout.matches
        ? mainEl.dataset.view === "output"
        : outputVisible;

    toolbarCopyDropdown.hidden = paneOnScreen;
    toolbarCopySep.hidden = paneOnScreen;
}

/*
 * The class drives the resting state: it flips the columns and fades the pane.
 * The column change itself is eased below.
 */
function applyOutputVisible() {
    mainEl.classList.toggle("output-collapsed", !outputVisible);
    showOutputBtn.hidden = outputVisible;
    syncCopyPlacement();
}

/* The fade the stylesheet runs on the pane and divider, in milliseconds. The
   slide below uses the same figure so the two stay in step. */
const collapseDuration = 240;

let collapseAnim = null;

/*
 * The class flips the columns in one step; this eases them instead. It reads
 * the real grid on either side of the flip, so the keyframes honour the
 * minmax(220px, …) floor the editor yields to on a narrow window, and it is
 * driven from JavaScript because Chrome's own grid-track interpolation jumps
 * between a minmax(…) track and a bare 0px rather than sliding.
 */
function animateOutputPane(from, to) {
    if (collapseAnim) collapseAnim.cancel();

    const anim = mainEl.animate(
        { gridTemplateColumns: [from, to] },
        { duration: collapseDuration, easing: "ease" },
    );
    collapseAnim = anim;
    anim.onfinish = () => {
        if (collapseAnim === anim) collapseAnim = null;
    };
}

function setOutputVisible(visible) {
    outputVisible = visible;

    /* The grid as laid out now, before the class flips it. */
    const from = getComputedStyle(mainEl).gridTemplateColumns;

    applyOutputVisible();
    syncToolbarTabStops();

    /* A restore after the window was resized while collapsed re-derives the
       ratio from the current width, so the editor does not settle on a width
       the window no longer has. */
    if (visible) applySplit();

    animateOutputPane(from, getComputedStyle(mainEl).gridTemplateColumns);

    if (storageAvailable()) {
        try {
            window.localStorage.setItem(outputVisibleKey, visible ? "1" : "0");
        } catch {
            /* Same refusal guard as the entry save. */
        }
    }
}

hideOutputBtn.addEventListener("click", () => setOutputVisible(false));
showOutputBtn.addEventListener("click", () => setOutputVisible(true));

/* ---------- View tabs ---------- */

/*
 * A narrow window shows one pane at a time. The stylesheet does the hiding,
 * so this only records which one is chosen and keeps focus out of the pane
 * that has just gone.
 */
function setView(view) {
    mainEl.dataset.view = view;

    for (const tab of viewTabs) {
        tab.setAttribute("aria-current", String(tab.dataset.view === view));
    }

    syncCopyPlacement();
    syncToolbarTabStops();

    if (document.activeElement && !document.activeElement.offsetParent) {
        const tab = viewTabs.find((button) => button.dataset.view === view);

        if (tab) tab.focus();
    }
}

for (const tab of viewTabs) {
    tab.addEventListener("click", () => setView(tab.dataset.view));
}

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

/*
 * A restored entry is the baseline the undo stack starts from, so it is in
 * place before the first snapshot is taken.
 */
restoreEntry();
updateRestoreButton();

/* The split and collapse preferences apply before the first paint, so the
   panes do not flash at the default half-and-half first. */
applyOutputVisible();
applySplit();

commitSnapshot();
render();
updateToolbarState();

/* The tool's one job is a paste, so the caret is waiting for it. The narrow
   layout is a phone-first fallback, and a keyboard popped open on load is
   worse there than the one tap it saves. */
if (matchMedia("(min-width: 801px)").matches) editor.focus();
