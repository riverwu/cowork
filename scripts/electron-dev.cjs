const { spawn } = require("node:child_process");
const net = require("node:net");

const vite = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1"], {
  stdio: "inherit",
  env: { ...process.env, COWORK_ELECTRON_DEV: "1" },
});

let electron = null;

function waitForPort(port, host = "127.0.0.1", timeoutMs = 30_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const socket = net.createConnection({ port, host });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(check, 200);
      });
    };
    check();
  });
}

waitForPort(1420)
  .then(() => {
    electron = spawn("pnpm", ["exec", "electron", "."], {
      stdio: "inherit",
      env: {
        ...process.env,
        COWORK_ELECTRON_DEV_URL: "http://127.0.0.1:1420",
      },
    });
    electron.on("exit", (code) => {
      vite.kill();
      process.exit(code ?? 0);
    });
  })
  .catch((error) => {
    console.error(error);
    vite.kill();
    process.exit(1);
  });

process.on("SIGINT", () => {
  electron?.kill();
  vite.kill();
  process.exit(130);
});
