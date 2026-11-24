import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./harness.mjs";

let app;

before(async () => {
    app = await startApp();
});

after(async () => {
    if (!app) return;
    assert.deepEqual(app.pageErrors, [], "Expected no uncaught page errors");
    await app.close();
});

describe("Markdown parser and heuristics", () => {
    it("parses headings h1 through h6", async () => {
        const html = await app.evaluate(() =>
            markdownToHtml("# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6"),
        );

        assert.equal(
            html,
            "<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>",
        );
    });

    it("parses inline emphasis, strike, code spans, and links without breaking bare asterisks", async () => {
        const html = await app.evaluate(() =>
            markdownToHtml(
                "***all*** **bold** *ital* ~~del~~ `a *b* <c>` 2 * 3 * 4 [docs](https://example.com/a_(b)) [bad](javascript:alert(1))",
            ),
        );

        assert.equal(
            html,
            '<p><b><em>all</em></b> <b>bold</b> <em>ital</em> <strike>del</strike> <code spellcheck="false">a *b* &lt;c&gt;</code> 2 * 3 * 4 <a href="https://example.com/a_(b)">docs</a> bad</p>',
        );
    });

    it("supports inline code nested inside a link label", async () => {
        const html = await app.evaluate(() =>
            markdownToHtml("[`fn()`](https://example.com)"),
        );

        assert.equal(
            html,
            '<p><a href="https://example.com"><code spellcheck="false">fn()</code></a></p>',
        );
    });

    it("parses blockquotes and joins consecutive quote lines with <br>", async () => {
        const html = await app.evaluate(() =>
            markdownToHtml("> First **line**\n> Second line"),
        );

        assert.equal(
            html,
            "<blockquote>First <b>line</b><br>Second line</blockquote>",
        );
    });

    it("parses nested unordered and ordered lists and list type switches", async () => {
        const html = await app.evaluate(() =>
            markdownToHtml(
                "- Top\n  - Nested\n1. First\n2) Second",
            ),
        );

        assert.equal(
            html,
            "<ul><li>Top<ul><li>Nested</li></ul></li></ul><ol><li>First</li><li>Second</li></ol>",
        );
    });

    it("parses fenced code blocks with CommonMark info strings and unclosed fences", async () => {
        const html = await app.evaluate(() =>
            markdownToHtml(
                '```python title="demo.py"\nif a < b:\n    print(a)\n```\n\n```sh\necho hi',
            ),
        );

        assert.equal(
            html,
            '<pre spellcheck="false"><code spellcheck="false">if a &lt; b:\n    print(a)</code></pre><pre spellcheck="false"><code spellcheck="false">echo hi</code></pre>',
        );
    });

    it("inserts an empty paragraph spacer for blank lines between paragraphs", async () => {
        const html = await app.evaluate(() =>
            markdownToHtml("First\n\nSecond"),
        );

        assert.equal(html, "<p>First</p><p><br></p><p>Second</p>");
    });

    it("distinguishes code snippets from Markdown in looksLikeCode and looksLikeMarkdown", async () => {
        const res = await app.evaluate(() => ({
            pyCode: looksLikeCode("# script\nimport os\nprint(os.getcwd())"),
            pyIsMd: looksLikeMarkdown("# script\nimport os\nprint(os.getcwd())"),
            mdHeadingProse: looksLikeCode("# Deploy Notes\nStatus = green"),
            mdHeadingIsMd: looksLikeMarkdown("# Deploy Notes\nStatus = green"),
            mdListWithCode: looksLikeCode("# Steps\n- run build()\n- check status"),
            singleLine: looksLikeCode("const x = 1;"),
            plainProse: looksLikeMarkdown("Just a plain sentence with no markers."),
            inlineMd: looksLikeMarkdown("See **bold** text here."),
        }));

        assert.equal(res.pyCode, true);
        assert.equal(res.pyIsMd, false);
        assert.equal(res.mdHeadingProse, false);
        assert.equal(res.mdHeadingIsMd, true);
        assert.equal(res.mdListWithCode, false);
        assert.equal(res.singleLine, false);
        assert.equal(res.plainProse, false);
        assert.equal(res.inlineMd, true);
    });
});
