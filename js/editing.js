/* Leaving a block, list editing and typed markers.
   Split out of app.js, lines 1891-2626. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

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
