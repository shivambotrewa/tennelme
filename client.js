const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const yargs = require('yargs');

// Parse CLI arguments
const argv = yargs
    .option('p', {
        alias: 'port',
        description: 'Local server port',
        type: 'number',
        default: 8000
    })
    .option('api', {
        description: 'API key for authentication',
        type: 'string',
        default: ''
    })
    .option('path', {
        description: 'Desired tunnel path (e.g., myapp)',
        type: 'string',
        default: ''
    })
    .help()
    .alias('help', 'h')
    .argv;

const serverUrl = 'wss://lazy-wolves-raise.loca.lt'; // Replace with your server URL
const apiKey = argv.api;
const requestedPath = argv.path;
const localPort = argv.port;
let ws;
let tunnelPath = '';
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectInterval = 5000;

function connect() {
    ws = new WebSocket(serverUrl);
    ws.on('open', () => {
        console.log('Connected to server');
        reconnectAttempts = 0;
        // Send authentication and path request
        ws.send(JSON.stringify({
            auth: {
                apiKey,
                requestedPath
            }
        }));
    });

    ws.on('pong', () => {
        console.log('Received ping from server');
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.error) {
                console.error('Server error:', msg.error);
                ws.terminate();
                process.exit(1);
            } else if (msg.path) {
                tunnelPath = msg.path;
                console.log(`Tunnel URL: ${msg.url}`);
            } else {
                // Strip the tunnel path from the URL
                const parsedUrl = url.parse(msg.url);
                const pathSegments = parsedUrl.pathname.split('/').filter(segment => segment);
                const tunnelIndex = pathSegments.indexOf(tunnelPath);
                const localPath = tunnelIndex >= 0 
                    ? '/' + pathSegments.slice(tunnelIndex + 1).join('/')
                    : parsedUrl.pathname;

                const options = {
                    hostname: 'localhost',
                    port: localPort,
                    path: localPath || '/',
                    method: msg.method,
                    headers: msg.headers
                };

                const req = http.request(options, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        ws.send(JSON.stringify({
                            response: {
                                status: res.statusCode,
                                body
                            }
                        }));
                    });
                });

                req.on('error', (err) => {
                    ws.send(JSON.stringify({
                        response: {
                            status: 500,
                            body: `Local server error: ${err.message}`
                        }
                    }));
 EDC });
                req.end();
            }
        } catch (err) {
            console.error('Invalid server message:', err);
        }
    });

    ws.on('close', () => {
        console.log('Disconnected from server');
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`Reconnecting in ${reconnectInterval / 1000} seconds... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
            setTimeout(connect, reconnectInterval);
        } else {
            console.error('Max reconnection attempts reached. Exiting.');
            process.exit(1);
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
}

connect();
