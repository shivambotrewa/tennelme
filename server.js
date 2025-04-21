//require('dotenv').config(); // For local development only
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active tunnels: path -> { ws, isAuthorized, apiKey }
const tunnels = new Map();

// Load API keys from environment variable
const validApiKeys = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];

// Generate a random path
function generatePath() {
    return Math.random().toString(36).substring(2, 10); // e.g., 'abcd1234'
}

// Validate API key
function isValidApiKey(apiKey) {
    return apiKey && validApiKeys.includes(apiKey);
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.auth) {
                const { apiKey, requestedPath } = msg.auth;
                let path = requestedPath || generatePath();
                let isAuthorized = isValidApiKey(apiKey);

                const existingTunnel = tunnels.get(path);
                if (existingTunnel) {
                    if (isAuthorized && (!existingTunnel.isAuthorized || apiKey !== existingTunnel.apiKey)) {
                        console.log(`Path /${path} taken over by new authorized client`);
                        existingTunnel.ws.terminate();
                        tunnels.delete(path);
                    } else if (!isAuthorized) {
                        path = generatePath();
                        console.log(`Unauthorized client assigned random path: /${path}`);
                    } else {
                        ws.send(JSON.stringify({ error: `Path /${path} is already in use` }));
                        ws.terminate();
                        return;
                    }
                }

                tunnels.set(path, { ws, isAuthorized, apiKey });
                ws.send(JSON.stringify({ path, url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/${path}` }));
                console.log(`New tunnel: /${path} (Authorized: ${isAuthorized})`);
            } else if (msg.response) {
                const path = [...tunnels.entries()].find(([_, t]) => t.ws === ws)?.[0];
                if (path) {
                    tunnels.get(path).httpResponse = msg.response;
                }
            }
        } catch (err) {
            console.error(`Invalid message: ${err.message}`);
            ws.terminate();
        }
    });

    ws.on('close', () => {
        const path = [...tunnels.entries()].find(([_, t]) => t.ws === ws)?.[0];
        if (path) {
            tunnels.delete(path);
            console.log(`Tunnel closed: /${path}`);
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error: ${err.message}`);
    });
});

// Periodic ping to keep connections alive
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            console.log('Terminating inactive client');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 10000); // Ping every 10 seconds

// Clean up stale tunnels hourly to save memory
setInterval(() => {
    tunnels.forEach((tunnel, path) => {
        if (!tunnel.ws.isAlive) {
            console.log(`Cleaning up stale tunnel: /${path}`);
            tunnels.delete(path);
        }
    });
}, 3600000); // Every hour

// HTTP route to handle incoming requests
app.get('/:path', (req, res) => {
    const { path } = req.params;
    const tunnel = tunnels.get(path);
    if (!tunnel) {
        res.status(404).send('Tunnel not found');
        return;
    }

    tunnel.ws.send(JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query
    }));

    let attempts = 0;
    const checkResponse = setInterval(() => {
        if (tunnel.httpResponse) {
            res.status(tunnel.httpResponse.status).send(tunnel.httpResponse.body);
            tunnel.httpResponse = null;
            clearInterval(checkResponse);
        } else if (attempts++ > 50) {
            res.status(504).send('Tunnel timeout');
            clearInterval(checkResponse);
        }
    }, 100);
});

// Health check for Render
app.get('/', (req, res) => res.send('TennelMe tunneling service running'));

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
