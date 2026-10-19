/* The keyboard shortcut table.
   Split out of app.js, lines 1835-1890. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

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
    { code: "Slash", cmd: "help", label: "Keyboard shortcuts" },
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
