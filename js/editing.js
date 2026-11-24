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
        return { node: text, offset: text.data.length, mutated: false };
    }

    if (forward && text && text.data) {
        return {
            node: text,
            offset: text.data.startsWith(caretAnchor) ? 1 : 0,
            mutated: false,
        };
    }

    flushSnapshot();

    const anchor = document.createTextNode(caretAnchor);

    if (forward) {
        code.after(anchor);
    } else {
        code.before(anchor);
    }

    return { node: anchor, offset: 1, mutated: true };
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

    if (!selection.rangeCount || !selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    const code = inlineCodeElement(range.startContainer);

    if (!code) return null;

    const forward = direction > 0;
    const atEdge = forward
        ? range.endOffset >= nodeOffset(range.endContainer)
        : range.startOffset === 0;

    if (!atEdge) return null;

    const beyond = forward
        ? contentAfterCaret(code, range)
        : contentBeforeCaret(code, range);

    if (!isBlankContent(beyond)) return null;

    const point = inlineCodeEscapePoint(code, forward);
    const target = document.createRange();

    target.setStart(point.node, point.offset);
    target.collapse(true);

    selection.removeAllRanges();
    selection.addRange(target);

    return { stepped: true, mutated: point.mutated };
}

function stripEmptyInlineWrappers(root) {
    for (const element of [
        ...root.querySelectorAll(inlineFormatSelector),
    ].reverse()) {
        if (!element.firstElementChild && element.textContent === "") {
            element.remove();
        }
    }
}

/*
 * Enter inside inline code would put the break in the span, which [code]
 * cannot hold, and Chrome's own paragraph command copies the span into the
 * block below when it is the last thing in its block. Everything after the
 * span on the current line moves into a new block instead, so the break lands
 * on the far side of it and the span stays whole.
 */
function splitBlockAfterInlineCode(code) {
    const block = blockOf(code);
    const anchor = block === editor ? editorChild(code) : block;
    const tailRange = document.createRange();

    tailRange.setStartAfter(code);

    let trailingBreak = null;

    if (block === editor) {
        let stop = anchor.nextSibling;

        while (stop) {
            if (
                stop.nodeType === Node.ELEMENT_NODE &&
                (stop.tagName === "BR" ||
                    blockLevelTags.has(stop.tagName.toLowerCase()))
            ) {
                break;
            }
            stop = stop.nextSibling;
        }

        if (stop) {
            tailRange.setEndBefore(stop);
            if (stop.nodeType === Node.ELEMENT_NODE && stop.tagName === "BR") {
                trailingBreak = stop;
            }
        } else {
            tailRange.setEnd(editor, editor.childNodes.length);
        }
    } else {
        tailRange.setEnd(block, block.childNodes.length);
    }

    const tail = tailRange.extractContents();

    stripEmptyInlineWrappers(tail);
    if (trailingBreak) trailingBreak.remove();

    const blockTag = block === editor ? "p" : block.tagName.toLowerCase();
    const nextTag =
        blockTag === "li" || blockTag === "div" ? blockTag : "p";
    const paragraph = document.createElement(nextTag);

    paragraph.appendChild(tail);

    if (!paragraph.firstChild) paragraph.innerHTML = "<br>";

    if (blockTag === "blockquote") {
        block.appendChild(paragraph);
    } else {
        anchor.after(paragraph);
    }

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
        if (!mod && !event.shiftKey) {
            const exit = stepOutOfInlineCode(
                event.key === "ArrowRight" ? 1 : -1,
            );

            if (exit) {
                event.preventDefault();
                if (exit.mutated) {
                    queueSnapshot();
                    render();
                }
                updateToolbarState();
                return;
            }
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

                    if (isBlankContent(pre)) pre.remove();

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

const globalShortcutCommands = new Set(["copyOutput", "preview", "help"]);

document.addEventListener("keydown", (event) => {
    if (editor.contains(event.target)) return;

    const openDialog = document.querySelector("dialog[open]");
    const inPreview = openDialog === previewDialog;

    if (openDialog && !inPreview) return;

    const mod = event.ctrlKey || event.metaKey;

    if (!mod) return;

    const shortcut = editingShortcuts.find(
        (entry) =>
            globalShortcutCommands.has(entry.cmd) &&
            (!inPreview ||
                entry.cmd === "preview" ||
                entry.cmd === "copyOutput") &&
            matchesShortcut(entry, event),
    );

    if (!shortcut) return;

    event.preventDefault();
    applyCommand(shortcut.cmd, shortcut.val);
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
 * lists that hang off it. Its children are included, so an item whose text
 * sits in a <b> is read too. A caret placed after the item's children would
 * sit inside the last nested item, and that is where typed text would land.
 */
function caretToItem(item) {
    const texts = [];
    const collect = (node) => {
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                texts.push(child);
            } else if (child.nodeName !== "UL" && child.nodeName !== "OL") {
                collect(child);
            }
        }
    };

    collect(item);

    const range = document.createRange();

    if (texts.length > 0) {
        const target = texts[texts.length - 1];

        range.setStart(target, nodeOffset(target));
    } else {
        const list = [...item.children].findIndex(
            (child) => child.nodeName === "UL" || child.nodeName === "OL",
        );

        range.setStart(item, list === -1 ? item.childNodes.length : list);
    }

    range.collapse(true);

    const selection = window.getSelection();

    selection.removeAllRanges();
    selection.addRange(range);
}

/*
 * Moving a list item with appendChild drops the selection to the editable in
 * Chrome, and insertBefore is a remove and an insert, so a range that sat
 * inside the moved item is clamped to where the item left from. The nodes
 * themselves travel with the item, so the caret is kept as a node and an
 * offset and built again once the move is done, which lands it back on the
 * same character.
 */
function preservingSelection(item, move) {
    const selection = window.getSelection();
    const saved =
        selection.rangeCount > 0
            ? {
                  start: selection.getRangeAt(0).startContainer,
                  startOffset: selection.getRangeAt(0).startOffset,
                  end: selection.getRangeAt(0).endContainer,
                  endOffset: selection.getRangeAt(0).endOffset,
              }
            : null;
    const result = move();

    if (saved && editor.contains(saved.start)) {
        const range = document.createRange();

        range.setStart(
            saved.start,
            Math.min(saved.startOffset, nodeOffset(saved.start)),
        );

        if (editor.contains(saved.end)) {
            range.setEnd(
                saved.end,
                Math.min(saved.endOffset, nodeOffset(saved.end)),
            );
        } else {
            range.collapse(true);
        }

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

        /*
         * The item lands after everything the parent item holds, so the
         * siblings that came after it would end up reading below it. They
         * keep their place by becoming its children, which is the level they
         * already sit at.
         */
        const siblings = [...sublist.children];
        const following = siblings.slice(siblings.indexOf(item) + 1);

        const tag = sublist.tagName.toLowerCase();

        parentList.insertBefore(item, parentItem.nextElementSibling);

        if (following.length > 0) {
            let itemList = item.lastElementChild;

            if (!itemList || itemList.tagName.toLowerCase() !== tag) {
                itemList = document.createElement(tag);
                item.appendChild(itemList);
            }

            for (const sibling of following) itemList.appendChild(sibling);
        }

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

    const items = [...editor.querySelectorAll("ul, ol")].flatMap((list) =>
        [...list.querySelectorAll(":scope > li")].filter((item) =>
            range.intersectsNode(item),
        ),
    );

    /*
     * An item that holds another selected item only matched because the
     * range starts or ends inside it. Moving it would take those children
     * with it, and the range rebuilt over the moves would cover its text,
     * so the next keystroke would replace text the selection never had.
     */
    return items.filter(
        (item) =>
            !items.some((other) => other !== item && item.contains(other)),
    );
}

function isLineBoundary(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

    const tag = node.tagName.toLowerCase();

    return tag === "br" || blockLevelTags.has(tag);
}

function bareLineNodes(boundary) {
    const nodes = [];
    let cursor = boundary ? boundary.nextSibling : editor.firstChild;

    while (cursor && !isLineBoundary(cursor)) {
        nodes.push(cursor);
        cursor = cursor.nextSibling;
    }

    return nodes;
}

function insertBareLineContainer(boundary, container, target, nodes) {
    if (nodes.length > 0) {
        nodes[0].before(container);
        for (const node of nodes) {
            if (node.nodeType === Node.TEXT_NODE && node.data === "") {
                node.remove();
            } else {
                target.appendChild(node);
            }
        }
    } else if (boundary && boundary.parentNode === editor) {
        boundary.after(container);
    } else {
        editor.prepend(container);
    }
}

/*
 * The line the caret sits on becomes the first item of a new list.
 */
function listifyLine(line, tag) {
    const list = document.createElement(tag);
    const item = document.createElement("li");

    while (line.firstChild) item.appendChild(line.firstChild);

    /*
     * An empty item leaves the caret nowhere to sit, so it carries an empty
     * text node to hold it.
     */
    if (!item.firstChild) item.appendChild(document.createTextNode(""));

    list.appendChild(item);
    line.replaceWith(list);

    return item;
}

function listifyBareLine(boundary, tag) {
    const nodes = bareLineNodes(boundary);
    const list = document.createElement(tag);
    const item = document.createElement("li");

    list.appendChild(item);
    insertBareLineContainer(boundary, list, item, nodes);

    if (!item.firstChild) item.appendChild(document.createTextNode(""));

    return item;
}

function formatBareLine(boundary, tag) {
    const nodes = bareLineNodes(boundary);
    const element = document.createElement(tag);

    insertBareLineContainer(boundary, element, element, nodes);

    if (!element.textContent && !element.querySelector("br")) {
        element.replaceChildren(document.createElement("br"));
    }

    placeCaret(element);
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
function precedingBreak(block, range) {
    let cursor = range.startContainer;

    if (cursor === block) {
        cursor = block.childNodes[range.startOffset - 1] ?? null;
    } else {
        while (cursor && cursor.parentNode !== block) {
            cursor = cursor.parentNode;
        }
        cursor = cursor ? cursor.previousSibling : null;
    }

    const stopAtBlock = block === editor;

    while (cursor) {
        if (cursor.nodeType === Node.ELEMENT_NODE) {
            const tag = cursor.tagName.toLowerCase();

            if (tag === "br" || (stopAtBlock && blockLevelTags.has(tag))) {
                return cursor;
            }
        }
        cursor = cursor.previousSibling;
    }

    return null;
}

function textBeforeOnLine(block, range, br) {
    const prefix = document.createRange();

    if (br) {
        prefix.setStartAfter(br);
    } else {
        prefix.selectNodeContents(block);
    }

    prefix.setEnd(range.startContainer, range.startOffset);

    return prefix.toString();
}

function splitBlockAtBreak(block, br) {
    const next = document.createElement("p");

    while (br.nextSibling) {
        next.appendChild(br.nextSibling);
    }

    br.remove();
    block.after(next);

    return next;
}

function switchListItemType(item, tag) {
    const parentList = item.parentElement;

    if (!parentList) return item;

    const siblings = [...parentList.children];
    const index = siblings.indexOf(item);
    const before = siblings.slice(0, index);
    const after = siblings.slice(index + 1);
    const replacement = document.createElement(tag);

    replacement.appendChild(item);

    if (before.length === 0) {
        parentList.before(replacement);
        if (after.length === 0) parentList.remove();
    } else {
        parentList.after(replacement);

        if (after.length > 0) {
            const tail = parentList.cloneNode(false);

            for (const sibling of after) tail.appendChild(sibling);
            replacement.after(tail);
        }
    }

    return item;
}

function applyTypedMarker() {
    const selection = window.getSelection();

    if (!selection.rangeCount || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const block = caretBlock(range.startContainer);

    /* A marker inside code is code, not markup. */
    if (!block || block.closest("pre")) return false;

    const br = precedingBreak(block, range);
    const prefix = textBeforeOnLine(block, range, br);
    const heading = prefix.match(headingMarkerPattern);
    const quote = quoteMarkerPattern.test(prefix);

    if (!heading && !quote && !listMarkerPattern.test(prefix)) return false;

    const blockMarker = Boolean(heading || quote);

    /*
     * Rebuilding a list item as a heading or a quote would take the list with
     * it, so a marker typed inside one stays text.
     */
    if (blockMarker && block.closest("li")) return false;

    flushSnapshot();

    if (blockMarker) {
        const tag = heading ? `h${heading[1].length}` : "blockquote";

        removeMarker(block, range, br);

        if (block === editor) {
            formatBareLine(br, tag);

            if (br && br.tagName === "BR" && br.parentNode === editor) {
                br.remove();
            }
        } else {
            const line = br ? splitBlockAtBreak(block, br) : block;

            formatLine(line, tag);
        }

        return true;
    }

    const existing = block.closest("li");
    const nested = /^[ \t\u00a0]/.test(prefix);
    const tag = /^[ \t\u00a0]*[-*+]/.test(prefix) ? "ul" : "ol";

    removeMarker(block, range, br);

    let item = existing;

    if (existing) {
        const parentList = existing.parentElement;
        const currentTag = parentList ? parentList.tagName.toLowerCase() : "";

        if (
            !nested &&
            (currentTag === "ul" || currentTag === "ol") &&
            currentTag !== tag
        ) {
            item = switchListItemType(existing, tag);
        }
    } else if (block === editor) {
        item = listifyBareLine(br, tag);

        if (br && br.tagName === "BR" && br.parentNode === editor) {
            br.remove();
        }
    } else {
        const line = br ? splitBlockAtBreak(block, br) : block;

        item = listifyLine(line, tag);
    }

    placeCaret(item);

    if (nested) nestListItem(item);

    return true;
}

/*
 * A closing backtick turns the run between it and the backtick before it
 * into an inline code span, the way the paste parser reads a code span in
 * pasted markdown. Both delimiters are removed, since they are markup rather
 * than content, and the caret gets a character of its own after the span so
 * the next keystroke lands in prose.
 *
 * The run stays text when it is empty or only whitespace, which lets a lone
 * backtick be typed, and when the caret is already inside code, where a
 * backtick is part of the code. Only the text node that holds the caret is
 * searched, so a delimiter split off by formatting is left as typed.
 */
function applyTypedInlineCode() {
    const selection = window.getSelection();

    if (!selection.rangeCount || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const node = range.startContainer;

    if (node.nodeType !== Node.TEXT_NODE) return false;

    if (node.data.charAt(range.startOffset - 1) !== "`") return false;

    const element = closestElement(node);

    if (element.closest("pre") || inlineCodeElement(node)) return false;

    const run = runBeforeCaret(node, range.startOffset);

    if (!run || !run.content.trim() || run.content.includes("\n")) return false;

    flushSnapshot();

    const code = document.createElement("code");

    code.setAttribute("spellcheck", "false");
    code.textContent = run.content;

    const first = run.segments[0];
    const lastSegment = run.segments[run.segments.length - 1];
    const open = first.start - 1;
    const before =
        open > 0
            ? [document.createTextNode(first.node.data.slice(0, open))]
            : [];
    const outside = document.createTextNode(
        `${caretAnchor}${lastSegment.node.data.slice(range.startOffset)}`,
    );

    if (first.node === lastSegment.node) {
        node.replaceWith(...before, code, outside);
    } else {
        first.node.replaceWith(...before, code);
        for (let i = 1; i < run.segments.length - 1; i++) {
            run.segments[i].node.remove();
        }
        lastSegment.node.replaceWith(outside);
    }

    const caret = document.createRange();

    caret.setStart(outside, caretAnchor.length);
    caret.collapse(true);

    selection.removeAllRanges();
    selection.addRange(caret);

    return true;
}

/*
 * The text between the delimiters, walked backwards from the closing backtick
 * and read forwards again. The walk crosses text nodes because a paste splits
 * the line into separate nodes: insertHtmlAtCursor inserts the clipboard as
 * its own node, so the closing backtick lands in the pasted text while the
 * open one stayed behind in the node before it. It stops at the first
 * non-text sibling, since flattening a run that crosses a <br> or a span from
 * rich text would take formatting the span cannot carry, and stops without a
 * delimiter the same way a run with no opener stays text.
 */
function runBeforeCaret(node, closeOffset) {
    const segments = [];

    let current = node;
    let end = closeOffset - 1;

    while (true) {
        const open = end > 0 ? current.data.lastIndexOf("`", end - 1) : -1;

        segments.unshift({
            node: current,
            start: open === -1 ? 0 : open + 1,
            end,
        });

        if (open !== -1) {
            return {
                segments,
                content: segments
                    .map((segment) =>
                        segment.node.data.slice(
                            segment.start,
                            segment.end,
                        ),
                    )
                    .join(""),
            };
        }

        const previous = current.previousSibling;

        if (!previous || previous.nodeType !== Node.TEXT_NODE) return null;

        current = previous;
        end = previous.data.length;
    }
}

/*
 * The marker is markup, not content, so it never reaches the block. Deleting
 * via a Range from the line boundary to the caret handles markers split
 * across adjacent text nodes without risking IndexSizeError.
 */
function removeMarker(block, range, br = null) {
    const marker = document.createRange();

    if (br) {
        marker.setStartAfter(br);
    } else {
        marker.selectNodeContents(block);
    }

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

/* ---------- Clearing formatting ---------- */

/*
 * The inline tags Clear formatting takes off. A code span and a link are
 * meaning rather than appearance, so they stay.
 */
const clearedInlineSelector = [
    ...boldTags,
    ...italicTags,
    ...strikeTags,
    ...underlineTags,
].join(", ");

function isFormattingBlock(element) {
    const tag = element.tagName.toLowerCase();

    return headingLevels.includes(tag) || tag === "blockquote";
}

/*
 * A quote can hold whole paragraphs, and those are blocks in their own right,
 * so a quote holding blocks is unwrapped rather than turned into a <p> that
 * would then hold them. Anything else becomes a paragraph, keeping its
 * content; an empty block gets the <br> that gives the caret somewhere to sit.
 */
function clearBlockFormat(element) {
    if (!isFormattingBlock(element)) return null;

    if (element.querySelector(blockSelector)) {
        const first = element.firstElementChild;

        unwrapElement(element);

        return first;
    }

    const paragraph = document.createElement("p");

    while (element.firstChild) paragraph.appendChild(element.firstChild);

    if (!paragraph.textContent && !paragraph.querySelector("br")) {
        paragraph.appendChild(document.createElement("br"));
    }

    element.replaceWith(paragraph);

    return paragraph;
}

/*
 * The inline formatting inside a line. A line can itself be the wrapper - a
 * bold run typed into an empty editor has no block around it - and a list
 * item's nested lists are separate lines, so their inline tags are left to
 * their own pass.
 */
function inlineFormatsIn(line) {
    const formats = line.matches(clearedInlineSelector)
        ? [line, ...line.querySelectorAll(clearedInlineSelector)]
        : [...line.querySelectorAll(clearedInlineSelector)];

    return formats.filter((inline) => {
        const item = inline.closest("li");

        return !item || item === line;
    });
}

/*
 * The lines Clear formatting rewrites: the line at a caret, and every block a
 * selection touches. A block tag cannot be dropped from part of a line, so the
 * lines are cleared whole.
 */
function formattingLines(range) {
    if (range.collapsed) {
        const line = caretBlock(range.startContainer);

        return line && line !== editor ? [line] : [];
    }

    const lines = new Set();

    for (const node of [range.startContainer, range.endContainer]) {
        const line = caretBlock(node);

        if (line && line !== editor) lines.add(line);
    }

    for (const element of editor.querySelectorAll(blockSelector)) {
        if (range.intersectsNode(element)) lines.add(element);
    }

    return [...lines];
}

function firstLeafNode(node) {
    let cur = node;

    while (cur && cur.firstChild) cur = cur.firstChild;

    return cur;
}

function lastLeafNode(node) {
    let cur = node;

    while (cur && cur.lastChild) cur = cur.lastChild;

    return cur;
}

function highestClearedInline(node) {
    let cur = closestElement(node);
    let highest = null;

    while (cur && cur !== editor) {
        if (cur.matches(clearedInlineSelector)) highest = cur;
        cur = cur.parentElement;
    }

    return highest;
}

function rangeHasContent(range) {
    if (range.toString() !== "") return true;

    return Boolean(range.cloneContents().querySelector("br"));
}

function splitClearedInlineAt(ancestor, container, offset) {
    const before = document.createRange();

    before.setStart(ancestor, 0);
    before.setEnd(container, offset);

    if (!rangeHasContent(before)) return { position: "start", split: null };

    const after = document.createRange();

    after.setStart(container, offset);
    after.setEnd(ancestor, ancestor.childNodes.length);

    if (!rangeHasContent(after)) return { position: "end", split: null };

    const clone = ancestor.cloneNode(false);

    clone.appendChild(after.extractContents());
    ancestor.after(clone);

    return { position: "middle", split: clone };
}

/*
 * Unwraps only clearedInlineSelector tags intersecting a non-collapsed range,
 * splitting partially selected inline wrappers at the range edges so inline
 * <code> spans and <a> links stay intact.
 */
function clearInlineFormatsInRange(range) {
    const endAncestor = highestClearedInline(range.endContainer);

    if (endAncestor) {
        const result = splitClearedInlineAt(
            endAncestor,
            range.endContainer,
            range.endOffset,
        );

        if (result.position === "start") {
            range.setEndBefore(endAncestor);
        } else if (result.split) {
            const endLeaf = lastLeafNode(endAncestor);

            if (endLeaf) {
                range.setEnd(endLeaf, nodeOffset(endLeaf));
            } else {
                range.setEnd(endAncestor, endAncestor.childNodes.length);
            }
        }
    }

    const startAncestor = highestClearedInline(range.startContainer);

    if (startAncestor) {
        const endInsideStart = startAncestor.contains(range.endContainer);
        const result = splitClearedInlineAt(
            startAncestor,
            range.startContainer,
            range.startOffset,
        );

        if (result.position === "end") {
            range.setStartAfter(startAncestor);
        } else if (result.split) {
            const startLeaf = firstLeafNode(result.split);

            if (startLeaf) {
                range.setStart(startLeaf, 0);
            } else {
                range.setStart(result.split, 0);
            }

            if (endInsideStart) {
                const endLeaf = lastLeafNode(result.split);

                if (endLeaf) {
                    range.setEnd(endLeaf, nodeOffset(endLeaf));
                } else {
                    range.setEnd(result.split, result.split.childNodes.length);
                }
            }
        }
    }

    const start = { node: range.startContainer, offset: range.startOffset };
    const end = { node: range.endContainer, offset: range.endOffset };

    const targets = [...editor.querySelectorAll(clearedInlineSelector)].filter(
        (el) => !el.closest("pre") && range.intersectsNode(el),
    );

    for (const el of targets) {
        if (el.isConnected) unwrapElement(el);
    }

    return { start, end };
}

/*
 * Clear formatting drops block formatting and character formatting together.
 * Headings and quotes are turned back into paragraphs here; the inline tags
 * the toolbar writes are unwrapped (splitting partly selected wrappers on a
 * ranged selection) while preserving inline <code> spans and links.
 */
function clearFormatting() {
    const selection = window.getSelection();

    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) return;

    const collapsed = range.collapsed;
    const lines = formattingLines(range);

    let start = { node: range.startContainer, offset: range.startOffset };
    let end = { node: range.endContainer, offset: range.endOffset };

    if (!collapsed) {
        ({ start, end } = clearInlineFormatsInRange(range));
    }

    const cleared = lines.map((line) => {
        if (collapsed) {
            for (const inline of inlineFormatsIn(line)) unwrapElement(inline);
        }

        return clearBlockFormat(line) ?? (line.isConnected ? line : null);
    });

    if (start && end && restoreSelection(start, end)) return;

    placeCaretAtEnd(cleared.findLast(Boolean) ?? editor);
}

/*
 * Puts the caret back on the character it was on. The nodes survive an unwrap
 * and a block change, so references to them are what stays true; a caret that
 * sat on an element which was replaced has no node to return to and reports
 * false.
 */
function restoreSelection(start, end) {
    if (!editor.contains(start.node) || !editor.contains(end.node)) return false;

    const selection = window.getSelection();
    const range = document.createRange();

    try {
        range.setStart(start.node, Math.min(start.offset, nodeOffset(start.node)));
        range.setEnd(end.node, Math.min(end.offset, nodeOffset(end.node)));
    } catch {
        return false;
    }

    selection.removeAllRanges();
    selection.addRange(range);

    return true;
}
