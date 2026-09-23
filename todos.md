# jff remaining work

Open items after the code review and the first round of fixes. Line numbers are from the current files and will drift.

Priority order within each section is the order I would work them.

## Core workflow

- [ ] **Merge sibling blocks into the code block when `formatBlock` splits them.**
  `app.js:248-251`, the `codeBlock` case.
  Chrome's `formatBlock` treats `<br><br>` as a paragraph boundary, so a pasted snippet containing blank lines converts only up to the first gap and the rest stays outside the code block.

  ```
  paste "a\n\nb", select all, click { }
  paste DOM: <p>a<br><br>b<br></p>
  after { }  : <pre>a</pre><p><br>b<br></p>
  output     : [code]<pre><code>a</code></pre>[/code]\n\nb
  ```

  Confirmed to be the browser, not the app, by running the raw command with no app code in the path: `execCommand("formatBlock", false, "pre")` on `<p>a<br><br>b</p>` yields `<pre>a</pre><p><br>b</p>`. Pre-existing, and unchanged by the work already done.

  The same command also folds an empty paragraph into a line break instead of a blank line, which matters more for Word and OneNote payloads, since those arrive as one paragraph per line and represent a blank line as an empty paragraph:

  ```
  paste DOM: <p>a</p><p></p><p>b</p>
  after { }  : <pre>a\nb</pre><p></p>
  output     : [code]<pre><code>a\nb</code></pre>[/code]
  ```

  Two options. Absorb the sibling blocks that are still inside the selection into the resulting `pre`, which is the smaller change but depends on Chrome's split points, and does not recover the blank line the browser already consumed. Or drop `formatBlock` for this command and build the `pre` from the selection's text, which is predictable and covers both shapes, but needs block-level surgery for multi-block selections and needs a decision about what the button should do inside a list.

## Correctness

- [ ] **Stop `looksLikeMarkdown` from firing on code.**
  `app.js:1468`. Any single line starting with `#`, `-`, `*`, `+`, a digit followed by `.` or `)`, `>`, or a triple backtick routes the whole paste through the markdown parser.

  ```
  paste "def f():\n# tail"
  looksLikeMarkdown -> true
  result            -> the comment line becomes <h3>tail</h3> and blank lines are lost
  ```

  Fix: require two independent signals, or skip the markdown path when the text looks like code, for example when it contains no prose and every non-indented line matches a code shape.

- [ ] **Handle clipboard failure in the Copy button.**
  `app.js:1493-1494`. `await navigator.clipboard.writeText(...)` has no `catch`, so a rejection leaves the label on "Copy", shows the user nothing, and raises an unhandled rejection. Observed page error `Uncaught (in promise) NotAllowedError: Write permission denied` raised from `app.js:1494`.

  Fix: `catch`, fall back to `document.execCommand("copy")` with a temporary selection, and surface a failure state on the button.

- [ ] **Keep inline code inside one block.**
  `app.js:268-282`. When `surroundContents` throws, the fallback wraps whatever was extracted, which can be block content.

  ```
  selection spanning two paragraphs -> <code><p>pha</p><p>be</p></code>
  output                            -> al\n[code]<b><code>phabe</code></b>[/code]ta
  ```

  Fix: refuse the command when the range crosses block boundaries, or apply it per block.

- [x] **Normalize nested lists produced by Tab.**
  `nestListItem` now moves the item into a new list under the item above it, so Tab and the typed marker both produce `<ul><li>a<ul><li>b</li></ul></li></ul>` and `<ul><ul>` cannot occur. `outdentListItem` reverses it, including for an item that carries its own subtree, and drops the list it leaves empty. Tab on the first item is now a no-op. Moving an item drops the selection to the editable in Chrome, so the caret is captured and re-applied around the move.

- [ ] **Route drag and drop through the paste pipeline.**
  `app.js:1411` handles `paste` only. A drop bypasses the rich text normalization, the whitespace pass, and the sanitizer. Not verified end to end, since synthetic drop events cannot trigger native insertion.

  Fix: handle `drop`, or `beforeinput` with `inputType === "insertFromDrop"`, and reuse the same normalization path.

## UI and accessibility

- [ ] **Toggle block formats off, and let `removeFormat` reach them.**
  `app.js:330` skips `removeFormat` in the active-state loop, and `execCommand("removeFormat")` only clears inline formatting. `formatBlock` is not a toggle, so a heading, blockquote, or code block cannot be converted back to a paragraph from the toolbar.

- [ ] **Replace the link `prompt()`.**
  `app.js:294` and `app.js:301`. Two blocking dialogs, one for the URL and one for the text, with `prompt` not available in some embedded contexts.

- [ ] **Pick one active-state hook.**
  `setButtonActive` sets both the `active` class and `aria-pressed` (`app.js:313-316`), while `styles.css:95-106` styles both. Keep `aria-pressed` and drop the class, or the reverse.

- [ ] **Fix invalid and outdated markup and CSS.**
  `readonly` on `<pre id="output">` at `index.html:141` is not a valid attribute for `pre`. `height: 100vh` at `styles.css:23` should be `100dvh` for mobile browser chrome. `:root` at `styles.css:1` has no `color-scheme: dark`, so scrollbars and native dialogs render light against the dark UI.

- [ ] **Add the missing roles and names.**
  `index.html:128` has no `role="textbox"` or `aria-multiline`, and now that a `data-placeholder` exists, `aria-placeholder` will not be honored without the textbox role. The output pane has no live region, so changes to it are not announced. Icon-only buttons such as `🔗`, `✕`, `❝`, and `{ }` rely on `title` alone for their accessible name.

- [ ] **Guard the Copy label timer.**
  `app.js:1493-1503` sets a 1200 ms timeout per click, so two quick clicks let the first timer reset the label early. Store and clear the handle.

## Code health

- [ ] **Rename the `history` global.**
  `app.js:8` shadows `window.history` for the whole script. Harmless today, a trap for anyone who later reaches for the browser API. `undoStack` reads better anyway.

- [ ] **Reduce reliance on deprecated editing APIs.**
  `queryCommandState` and `queryCommandValue` at `app.js:342` and `app.js:350`, and `document.execCommand` throughout the toolbar, are deprecated but still functional in current Chrome and Firefox. The active state for `formatBlock` is the fragile part, since Firefox has returned an empty string from `queryCommandValue("formatBlock")` in some versions. Untested here, Chrome only.

- [ ] **Split the file and add tests.**
  `app.js` is 1505 lines covering undo, DOM helpers, toolbar, markdown parsing, rich text normalization, sanitizing, and serializing. No tests, no version control, no build. `markdownToHtml`, the paste normalization, and the serializer are testable under jsdom with no browser beyond `DOMParser` and tree walkers, and tests there would have caught most of the review findings. Note that ES modules do not load over `file://`, so use separate classic `<script src>` tags or accept running a local server.

- [ ] **Name the magic numbers.**
  The 100 snapshot cap and the 300 ms debounce in the undo section, and the 1200 ms Copy label in `app.js:1498`.

## Known limitations, no fix planned

- User text containing a literal `[code]` or `[/code]` terminates the region in ServiceNow, and also splits the prose tidy pass in `render()`. The serializer escapes only `&`, `<`, and `>`. Escaping the brackets would change every code sample, so this stays documented rather than fixed.
- Images, tables, and structures outside the sanitizer whitelist are unwrapped by design.
- The serializer strips leading and trailing newlines inside a `pre`, which is deliberate, since `formatBlock` leaves a stray newline behind.
- Prose collapses runs of three or more newlines to one blank line, and strips trailing spaces. Code regions are exempt.
- Chrome's list commands, which is what the two list buttons and Ctrl+Shift+7 and Ctrl+Shift+8 run, leave the list inside the paragraph they replaced, so the editor DOM holds `<p><ul><li>x</li></ul></p>` and a pair of empty paragraphs around it. The output is unaffected, since the serializer walks through the wrapper and `render()` trims the blank lines. The typed marker does not do this, because it builds the list itself.

## Done, for context

Keyboard shortcuts, underline paste, and list markers:

- Every toolbar button has a shortcut now. `editingShortcuts` in `app.js` is the table of record, and each button title carries its chord: Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X, Ctrl+Shift+7, Ctrl+Shift+8, Ctrl+Shift+>, Ctrl+Alt+1, Ctrl+Shift+backtick, Ctrl+backtick, Ctrl+backslash, Ctrl+K. Letters and digits match the character the layout produces; the shifted chords match the physical key, since Ctrl+Shift+8 is a different character on a different layout. Toolbar and keyboard both go through `applyCommand`, so a command cannot behave one way from the mouse and another from the keyboard.
- Underline was missing from the paste path end to end, which is why underlined rich text arrived plain. `u` and `ins` now survive the sanitizer, `text-decoration: underline` becomes a `u` in `normalizeInlineStyles` (with an explicit `none` unwrapped, the way bold, italic, and strike already behaved), and the serializer emits `u`. Word, Google Docs, and LibreOffice each spell it differently and all three land. There is a toolbar button and an active state to match.
- A marker typed at the start of a line becomes a list item: `- `, `* `, `+ `, `1. `, or `1) `. An indented marker nests the item one level under the item above it. The conversion fires from the `input` event, because the trailing space is not in the DOM yet when `keydown` runs, and it builds the list with DOM calls rather than `execCommand`, which Chrome silently ignores for the length of an `input` handler. A marker in the middle of a line, or inside a `pre`, is left alone.
- Formatting commands are pinned to tags with `styleWithCSS`, so a command cannot produce a `<span style>` that the serializer would drop.

Findings 1, 3, 4, 5, 6, 7, 8, 9, 10, and 11 from the review, plus the blank-line and trailing-whitespace corruption inside `[code]`. Finding 2, escaping text outside `[code]`, was closed as intentional: ServiceNow shows the non-code region literally, and the decision is recorded in a comment at `app.js:1217-1221`.

Rich text paste fidelity, driven by firm fixtures for Word 365, OneNote 2016, Google Docs, and LibreOffice Writer:

- `looksLikeOneNoteHtml` is gone. Inline style conversion (`font-weight`, `font-style`, `text-decoration`) now runs for all rich HTML, so editors without Microsoft markers keep their formatting. Before: a LibreOffice `font-weight:bold` span and a Google Docs `font-weight:700` span both pasted as plain text.
- Explicit off values are honored: `<b style="font-weight:normal">` is unwrapped instead of kept. Google Docs wraps an entire document in one, which pasted the whole entry bold, and as a single joined line, because the wrapper held the paragraphs.
- A formatting element that wraps whole blocks is pushed down onto each block's contents (`distributeFormattingOverBlocks`), so its paragraphs keep their line structure and never end up inside `[code]`.
- The whitespace pass only collapses runs that span a newline. Runs of spaces and `&nbsp;` are content, so indentation survives: Word and OneNote both indent code with `&nbsp;`, which used to arrive as a single space. Word's `mso-list:Ignore` marker padding is collapsed separately, and `render()` no longer strips the first line's indentation.
- Typographic punctuation is normalized inside `[code]`: curly quotes, en and em dashes, ellipsis, `&nbsp;`, and zero-width characters back to ASCII. Word and Outlook autocorrect produce these before the paste reaches the browser.
- The sanitizer drops non-content subtrees (`style`, `script`, `svg`, ...), drops comments, and keeps an `href` only when `normalizeHref` accepts it.

## Verifying changes

All of the above was found and checked by loading `file://` in a headless browser and driving the real pipeline: synthetic `ClipboardEvent` pastes with a populated `DataTransfer`, synthetic `keydown` for undo, redo, Enter, and Tab, `mousedown` on the toolbar buttons, then reading `output.textContent` and `editor.innerHTML`. Keep using that loop. Assertions on serialized output catch more than assertions on the DOM.
