import http from "http";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { resolve } from "path";

const app = express();
/** Same default as Vite dev server: HTTPS reverse-proxy entry (API + WebSocket on /api). */
const port = Number(process.env.PORT) || 8301;
const backendHost = process.env.BACKEND_HOST || "http://127.0.0.1:8300";
const fileStorageHost = process.env.FILE_STORAGE_HOST || "http://localhost:8302";
const filePath = process.env.STATIC_FILE_PATH || ".";

// API + WebSocket (e.g. /api/chat/ws) — must attach upgrade on the HTTP server, not app.listen().
const apiProxy = createProxyMiddleware({
    target: backendHost,
    changeOrigin: true,
    pathRewrite: { "^/api": "" },
    ws: true,
});

app.use("/api", apiProxy);

app.use(
    "/uploads/files",
    createProxyMiddleware({
        target: fileStorageHost,
        changeOrigin: true,
    }),
);

app.use(express.static(resolve(filePath)));

app.use((_req, res) => {
    res.sendFile(resolve(filePath, "index.html"));
});

const server = http.createServer(app);

type ProxyWithUpgrade = ReturnType<typeof createProxyMiddleware> & {
    upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

server.on("upgrade", (req, socket, head) => {
    const path = req.url?.split("?")[0] ?? "";
    const upgrade = (apiProxy as ProxyWithUpgrade).upgrade;
    if (path.startsWith("/api") && upgrade) {
        upgrade.call(apiProxy, req, socket, head);
    } else {
        socket.destroy();
    }
});

server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port} (API+WS → ${backendHost})`);
});
