/* Markdown to HTML.
   Split out of app.js, lines 1201-1342. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Markdown to HTML ---------- */

function markdownToHtml(markdown) {
    const lines = markdown.split(/\r?\n/);
    const result = [];
    const listStack = [];
    let quoteLines = null;
    let fence = null;
    let lastType = null;
    let pendingBlank = false;

    const closeListsTo = (targetIndent, tag) => {
        while (listStack.length > 0) {
            const top = listStack[listStack.length - 1];

            if (
                top.indent > targetIndent ||
                (top.indent === targetIndent && top.tag !== tag)
            ) {
                if (top.hasItem) result.push("</li>");
                result.push(`</${top.tag}>`);
                listStack.pop();
            } else {
                break;
            }
        }
    };

    const closeAllLists = () => {
        while (listStack.length > 0) {
            const top = listStack.pop();

            if (top.hasItem) result.push("</li>");
            result.push(`</${top.tag}>`);
        }
    };

    const closeQuote = () => {
        if (!quoteLines) return;

        result.push(`<blockquote>${quoteLines.join("<br>")}</blockquote>`);
        quoteLines = null;
        lastType = "blockquote";
    };

    const closeFence = () => {
        result.push(
            `<pre spellcheck="false"><code spellcheck="false">${escapeHtml(fence.join("\n"))}</code></pre>`,
        );

        fence = null;
        lastType = "pre";
    };

    const inline = (text) => {
        const tokens = [];

        const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;

        const expandTokens = (value) => {
            let current = value;

            for (let pass = 0; pass < 4 && /\u0000\d+\u0000/.test(current); pass++) {
                current = current.replace(
                    /\u0000(\d+)\u0000/g,
                    (match, index) => tokens[Number(index)] ?? match,
                );
            }

            return current;
        };

        /*
         * Code spans and links are held as placeholders so the emphasis
         * passes cannot rewrite text inside them, and so link URLs are
         * escaped exactly once. Emphasis delimiters are anchored to word
         * boundaries so that prose containing bare asterisks survives. NUL
         * is the placeholder delimiter, so any that arrived in the text is
         * removed before tokenizing, and nested placeholders (such as a code
         * span inside a link label) are expanded iteratively.
         */
        const held = text
            .replace(/\u0000/g, "")
            .replace(
                /`([^`]+)`/g,
                (_, code) =>
                    hold(`<code spellcheck="false">${escapeHtml(code)}</code>`),
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

        const formatted = escapeHtml(held)
            .replace(
                /(^|[^*\w])\*\*\*(?!\s)((?:[^*]|\*(?!\*\*))+?)(?<!\s)\*\*\*(?![\w*])/g,
                "$1<b><em>$2</em></b>",
            )
            .replace(
                /(^|[^*\w])\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*(?![\w*])/g,
                "$1<b>$2</b>",
            )
            .replace(
                /(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g,
                "$1<em>$2</em>",
            )
            .replace(/~~([^~]+)~~/g, "<strike>$1</strike>");

        return expandTokens(formatted);
    };

    const pushListItem = (tag, rawIndent, content) => {
        closeQuote();
        pendingBlank = false;

        const indent = rawIndent.replace(/\t/g, "  ").length;

        if (listStack.length === 0) {
            result.push(`<${tag}>`);
            listStack.push({ tag, indent, hasItem: false });
        } else {
            const top = listStack[listStack.length - 1];

            if (indent > top.indent) {
                result.push(`<${tag}>`);
                listStack.push({ tag, indent, hasItem: false });
            } else {
                closeListsTo(indent, tag);

                if (
                    listStack.length === 0 ||
                    listStack[listStack.length - 1].indent < indent
                ) {
                    result.push(`<${tag}>`);
                    listStack.push({ tag, indent, hasItem: false });
                }
            }
        }

        const current = listStack[listStack.length - 1];

        if (current.hasItem) result.push("</li>");
        result.push(`<li>${inline(content)}`);
        current.hasItem = true;
        lastType = "list";
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
            closeAllLists();
            closeQuote();
            pendingBlank = false;
            fence = [];
        } else if ((match = line.match(headingHashPattern))) {
            /*
             * ServiceNow renders each heading level as written, so the hash
             * count maps straight to the tag rather than collapsing to h3.
             */
            closeAllLists();
            closeQuote();
            pendingBlank = false;

            const level = match[1].length;

            result.push(`<h${level}>${inline(match[2])}</h${level}>`);
            lastType = "heading";
        } else if ((match = line.match(/^>\s?(.*)$/))) {
            closeAllLists();
            pendingBlank = false;

            if (!quoteLines) quoteLines = [];
            quoteLines.push(inline(match[1]));
        } else if ((match = line.match(/^([ \t]*)[-*+]\s+(.*)$/))) {
            pushListItem("ul", match[1], match[2]);
        } else if ((match = line.match(/^([ \t]*)\d+[.)]\s+(.*)$/))) {
            pushListItem("ol", match[1], match[2]);
        } else if (line.trim() === "") {
            closeAllLists();
            closeQuote();

            if (result.length > 0) pendingBlank = true;
        } else {
            closeAllLists();
            closeQuote();

            if (pendingBlank && lastType === "p") {
                result.push("<p><br></p>");
            }

            pendingBlank = false;
            result.push(`<p>${inline(line)}</p>`);
            lastType = "p";
        }
    }

    if (fence) closeFence();

    closeAllLists();
    closeQuote();

    return result.join("");
}
