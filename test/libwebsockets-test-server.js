#!/usr/bin/env node
/************************************************************************
 *  Copyright 2010-2011 Worlize Inc.
 *  
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *  
 *      http://www.apache.org/licenses/LICENSE-2.0
 *  
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ***********************************************************************/
"use strict"

var WebSocketServer = require('../lib/WebSocketServer')
, WebSocketRouter = require('../lib/WebSocketRouter')
, http = require('http')
, url = require('url')
, fs = require('fs')
, os = require('os')
, utils = require('./utils')
, args = utils.args(process.argv, {port:8000})

args.protocol = args.secure ? 'wss:' : 'ws:'

if (args.secure) {
    console.log("WebSocket-Node: Test Server implementing Andy Green's"
    , "libwebsockets-test-server protocols.\n"
    , "ERROR: TLS is not yet supported.")
    return
}

var server = http.createServer(function(request, response) {
    var filestream

    console.log(utils.now(), "Received request for", request.url)

    if (request.url == "/") {
        filestream = fs.createReadStream('libwebsockets-test.html')

        filestream.on('error', function (e) {utils.notfound(response, e.message)})

        response.writeHead(200, {'Content-Type': 'text/html'})
        filestream.pipe(response)
    }
    else {
        utils.notfound(response)
    }
})

server.listen(args.port, function() {
    console.log("Server is listening on port", args.port);
});

var wsServer = new WebSocketServer({
    httpServer: server
});

var router = new WebSocketRouter();

router.attachServer(wsServer);

var mirrorConnections = [];

var mirrorHistory = [];

router.mount('*', 'lws-mirror-protocol', function(request) {
    var historyString
    , cookies = [
        {
            name: "TestCookie",
            value: "CookieValue" + Math.floor(Math.random()*1000),
            path: '/',
            secure: false,
            maxage: 5000,
            httponly: true
        }
    ]
    
    // Should do origin verification here. You have to pass the accepted
    // origin into the accept method of the request.
    var connection = request.accept(request.origin, cookies)

    console.log(utils.now(), "lws-mirror-protocol connection accepted from", connection.remoteAddress
    , "- Protocol Version", connection.webSocketVersion)

    if (mirrorHistory.length > 0) {
        historyString = mirrorHistory.join('')
        connection.send(historyString, sendCallback)

        console.log(utils.now(), "sending mirror protocol history to client", connection.remoteAddress
        , ":", Buffer.byteLength(historyString), "bytes")
    }
    
    mirrorConnections.push(connection)
    
    connection.on('message', function(message) {
        // We only care about text messages
        if (message.type === 'utf8') {
            // Clear canvas command received
            if (message.utf8Data === 'clear;') {
                mirrorHistory = [];
            }
            else {
                // Record all other commands in the history
                mirrorHistory.push(message.utf8Data);
            }

            // Re-broadcast the command to all connected clients
            mirrorConnections.forEach(function (outputConnection) {
                outputConnection.send(message.utf8Data, sendCallback);
            })
        }
    })

    connection.on('close', function(closeReason, description) {
        var index = mirrorConnections.indexOf(connection);
        if (index !== -1) {
            console.log(utils.now(), "lws-mirror-protocol peer", connection.remoteAddress
            , "disconnected, code:", closeReason, ".")
            mirrorConnections.splice(index, 1)
        }
    })
    
    connection.on('error', function(error) {
        console.log("Connection error for peer", connection.remoteAddress, ":", error.message);
    })
})

router.mount('*', 'dumb-increment-protocol', function(request) {
    // Should do origin verification here. You have to pass the accepted
    // origin into the accept method of the request.
    var connection = request.accept(request.origin)

    console.log(utils.now(), "dumb-increment-protocol connection accepted from"
    , connection.remoteAddress, "- Protocol Version", connection.webSocketVersion)

    var number = 0

    connection.timerInterval = setInterval(function() {
        connection.send((number++).toString(10), sendCallback);
    }, 50)

    connection.on('close', function() {
        clearInterval(connection.timerInterval);
    })
    .on('message', function(message) {
        if (message.type === 'utf8') {
            if (message.utf8Data === 'reset\n') {
                console.log(utils.now(), "increment reset received")
                number = 0
            }
        }
    })
    .on('close', function(closeReason, description) {
        console.log(utils.now(), "dumb-increment-protocol peer", connection.remoteAddress
        , " disconnected, code: ",closeReason, ".")
    })
})

console.log("WebSocket-Node: Test Server implementing Andy Green's")
console.log("libwebsockets-test-server protocols.");
console.log("Point your WebSocket Protocol Version 8 compliant browser to http://localhost:"
, args.port, "/");

function sendCallback(err) {
    if (err) console.error("send() error:", err);
}

