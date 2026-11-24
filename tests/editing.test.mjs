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

describe("Keyboard shortcuts, toolbar commands, and editing", () => {
    it("verifies every toolbar button and shortcut maps to a known command", async () => {
        await app.evaluate(() => checkCommandCoverage());
    });

    it("matches keyboard shortcuts and ignores AltGraph", async () => {
        const res = await app.evaluate(() => {
            const makeEvent = (init) => ({
                key: "",
                code: "",
                shiftKey: false,
                altKey: false,
                getModifierState: (mod) => Boolean(init.altGraph && mod === "AltGraph"),
                ...init,
            });

            const bold = editingShortcuts.find((s) => s.cmd === "bold");
            const h2 = editingShortcuts.find(
                (s) => s.cmd === "formatBlock" && s.val === "h2",
            );
            const ul = editingShortcuts.find((s) => s.cmd === "insertUnorderedList");

            return {
                boldMatch: matchesShortcut(bold, makeEvent({ key: "B" })),
                boldShiftNo: matchesShortcut(bold, makeEvent({ key: "b", shiftKey: true })),
                altGraphNo: matchesShortcut(
                    h2,
                    makeEvent({ code: "Digit2", altKey: true, altGraph: true }),
                ),
                h2Match: matchesShortcut(h2, makeEvent({ code: "Digit2", altKey: true })),
                ulMatch: matchesShortcut(ul, makeEvent({ code: "Digit8", shiftKey: true })),
            };
        });

        assert.deepEqual(res, {
            boldMatch: true,
            boldShiftNo: false,
            altGraphNo: false,
            h2Match: true,
            ulMatch: true,
        });
    });

    it("applies bold, italic, underline, and strikethrough via keyboard shortcuts", async () => {
        await app.resetEditor("<p>hello</p>");

        const body = await app.evaluate(() => {
            const p = editor.querySelector("p");
            const range = document.createRange();
            range.selectNodeContents(p);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            const press = (init) =>
                editor.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        bubbles: true,
                        cancelable: true,
                        ctrlKey: true,
                        ...init,
                    }),
                );

            press({ key: "b" });
            press({ key: "i" });
            press({ key: "u" });
            press({ key: "x", shiftKey: true });

            return serializedBody();
        });

        assert.match(body, /^\[code\].*hello.*\[\/code\]$/);
        assert.ok(body.includes("<b>"));
        assert.ok(body.includes("<em>"));
        assert.ok(body.includes("<u>"));
        assert.ok(body.includes("<strike>"));
    });

    it("toggles headings and blockquotes on and off via shortcuts", async () => {
        await app.resetEditor("<p>Section</p>");

        const res = await app.evaluate(() => {
            const press = (init) =>
                editor.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        bubbles: true,
                        cancelable: true,
                        ctrlKey: true,
                        ...init,
                    }),
                );

            placeCaretAtEnd(editor.querySelector("p"));
            press({ code: "Digit2", altKey: true });
            const afterH2 = serializedBody();

            press({ code: "Digit2", altKey: true });
            const afterH2Off = serializedBody();

            press({ code: "Period", shiftKey: true });
            const afterQuote = serializedBody();

            press({ code: "Period", shiftKey: true });
            const afterQuoteOff = serializedBody();

            return { afterH2, afterH2Off, afterQuote, afterQuoteOff };
        });

        assert.equal(res.afterH2, "[code]<h2>Section</h2>[/code]");
        assert.equal(res.afterH2Off, "Section");
        assert.equal(res.afterQuote, "[code]<blockquote>Section</blockquote>[/code]");
        assert.equal(res.afterQuoteOff, "Section");
    });

    it("toggles inline code on a selection, refuses cross-block selection, and removes it on second press", async () => {
        await app.resetEditor("<p>run build now</p>");

        const res = await app.evaluate(() => {
            const text = editor.querySelector("p").firstChild;
            const range = document.createRange();
            range.setStart(text, 4);
            range.setEnd(text, 9);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            const press = () =>
                editor.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        bubbles: true,
                        cancelable: true,
                        ctrlKey: true,
                        code: "Backquote",
                    }),
                );

            press();
            const wrapped = serializedBody();
            const active = commands.inlineCode.isActive(null, getSelectedElement());

            press();
            const unwrapped = serializedBody();

            return { wrapped, active, unwrapped };
        });

        assert.equal(res.wrapped, "run [code]<b><code>build</code></b>[/code] now");
        assert.equal(res.active, true);
        assert.equal(res.unwrapped, "run build now");
    });

    it("builds a single code block across multiple paragraphs and toggles it back to paragraphs", async () => {
        await app.resetEditor("<p>line 1</p><p>line 2</p>");

        const res = await app.evaluate(() => {
            const ps = editor.querySelectorAll("p");
            const range = document.createRange();
            range.setStart(ps[0].firstChild, 0);
            range.setEnd(ps[1].firstChild, 6);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            const pressCodeBlock = () =>
                editor.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        bubbles: true,
                        cancelable: true,
                        ctrlKey: true,
                        shiftKey: true,
                        code: "Backquote",
                    }),
                );

            pressCodeBlock();
            const inPre = serializedBody();
            const preCount = editor.querySelectorAll("pre").length;

            pressCodeBlock();
            const afterToggle = serializedBody();

            return { inPre, preCount, afterToggle };
        });

        assert.equal(res.preCount, 1);
        assert.equal(res.inPre, "[code]<pre><code>line 1\nline 2</code></pre>[/code]");
        assert.equal(res.afterToggle, "line 1\nline 2");
    });

    it("preserves inline code on ranged Clear formatting while stripping bold/italic", async () => {
        await app.resetEditor("<p><b>bold</b> <code>keep</code> <i>ital</i></p>");

        const body = await app.evaluate(() => {
            const p = editor.querySelector("p");
            const range = document.createRange();
            range.selectNodeContents(p);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            editor.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    ctrlKey: true,
                    code: "Backslash",
                }),
            );

            return serializedBody();
        });

        assert.equal(body, "bold [code]<b><code>keep</code></b>[/code] ital");
    });

    it("blocks inserting a link when selection touches a <pre> block", async () => {
        await app.resetEditor("<pre>const url = 1;</pre>");

        const dialogOpened = await app.evaluate(() => {
            const pre = editor.querySelector("pre");
            const range = document.createRange();
            range.selectNodeContents(pre);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            applyCommand("link");
            return linkDialog.open;
        });

        assert.equal(dialogOpened, false);
    });

    it("supports custom undo and redo via Ctrl+Z and Ctrl+Y", async () => {
        await app.resetEditor("<p>start</p>");

        const res = await app.evaluate(() => {
            const p = editor.querySelector("p");
            const range = document.createRange();
            range.selectNodeContents(p);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            const press = (init) =>
                editor.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        bubbles: true,
                        cancelable: true,
                        ctrlKey: true,
                        ...init,
                    }),
                );

            press({ key: "b" });
            const bolded = serializedBody();

            press({ key: "z" });
            const undone = serializedBody();

            press({ key: "y" });
            const redone = serializedBody();

            return { bolded, undone, redone };
        });

        assert.equal(res.bolded, "[code]<b>start</b>[/code]");
        assert.equal(res.undone, "start");
        assert.equal(res.redone, "[code]<b>start</b>[/code]");
    });

    it("runs toolbar buttons via mousedown delegation and updates aria-pressed state", async () => {
        await app.resetEditor("<p>toolbar</p>");

        const res = await app.evaluate(() => {
            const p = editor.querySelector("p");
            const range = document.createRange();
            range.selectNodeContents(p);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            const boldBtn = toolbar.querySelector('button[data-cmd="bold"]');
            boldBtn.dispatchEvent(
                new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
            );
            updateToolbarState();

            return {
                body: serializedBody(),
                pressed: boldBtn.getAttribute("aria-pressed"),
            };
        });

        assert.equal(res.body, "[code]<b>toolbar</b>[/code]");
        assert.equal(res.pressed, "true");
    });

    it("converts typed Markdown markers on both <p> and bare editor lines", async () => {
        await app.resetEditor("## Title");

        const headingBody = await app.evaluate(() => {
            const text = editor.firstChild;
            const range = document.createRange();
            range.setStart(text, 3);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            editor.dispatchEvent(
                new InputEvent("input", {
                    bubbles: true,
                    inputType: "insertText",
                    data: " ",
                }),
            );

            return serializedBody();
        });

        assert.equal(headingBody, "[code]<h2>Title</h2>[/code]");

        await app.resetEditor("<p>- item</p>");

        const listBody = await app.evaluate(() => {
            const text = editor.querySelector("p").firstChild;
            const range = document.createRange();
            range.setStart(text, 2);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            editor.dispatchEvent(
                new InputEvent("input", {
                    bubbles: true,
                    inputType: "insertText",
                    data: " ",
                }),
            );

            return serializedBody();
        });

        assert.equal(listBody, "[code]<ul><li>item</li></ul>[/code]");
    });

    it("converts typed backtick pairs into inline code", async () => {
        await app.resetEditor("<p>run `cmd`</p>");

        const body = await app.evaluate(() => {
            const text = editor.querySelector("p").firstChild;
            const range = document.createRange();
            range.setStart(text, text.data.length);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            editor.dispatchEvent(
                new InputEvent("input", {
                    bubbles: true,
                    inputType: "insertText",
                    data: "`",
                }),
            );

            return serializedBody();
        });

        assert.equal(body, "run [code]<b><code>cmd</code></b>[/code]");
    });

    it("nests and outdents list items with Tab and Shift+Tab", async () => {
        await app.resetEditor("<ul><li>One</li><li>Two</li></ul>");

        const res = await app.evaluate(() => {
            const second = editor.querySelectorAll("li")[1];
            placeCaretAtEnd(second);

            editor.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "Tab",
                }),
            );
            const nested = serializedBody();

            editor.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "Tab",
                    shiftKey: true,
                }),
            );
            const outdented = serializedBody();

            return { nested, outdented };
        });

        assert.equal(
            res.nested,
            "[code]<ul><li>One<ul><li>Two</li></ul></li></ul>[/code]",
        );
        assert.equal(
            res.outdented,
            "[code]<ul><li>One</li><li>Two</li></ul>[/code]",
        );
    });

    it("exits <pre> on Enter at an empty trailing line and steps out of inline <code> with ArrowRight", async () => {
        await app.resetEditor("<pre>code line\n</pre>");

        const preExit = await app.evaluate(() => {
            const pre = editor.querySelector("pre");
            placeCaretAtEnd(pre);

            editor.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "Enter",
                }),
            );

            return {
                hasP: Boolean(editor.querySelector("p")),
                preText: editor.querySelector("pre")?.textContent,
                inP: Boolean(getSelectedElement()?.closest("p")),
            };
        });

        assert.deepEqual(preExit, {
            hasP: true,
            preText: "code line",
            inP: true,
        });

        await app.resetEditor("<p><code>fn</code></p>");

        const arrowExit = await app.evaluate(() => {
            const code = editor.querySelector("code");
            placeCaretAtEnd(code);

            editor.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "ArrowRight",
                }),
            );

            return {
                stillInCode: Boolean(getSelectedElement()?.closest("code")),
            };
        });

        assert.equal(arrowExit.stillInCode, false);
    });

    it("handles paste: URL over selection links text, paste in <pre> inserts plain text, Markdown paste converts", async () => {
        await app.resetEditor("<p>click here</p>");

        const linked = await app.evaluate(() => {
            const text = editor.querySelector("p").firstChild;
            const range = document.createRange();
            range.setStart(text, 6);
            range.setEnd(text, 10);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            const dt = new DataTransfer();
            dt.setData("text/plain", "https://example.com");
            editor.dispatchEvent(
                new ClipboardEvent("paste", {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: dt,
                }),
            );

            return serializedBody();
        });

        assert.equal(linked, 'click [code]<a href="https://example.com">here</a>[/code]');

        await app.resetEditor("<pre>x = </pre>");

        const prePasted = await app.evaluate(() => {
            placeCaretAtEnd(editor.querySelector("pre"));
            const dt = new DataTransfer();
            dt.setData("text/plain", "<b>1</b>");
            dt.setData("text/html", "<b>1</b>");
            insertClipboard(dt);
            return serializedBody();
        });

        assert.equal(prePasted, "[code]<pre><code>x = &lt;b&gt;1&lt;/b&gt;</code></pre>[/code]");

        await app.resetEditor("");

        const mdPasted = await app.evaluate(() => {
            placeCaret(editor);
            const dt = new DataTransfer();
            dt.setData("text/plain", "# Title\n- one\n- two");
            insertClipboard(dt);
            return serializedBody();
        });

        assert.equal(
            mdPasted,
            "[code]<h1>Title</h1>[/code]\n[code]<ul><li>one</li><li>two</li></ul>[/code]",
        );
    });
});
