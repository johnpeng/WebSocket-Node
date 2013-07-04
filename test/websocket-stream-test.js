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
	, testFile = pathBinFile

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
		, testStream = fs.createReadStream(testFile)

    console.log(utils.now(), "connection accepted from", connection.remoteAddress)

	console.log('server is piping', testFile)
	testStream.pipe(wssSend)

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
	    console.log(utils.now(), "connection accepted by", connection.remoteAddress)
	   
		var wsstream = new WebSocketStream(connection)
			, md5wsfinal, md5test, md5testfinal
			, md5ws = crypto.createHash('md5')

		wsstream.on('error', utils.errorHandler('WebSocket Stream Client side Error:'))
		wsstream.on('end', assertResult)

		wsstream.pipe(md5ws, {end: false})

		connection.on('close', function(reasonCode, description) {
			console.log(utils.now(), "Client disconnected.", reasonCode, description);
		})

		connection.on('error', utils.errorHandler('client connection error'))

		function assertResult () {
			var testStream = fs.createReadStream(testFile)
			
			md5test = crypto.createHash('md5')
			md5test.on('error', utils.errorHandler('MD5 on text stream Error:'))
			
			md5ws.end()
			md5wsfinal = md5ws.read().toString('base64')

			console.log('WebSocket Server txt Stream MD5 is', md5wsfinal)

			testStream.on('error', utils.errorHandler('Client reading txt file Error:'))
			testStream.on('end', assertFinalResult)

			testStream.pipe(md5test, {end: false})
		}

		function assertFinalResult () {
			md5test.end()
			md5testfinal = md5test.read().toString('base64')
			console.log('The source txt file MD5 is', md5testfinal)

			assert.equal(md5testfinal, md5wsfinal
				, 'The md5 of server pushed file and source file does not equal')

			console.log('Test of downloading', testFile, 'is passed.')
			//assert passed, exit normally
			process.exit(0)
		}
	})

	var wshostaddress = args.protocol + '//' + args.host + ':' + args.port
	console.log("Client connecting", wshostaddress, 'for', resource)

	client.connect(wshostaddress, resource)

}

