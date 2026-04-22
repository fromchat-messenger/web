import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { resolve } from 'path';

const app = express();
const port = process.env.PORT || 3000;
const lan = process.env.LAN_IP;
const backendHost =
    process.env.BACKEND_HOST || (lan ? `http://${lan}:8300` : "http://localhost:8300");
const fileStorageHost =
    process.env.FILE_STORAGE_HOST || (lan ? `http://${lan}:8302` : "http://localhost:8302");
const filePath = process.env.STATIC_FILE_PATH || ".";

// API proxy middleware
app.use('/api', createProxyMiddleware({
    target: backendHost,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    ws: true
}));

// File serving proxy middleware
app.use('/uploads/files', createProxyMiddleware({
    target: fileStorageHost,
    changeOrigin: true
}));

// Serve static files
app.use(express.static(resolve(filePath)));

// SPA routing - catch all handler for client-side routing
app.use((_req, res) => {
    res.sendFile(resolve(filePath, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server launched on http://localhost:${port}`);
});
