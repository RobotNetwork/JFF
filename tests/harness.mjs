import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
};

function findChromeBinary() {
    const candidates = [
        process.env.CHROME_PATH,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error(
        "No Chrome/Chromium binary found. Set CHROME_PATH to a Chrome or Chromium executable.",
    );
}

function startStaticServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const urlPath = (req.url || "/").split("?")[0];
            const relPath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
            const filePath = path.resolve(rootDir, relPath);

            if (!filePath.startsWith(rootDir + path.sep) && filePath !== rootDir) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end("Not found");
                    return;
                }

                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, {
                    "Content-Type": mimeTypes[ext] || "application/octet-stream",
                });
                res.end(data);
            });
        });

        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function launchChrome(chromePath, userDataDir, url) {
    return new Promise((resolve, reject) => {
        const proc = spawn(
            chromePath,
            [
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--no-default-browser-check",
                "--remote-debugging-port=0",
                `--user-data-dir=${userDataDir}`,
                url,
            ],
            { stdio: ["ignore", "ignore", "pipe"] },
        );

        let stderr = "";
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            proc.kill("SIGKILL");
            reject(new Error(`Timed out waiting for Chrome DevTools endpoint.\n${stderr}`));
        }, 15000);

        proc.once("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });

        proc.once("exit", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`Chrome exited early (code ${code}).\n${stderr}`));
        });

        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            const match = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/\S+)/);

            if (match && !settled) {
                settled = true;
                clearTimeout(timer);
                resolve({ proc, debugPort: Number(match[2]) });
            }
        });
    });
}

async function connectToPageTarget(debugPort) {
    const deadline = Date.now() + 10000;
    let target = null;

    while (Date.now() < deadline) {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        const targets = await res.json();
        target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);

        if (target) break;
        await new Promise((r) => setTimeout(r, 50));
    }

    if (!target) {
        throw new Error("Could not find a Chrome page target to attach to.");
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", reject, { once: true });
    });

    ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);

        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);

            if (msg.error) {
                reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
            } else {
                resolve(msg.result);
            }
            return;
        }

        if (msg.method && listeners.has(msg.method)) {
            for (const handler of listeners.get(msg.method)) {
                handler(msg.params);
            }
        }
    });

    function send(method, params = {}) {
        const id = nextId++;

        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    function on(method, handler) {
        if (!listeners.has(method)) listeners.set(method, []);
        listeners.get(method).push(handler);
    }

    return { ws, send, on };
}

export async function startApp() {
    const chromePath = findChromeBinary();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jff-test-"));
    const { server, baseUrl } = await startStaticServer();
    const { proc, debugPort } = await launchChrome(chromePath, userDataDir, `${baseUrl}/index.html`);
    const cdp = await connectToPageTarget(debugPort);
    const pageErrors = [];

    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
        const detail =
            exceptionDetails.exception?.description ||
            exceptionDetails.text ||
            "Unknown page exception";
        pageErrors.push(detail);
    });

    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    async function evaluate(fn, ...args) {
        const serializedArgs = args.map((arg) => JSON.stringify(arg)).join(", ");
        const expression = `(${fn.toString()})(${serializedArgs})`;
        const result = await cdp.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });

        if (result.exceptionDetails) {
            const desc =
                result.exceptionDetails.exception?.description ||
                result.exceptionDetails.text ||
                "Evaluation failed";
            throw new Error(desc);
        }

        return result.result?.value;
    }

    /* Wait for all 24 scripts (including io.js startup) to finish loading. */
    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
        const ready = await evaluate(
            () =>
                document.readyState === "complete" &&
                typeof serializedBody === "function" &&
                typeof checkCommandCoverage === "function",
        );

        if (ready) break;
        await new Promise((r) => setTimeout(r, 50));
    }

    /* Dismiss first-run tutorial dialog and mark it seen. */
    await evaluate(() => {
        if (tutorialDialog && tutorialDialog.open) {
            tutorialDialog.close();
        }
        try {
            localStorage.setItem("tutorial", "1");
        } catch {}
    });

    async function resetEditor(html = "") {
        await evaluate((initialHtml) => {
            for (const dialog of document.querySelectorAll("dialog[open]")) {
                dialog.close();
            }

            clearTimeout(undoTimer);
            undoTimer = null;
            undoStack = [];
            undoIndex = -1;
            lastEditorCaret = null;

            editor.innerHTML = initialHtml;
            editor.focus();
            commitSnapshot();
            render();
            updateToolbarState();
        }, html);
    }

    async function close() {
        try {
            cdp.ws.close();
        } catch {}

        if (proc.exitCode === null) {
            proc.kill("SIGTERM");
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    proc.kill("SIGKILL");
                    resolve();
                }, 3000);
                proc.once("close", () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }

        await new Promise((resolve) => server.close(resolve));
        try {
            fs.rmSync(userDataDir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 50,
            });
        } catch {
            /* Best-effort cleanup if a Chrome helper process is still exiting. */
        }
    }

    return { evaluate, resetEditor, pageErrors, close };
}
