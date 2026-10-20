/* Toolbar delegation and the command table every button and shortcut shares.
   Split out of app.js, lines 281-648. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Command bars ---------- */

/*
 * The formatting toolbar and the action row under the field both hold
 * command buttons, so both share this delegation. The heading dropdown only
 * exists in the toolbar, and the saved menu keeps its own listener.
 */
function commandPress(event) {
    /*
     * A press on a control can clear a caret the browser has nowhere to paint
     * before this handler runs. When the editor still holds focus, the caret
     * the toolbar last read is put back so the command has a target.
     */
    if (
        !window.getSelection().rangeCount &&
        document.activeElement === editor &&
        lastEditorCaret
    ) {
        applyCaret(lastEditorCaret);
    }

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
}

/*
 * Enter or Space on a focused toolbar button raises a click with detail 0
 * and never raises mousedown, so keyboard activation needs its own path. A
 * real mouse click also raises click, with a non-zero detail, and is already
 * handled above.
 */
function commandActivate(event) {
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
}

for (const bar of [toolbar, editorActions]) {
    bar.addEventListener("mousedown", commandPress);
    bar.addEventListener("click", commandActivate);
}

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
             * Clicking the block already in use turns it off rather than
             * reapplying it: an h2 that is already an h2 becomes a paragraph,
             * and so does a blockquote. The browser's own formatBlock cannot
             * do the quote - handing it "p" inside a quote changes nothing -
             * so the toggle rebuilds the block itself.
             */
            if (
                isToggleBlock(value) &&
                blockAtCaretMatches(value) &&
                clearBlockFormatting(value)
            ) {
                return false;
            }

            return execCommand("formatBlock", value);
        },
        isActive: (value) =>
            normalizeBlockName(document.queryCommandValue("formatBlock")) ===
            normalizeBlockName(value),
    },
    inlineCode: {
        run: () => {
            /*
             * The same button takes the span off again. A collapsed caret or
             * a selection inside a span would otherwise be wrapped a second
             * time, leaving nested code elements that only another click can
             * undo.
             */
            const selection = window.getSelection();
            const codes = selection.rangeCount
                ? inlineCodesInRange(selection.getRangeAt(0))
                : [];
            const fallback = selection.rangeCount
                ? null
                : inlineCodeElement(lastSelectedElement);

            if (fallback && !codes.includes(fallback)) codes.push(fallback);

            if (codes.length) {
                removeInlineCode(codes);

                return false;
            }

            wrapInlineCode();

            return false;
        },
        isActive: (value, element) =>
            Boolean(element.closest("code")) && !element.closest("pre"),
    },
    codeBlock: {
        run: () => {
            /*
             * formatBlock makes a paragraph *inside* the pre rather than
             * replacing it, so clicking the button again rebuilds the block
             * here: the code text becomes paragraphs and the pre goes.
             */
            const selection = window.getSelection();
            const element = selection.rangeCount
                ? getSelectedElement()
                : lastSelectedElement;
            const pre = element ? element.closest("pre") : null;

            if (pre && editor.contains(pre)) {
                const range = selection.rangeCount
                    ? selection.getRangeAt(0)
                    : null;
                const start = range
                    ? { node: range.startContainer, offset: range.startOffset }
                    : null;
                const end = range
                    ? { node: range.endContainer, offset: range.endOffset }
                    : null;
                const paragraph = clearCodeBlock(pre);

                if (!start || !restoreSelection(start, end)) {
                    placeCaretInBlock(paragraph);
                }

                return false;
            }

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

/*
 * A block that has just been emptied gets the <br> it needs and puts the
 * caret in front of it, so typing fills the block instead of leaving the
 * blank line above the text.
 */
function placeCaretInBlock(block) {
    if (block !== editor && !block.firstChild) {
        block.appendChild(document.createElement("br"));
    }

    if (
        block !== editor &&
        block.childNodes.length === 1 &&
        block.firstChild.nodeName === "BR"
    ) {
        placeCaret(block);
    } else {
        placeCaretAtEnd(block);
    }
}

/* The block formats the toolbar toggles: a heading level or a quote. */
function isToggleBlock(value) {
    const tag = normalizeBlockName(value);

    return headingLevels.includes(tag) || tag === "blockquote";
}

/* Whether the block at the caret is already the format the button names. */
function blockAtCaretMatches(value) {
    const selection = window.getSelection();
    const element = selection.rangeCount
        ? getSelectedElement()
        : lastSelectedElement;
    const block = element ? caretBlock(element) : null;

    return Boolean(
        block &&
            block !== editor &&
            block.nodeType === Node.ELEMENT_NODE &&
            block.tagName.toLowerCase() === normalizeBlockName(value),
    );
}

/*
 * Takes a block format off every line the selection touches. Rebuilding the
 * block rather than handing formatBlock a paragraph is what makes a quote
 * toggle: inside a quote the browser command changes nothing, and a quote
 * holding paragraphs has to be unwrapped rather than turned into a p.
 */
function clearBlockFormatting(value) {
    const selection = window.getSelection();
    const live = selection.rangeCount ? selection.getRangeAt(0) : null;
    let range = live;

    /*
     * A press can clear a caret the browser has nowhere to paint. The block
     * the button was active on is then selected as a whole, which is what
     * clearing a block tag does anyway.
     */
    if (!range && lastSelectedElement) {
        const block = caretBlock(lastSelectedElement);

        if (block && block !== editor) {
            range = document.createRange();
            range.selectNodeContents(block);
        }
    }

    if (!range) return false;

    const start = live
        ? { node: range.startContainer, offset: range.startOffset }
        : null;
    const end = live
        ? { node: range.endContainer, offset: range.endOffset }
        : null;
    const lines = formattingLines(range).filter(
        (line) =>
            line.nodeType === Node.ELEMENT_NODE &&
            line.tagName.toLowerCase() === normalizeBlockName(value),
    );

    if (!lines.length) return false;

    let last = null;

    for (const line of lines) {
        last = clearBlockFormat(line) ?? last;
    }

    if (!start || !restoreSelection(start, end)) {
        placeCaretInBlock(last ?? editor);
    }

    return true;
}

/*
 * The reverse of a code block. formatBlock puts a paragraph inside the pre
 * instead of replacing it, so the code text is rebuilt as paragraphs, with
 * a break where each newline was.
 */
function clearCodeBlock(pre) {
    const text = codeText(pre).replace(/^\n+|\n+$/g, "");
    const paragraph = document.createElement("p");

    text.split("\n").forEach((line, index) => {
        if (index) paragraph.appendChild(document.createElement("br"));
        if (line) paragraph.appendChild(document.createTextNode(line));
    });

    if (!paragraph.firstChild) {
        paragraph.appendChild(document.createElement("br"));
    }

    pre.replaceWith(paragraph);

    return paragraph;
}

/*
 * The inline code spans the selection is in or covers. A span nested inside
 * another one is left to the outer unwrap: removing the outer span removes
 * the reason the inner one was made.
 */
function inlineCodesInRange(range) {
    const start = inlineCodeElement(range.startContainer);
    const end = inlineCodeElement(range.endContainer);

    if (start && start === end) return [start];

    const codes = [...editor.querySelectorAll("code")].filter(
        (code) => !code.closest("pre") && range.intersectsNode(code),
    );

    return codes.filter(
        (code) => !codes.some((other) => other !== code && other.contains(code)),
    );
}

/*
 * Unwraps the spans and leaves the caret where it was. An empty span has no
 * text node for the selection to land on once the element is gone, so the
 * block takes the caret instead, with the <br> an empty block needs.
 */
function removeInlineCode(codes) {
    const selection = window.getSelection();
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    const start = range
        ? { node: range.startContainer, offset: range.startOffset }
        : null;
    let fallback = null;

    for (const code of codes) {
        fallback = code.parentNode ?? fallback;
        unwrapElement(code);
    }

    if (range && !range.collapsed) return;

    if (start && restoreSelection(start, start)) return;

    placeCaretInBlock(caretBlock(fallback ?? editor) ?? editor);
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
