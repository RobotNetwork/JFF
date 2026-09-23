Code review: Journal Entry Formatter

 Four files, no VCS, no tests. I read all 1875 lines of app.js plus the markup and CSS, ran three independent review agents (logic, security, spec/CSS/a11y), and verified
 every claim below by driving the real app in headless Chromium over file://: real ClipboardEvent pastes with populated DataTransfer, real key presses, real toolbar clicks,
 and CDP drag events. Full agent reports: agent://LogicReview, agent://SecurityReview, agent://SpecReview.

 Verdict. The hard parts hold up. The paste sanitizer is genuinely effective (I could not get a single handler, script, iframe, svg, or javascript: href through it), the
 undo/redo stack is correct including branch truncation, and the serializer matches its documented [code] contract on every well-formed shape I threw at it. The defects
 cluster in four places: the code-block text source, block children serialized inside a [code] region, the markdown sniff, and the fact that no keyboard user can operate
 the toolbar or leave the editor.

 Ranked findings

 ┌─────┬─────────┬────────────────────────────────────────────────────────────────────────────┬────────────────────────┐
 │ #   │ Sev     │ Finding                                                                    │ Where                  │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C1  │ High    │ A <pre> with a <code> child silently drops every sibling of that child     │ app.js:1639            │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C2  │ High    │ Block children of li/blockquote inside [code] are joined with no separator │ app.js:1684-1686       │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C3  │ High    │ looksLikeMarkdown fires on ordinary code/prose and corrupts the paste      │ app.js:1824            │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C4  │ Med     │ Paste with a contentless text/html discards text/plain entirely            │ app.js:1772-1793       │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C5  │ Med     │ No keyboard path out of a code block; trailing blank lines vanish          │ app.js:1069-1074       │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C6  │ Med     │ inlineCode across block boundaries merges the content                      │ app.js:288-292         │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C7  │ Med     │ Extra blank line after any toolbar-created block that isn't last           │ app.js:1708-1712       │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C8  │ Med     │ Tab is swallowed in the editor: keyboard trap, Copy unreachable            │ app.js:1037-1045       │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C9  │ Med     │ Toolbar is mousedown-only: Enter/Space on a focused button does nothing    │ app.js:229             │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ C10 │ Med     │ Multi-item selection collapses on Tab, so the second Tab indents one item  │ app.js:1202            │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ I1  │ Med     │ Prose containing [code]/[/code] mints live HTML regions downstream         │ app.js:1572, 1732      │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ I2  │ Low-Med │ insertLink never validates the URL; javascript: lives in the editor DOM    │ app.js:311, 315        │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ I3  │ Low     │ //evil.com and /\evil.com pass normalizeHref                               │ app.js:1529            │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ R1  │ Low     │ Copy button: unhandled rejection, no feedback, label timer race            │ app.js:1856-1864       │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ R2  │ Low     │ Bare <li> fragment serializes as one joined line; Tab fabricates a <div>   │ app.js:1718-1725, 1222 │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ R3  │ Low     │ Markdown NUL placeholders are forgeable from pasted text                   │ app.js:415, 453        │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ R4  │ Low     │ Editor has no focus indicator; borders/rings under 3:1                     │ styles.css:119         │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ R5  │ Low     │ Ctrl+Alt+1 (heading) is dead on macOS                                      │ app.js:1016            │
 ├─────┼─────────┼────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
 │ R6  │ Low     │ Per-keystroke full re-serialization; <pre> serialized twice per render     │ app.js:1614, 1760      │
 └─────┴─────────┴────────────────────────────────────────────────────────────────────────────┴────────────────────────┘

 Correctness details

 C1, <pre> with a <code> child loses content. serializeHtmlElement picks the first direct code child as the sole text source:

 ```js
const body = element.querySelector(":scope > code") || element;
 ```

 Everything else in the pre is then ignored. Measured: <pre><code>x</code>y</pre> and <pre>y<code>x</code></pre> both emit [code]<pre><code>x</code></pre>[/code], and
 <pre><code>x</code><code>y</code></pre> emits only x. Reachable with no clipboard at all: inline-code x in a paragraph, type y next to it (DOM <p><code>x</code>y</p>),
 press the code-block button. formatBlock pre produces <pre><code>x</code>y</pre> and the output drops the y. normalizeCodeBlocks does not repair it (its
 pre.querySelector(codeBreakSelector) test finds no br/p/div). Fix: use codeText(element), which already descends through a code child via its else branch, so the
 well-formed shape is unaffected.

 C2, blocks inside a code region lose their line breaks. Inside [code], case "p": case "div": return inner; returns no separator, and serializeNode's paragraph newline
 logic is unreachable once insideCode is true. Measured through the real paste pipeline:

 ```
paste <ul><li><p>a</p><p>b</p></li></ul>        -> [code]<ul><li>ab</li></ul>[/code]
paste <ul><li><div>a</div><div>b</div></li></ul> -> [code]<ul><li>ab</li></ul>[/code]
paste <blockquote><p>a</p><p>b</p></blockquote>  -> [code]<blockquote>ab</blockquote>[/code]
 ```

 Word, Google Docs, and any web page with multi-paragraph list items produce this shape. <pre> is unaffected because codeText breaks lines on p/div. Fix: emit the same
 in-code break the br case already uses (<p></p>), between block children rather than after every child.

 C3, markdown sniff. paste "def f():\n# tail" gives def f():\n[code]<h3>tail</h3>[/code]: the comment becomes a heading and the blank line disappears. Any single line
 starting with #, -, *, +, N., N), >, or a fence routes the entire plain-text paste through the markdown parser, which then also eats blank lines. Fix per the backlog:
 require two independent signals, or bail when every non-indented line matches a code shape.

 C4, paste fallback. With text/html present but contentless, the handler returns after inserting nothing and never reads text/plain. Measured: html <meta charset='utf-8'>
 plus text hello world leaves the editor empty; so does html <img src=x> plus text. Fix: after building the sanitized body, if it has no insertable content, fall through to
 the text branch.

 C5, the code-block exit branch is dead. The guard is

 ```js
const caretAtEnd = after.toString() === "";
const currentLineEmpty = /(^|\n)$/.test(before.toString());
 ```

 Range.toString() ignores <br>, and Enter inside a pre produces <br>, so after any number of Enters the prefix is still the line's text ("a") and the second condition can
 never be satisfied. Measured: caret at the end of <pre>a</pre>, two Enters, DOM <pre>a<br><br><br></pre>, output still [code]<pre><code>a</code></pre>[/code]. The branch
 does fire when the pre's text ends in a literal newline (<pre>a\n</pre> gives <pre>a</pre><p><br></p>), which the UI cannot produce. Net effect: the user cannot leave a
 code block with Enter, and blank lines added inside one are invisible in the output (stripped at app.js:1641). Fix: decide "the line is empty" from the DOM, walking back
 over br, instead of from Range.toString().

 C6, wrapInlineCode fallback. Selection from al|pha to be|ta across two paragraphs gives <p>al</p><code><p>pha</p><p>be</p></code><p>ta</p> and output
 al\n[code]<b><code>phabe</code></b>[/code]ta. The surroundContents throw path wraps block content. Refuse the command when the range crosses blocks, or apply it per block.

 C7, extra blank line. serializeNode appends \n to a p/div even when the serialized content already ends with a block's \n, and render() only trims at the document edges.
 Measured with the real list button on <p>item</p><p>after</p>: output [code]<ul><li>item</li></ul>[/code]\n\nafter. Same for blockquote and headings. This contradicts the
 backlog's "the output is unaffected".

 Injection and downstream

 I1, [code] in prose. serializeText returns prose verbatim, and the app's premise is that ServiceNow renders [code] regions as HTML. So user text containing the delimiter
 mints a live region. Confirmed at the payload level: typed or pasted prose see [code]<img src=x onerror=alert(1)>[/code] now reaches the output byte for byte, and
 [code]<b>bold</b>[/code] written as literal characters renders as bold in the ticket. Locally it also disables the tidy pass: an unclosed [code] makes the regex swallow
 everything up to the app's next [/code], so trailing spaces in intervening prose survive. The backlog closes this as a display limitation, but the fix it rejects is not
 the fix needed: breaking the delimiter in the prose branch only (insert a zero-width space after [) leaves every app-generated code sample untouched, since those are
 minted later in wrapCode.

 I2, insertLink. The collapsed branch inserts an anchor built from the raw prompt value, and the selection branch passes it straight to createLink. Measured with prompt
 stubbed to javascript:alert(document.domain): the editor ends up holding <a href="javascript:alert(document.domain)"> in both branches, clickable and live in the app's own
 origin. The serializer's re-check keeps the ServiceNow payload safe ([code]click[/code] me), so the harm is a live link in the editor plus silently discarded user intent.
 Fix: const safe = normalizeHref(url); if (!safe) return; before either branch.

 I3. href.startsWith("/") accepts //evil.com (measured, emitted as a live link inside [code]) and /\evil.com, which browsers resolve off-host. Exclude both.

 Keyboard and accessibility (all measured)

 - C8: six Tabs from inside the editor stay on the editor (editor -> editor -> ...) while inserting tabs into the document; Shift+Tab from the Copy button lands on the
   editor and sticks. WCAG 2.1.2. Capture Tab only where it does something (inside a list or pre) and let the default move focus otherwise.
 - C9: with a real selection, a mouse click on Bold gives <p><b>hi</b></p>; Enter, and Space, on the same focused button do nothing. Keyboard activation fires click with
   detail === 0 and never mousedown. The chords still work inside the editor, so this is a dead affordance rather than a lockout, but a screen-reader user activating "Bold"
   gets no effect.
 - R4: outline: none with a rgba(98,216,78,0.02) tint, which I computed at 1.04:1 against the background. Button borders measure 1.36:1 and the active ring 1.6 to 2.4:1,
   under the 3:1 of 1.4.11. Every text pair passes AA (lowest 5.53:1; the active-hover toolbar state sits at 4.51:1, half a percent of headroom).
 - Names: accessible name comes from content before title, so the icon buttons announce glyphs (🔗, ✕, ❝, { }, </>), and the tooltips are never used as names. The toolbar
   has no role/label, the editor has no role="textbox", aria-multiline, or aria-placeholder, and the output pane is not a live region.

 Robustness and hygiene

 - R1: a real click with a denied clipboard raises Uncaught (in promise) NotAllowedError: Write permission denied at app.js:1863, the label stays "Copy", and nothing is
   shown. The label race is real too: click, wait 900 ms, click again, and 400 ms later the label reads "Copy". navigator.clipboard is also undefined on a non-secure origin
   (file:// in Firefox), which trips the same unhandled rejection. Add try/catch, a ?., an execCommand("copy") fallback, and a stored timer handle.
 - R2: pasting <li>a</li><li>b</li> keeps two bare li (the sanitizer allows li), and the serializer drops the element, giving ab. Tab on the second item then builds
   <li>a<div><li>b</li></div></li>, because nestListItem reads list.tagName when the parent is the editor.
 - R3: paste `code`\u00000\u0000 emits the code span twice; **bold** \u00000\u0000 emits the literal text undefined. Tokens are escaped, so there is no injection, only
   garbage. Strip NUL before tokenizing, or return the matched text for an out-of-range index.
 - R5: { key: "1", alt: true } matches event.key, but Option+1 produces ¡ on macOS, so the heading chord never fires there. Every other shifted chord correctly matches
   code. [INFERENCE: macOS only, not testable here. The matching logic reads event.key at app.js:1025, which I did verify.]
 - R6: at 2000 paragraphs render() costs 2.4 ms and updateToolbarState() 1.6 ms per call, and both run on every input, again on selectionchange via rAF, and again on keyup.
   End-to-end typing measured 22.8 ms/char at 2000 paragraphs, 4.0 ms at 200, 1.35 ms for a one-paragraph document (baseline includes the CDP round trip).
   serializeHtmlElement also builds inner for pre and discards it, a second full walk of every code block per render. At realistic entry sizes this is fine; coalescing into
   one rAF and skipping unchanged renders would remove the cliff.
 - Markup/CSS: readonly on <pre> is invalid and inert; 100vh should be 100dvh; no color-scheme: dark, so scrollbars and the native prompt dialogs render light against the
   dark UI; at ≤800 px the .pane border-bottom has no :last-child reset, leaving a hairline at the viewport bottom; .active and [aria-pressed] are duplicate hooks for one
   state; let history at app.js:8 shadows window.history for every classic script on the page (measured: bare history is the array, window.history is intact).

 Corrections to todos.md

 - Item 16 is wrong: Chrome's <p><ul>...</ul></p> wrapper is not harmless output-wise; it costs a blank line whenever content follows (C7).
 - Item 10 is imprecise about title: content wins over title in accname, so the buttons expose glyph names, not the tooltips.
 - Item 5, drop: the security framing overstates it. Chromium strips handlers and script from dropped fragments before insertion (measured: <img onerror>, <div onclick>,
   <svg onload>, <script>, and a javascript: anchor all arrive inert). The real cost is fidelity: a dropped <span style="font-weight:bold"> stays a span and the output
   loses the emphasis, while the same HTML pasted yields [code]<b>...[/b][/code]. Worth fixing for consistency, not for XSS.
 - Every line reference in the file has drifted: it says 1505 lines, app.js is 1875, and anchors are off by roughly 370 (looksLikeMarkdown is at 1822, not 1468).

 Verified correct, so you can skip re-auditing

 Serializer output for paragraphs, bold/italic/underline/strike, inline code, links (absolute, relative, anchor, mailto, and the rejection of javascript:), nested lists to
 three levels, h1/h2→h3 and h4-h6→<b>, <pre> with newlines or <br>, HTML escaping inside [code] versus literal prose outside, typographic punctuation and &nbsp;
 normalization, and leading-space preservation. Paste sanitization against img/script/svg/iframe/style/input/template/base/math/onclick/whitespace-padded javascript:, with
 zero executions. Word bold spans, Google Docs font-weight:normal unwrapping, &nbsp; indentation, and the push-down of a block-wrapping <b> (<b><p>a</p><p>b</p></b> →
 [code]<b>a</b>[/code]\n[code]<b>b</b>[/code]). Undo/redo including slash-truncation on a new edit, the 100-entry cap, and caret restore. Typed - , * , + , 1. , 1)
 markers, indented nesting, and Tab/Shift+Tab on well-formed lists. No console errors at load.

 Suggested order: C1, C2, C3, C4, C7 (payload correctness), then C8, C9, R4 (keyboard), then C5, C6, C10, I2, I1, then the rest.
