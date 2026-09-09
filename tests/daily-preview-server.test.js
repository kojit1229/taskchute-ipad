// Preview static assets: read-only HTTP, path confinement and shared UI modules.
// Isolated synthetic files only; child readiness/exit events replace fixed startup waits.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { randomPort } = require("./helpers");

const script = path.resolve(__dirname, "../scripts/daily-preview-server.py");
const python = ["python3", "python"].find(command =>
  spawnSync(command, ["--version"], { windowsHide: true, timeout: 5000 }).status === 0);
assert.ok(python, "Python is required: neither python3 nor python could be started");
const PORT = randomPort();
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }

function request(port, url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: url, method }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error(`request timeout: ${method} ${url}`)));
    req.end(method === "POST" ? "synthetic write" : undefined);
  });
}

async function startServer(product, mock, port = PORT) {
  const child = spawn(python, ["-B", "-u", script, "--bind", "127.0.0.1", "--port", String(port),
    "--product-root", product, "--mock-root", mock], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`preview readiness timeout: ${stderr}`)), 10000);
      const finish = fn => value => { clearTimeout(timer); fn(value); };
      child.once("error", finish(reject)); // ENOENT is a failure, never a skipped test.
      child.once("exit", finish(() => reject(new Error(`preview exited before readiness: ${stderr}`))));
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.stdout.on("data", chunk => {
        stdout += chunk;
        if (stdout.includes("\n")) {
          try {
            const ready = JSON.parse(stdout.split("\n")[0]);
            assert.equal(ready.ready, true);
            assert.equal(ready.port, port);
            finish(resolve)();
          } catch (error) { finish(reject)(error); }
        }
      });
    });
    return { stop, closed, port };
  } catch (error) {
    await stop();
    throw error;
  }
}

(async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "tcj-preview-test-"));
  const product = path.join(fixture, "product"), mock = path.join(fixture, "m04");
  const sharedJS = "export const label = 'synthetic shared row';\n";
  const sharedCSS = ".row { height: 44px; }\n";
  const moduleURL = "/product/src/ui/daily-parts/plan-row.js";
  const cssURL = "/product/src/ui/daily-parts/daily-parts.css";
  const html = `<link rel="stylesheet" href="${cssURL}"><script type="module" src="${moduleURL}"></script>`;
  function write(relative, content = "synthetic forbidden file") {
    const file = path.join(fixture, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  let server;
  try {
    const assets = {
      "product/index.html": html, "product/concept.html": "synthetic concept",
      "product/app.js": "export {};", "product/styles.css": sharedCSS,
      "product/marked.min.js": "// synthetic markdown library",
      "product/sw.js": "// synthetic service worker", "product/manifest.webmanifest": "{}",
      "product/src/ui/daily-parts/plan-row.js": sharedJS,
      "product/src/ui/daily-parts/daily-parts.css": sharedCSS,
      "product/assets/icon.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "m04/preview.html": html, "m04/preview.js": `import '${moduleURL}';`,
      "m04/preview.css": `@import '${cssURL}';`,
      "m04/shared/row.js": sharedJS, "m04/assets/icon.svg": "<svg/>",
    };
    for (const [name, body] of Object.entries(assets)) write(name, body);
    const forbidden = [".git/config", "tools/admin.js", "scripts/build.js", "tests/test.js", "docs/help.html",
      "personal-data/secret.js", "auth/token.js", "credentials/token.js", "app-state.json",
      "src/.private.js", "src/tools/admin.js", "src/auth/token.js", "src/model.json",
      "assets/personal-data/photo.svg", "assets/.hidden.svg", "unlisted.js", "README.md", "dump.json"];
    for (const route of ["product", "m04"]) for (const name of forbidden) write(`${route}/${name}`);
    write("outside/escape.js");
    write("outside/photo.svg");
    // Directory junctions need no Windows symlink privilege; still test real filesystem escape.
    for (const [from, to] of [["product/src/outside", "outside"], ["m04/shared/outside", "outside"],
      ["product/src/inside", "product/auth"]]) {
      fs.symlinkSync(path.join(fixture, to), path.join(fixture, from), process.platform === "win32" ? "junction" : "dir");
    }
    server = await startServer(product, mock);
    for (const [name, body] of Object.entries(assets)) {
      const url = "/" + name.replace(/^m04\//, "mock/");
      const get = await request(PORT, url + "?preview=1");
      const head = await request(PORT, url, "HEAD");
      check(`GET/HEAD display asset ${url}`, () => {
        assert.equal(get.status, 200); assert.equal(get.body.toString(), body);
        assert.equal(head.status, 200); assert.equal(head.body.length, 0);
        assert.equal(head.headers["content-length"], String(Buffer.byteLength(body)));
        assert.equal(head.headers["content-type"], get.headers["content-type"]);
        assert.equal(get.headers["cache-control"], "no-store");
        assert.equal(get.headers["x-content-type-options"], "nosniff");
        if (url.endsWith(".js")) assert.match(get.headers["content-type"], /^text\/javascript/);
        if (url.endsWith(".css")) assert.match(get.headers["content-type"], /^text\/css/);
      });
    }
    const productPage = (await request(PORT, "/product/index.html")).body.toString();
    const mockPage = (await request(PORT, "/mock/preview.html")).body.toString();
    write("product/src/ui/daily-parts/plan-row.js", "export const label = 'changed once';\n");
    for (const page of [productPage, mockPage]) {
      const target = page.match(/src="([^"]+)"/)[1];
      const response = await request(PORT, target);
      check("both entries refer to the same live shared module", () => {
        assert.equal(target, moduleURL); assert.match(response.body.toString(), /changed once/);
      });
    }
    // Check the real SW asset names using synthetic content, without launching the product app.
    const sw = fs.readFileSync(path.join(__dirname, "../sw.js"), "utf8");
    const shell = sw.match(/const APP_SHELL\s*=\s*\[([\s\S]*?)\]/)[1];
    const shellAssets = [...shell.matchAll(/["']([^"']+)["']/g)].map(match => match[1]);
    assert.ok(shellAssets.length > 0);
    for (const entry of shellAssets) {
      const name = entry === "./" ? "index.html" : entry.replace(/^\.\//, "");
      if (!fs.existsSync(path.join(product, name))) write(`product/${name}`, "// synthetic SW shell asset");
      const result = await request(PORT, "/product/" + entry.replace(/^\.\//, ""));
      check(`product SW shell asset is allowed: ${entry}`, () => assert.equal(result.status, 200));
    }
    const denied = ["/", "/product", "/mock/", "/product/src/", "/unknown/index.html",
      "/mock/index.html", "/product/../outside/escape.js", "/product/%2e%2e/outside/escape.js",
      "/product/src/%2e%2e/app.js", "/mock/%2E%2E/product/app.js",
      "/product/%252e%252e/app.js", "/product/src%5coutside/escape.js",
      "/product/src\\outside/escape.js", "/product/app.js::$DATA", "/product/app.js%00",
      "/product/%FF.js", "/product/%broken.js", "/product//app.js", "/product/app.js.",
      "/product/app.js%20", "/product/src/outside/escape.js", "/mock/shared/outside/escape.js",
      "/product/src/inside/token.js", "/mock/tools/preview-server.py", "/tools/preview-server.py",
      ...["product", "mock"].flatMap(route => forbidden.map(name => `/${route}/${name}`))];
    for (const url of denied) {
      for (const method of ["GET", "HEAD"]) {
        const result = await request(PORT, url, method);
        check(`${method} rejects ${url}`, () => {
          assert.equal(result.status, 404);
          if (method === "HEAD") assert.equal(result.body.length, 0);
        });
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "PROPFIND"]) {
      for (const url of ["/product/index.html", "/mock/preview.html", "/product/app-state.json"]) {
        const result = await request(PORT, url, method);
        check(`${method} is rejected on ${url}`, () => {
          assert.equal(result.status, 405); assert.equal(result.headers.allow, "GET, HEAD");
          assert.equal(result.body.length, 0);
        });
      }
    }
    check("write requests preserve fixture files", () => {
      assert.equal(fs.readFileSync(path.join(product, "index.html"), "utf8"), html);
      assert.equal(fs.readFileSync(path.join(product, "app-state.json"), "utf8"), "synthetic forbidden file");
    });
    fs.unlinkSync(path.join(mock, "preview.js"));
    const removed = await request(PORT, "/mock/preview.js");
    check("asset removal fails closed", () => assert.equal(removed.status, 404));
    await assert.rejects(async () => {
      const unexpected = await startServer(product, mock, PORT);
      await unexpected.stop(); // Clean up even if a port-conflict regression returns success.
    }, /exited before readiness/);
    check("occupied port startup fails without orphaning child", () => assert.ok(true));
    const stillAlive = await request(PORT, "/product/index.html");
    check("first child remains healthy after injected bind failure", () => assert.equal(stillAlive.status, 200));
  } finally {
    try {
      if (server) {
        await server.stop();
        await assert.rejects(request(PORT, "/product/index.html"));
        check("child stopped and listening socket released", () => assert.ok(true));
      }
    } finally {
      // Delete only this freshly created fixture, after verifying its resolved temp parent.
      assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(fixture).startsWith("tcj-preview-test-"));
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
  console.log(`daily-preview-server: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
