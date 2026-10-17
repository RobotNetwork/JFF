/* Rich text normalization, sanitizing and code blocks.
   Split out of app.js, lines 1343-1834. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

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
    ...headingLevels,
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
        ...headingLevels,
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

/*
 * Clipboard fragments can hold <li> elements with no list around them, which
 * the serializer would otherwise flatten into one line. Every run of adjacent
 * loose items is wrapped in an unordered list so the editor DOM is well
 * formed before editing begins.
 */
function wrapOrphanListItems(root) {
    for (const parent of [root, ...root.querySelectorAll("*")]) {
        const tag = parent.tagName;

        if (tag === "UL" || tag === "OL") continue;

        let list = null;

        for (const child of [...parent.childNodes]) {
            if (
                child.nodeType === Node.ELEMENT_NODE &&
                child.tagName === "LI"
            ) {
                if (!list) {
                    list = root.ownerDocument.createElement("ul");
                    parent.insertBefore(list, child);
                }

                list.appendChild(child);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                list = null;
            }
        }
    }
}
