/* Pressed state, tab ring and the heading dropdown.
   Split out of app.js, lines 968-1200. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Toolbar active state ---------- */

function setButtonActive(button, active) {
    button.setAttribute("aria-pressed", String(active));
}

function normalizeBlockName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[<>]/g, "");
}

/*
 * The element the toolbar state was last read from. A press on a control can
 * clear a caret the browser has nowhere to paint, most visibly inside an
 * empty inline code span, so the command falls back to the element that made
 * the button active rather than acting on no selection at all.
 */
let lastSelectedElement = null;

function updateToolbarState() {
    const selectedElement = getSelectedElement();

    lastSelectedElement = selectedElement;

    const caret = captureCaret();

    if (caret) lastEditorCaret = caret;

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
 * One button in place of the menu's items. Its label carries the level the
 * caret is on and the menu marks the same item, so the control always shows
 * what is in use without spending a button per level.
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
    const levelNumber = headingLevels.indexOf(level) + 1;

    headingToggle.textContent = level ? `Heading ${levelNumber}` : "Heading";
    headingToggle.classList.toggle("is-active", Boolean(level));

    for (const item of headingMenu.querySelectorAll("button[data-val]")) {
        item.setAttribute("aria-checked", String(item.dataset.val === level));
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

    if (!savedMenu.hidden && !event.target.closest("#savedDropdown")) {
        setSavedMenuOpen(false);
    }
});

/*
 * Escape closes whatever menu is open, wherever the focus is. The controls
 * that keep the editor's caret from being disturbed do not take focus when
 * they open, so the key arrives at the editor rather than at the menu, and a
 * menu cannot hear it from there.
 */
document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (!savedMenu.hidden) {
        setSavedMenuOpen(false);
        savedToggle.focus();
    }

    if (!headingMenu.hidden) {
        closeHeadingMenu();
        headingToggle.focus();
    }
});
