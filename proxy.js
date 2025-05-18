const net = require('net');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const licenseRoutes = require('./lic');
const cors = require('cors');
const dbOperations = require('./database');

class ProxyServer {
    constructor(proxyPort, apiPort) {
        this.proxyPort = proxyPort;
        this.apiPort = apiPort;
        this.server = net.createServer();
        this.isRunning = false;
        this.licenseCache = new Map();
    }

    start() {
        this.isRunning = true;
        this.server.listen(this.proxyPort, '0.0.0.0', () => {
            console.log(`Proxy server running on port ${this.proxyPort}`);
        });

        this.server.on('connection', (client) => {
            const clientAddress = client.remoteAddress;
            const clientPort = client.remotePort;
            console.log(`[${new Date()}] New connection from ${clientAddress}:${clientPort}`);
            this.handleClient(client);
        });

        const app = express();
        app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));
        app.use(express.json());
        app.use('/api', licenseRoutes);

        app.listen(this.apiPort, () => {
            console.log(`API server running on port ${this.apiPort}`);
        });
    }

    async handleClient(client) {
        const timeout = 30000; // 30 seconds
        try {
            client.setTimeout(timeout);
            const dataPromise = new Promise((resolve) => client.once('data', resolve));
            const timeoutPromise = new Promise((_, reject) => client.once('timeout', () => reject(new Error('Client connection timed out'))));
            const data = await Promise.race([dataPromise, timeoutPromise]);
            const request = data.toString('ascii');

            await this.writeWithRetry(client, async (stream) => {
                if (request.includes('GET / HTTP/1.1') || request.includes('GET /index.html')) {
                    await this.handleHomePage(stream);
                } else if (request.includes('gws.bdns.in')) {
                    await this.handleGWSRequest(request, stream);
                } else if (request.includes('uws.bdns.in')) {
                    await this.handleUWSRequest(stream, request);
                } else if (request.includes('bws.bdns.in')) {
                    const scHeader = this.getHeaderValue(request, 'SC');
                    await this.handleBWSRequest(stream, request, scHeader);
                }
            });
        } catch (error) {
            if (error instanceof Error && (error.code === 'ECONNRESET' || error.code === 'EPIPE')) {
                // Handle connection reset or pipe errors silently
            } else {
                console.error(`[${new Date()}] Error: ${error.message}`);
            }
        } finally {
            client.destroy();
        }
    }

    async writeWithRetry(stream, writeAction) {
        const maxRetries = 3;
        const delayMs = 1000;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await writeAction(stream);
                return;
            } catch (error) {
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
                }
            }
        }
    }

    async handleHomePage(clientStream) {
        const body = 'Hello';
        const response = `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`;
        await clientStream.write(Buffer.from(response, 'utf8'));
    }
    
    async handleGWSRequest(request, clientStream) {
        try {
            const [headers] = request.split('\r\n\r\n');
            const headerLines = headers.split('\r\n');
            let appSerialNo = null, machineIDNew = null, blsExpiry = null;
            for (const line of headerLines) {
                if (line.startsWith('AppSerialNo:')) appSerialNo = line.split(':')[1].trim();
                if (line.startsWith('MachineIDNew:')) machineIDNew = line.split(':')[1].trim();
                if (line.startsWith('AppValidityDate:') || line.startsWith('BLSExpiry:')) blsExpiry = line.split(':')[1].trim();
            }
            const clientIP = clientStream.remoteAddress;

            // Check if the request is for /getgstconfig
            const isGetGstConfig = request.includes('/getgstconfig');

            // License validation bypassed
            /*
            if (!isGetGstConfig) {
                const licenseValidation = await this.validateLicense(request);
                if (licenseValidation === null || !licenseValidation.valid) {
                    const responseBody = {
                        "status": "failure",
                        "gspCode": "0",
                        "errorCode": "5",
                        "errorMessage": licenseValidation ? licenseValidation.message : "Missing MachineIDNew or SerialNo",
                        "data": {}
                    };
                    const response = `HTTP/1.1 200 OK\r\nCache-Control: private\r\nContent-Type: application/json; charset=utf-8\r\nServer: Microsoft-IIS/10.0\r\nX-AspNet-Version: 4.0.30319\r\nX-Powered-By: ASP.NET\r\nDate: ${new Date().toUTCString()}\r\nContent-Length: ${JSON.stringify(responseBody).length}\r\n\r\n${JSON.stringify(responseBody)}`;
                    clientStream.write(Buffer.from(response, 'utf8'));
                    if (licenseValidation !== null) this.cacheLicenseStatus(clientIP, licenseValidation.valid);
                    return;
                }
                this.cacheLicenseStatus(clientIP, true);
            }
            */

            const modifiedRequest = this.modifyGWSRequest(request);
            this.logToFile('Modified Request', modifiedRequest);
            let response = await this.forwardRequest('gws.bdns.in', 80, modifiedRequest);
            response = this.modifyGWSResponse(response);
            this.logToFile('Response from Server', response.toString('utf-8'));
            clientStream.write(response);
            console.log(`[${new Date()}] GWS request handled successfully`);
        } catch (err) {
            console.error(`[${new Date()}] Error handling GWS request: ${err.message}`);
            await this.sendErrorResponse(clientStream, 502, 'Bad Gateway');
        }
    }

    modifyGWSRequest(request) {
        const [headers, body = ''] = request.split('\r\n\r\n');
        const headersToRemove = ['IPAddress:', 'HDDNoOld:', 'HDDNoNew:', 'MachineIDOld:',  'IPInfo:', 'AppCompID:', 'AppVersion:'];

        //'MachineIDNew:',
        // Check if the request is for searchgstin or searchhsn
        const isGstinOrHsnRequest = request.includes('/searchgstin') || request.includes('/searchhsnv2');

        const modifiedHeaders = headers
            .split('\r\n')
            .map(line => {
                if (line.startsWith('AppSerialNo:')) {
                    // Use 'DEMO' for searchgstin or searchhsn requests, otherwise use '19080625'
                    return isGstinOrHsnRequest ? 'AppSerialNo: DEMO' : 'AppSerialNo: 75655029';
                }
                return line;
            })
            .map(line => (line.startsWith('AppValidityDate:') ? 'AppValidityDate: 13 Dec 2025' : line))
            .map(line => (line.startsWith('AppModel:') ? 'AppModel: EM' : line))
            .map(line => (line.startsWith('MachineIDNew:') ? 'MachineIDNew: 4A77258450E4481F10FAD78F53FED481' : line))
            .filter(line => !headersToRemove.some(header => line.startsWith(header)));

        return `${modifiedHeaders.join('\r\n')}\r\n\r\n${body}`;
    }

    modifyGWSResponse(response) {
        try {
            const responseString = response.toString('utf-8');
            const bodyStartIndex = responseString.indexOf('\r\n\r\n') + 4;
            const headers = responseString.slice(0, bodyStartIndex);
            const body = responseString.slice(bodyStartIndex);
            const responseObject = JSON.parse(body);
            if (responseObject.errorMessage?.includes("with our Record")) {
                responseObject.errorMessage = "You can not use this feature with your Busy License.";
            }
            return Buffer.from(headers + JSON.stringify(responseObject), 'utf-8');
        } catch {
            return response;
        }
    }

    forwardRequest(host, port, request) {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            const chunks = [];
            client.connect(port, host, () => client.write(request));
            client.on('data', (chunk) => {
                chunks.push(chunk);
                if (this.isResponseComplete(Buffer.concat(chunks))) client.end();
            });
            client.on('end', () => resolve(Buffer.concat(chunks)));
            client.on('error', reject);
        });
    }

    sendErrorResponse(client, statusCode, message) {
        const response = `HTTP/1.1 ${statusCode} ${message}\r\nContent-Length: ${message.length}\r\nConnection: close\r\n\r\n${message}`;
        client.write(Buffer.from(response, 'utf8'));
    }

    isResponseComplete(response) {
        const responseStr = response.toString('ascii');
        const headerEnd = responseStr.indexOf('\r\n\r\n');
        if (headerEnd === -1) return false;
        const contentLengthMatch = responseStr.match(/Content-Length:\s*(\d+)/i);
        if (contentLengthMatch) {
            const contentLength = parseInt(contentLengthMatch[1]);
            const bodyLength = response.length - (headerEnd + 4);
            return bodyLength >= contentLength;
        }
        return responseStr.endsWith('0\r\n\r\n');
    }

    getHeaderValue(request, headerName) {
        const lines = request.split('\n');
        for (const line of lines) {
            if (line.toLowerCase().startsWith(`${headerName.toLowerCase()}: `)) {
                return line.substring(headerName.length + 2).trim();
            }
        }
        return null;
    }

    cacheLicenseStatus(clientIP, isValid) {
        this.licenseCache.set(clientIP, { isValid, timestamp: Date.now() });
        setTimeout(() => this.licenseCache.delete(clientIP), 15 * 60 * 1000); // 15 minutes
    }

    async validateLicense(request) {
        const machineIDNew = this.getHeaderValue(request, 'MachineIDNew');
        const serialNo = this.getHeaderValue(request, 'SerialNo');
        if (machineIDNew) {
            return dbOperations.checkLicenseByMachineId(machineIDNew);
        } else if (serialNo) {
            return dbOperations.checkLicenseBySerialNo(serialNo);
        }
        return null;
    }

    async handleBWSRequest(clientStream, request, scHeader) {
        if (!scHeader) {
            const response = `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nF`;
            await clientStream.write(Buffer.from(response, 'ascii'));
            return;
        }

        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const serverDate = `${day}-${month}-${year}`;
        const dateHeader = now.toUTCString();

        const clientIP = clientStream.remoteAddress;
        // License validation bypassed
        /*
        const licenseValidation = await this.validateLicense(request);
        let body;
        if (licenseValidation !== null) {
            body = licenseValidation.valid ? 'T' : 'F';
            this.cacheLicenseStatus(clientIP, licenseValidation.valid);
        } else {
            const cached = this.licenseCache.get(clientIP);
            body = cached ? (cached.isValid ? 'T' : 'F') : 'T'; // Default to 'T' if no cache
        }
        */
        const body = 'T'; // Assume license is valid

        const bwsResponseTemplates = {
            '15': `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nT`,
            '1001': `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\n${body}`,
            '152': `HTTP/1.1 200 OK\r\nServerDate: ${serverDate}\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\n${body}`,
            '28': `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\n${body}`
        };

        const response = bwsResponseTemplates[scHeader] || `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nF`;
        await clientStream.write(Buffer.from(response, 'ascii'));
    }

    async handleUWSRequest(clientStream, request) {
        const scHeader = this.getHeaderValue(request, 'SC');
        if (!scHeader) {
            const response = `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nF`;
            await clientStream.write(Buffer.from(response, 'ascii'));
            return;
        }

        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const serverDate = `${day}-${month}-${year}`;
        const dateHeader = now.toUTCString();

        const clientIP = clientStream.remoteAddress;
        // License validation bypassed
        /*
        const licenseValidation = await this.validateLicense(request);
        let body;
        if (licenseValidation !== null) {
            body = licenseValidation.valid ? 'T' : 'F';
            this.cacheLicenseStatus(clientIP, licenseValidation.valid);
        } else {
            const cached = this.licenseCache.get(clientIP);
            body = cached ? (cached.isValid ? 'T' : 'F') : 'T'; // Default to 'T' if no cache
        }
        */
        const body = 'T'; // Assume license is valid

        const uwsResponseTemplates = {
            '233': `HTTP/1.1 200 OK\r\nCache-Control: private\r\nContent-Type: application/json; charset=utf-8\r\nServer: Microsoft-IIS/10.0\r\nMinRelVer: 0\r\nX-AspNet-Version: 4.0.30319\r\nX-Powered-By: ASP.NET\r\nDate: ${dateHeader}\r\nContent-Length: 1\r\n\r\n${body}`,
            '111': `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\n${body}`,
            '52': `HTTP/1.1 200 OK\r\nCache-Control: private\r\nContent-Type: application/json; charset=utf-8\r\nServer: Microsoft-IIS/10.0\r\nServerDate: ${serverDate}\r\nX-AspNet-Version: 4.0.30319\r\nX-Powered-By: ASP.NET\r\nDate: ${dateHeader}\r\nContent-Length: 1\r\n\r\n${body}`,
            '32': `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\n${body}`,
            '75': `HTTP/1.1 200 OK\r\nServerDate: ${serverDate}\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\n${body}`,
            '20': `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nDate: ${dateHeader}\r\nServer: Microsoft-IIS/10.0\r\nCache-Control: private\r\nDescription: Verified!\r\nLastDevice: 1\r\nValidityDate: 1/1/1900\r\nValidityDateUniversal: 1 Jan 1900\r\nNoOfDays: 0\r\nX-AspNet-Version: 4.0.30319\r\nX-Powered-By: ASP.NET\r\nContent-Length: 1\r\n\r\nT`
        };

        const response = uwsResponseTemplates[scHeader] || `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nF`;
        await clientStream.write(Buffer.from(response, 'ascii'));
    }

    logToFile(label, content) {
        const fs = require('fs');
        const logEntry = `[${new Date().toISOString()}] ${label}:\n${content}\n\n`;
        fs.appendFile('proxy.log', logEntry, (err) => {
            if (err) console.error(`[${new Date()}] Error writing to log file: ${err.message}`);
        });
    }
}

module.exports = ProxyServer;
