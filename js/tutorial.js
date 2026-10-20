/* First-run tutorial and the preference that suppresses it.
   Load order matters: keep the <script> tag for this file after entry.js
   (readStoredEntry) and dialogs.js (closeOnBackdrop), and before io.js, which
   calls maybeShowTutorial at start-up. */

/* ---------- Tutorial ---------- */

const tutorialHiddenKey = "jff.tutorialHidden.v1";

const tutorialSteps = [
    ...tutorialDialog.querySelectorAll(".tutorial-step"),
];

let tutorialIndex = 0;

/* The one stored preference: true means the walkthrough stays closed. */
function tutorialIsHidden() {
    return readStoredEntry(tutorialHiddenKey) === "true";
}

/*
 * The checkbox in the tutorial and the one in Settings are two faces of the
 * same preference, so both are set from the value that was just chosen rather
 * than read back. A store that refuses the write still leaves the controls
 * showing what this visit chose; only the next page load loses it.
 */
function setTutorialHidden(hidden) {
    try {
        if (hidden) {
            window.localStorage.setItem(tutorialHiddenKey, "true");
        } else {
            window.localStorage.removeItem(tutorialHiddenKey);
        }
    } catch {
        /* The walkthrough still works; only the choice is lost at reload. */
    }

    tutorialHideInput.checked = hidden;
    tutorialStartInput.checked = !hidden;
}

function syncTutorialPreference() {
    const hidden = tutorialIsHidden();

    tutorialHideInput.checked = hidden;
    tutorialStartInput.checked = !hidden;
}

/*
 * Steps are switched with the hidden attribute rather than rebuilt, so the
 * screenshots are decoded once and the scroll position of one step does not
 * follow the next. Back is hidden at the start: the first screen offers only
 * the way forward, and it appears once there is something to go back to.
 */
function showTutorialStep(index) {
    tutorialIndex = Math.max(0, Math.min(index, tutorialSteps.length - 1));

    tutorialSteps.forEach((step, stepIndex) => {
        step.hidden = stepIndex !== tutorialIndex;
    });

    tutorialBack.hidden = tutorialIndex === 0;
    tutorialNext.textContent =
        tutorialIndex === tutorialSteps.length - 1 ? "Done" : "Next";
    tutorialBody.scrollTop = 0;
}

/*
 * showModal throws on a dialog that is already open, so reopening from the
 * Settings panel while the walkthrough is up only brings it forward. The
 * preference is re-read here because Settings can change it while closed.
 */
function openTutorial() {
    syncTutorialPreference();
    showTutorialStep(0);

    if (!tutorialDialog.open) tutorialDialog.showModal();
}

/*
 * Only the start-up opening takes the caret into the editor when it closes.
 * One opened from Settings leaves focus where the native close puts it, on
 * the Settings button that launched it.
 */
let focusEditorAfterClose = false;

function maybeShowTutorial() {
    if (tutorialIsHidden()) return;

    focusEditorAfterClose = true;
    openTutorial();
}

tutorialDialog.addEventListener("close", () => {
    if (focusEditorAfterClose && matchMedia("(min-width: 801px)").matches) {
        editor.focus();
    }

    focusEditorAfterClose = false;
});

tutorialClose.addEventListener("click", () => {
    tutorialDialog.close();
});

tutorialBack.addEventListener("click", () => {
    showTutorialStep(tutorialIndex - 1);
});

tutorialNext.addEventListener("click", () => {
    if (tutorialIndex === tutorialSteps.length - 1) {
        tutorialDialog.close();
        return;
    }

    showTutorialStep(tutorialIndex + 1);
});

/*
 * The arrow keys move between steps while the dialog has focus. The
 * preference checkbox keeps its own arrow behaviour, and text inputs are
 * skipped for the same reason even though no step has one today.
 */
tutorialDialog.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.target.matches("input, textarea, select")) return;

    event.preventDefault();

    showTutorialStep(
        tutorialIndex + (event.key === "ArrowRight" ? 1 : -1),
    );
});

tutorialHideInput.addEventListener("change", () => {
    setTutorialHidden(tutorialHideInput.checked);
});

tutorialStartInput.addEventListener("change", () => {
    setTutorialHidden(!tutorialStartInput.checked);
});

tutorialOpenBtn.addEventListener("click", () => {
    if (settingsDialog.open) settingsDialog.close();

    openTutorial();
});

closeOnBackdrop(tutorialDialog, () => tutorialDialog.close());

syncTutorialPreference();
