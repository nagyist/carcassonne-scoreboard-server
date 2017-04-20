const express = require('express');
const pkginfo = require('pkginfo')(module);

const app = express();
const server = require('http').Server(app);

// Modules
const mongo = require('./modules/mongo').init();

// websockets
const io = require('socket.io')(server);
const websockets = require('./websockets').start(server);

// configuration
const config = require('../config/config.json');

// Get our API routes
const router = require('./router')(module);
const serverPort = process.env.PORT || config.port;

app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept');

  next();
});

// Set our api routes
app.use('/', router);

server.listen(serverPort, () => console.log(`Server running on http://localhost:${serverPort}`));
