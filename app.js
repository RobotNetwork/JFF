const editor = document.getElementById("editor");
const output = document.getElementById("output");
const copyBtn = document.getElementById("copyBtn");
const toolbar = document.getElementById("toolbar");

/* ---------- Custom undo/redo history ---------- */

let history = [];
let historyIndex = -1;
let historyTimer = null;

function flushSnapshot() {
    if (!historyTimer) return;

    clearTimeout(historyTimer);
    historyTimer = null;
    commitSnapshot();
}

function commitSnapshot() {
    const html = editor.innerHTML;

    if (history[historyIndex] && history[historyIndex].html === html) {
        return;
    }

    history = history.slice(0, historyIndex + 1);
    history.push({ html, caret: captureCaret() });

    if (history.length > 100) {
        history.shift();
    }

    historyIndex = history.length - 1;
}

function queueSnapshot() {
    clearTimeout(historyTimer);

    historyTimer = setTimeout(() => {
        historyTimer = null;
        commitSnapshot();
    }, 300);
}

/*
 * Steps are relative because a pending snapshot is committed first, which
 * appends an entry and moves historyIndex.
 */
function restore(step) {
    flushSnapshot();

    const index = historyIndex + step;

    if (index < 0 || index >= history.length) return;

    historyIndex = index;
    editor.innerHTML = history[index].html;

    if (!applyCaret(history[index].caret)) {
        placeCaretAtEnd(editor);
    }

    render();
    updateToolbarState();
}

function nodeOffset(node) {
    return node.nodeType === Node.TEXT_NODE
        ? node.data.length
        : node.childNodes.length;
}

function nodePath(node) {
    const path = [];

    while (node && node !== editor) {
        path.unshift([...node.parentNode.childNodes].indexOf(node));
        node = node.parentNode;
    }

    return path;
}

function nodeAtPath(path) {
    let node = editor;

    for (const index of path) {
        node = node.childNodes[index];

        if (!node) return null;
    }

    return node;
}

function captureCaret() {
    const selection = window.getSelection();

    if (!selection.rangeCount) return null;

    const range = selection.getRangeAt(0);

    if (
        !editor.contains(range.startContainer) ||
        !editor.contains(range.endContainer)
    ) {
        return null;
    }

    return {
        start: nodePath(range.startContainer),
        startOffset: range.startOffset,
        end: nodePath(range.endContainer),
        endOffset: range.endOffset,
    };
}

function applyCaret(caret) {
    if (!caret) return false;

    const start = nodeAtPath(caret.start);
    const end = nodeAtPath(caret.end);

    if (!start || !end) return false;

    const range = document.createRange();

    try {
        range.setStart(
            start,
            Math.min(caret.startOffset, nodeOffset(start)),
        );
        range.setEnd(end, Math.min(caret.endOffset, nodeOffset(end)));
    } catch {
        return false;
    }

    const selection = window.getSelection();

    selection.removeAllRanges();
    selection.addRange(range);

    return true;
}

/* ---------- General DOM helpers ---------- */

function closestElement(node) {
    if (!node) return null;

    return node.nodeType === Node.ELEMENT_NODE
        ? node
        : node.parentElement;
}

function getSelectedElement() {
    const selection = window.getSelection();

    if (!selection.rangeCount) return null;

    const element = closestElement(selection.anchorNode);

    if (!element || !editor.contains(element)) {
        return null;
    }

    return element;
}

function placeCaret(element) {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
}

function placeCaretAtEnd(element) {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);
}

function insertHtmlAtCursor(html) {
    const selection = window.getSelection();

    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    /*
     * The toolbar keeps the selection alive with preventDefault, so it can
     * still sit outside the editor. Editing it would delete unrelated page
     * content and insert markup that is never serialized.
     */
    if (!editor.contains(range.commonAncestorContainer)) return;

    range.deleteContents();

    const fragment = range.createContextualFragment(html);
    const lastNode = fragment.lastChild;

    range.insertNode(fragment);

    if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);

        selection.removeAllRanges();
        selection.addRange(range);
    }

    queueSnapshot();
    render();
    updateToolbarState();
}

/* ---------- Toolbar ---------- */

toolbar.addEventListener("mousedown", (event) => {
    const button = event.target.closest("button");

    if (!button) return;

    event.preventDefault();
    flushSnapshot();

    const { cmd, val } = button.dataset;

    applyCommand(cmd, val);

    editor.focus();
    queueSnapshot();
    render();

    requestAnimationFrame(updateToolbarState);
});

/*
 * Single entry point for the toolbar buttons and the keyboard shortcuts, so
 * a command behaves the same whichever way it is reached.
 */
function applyCommand(cmd, value) {
    switch (cmd) {
        case "formatBlock":
            document.execCommand(cmd, false, value);
            break;

        case "inlineCode":
            wrapInlineCode();
            break;

        case "codeBlock":
            document.execCommand("formatBlock", false, "pre");
            normalizeCodeBlocks(editor);
            break;

        case "link":
            insertLink();
            break;

        default:
            document.execCommand(cmd, false, null);
    }
}

function wrapInlineCode() {
    const selection = window.getSelection();

    if (!selection.rangeCount || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) return;

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

function insertLink() {
    const url = prompt("Link URL:", "https://");

    if (!url) return;

    const selection = window.getSelection();

    if (!selection.rangeCount || selection.isCollapsed) {
        const text = prompt("Link text:", url) || url;

        insertHtmlAtCursor(
            `<a href="${escapeAttr(url)}">${escapeHtml(text)}</a>&nbsp;`,
        );
    } else {
        document.execCommand("createLink", false, url);
    }
}

/* ---------- Toolbar active state ---------- */

function setButtonActive(button, active) {
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
}

function normalizeBlockName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[<>]/g, "");
}

function updateToolbarState() {
    const selectedElement = getSelectedElement();

    for (const button of toolbar.querySelectorAll("button")) {
        const { cmd, val } = button.dataset;

        if (!cmd || cmd === "removeFormat") continue;

        let active = false;

        if (selectedElement) {
            switch (cmd) {
                case "bold":
                case "italic":
                case "underline":
                case "strikeThrough":
                case "insertUnorderedList":
                case "insertOrderedList":
                    try {
                        active = document.queryCommandState(cmd);
                    } catch {
                        active = false;
                    }
                    break;

                case "formatBlock": {
                    const currentBlock = normalizeBlockName(
                        document.queryCommandValue("formatBlock"),
                    );

                    active =
                        currentBlock === normalizeBlockName(val);
                    break;
                }

                case "inlineCode":
                    active =
                        Boolean(selectedElement.closest("code")) &&
                        !selectedElement.closest("pre");
                    break;

                case "codeBlock":
                    active = Boolean(
                        selectedElement.closest("pre"),
                    );
                    break;

                case "link":
                    active = Boolean(selectedElement.closest("a"));
                    break;
            }
        }

        setButtonActive(button, active);
    }
}

/* ---------- Markdown to HTML ---------- */

function markdownToHtml(markdown) {
    const lines = markdown.split(/\r?\n/);
    const result = [];
    let list = null;
    let fence = null;

    const closeList = () => {
        if (!list) return;

        result.push(`</${list}>`);
        list = null;
    };

    const closeFence = () => {
        result.push(
            `<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`,
        );

        fence = null;
    };

    const inline = (text) => {
        const tokens = [];

        const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;

        /*
         * Code spans and links are held as placeholders so the emphasis
         * passes cannot rewrite text inside them, and so link URLs are
         * escaped exactly once. Emphasis delimiters are anchored to word
         * boundaries so that prose containing bare asterisks survives.
         */
        const held = text
            .replace(
                /`([^`]+)`/g,
                (_, code) => hold(`<code>${escapeHtml(code)}</code>`),
            )
            .replace(
                /\[([^\]]+)\]\(([^\s)]+?(?:\([^)]*\)[^\s)]*)*)\)/g,
                (_, label, url) => {
                    const href = normalizeHref(url);

                    if (!href) return label;

                    return hold(
                        `<a href="${escapeAttr(href)}">${escapeHtml(
                            label,
                        )}</a>`,
                    );
                },
            );

        return escapeHtml(held)
            .replace(
                /(^|[^*\w])\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*(?![\w*])/g,
                "$1<b>$2</b>",
            )
            .replace(
                /(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g,
                "$1<em>$2</em>",
            )
            .replace(/~~([^~]+)~~/g, "<strike>$1</strike>")
            .replace(
                /\u0000(\d+)\u0000/g,
                (_, index) => tokens[Number(index)],
            );
    };

    for (const line of lines) {
        let match;

        /*
         * Fenced code is consumed line by line. A single regular expression
         * over the whole document cannot tell a fence that opens a block
         * from a run of backticks inside a sentence.
         */
        if (fence) {
            if (/^\s*```\s*$/.test(line)) {
                closeFence();
            } else {
                fence.push(line);
            }

            continue;
        }

        if (/^\s*```[\w-]*\s*$/.test(line)) {
            closeList();
            fence = [];
        } else if ((match = line.match(/^#{1,3}\s+(.*)$/))) {
            closeList();
            result.push(`<h3>${inline(match[1])}</h3>`);
        } else if ((match = line.match(/^#{4,6}\s+(.*)$/))) {
            closeList();
            result.push(`<p><b>${inline(match[1])}</b></p>`);
        } else if ((match = line.match(/^>\s?(.*)$/))) {
            closeList();
            result.push(
                `<blockquote>${inline(match[1])}</blockquote>`,
            );
        } else if ((match = line.match(/^[-*+]\s+(.*)$/))) {
            if (list !== "ul") {
                closeList();
                result.push("<ul>");
                list = "ul";
            }

            result.push(`<li>${inline(match[1])}</li>`);
        } else if ((match = line.match(/^\d+[.)]\s+(.*)$/))) {
            if (list !== "ol") {
                closeList();
                result.push("<ol>");
                list = "ol";
            }

            result.push(`<li>${inline(match[1])}</li>`);
        } else if (line.trim() === "") {
            closeList();
            result.push("");
        } else {
            closeList();
            result.push(`<p>${inline(line)}</p>`);
        }
    }

    if (fence) closeFence();

    closeList();

    return result.join("");
}

/* ---------- Rich text normalization ---------- */

const boldTags = new Set(["b", "strong"]);
const italicTags = new Set(["i", "em"]);
const strikeTags = new Set(["s", "strike", "del"]);
const underlineTags = new Set(["u", "ins"]);

/*
 * Elements that carry line structure. They decide where a line ends and
 * where an inline wrapper has to be pushed down onto what it surrounds.
 */
const blockLevelTags = new Set([
    "p",
    "div",
    "li",
    "blockquote",
    "pre",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
]);

const inlineFormatTags = [
    ...boldTags,
    ...italicTags,
    ...strikeTags,
    ...underlineTags,
    "code",
    "a",
];

const inlineFormatSelector = inlineFormatTags.join(", ");

function wrapElementContents(element, tagName) {
    const wrapper = element.ownerDocument.createElement(tagName);

    while (element.firstChild) {
        wrapper.appendChild(element.firstChild);
    }

    element.appendChild(wrapper);
}

function unwrapElement(element) {
    element.replaceWith(...element.childNodes);
}

function hasBoldStyle(style) {
    const weight = style.fontWeight.trim().toLowerCase();

    return (
        weight === "bold" ||
        weight === "bolder" ||
        (/^\d+$/.test(weight) && Number(weight) >= 600)
    );
}

function hasItalicStyle(style) {
    return style.fontStyle.trim().toLowerCase() === "italic";
}

function hasStrikeStyle(style) {
    return `${style.textDecoration} ${style.textDecorationLine}`
        .toLowerCase()
        .includes("line-through");
}

function hasUnderlineStyle(style) {
    return `${style.textDecoration} ${style.textDecorationLine}`
        .toLowerCase()
        .includes("underline");
}

/*
 * Editors spell "this run is not bold" as an explicit normal value rather
 * than by leaving the wrapper out. Google Docs wraps a whole document in
 * <b style="font-weight:normal">, so reading only the on values would paste
 * that document entirely bold.
 */
function isBoldOff(style) {
    const weight = style.fontWeight.trim().toLowerCase();

    return weight === "normal" || weight === "400";
}

function isItalicOff(style) {
    return style.fontStyle.trim().toLowerCase() === "normal";
}

function isStrikeOff(style) {
    return (
        style.textDecoration.trim().toLowerCase() === "none" ||
        style.textDecorationLine.trim().toLowerCase() === "none"
    );
}

function isUnderlineOff(style) {
    return (
        style.textDecoration.trim().toLowerCase() === "none" ||
        style.textDecorationLine.trim().toLowerCase() === "none"
    );
}

/*
 * Word writes its bullet and number glyphs into the clipboard HTML as text,
 * one <span style="mso-list:Ignore"> per item, padded with &nbsp; out to the
 * width of the marker column. That padding is typesetting rather than
 * content, and the whitespace pass no longer collapses it, so reduce the
 * marker to the single space that separates it from the item.
 */
function collapseListMarkers(root) {
    for (const marker of root.querySelectorAll(
        '[style*="mso-list:ignore" i]',
    )) {
        marker.textContent = marker.textContent.replace(/\s+/g, " ");
    }
}

/*
 * Inline styles are how every editor carries formatting across the
 * clipboard: Word and OneNote use font-weight and friends, Google Docs and
 * LibreOffice use the same properties on spans. Only the marker comments
 * differ, so this runs for all rich HTML rather than for the payloads that
 * happen to look like OneNote.
 */
function normalizeInlineStyles(doc) {
    collapseListMarkers(doc.body);

    for (const element of [...doc.body.querySelectorAll("*")]) {
        const tag = element.tagName.toLowerCase();
        const style = element.style;

        const formatsOff =
            (boldTags.has(tag) && isBoldOff(style)) ||
            (italicTags.has(tag) && isItalicOff(style)) ||
            (strikeTags.has(tag) && isStrikeOff(style)) ||
            (underlineTags.has(tag) && isUnderlineOff(style));

        if (formatsOff) {
            unwrapElement(element);
            continue;
        }

        if (hasBoldStyle(style) && !boldTags.has(tag)) {
            wrapElementContents(element, "strong");
        }

        if (hasItalicStyle(style) && !italicTags.has(tag)) {
            wrapElementContents(element, "em");
        }

        if (hasStrikeStyle(style) && !strikeTags.has(tag)) {
            wrapElementContents(element, "strike");
        }

        if (hasUnderlineStyle(style) && !underlineTags.has(tag)) {
            wrapElementContents(element, "u");
        }
    }

    distributeFormattingOverBlocks(doc.body);
}

/*
 * A wrapper around part of a line is applied to its contents, but a wrapper
 * around whole blocks cannot stay: [code] holds no block structure, so the
 * paragraphs inside would serialize as one joined line. Google Docs puts
 * such a wrapper around the entire document, so push it down onto each
 * block instead of dropping the formatting.
 */
function distributeFormattingOverBlocks(root) {
    const wrappers = [...root.querySelectorAll(inlineFormatSelector)];

    /*
     * Deepest first: pushing a block out of a nested wrapper can leave the
     * wrapper around that one holding blocks too.
     */
    for (let index = wrappers.length - 1; index >= 0; index--) {
        const wrapper = wrappers[index];

        const children = [...wrapper.childNodes].filter(
            (node) =>
                node.nodeType === Node.ELEMENT_NODE ||
                node.textContent.trim() !== "",
        );

        const wrapsOnlyBlocks =
            children.length > 0 &&
            children.every(
                (node) =>
                    node.nodeType === Node.ELEMENT_NODE &&
                    blockLevelTags.has(node.tagName.toLowerCase()),
            );

        if (!wrapsOnlyBlocks) continue;

        for (const block of children) {
            const copy = wrapper.cloneNode(false);

            while (block.firstChild) {
                copy.appendChild(block.firstChild);
            }

            block.appendChild(copy);
            wrapper.parentNode.insertBefore(block, wrapper);
        }

        wrapper.remove();
    }
}

function hasBlockChild(element) {
    return [...element.children].some((child) =>
        blockLevelTags.has(child.tagName.toLowerCase()),
    );
}

function hasContentBefore(node) {
    for (
        let sibling = node.previousSibling;
        sibling;
        sibling = sibling.previousSibling
    ) {
        if (sibling.nodeType === Node.ELEMENT_NODE) return true;
        if (sibling.textContent.trim() !== "") return true;
    }

    return false;
}

function hasContentAfter(node) {
    for (
        let sibling = node.nextSibling;
        sibling;
        sibling = sibling.nextSibling
    ) {
        if (sibling.nodeType === Node.ELEMENT_NODE) return true;
        if (sibling.textContent.trim() !== "") return true;
    }

    return false;
}

/*
 * A whitespace run that spans a newline is the markup's own line wrapping.
 * HTML would collapse it, and this editor renders with white-space:
 * pre-wrap, so it has to be collapsed before insertion. Runs of plain
 * spaces are content: Word and OneNote indent with &nbsp;, and that
 * indentation is what makes a pasted snippet usable as code.
 *
 * A collapsed run at the edge of a text node becomes a space only when
 * there is content beside it, since a run at the edge of a paragraph would
 * otherwise indent the paragraph.
 */
function collapseSourceWrapping(text, before, after) {
    const leading = text.match(/^\s*\n\s*/);
    const trailing = text.match(/\s*\n\s*$/);

    let start = 0;
    let end = text.length;
    let head = "";
    let tail = "";

    if (leading) {
        start = leading[0].length;
        head = before ? " " : "";
    }

    if (trailing) {
        /*
         * A node that holds nothing but wrapping matches both patterns, and
         * the leading match has already consumed it.
         */
        if (trailing[0].length <= text.length - start) {
            end = text.length - trailing[0].length;
            tail = after ? " " : "";
        } else {
            end = start;
        }
    }

    const middle = text.slice(start, end).replace(/\s*\n\s*/g, " ");

    return head + middle + tail;
}

function normalizeRichTextWhitespace(root) {
    /*
     * Indentation-only text nodes exist so that the markup between block
     * elements is readable. They surface as stray spaces as soon as the
     * element around them is unwrapped, so drop them first.
     */
    for (const parent of [root, ...root.querySelectorAll("*")]) {
        if (!hasBlockChild(parent)) continue;

        for (const child of [...parent.childNodes]) {
            if (
                child.nodeType === Node.TEXT_NODE &&
                child.textContent.trim() === ""
            ) {
                child.remove();
            }
        }
    }

    const walker = root.ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
    );

    const textNodes = [];
    let node = null;

    while ((node = walker.nextNode())) {
        textNodes.push(node);
    }

    for (const textNode of textNodes) {
        const parent = textNode.parentElement;

        if (!parent || parent.closest("pre")) continue;

        const text = textNode.data.replace(/\u00a0/g, " ");

        textNode.data = collapseSourceWrapping(
            text,
            hasContentBefore(textNode),
            hasContentAfter(textNode),
        );
    }

    root.normalize();
}

/*
 * Code blocks are stored as plain text with real newlines. Paste can drop
 * <br> elements or whole blocks into a <pre>, which renders identically but
 * serializes to a single joined line, so flatten it back to newlines.
 */
function normalizeCodeBlocks(root) {
    const selection = window.getSelection();
    const anchor =
        selection.rangeCount > 0 ? selection.anchorNode : null;

    for (const pre of root.querySelectorAll("pre")) {
        if (!pre.querySelector(codeBreakSelector)) continue;

        const caretWasInside = Boolean(anchor && pre.contains(anchor));

        pre.textContent = codeText(pre).replace(/^\n+|\n+$/g, "");

        if (caretWasInside) {
            placeCaretAtEnd(pre);
        }
    }
}

/*
 * Elements whose text is not content. Every other disallowed element is
 * unwrapped, which is what the editor wants for layout wrappers, but
 * unwrapping these would paste their text into the entry.
 */
const droppedTags = new Set([
    "style",
    "script",
    "title",
    "meta",
    "link",
    "base",
    "head",
    "noscript",
    "template",
    "iframe",
    "object",
    "embed",
    "svg",
]);

/*
 * Clipboard HTML carries comments: the StartFragment markers that Word and
 * OneNote wrap their payload in, and Word's conditional comments around
 * list bullets. They hold no content and would otherwise stay in the
 * editor DOM and in every undo snapshot.
 */
function removeComments(root) {
    const walker = root.ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_COMMENT,
    );

    const comments = [];
    let node = null;

    while ((node = walker.nextNode())) {
        comments.push(node);
    }

    for (const comment of comments) {
        comment.remove();
    }
}

function sanitizeRichText(doc) {
    const allowed = [
        "b",
        "strong",
        "i",
        "em",
        "s",
        "strike",
        "del",
        "u",
        "ins",
        "code",
        "pre",
        "blockquote",
        "a",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "br",
        "p",
        "div",
    ].join(",");

    removeComments(doc.body);

    doc.body
        .querySelectorAll([...droppedTags].join(","))
        .forEach((element) => element.remove());

    /*
     * Scope sanitization to the body. Unwrapping document root elements
     * can throw HierarchyRequestError.
     */
    doc.body
        .querySelectorAll(`*:not(${allowed})`)
        .forEach((element) => {
            element.replaceWith(...element.childNodes);
        });

    doc.body.querySelectorAll("*").forEach((element) => {
        for (const attribute of [...element.attributes]) {
            /*
             * A link is kept only if the serializer would keep it, so an
             * href that reaches the editor is one the output can carry.
             */
            const isAllowedHref =
                element.tagName === "A" &&
                attribute.name.toLowerCase() === "href" &&
                normalizeHref(attribute.value) !== "";

            if (!isAllowedHref) {
                element.removeAttribute(attribute.name);
            }
        }
    });
}

/* ---------- Keyboard shortcuts ---------- */

/*
 * Every shortcut is Ctrl (Cmd on macOS) plus the chord below. Letters and
 * digits match the character the layout produces, so they follow the
 * keyboard; the shifted chords match the physical key instead, since
 * Ctrl+Shift+8 produces a different character on a different layout.
 *
 * The table is the reference for what the editor can do without a mouse, so
 * it covers every toolbar button.
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
    { key: "1", alt: true, cmd: "formatBlock", val: "h3" },
    { key: "z", cmd: "undo" },
    { key: "y", cmd: "redo" },
    { key: "z", shift: true, cmd: "redo" },
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

editor.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;

    if (event.key === "Tab") {
        event.preventDefault();
        flushSnapshot();
        handleTab(event.shiftKey);
        queueSnapshot();
        render();
        updateToolbarState();
        return;
    }

    if (event.key === "Enter" && !mod && !event.shiftKey) {
        const selection = window.getSelection();

        if (selection.rangeCount && selection.isCollapsed) {
            const element = closestElement(selection.anchorNode);
            const pre = element?.closest("pre");

            if (pre) {
                const range = selection.getRangeAt(0);
                const after = range.cloneRange();

                after.selectNodeContents(pre);
                after.setStart(range.endContainer, range.endOffset);

                const before = range.cloneRange();

                before.selectNodeContents(pre);
                before.setEnd(
                    range.startContainer,
                    range.startOffset,
                );

                const caretAtEnd = after.toString() === "";
                const currentLineEmpty = /(^|\n)$/.test(
                    before.toString(),
                );

                if (caretAtEnd && currentLineEmpty) {
                    event.preventDefault();
                    flushSnapshot();

                    pre.textContent = pre.textContent.replace(
                        /\n$/,
                        "",
                    );

                    const paragraph = document.createElement("p");

                    paragraph.innerHTML = "<br>";
                    pre.after(paragraph);
                    placeCaret(paragraph);

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

    /*
     * Undo and redo walk the snapshot stack instead of running a document
     * command, so they own the rest of the handler.
     */
    if (shortcut.cmd === "undo" || shortcut.cmd === "redo") {
        restore(shortcut.cmd === "undo" ? -1 : 1);
        return;
    }

    flushSnapshot();
    applyCommand(shortcut.cmd, shortcut.val);
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

        if (!list || !previous || previous.tagName !== "LI") return false;

        const tag = list.tagName.toLowerCase();
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
 * Typing a marker at the start of a line turns that line into a list item,
 * the way a word processor does. An indented marker nests the item one level
 * under the item above it.
 *
 * The list is built here rather than with execCommand, which Chrome ignores
 * for the length of the input event this runs in.
 */
function applyListMarker() {
    const selection = window.getSelection();

    if (!selection.rangeCount || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const block = caretBlock(range.startContainer);

    if (!block || block.closest("pre")) return false;

    const prefix = textBefore(block, range);

    if (!listMarkerPattern.test(prefix)) return false;

    const line = caretLine(block, range);

    // The editor is not a line, and replacing it would take the page apart.
    if (!line || line === editor) return false;

    flushSnapshot();

    const existing = block.closest("li");
    const nested = /^[ \t\u00a0]/.test(prefix);
    const tag = /^[ \t\u00a0]*[-*+]/.test(prefix) ? "ul" : "ol";

    /*
     * The marker is markup, not content, so it never reaches the list item.
     * A bare text node is trimmed in place rather than deleted, since it is
     * about to become the item's content, and the marker is its entire text
     * up to the caret.
     */
    if (line.nodeType === Node.TEXT_NODE) {
        line.deleteData(0, prefix.length);
    } else {
        const marker = document.createRange();

        marker.selectNodeContents(line);
        marker.setEnd(range.startContainer, range.startOffset);
        marker.deleteContents();
    }

    const item = existing || listifyLine(line, tag);

    placeCaret(item);

    if (nested) nestListItem(item);

    return true;
}

/* ---------- Tab handling ---------- */

function insertTab() {
    document.execCommand("insertText", false, "\t");
}

function removeIndentBeforeCaret() {
    const selection = window.getSelection();

    if (!selection.rangeCount || !selection.isCollapsed) {
        return false;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;

    if (node.nodeType !== Node.TEXT_NODE) {
        return false;
    }

    const before = node.textContent.slice(0, offset);
    const match = before.match(/(?:\t| {1,4})$/);

    if (!match) return false;

    node.deleteData(offset - match[0].length, match[0].length);

    range.setStart(node, offset - match[0].length);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);

    return true;
}

function handleTab(shiftKey) {
    const items = listItemsInSelection();

    if (items.length === 0) {
        if (shiftKey) {
            removeIndentBeforeCaret();
        } else {
            insertTab();
        }

        return;
    }

    /*
     * Outdenting walks backwards: each item lands directly after its parent
     * item, so the ones already moved stay ahead of the ones still to move.
     * Nesting walks forwards, since moving an item out of the list makes the
     * item above it the previous sibling of the next one.
     */
    const order = shiftKey ? [...items].reverse() : items;

    for (const item of order) {
        if (shiftKey) {
            outdentListItem(item);
        } else {
            nestListItem(item);
        }
    }
}

/* ---------- Editor placeholder ---------- */

function updatePlaceholder() {
    /*
     * An empty code block renders as its own box, so it is not an empty
     * document even though it holds no text.
     */
    const empty =
        editor.textContent.trim() === "" &&
        !editor.querySelector("pre");

    editor.classList.toggle("is-empty", empty);
}

/* ---------- ServiceNow serializer ---------- */

const inlineTags = new Set([
    "b",
    "strong",
    "i",
    "em",
    "s",
    "strike",
    "del",
    "u",
    "ins",
    "code",
    "a",
]);

const blockTags = new Set([
    "pre",
    "blockquote",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
]);

/*
 * Elements that end a line inside a code block. Clipboard paste carries
 * line structure as <br>, rich text paste carries it as whole blocks, and
 * neither survives textContent.
 */
const codeBreakTags = new Set([
    "br",
    "p",
    "div",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
]);

const codeBreakSelector = [...codeBreakTags].join(", ");

function wrapCode(html) {
    return html ? `[code]${html}[/code]` : "";
}

function normalizeHref(value) {
    const href = value.trim();

    if (
        /^(https?:|mailto:|tel:)/i.test(href) ||
        href.startsWith("/") ||
        href.startsWith("#")
    ) {
        return href;
    }

    return "";
}

/*
 * Word and Outlook autocorrect run before the paste reaches the browser, so
 * a code sample arrives with typographic punctuation: curly quotes, en and
 * em dashes, an ellipsis. Those characters break the code once it is pasted
 * out of ServiceNow, and inside [code] a straight ASCII character is what
 * was meant. Outside it the journal shows the text as written, which is
 * proper typography in prose, so this is scoped to code.
 */
const codeTypography = [
    [/\u200b|\u200c|\u200d|\ufeff/g, ""],
    [/\u00a0/g, " "],
    [/\u2018|\u2019|\u201b/g, "'"],
    [/\u201c|\u201d|\u201f/g, '"'],
    [/\u2026/g, "..."],
    [/\u2013/g, "-"],
    [/\u2014/g, "--"],
];

function normalizeCodePunctuation(text) {
    return codeTypography.reduce(
        (value, [pattern, replacement]) =>
            value.replace(pattern, replacement),
        text,
    );
}

function serializeText(node, insideCode) {
    const text = node.textContent.replace(/\u00a0/g, " ");

    /*
     * Inside [code] ServiceNow renders HTML, so literal characters must be
     * escaped. Outside it the journal shows the text as written, so escaping
     * there would display entities instead of the characters typed.
     */
    return insideCode
        ? escapeHtml(normalizeCodePunctuation(text))
        : text;
}

function serializeChildren(node, insideCode) {
    return [...node.childNodes]
        .map((child) => serializeNode(child, insideCode))
        .join("");
}

function codeText(element) {
    let text = "";

    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.data;
            continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = node.tagName.toLowerCase();

        if (tag === "br") {
            text += "\n";
        } else if (codeBreakTags.has(tag)) {
            if (text && !text.endsWith("\n")) {
                text += "\n";
            }

            text += `${codeText(node)}\n`;
        } else {
            text += codeText(node);
        }
    }

    return text;
}

function serializeHtmlElement(element) {
    const tag = element.tagName.toLowerCase();
    const inner = serializeChildren(element, true);

    switch (tag) {
        case "b":
        case "strong":
            return `<b>${inner}</b>`;

        case "i":
        case "em":
            return `<em>${inner}</em>`;

        case "s":
        case "strike":
        case "del":
            return `<strike>${inner}</strike>`;

        case "u":
        case "ins":
            return `<u>${inner}</u>`;

        case "code":
            // Intentionally bold inline code for ServiceNow readability.
            return `<b><code>${inner}</code></b>`;

        case "pre": {
            const body = element.querySelector(":scope > code") || element;
            const text = normalizeCodePunctuation(
                codeText(body).replace(/^\n+|\n+$/g, ""),
            );

            return `<pre><code>${escapeHtml(text)}</code></pre>`;
        }

        case "blockquote":
            return `<blockquote>${inner}</blockquote>`;

        case "a": {
            const href = normalizeHref(
                element.getAttribute("href") || "",
            );

            if (!href) return inner;

            return `<a href="${escapeAttr(href)}">${inner}</a>`;
        }

        case "ul":
        case "ol":
            return `<${tag}>${inner}</${tag}>`;

        case "li":
            return `<li>${inner}</li>`;

        case "h1":
        case "h2":
        case "h3":
            return `<h3>${inner}</h3>`;

        case "h4":
        case "h5":
        case "h6":
            return `<b>${inner}</b>`;

        case "br":
            /*
             * ServiceNow strips ordinary newlines and <br> inside [code].
             * This is one of the few places where <p></p> is necessary.
             */
            return "<p></p>";

        case "p":
        case "div":
            return inner;

        default:
            return inner;
    }
}

function serializeNode(node, insideCode = false) {
    if (node.nodeType === Node.TEXT_NODE) {
        return serializeText(node, insideCode);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    const tag = node.tagName.toLowerCase();

    if (insideCode) {
        return serializeHtmlElement(node);
    }

    if (tag === "p" || tag === "div") {
        const content = serializeChildren(node, false);

        return content ? `${content}\n` : "\n";
    }

    if (tag === "br") {
        return "\n";
    }

    if (inlineTags.has(tag) || blockTags.has(tag)) {
        const html = serializeHtmlElement(node);
        const suffix = blockTags.has(tag) ? "\n" : "";

        return `${wrapCode(html)}${suffix}`;
    }

    return serializeChildren(node, false);
}

/*
 * split() keeps the captured [code] regions at odd indices. Only the prose
 * is tidied, so code keeps its trailing whitespace and blank lines.
 */
const codeRegion = /(\[code\][\s\S]*?\[\/code\])/;

function tidyProse(text) {
    return text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
}

function render() {
    /*
     * Blank lines at either end come from an empty first or last block and
     * are dropped, but the indentation of the first line is not: it is what
     * survives of a pasted snippet's leading whitespace.
     */
    const body = serializeChildren(editor, false)
        .split(codeRegion)
        .map((part, index) => (index % 2 ? part : tidyProse(part)))
        .join("")
        .replace(/^[ \t]*\n+/, "")
        .replace(/\n+[ \t]*$/, "")
        .replace(/[ \t]+$/, "");

    output.textContent = body;

    /*
     * render() is the one hook every content change already runs, so the
     * placeholder is refreshed here rather than at each call site.
     */
    updatePlaceholder();
}

/* ---------- Paste handling ---------- */

editor.addEventListener("paste", (event) => {
    event.preventDefault();
    flushSnapshot();

    const clipboard = event.clipboardData;
    const html = clipboard.getData("text/html");

    if (html) {
        const doc = new DOMParser().parseFromString(
            html,
            "text/html",
        );

        /*
         * Clipboard metadata varies between editors and versions, and every
         * editor that is not a Microsoft one still carries formatting as
         * inline styles, so the whole path runs for all rich HTML.
         */
        normalizeInlineStyles(doc);

        sanitizeRichText(doc);

        normalizeRichTextWhitespace(doc.body);

        insertHtmlAtCursor(doc.body.innerHTML);
        normalizeCodeBlocks(editor);
        return;
    }

    const text = clipboard.getData("text/plain");

    if (!text) return;

    if (looksLikeMarkdown(text)) {
        insertHtmlAtCursor(markdownToHtml(text));
    } else {
        insertHtmlAtCursor(
            escapeHtml(text).replace(/\r?\n/g, "<br>"),
        );
    }

    normalizeCodeBlocks(editor);
});

/* ---------- Helpers ---------- */

function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function looksLikeMarkdown(text) {
    return (
        /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```)/m.test(text) ||
        /(\*\*[^*]+\*\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/.test(
            text,
        )
    );
}

/* ---------- Events ---------- */

editor.addEventListener("input", (event) => {
    /*
     * A marker is only complete once its trailing space is in the DOM, so the
     * conversion runs from the input event rather than from keydown, where
     * the space has not been inserted yet.
     */
    if (event.inputType === "insertText" && event.data === " ") {
        applyListMarker();
    }

    queueSnapshot();
    render();
    updateToolbarState();
});

editor.addEventListener("keyup", updateToolbarState);
editor.addEventListener("mouseup", updateToolbarState);
editor.addEventListener("focus", updateToolbarState);

document.addEventListener("selectionchange", () => {
    requestAnimationFrame(updateToolbarState);
});

copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(output.textContent);

    copyBtn.textContent = "Copied!";

    setTimeout(() => {
        copyBtn.textContent = "Copy";
    }, 1200);
});

/*
 * Formatting commands are captured as tags rather than as inline styles: the
 * serializer and the sanitizer both understand <b>, <i>, <u>, and <strike>,
 * and a style attribute would be stripped on the way in.
 */
document.execCommand("styleWithCSS", false, false);

commitSnapshot();
render();
updateToolbarState();
