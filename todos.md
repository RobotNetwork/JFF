# Plan

Decisions locked in discussion:

- Saved messages: header "Saved" dropdown, one click to insert. Save prompts for a name, prefilled from the first line. JSON in localStorage. Save / delete / import / export.
- Output: the pane stays but is hidden by default, toggled when truly desired. Char count removed.
- Layout: centered single column with margins on all sides when the output is hidden. Below a minimum margin it snaps back to full-bleed.
- Mirror: a ServiceNow "Work notes" visual preview, live as you type.
- #4 suggestion: a persistent primary Copy action.

Each phase is implemented and validated by you before the next starts. No code lands for the next phase until the current one is confirmed.

## The raw markup moves into a dialog, not a collapsible pane

The pane hidden by default was the plan; the pane is gone instead, and the markup
lives in a modal. Reasons, in order of weight:

- The split is where every layout question lives: a grid split, a collapse class
  plus a JavaScript-eased column animation, and a third narrow-only layout with
  its own pane switcher. Three systems decide where the editor ends, and the two
  thresholds they use (760px column, 800px tabs) collide in the 800-824px band.
  A dialog leaves one layout: a centered column, always.
- The mirror is the always-on output surface from phase 3 on. That leaves the raw
  pane one job, inspecting and copying markup on demand, which is what a dialog is.
- The pattern already exists twice (`linkDialog`, `shortcutsDialog`, `closeOnBackdrop`),
  so this is a third use of boring code rather than a fourth layout.

Deleted with it: `splitRatio`/`splitKey`/`applySplit`/`storeSplit` and the divider
drag handlers, `outputVisible`/`outputVisibleKey`/`applyOutputVisible`/
`animateOutputPane`, the Show/Hide pair, `syncCopyPlacement`, the view tabs and
`setView`, and the `narrowLayout` media query. The toolbar carries one Copy control
instead of two that trade places.

## Other decisions this leaves open, now made

- **Sticky vs per-load.** The pane preference died with the pane, so nothing is
  persisted. The dialog opens on demand and does not remember.
- **Narrow layout.** One layout at every width: the view tabs existed only to swap
  panes that no longer both exist, so they go.
- **Thresholds.** Column `max-width: 760px`, gutters 20px, minimum margin 32px, so
  the column is centered at 824px and wider and goes full width below that. One
  media query, and the number is derived in a comment rather than typed twice.
- **The editor keeps its internal scroll, and the mirror gets its own.** A mirror
  below a page-length editor is a preview you have to scroll past the work to
  read, which kills the live-glance reason for having it. The column is
  viewport-height: editor above (grows, scrolls inside), mirror below (capped,
  scrolls inside). Both are on screen while typing.
- **Insert point for a saved message.** At the caret, falling back to the end of
  the entry when the caret is not in the editor. That is the paste path
  (`insertRichText`), which sanitizes and wraps, so a stored message is held to
  the rules a paste is held to whether or not it came from one.
- **`html` in storage is the editor's HTML**, re-sanitized on insert. localStorage
  is user-writable, so nothing out of it is trusted.
- **Import merges by `id`.** A record naming an id already held replaces it, an
  unknown id appends, and a row that does not validate is dropped rather than
  repaired. Importing the same file twice is then idempotent.
- **Saving always appends.** Two messages may share a name; a name is a label, and
  a silent overwrite of one message by another is worse than two rows.
- **The persistent Copy sits in the mirror's head row**, not floating. A fixed
  button overlaps the column wherever the layout is full width (below 824px), and
  the mirror head is on screen for the whole flow anyway: paste, review, copy.
- **The mirror's empty state is not optional.** It is the card's empty state and
  it lands with the card.

## Status

All five phases are in and verified in headless Chrome against the real page,
by measurements rather than by eye: computed styles and rects, serialized
output, clipboard reads, and console errors. 95 assertions across the five
phase runs, all passing, no leaked browser processes.

| Phase | Checks | What the run proved |
| --- | --- | --- |
| 1 centered column, markup in a dialog | 33 | one column at 1280/824/823/380, dialog opens from the button and both keys, Escape/backdrop/Close, both Copy controls, clear-after-copy then Ctrl+Z, paste, reload |
| 2 saved messages | 31 | save/name prompt/insert at the caret/delete/import/export round trip, merge by id is idempotent, junk store and junk rows refused, a hand-edited record can put nothing into the entry |
| 3 mirror | 14 | DOM equals the captured rendering of the same entry, 264 computed-style comparisons against `ex/jsonoutput3.json` with no mismatch, live on every keystroke, code regions keep their newlines, field stays ServiceNow-white in a dark theme |
| 4 detach | 5 | separation, alignment, eight viewport sizes from 1600x1000 to 900x420, the 824px threshold, a long code line scrolling the field rather than the page |
| 5 persistent Copy | 12 | Copy in the mirror's head out of the toolbar, one click copies and clears, the caret menu on screen at 380px, the dialog's Copy shares the setting |

Three things the runs caught that the plan did not have:

- The copy menu hangs left of the control it belongs to, and where the toolbar
  wraps that put it off the window: it now measures on open and opens rightward
  when leftward would leave the screen.
- Escape never reached the Saved menu, because the menu's own control keeps the
  caret in the editor rather than taking focus. Escape is handled for the page
  now, which fixes it for the heading and copy menus too.
- Copy stopped working the moment it left the toolbar, since the toolbar's own
  delegation had been running it. Both Copy controls are wired directly.

## Cross-cutting impact

- Phase 1 deletes the whole pane/split/collapse/tabs machine and is what phases 3
  to 5 build on. It is the only phase that removes things.
- The mirror (phase 3) renders the serialized markup with `[code]` stripped, not a
  second DOM walk.
- Saved messages reuse the existing storage guards and the link-dialog modal pattern.

## Phase 1: centered column, markup in a dialog

- Output pane deleted. `#output`, the `[code]` painting and `copyOutput` are
  unchanged; the markup element just lives in a `<dialog>` with a head row, a
  Close button, and `closeOnBackdrop`.
- Toolbar gains a `Markup` button (a command, like `help`) that opens the dialog.
  No chord: the dialog is secondary to Copy and the table names no shortcut for it.
- One Copy control in the toolbar (the old pane copy is deleted, the toolbar one
  keeps the id `#copyBtn`), and `copyButtons`/`syncCopyPlacement` go with it.
- Column: `main` holds a `max-width: 760px` centered column with 20px gutters,
  full width below 824px, viewport height, editor card scrolling inside it.
- Remove the char count: `#outputStats`, `updateOutputStats`, `journalCharLimit`,
  and the `.output-stats` CSS. `render()` stops calling `updateOutputStats`.

Validate: the app opens as one centered column with no markup pane; Markup opens
the dialog with the same output as before, Escape and the backdrop close it; Copy
still works from the toolbar and the chord; no char count anywhere; no view tabs
below 800px; no console errors.

## Phase 2: saved messages

- Storage: `jff.saved.v1` holds a JSON array of `{ id, name, html, savedAt }`, read
  and written through the existing guards.
- UI: header "Saved" dropdown. Rows show the name plus a dim preview. Click inserts
  the message through `insertRichText`. Per-row delete. Footer actions: Save
  current, Import, Export.
- Save prompts for a name, prefilled from the first line (~40 chars). Modal built
  on the link-dialog pattern.
- Import reads a JSON file, validates shape, merges by id. Export downloads
  `journal-messages.json`, and that file is what Import takes.

Validate: save, insert, delete, import, export all round-trip and survive reload.
Inserted markup serializes the same as typing it. A hand-edited store with a junk
row loads without throwing and inserts nothing dangerous.

## Phase 3: Work notes mirror

Reference captured in `ex/jsonoutput3.json`.

- `renderMirror()` renders the serialized markup with `[code]` stripped: prose
  newlines become `<br/>`, newlines inside `[code]` regions (i.e. inside `<pre>`)
  are preserved. The existing `codeRegion` split separates the two.
- Styles: base Lato/Arial 12px line-height 15px, custom `a`/`code`/`pre` rules,
  browser-default headings at 12px base. Scoped to the card so nothing leaks.
- Runs from `render()` so it live-updates on every keystroke.
- The empty state is the card's own: a "Work notes" label and a faint hint.

Validate: mirror matches the reference; code blocks, headings, lists, links all
render as ServiceNow does; computed styles on the mirror match the reference
values, not just the look.

## Phase 4: detach the mirror below the editor

Completes the original layout item.

- The mirror card reads as the platform rather than the app: its own surface, set
  apart from the editor card, below it in the column.
- Finalize the spacing, the cap on the mirror's height, and the full-bleed
  interaction from phase 1.

Validate: mirror reads as a detached ServiceNow field below the editor; both cards
are usable at 1400px, 900px, and 380px wide.

## Phase 5: persistent primary Copy

The #4 suggestion.

- The Copy control moves from the toolbar into the mirror's head row, still accent
  filled, still carrying the clear-after-copy caret menu, so the payoff action
  never requires hunting the toolbar. Flow becomes paste, review the mirror, copy,
  optionally save.

Validate: copy reachable without opening anything; the full loop is one surface.

## Round 2: the field behind Preview, Clear removed, Markup moved

Three changes asked for after the five phases landed.

- **The work notes field is a dialog behind a Preview button, off until it is
  asked for.** The card left the column entirely, so the editor card is now the
  whole column and gets its full height. The button sits in the header row
  directly after Saved, and the field's own Copy control moved with the field
  into the dialog's head, which is where the payoff already lived.
- **Nothing is rendered into it while it is closed.** `render()` skips the
  field unless the dialog is open, and opening renders it from the editor at
  that moment, so it is never a frame behind the entry and never draws a
  viewport nobody is looking at. That is what "disabled by default" means here.
- **Clear and Restore are gone from the code**, not just unwired: the buttons,
  the `clearBtn` wiring, the previous-entry storage slot, `storePrevious`,
  `restorePrevious`, `updateRestoreButton`, its tooltip block and its startup
  call. Emptying the entry survives as one function used by Clear after copy,
  which still goes through the undo stack, so Ctrl+Z is the recovery now.
- **Markup took Clear's slot**, which is where it already was: with Clear and
  Restore gone the toolbar ends `... removeFormat, sep, Markup`.

Two things worth knowing about what the checks found:

- A `</div>` closing the toolbar was missing, which nested the editor inside
  the toolbar. The check that would have caught it reads the parent chain of
  the editor, the notice and the toolbar rather than counting cards, because
  one bad close tag left the card count looking right.
- The doubled `<b>` the style comparison flagged on inline code is the
  serializer's own doing (`case "code"` bolds inline code on purpose), so
  rebuilding the sample entry from the capture has to invert that wrapper. No
  change was needed; the comparison caught a wrong assumption in the test.

One fidelity fix came out of the same comparison: the captured field inherits
`list-style-type: none` from the platform's reset, which the stylesheet now
does too. It has no visual effect outside a list item, and it is there because
the capture is the authority for every value in that block.

Verify: 49 assertions across two runs, all passing, no leaked browser
processes.

| Run | Checks | What it proves |
| --- | --- | --- |
| 6, the field behind Preview | 28 | closed and zero-height at rest; the column is the editor card alone and it fills it; Preview sits next to Saved; the toolbar has no Clear or Restore and ends with Markup; the removed code is absent from the global scope; the field renders the captured page element for element (897 characters, identical to the last one) and matches all 323 captured computed styles with only the two named exceptions; it fits at 824/760/380x780/380x560 with both head controls reachable; copy, clear-after-copy and the copy chord; the empty state |
| 7, the rest of the app | 21 | the editor/toolbar/notice parent chain; toolbar commands and the arrow ring; the header row; the Saved menu, naming, storing and inserting; Escape from the editor; autosave across a reload; all three dialogs open and close on Escape; the bold and h1 chords; the placeholder; a paste that is only an image |
