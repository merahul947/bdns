const ProxyServer = require('./proxy');

//const port = 8080;
const server = new ProxyServer(8080, 3000);
server.start();
