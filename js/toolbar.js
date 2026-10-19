/* Toolbar delegation and the command table every button and shortcut shares.
   Split out of app.js, lines 281-648. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

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
        run: (value) => {
            /*
             * Clicking the level already in use turns a heading off rather
             * than reapplying it: an h2 that is already an h2 becomes a
             * paragraph. A blockquote is not a level, so it never toggles.
             */
            const current = normalizeBlockName(
                document.queryCommandValue("formatBlock"),
            );
            const off =
                headingLevels.includes(value) &&
                current === normalizeBlockName(value);

            return execCommand("formatBlock", off ? "p" : value);
        },
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
    /*
     * The browser command only clears character formatting and ignores a
     * heading or a quote, so the editor's own version does both.
     */
    removeFormat: {
        run: () => {
            clearFormatting();

            return false;
        },
    },
    /*
     * The shortcut reference, now a Settings section. The chord lands there
     * rather than on a dialog of its own; it changes nothing in the entry,
     * and the command is here so the shortcut table can name it.
     */
    help: {
        run: () => {
            openSettingsDialogAt("shortcuts");

            return true;
        },
    },
    /*
     * The chord reaches Copy through this table, and so does the toolbar's
     * button through the toolbar's command delegation.
     */
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
