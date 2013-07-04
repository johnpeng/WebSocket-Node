#!/usr/bin/env node
/************************************************************************
 *  Copyright 2013
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
    , WebSocketStream = require('../lib/WebSocketStream')
    , http = require('http')
    , fs = require('fs')
    , utils = require('./utils')
    , crypto = require('crypto')
    , assert = require('assert')
	, WebSocketClient = require('../lib/WebSocketClient')
	, pathTxtFile = "../README.md"
	, pathBinFile = "browser-icon-firefox.png"
	, resource = "UTF8-Stream-Test"

console.log("WebSocket-Stream-Node: Test Stream Server")

var args = utils.args(process.argv, {
		"port": 8000
		, host: 'localhost'
	})

args.protocol = 'ws:'

if (args.help) {
    console.log("Usage: ./websocket-stream-test.js [--port=8000] [--host=localhost")
    return
}
else {
    console.log("Use --help for usage information.")
}

console.log('args are:', args)
/*
 * Server session
 */

var server = http.createServer(function(request, response) {
	console.log(utils.now(), "Received request from", request.url)
	utils.notfound(response, 'I am a dumb server for testing')
})

server.listen(args.port, args.host, function() {

	console.log("Server is listening on", args.host, ':', args.port, 'at', utils.now())

	startClient()

})

var wsServer = new WebSocketServer({
    httpServer: server
})

var router = new WebSocketRouter()

router.attachServer(wsServer)

router.mount('*', resource, function(request) {
   
	var connection = request.accept(request.origin)
		, wssSend = new WebSocketStream(connection)
		, txtStream = fs.createReadStream(pathTxtFile)
		, wssRead = new WebSocketStream(connection)
		, binstream = fs.createReadStream(pathBinFile)

    console.log(utils.now(), "connection accepted from", connection.remoteAddress, ':', connection.socket.remotePort)

	console.log('server is piping', pathTxtFile)
	txtStream.pipe(wssSend)

	streamEqual(binstream, wssRead, assertResult)

	function assertResult(error) {
		if (error) {
			utils.errorHandler('Server Assertion Error of' + pathTxtFile)(error)
			process.exit(1)
		} 
		else {
			console.log('Server Assertion Passed')
			process.exit(0)
		}
	}

	connection.on('close', function(reasonCode, description) {
		console.log(utils.now(), "Client disconnected.");
	})
    
	connection.on('error', utils.errorHandler("Connection error for WebSocket server"))

})

/*
 * client session
 */
function startClient() {
	console.log("WebSocket-Stream-Node: Test Stream Client.")

	var client = new WebSocketClient()

	client.on('connectFailed', utils.errorHandler("WebSocket Client error"))

	client.on('connect', function(connection) {
	    console.log(utils.now(), "connection accepted by", connection.remoteAddress, ':', connection.socket.remotePort)
	   
		var wsstream = new WebSocketStream(connection)
			, sourcestream = fs.createReadStream(pathTxtFile)

		streamEqual(wsstream, sourcestream, assertResult)

		function assertResult(error) {
			if (error) utils.errorHandler('Client Assertion Error of' + testFile)(error)
			else console.log('Client Assertion Passed')

			// send back a binary stream for testing
			var wsbinstream = new WebSocketStream(connection)
			console.log('client is piping', pathBinFile)
			fs.createReadStream(pathBinFile).pipe(wsbinstream)
		}
		connection.on('close', function(reasonCode, description) {
			console.log(utils.now(), "Client disconnected.", reasonCode, description);
		})

		connection.on('error', utils.errorHandler('client connection error'))

	})

	var wshostaddress = args.protocol + '//' + args.host + ':' + args.port
	console.log("Client connecting", wshostaddress, 'for', resource)

	client.connect(wshostaddress, resource)

}

function streamEqual(stm1, stm2, callback) {
	var hash1sum = crypto.createHash('md5')
		, hash2sum = crypto.createHash('md5')
		, firstHash

	stm1.on('end', assertEqual(hash1sum))
	stm1.pipe(hash1sum, {end:false})

	stm2.on('end', assertEqual(hash2sum))
	stm2.pipe(hash2sum, {end:false})

	function assertEqual(hashsum) {

		return function () {
			hashsum.end()
			if (!firstHash) {
				firstHash = hashsum.read().toString('base64')
				console.log('got first hash:', firstHash)
			} else {
				var secondHash = hashsum.read().toString('base64')
				console.log('got second hash:', secondHash)
				if (firstHash === secondHash) callback()
				else callback(new Error('First and second hash are not equal'))
			}
		}
	}

}