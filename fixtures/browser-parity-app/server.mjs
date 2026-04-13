import http from "node:http";
import { URLSearchParams } from "node:url";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

function html(title, body, scripts = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: Georgia, serif; margin: 0; padding: 2rem; background: #f5f1e8; color: #1e2d27; }
    nav { display: flex; gap: 1rem; margin-bottom: 1rem; }
    main { background: white; border-radius: 16px; padding: 1.5rem; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
    .card { border: 1px solid #d5cabd; border-radius: 12px; padding: 1rem; margin-top: 1rem; }
    .hidden { display: none; }
    label { display: block; margin-top: 0.75rem; }
    button, a.buttonish { margin-top: 1rem; display: inline-block; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/settings">Settings</a>
    <a href="/broken">Broken</a>
    <a href="/secure">Secure</a>
  </nav>
  ${body}
  ${scripts}
</body>
</html>`;
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(cookieHeader.split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const [key, ...value] = part.split("=");
    return [key, value.join("=")];
  }));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const cookies = parseCookies(req.headers.cookie);

  if (method === "POST" && url.pathname === "/login") {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (params.get("username") === "demo" && params.get("password") === "secret") {
        res.writeHead(302, {
          Location: "/secure",
          "Set-Cookie": "speclens_session=1; HttpOnly; Path=/",
        });
        res.end();
        return;
      }
      send(res, 401, html("Login failed", `
        <main>
          <h1>Login failed</h1>
          <p>Invalid credentials.</p>
          <a href="/login">Try again</a>
        </main>
      `));
    });
    return;
  }

  if (url.pathname === "/login") {
    send(res, 200, html("Login", `
      <main>
        <h1>Login</h1>
        <form method="post" action="/login">
          <label>Username <input name="username" type="text" autocomplete="username"></label>
          <label>Password <input name="password" type="password" autocomplete="current-password"></label>
          <button type="submit">Sign in</button>
        </form>
      </main>
    `));
    return;
  }

  if (url.pathname === "/secure") {
    if (cookies.speclens_session !== "1") {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }
    send(res, 200, html("Secure workspace", `
      <main>
        <h1>Secure workspace</h1>
        <p>Protected route reached.</p>
        <button id="secure-toggle">Reveal audit trail</button>
        <div id="secure-panel" class="card hidden">Audit trail unlocked.</div>
      </main>
    `, `
      <script>
        document.getElementById("secure-toggle")?.addEventListener("click", () => {
          document.getElementById("secure-panel")?.classList.toggle("hidden");
        });
      </script>
    `));
    return;
  }

  if (url.pathname === "/settings") {
    send(res, 200, html("Settings", `
      <main>
        <h1>Settings</h1>
        <label>Project name <input type="text" value="SpecLens portal"></label>
        <label>Preset
          <select>
            <option>generic</option>
            <option>tagtwo</option>
          </select>
        </label>
        <button id="save-button">Save settings</button>
        <div id="save-result" class="card hidden">Settings staged in UI only.</div>
      </main>
    `, `
      <script>
        document.getElementById("save-button")?.addEventListener("click", () => {
          document.getElementById("save-result")?.classList.remove("hidden");
        });
      </script>
    `));
    return;
  }

  if (url.pathname === "/broken") {
    send(res, 200, html("Broken widget", `
      <main>
        <h1>Broken widget</h1>
        <p>This page emits a console error on load.</p>
      </main>
    `, `
      <script>
        console.error("SpecLens demo console error");
      </script>
    `));
    return;
  }

  if (url.pathname === "/") {
    send(res, 200, html("SpecLens demo", `
      <main>
        <h1>SpecLens demo</h1>
        <p>Browser parity fixture for hosted sandbox execution.</p>
        <button id="toggle-button">Open launch checklist</button>
        <a class="buttonish" href="/settings">Go to settings</a>
        <div id="launch-panel" class="card hidden">
          <p>Checklist visible.</p>
        </div>
      </main>
    `, `
      <script>
        document.getElementById("toggle-button")?.addEventListener("click", () => {
          document.getElementById("launch-panel")?.classList.toggle("hidden");
        });
      </script>
    `));
    return;
  }

  send(res, 404, html("Not found", `
    <main>
      <h1>Not found</h1>
      <p>Unknown route.</p>
    </main>
  `));
});

server.listen(port, host, () => {
  console.log(`browser-parity-app listening on http://${host}:${port}`);
});
