"use strict"

var Transform = require('stream').Transform

module.exports = WebSocketStream

function WebSocketStream(wsConnection, options) {
	if (!(this instanceof WebSocketStream))
		return new WebSocketStream(wsConnection, end, options);

	this.connection = wsConnection
		.on('message', messageHandler.bind(this))
		.on('error', errorHandler.bind(this))
		.on('close', closeHandler.bind(this))

	Transform.call(this, options)
}

// WebSocketStream Commands
WebSocketStream.COMMAND_END = 'end'


WebSocketStream.prototype = Object.create(
	Transform.prototype, { constructor: { value: WebSocketStream }});

WebSocketStream.prototype._transform = function(chunk, encoding, done) {

	// Stream data is ALWAYS send as BINARY
	this.connection.sendBytes(chunk)

	done()

	console.log('WebSocketStream sent', chunk.length, 'bytes of BINARY data.')
}

WebSocketStream.prototype._flush = function(done) {

	// when is source stream is ended, send COMMAND_END to the other side of the WebSocketStream
	// but left the connection opened; this is the responsibility of the connection creator to end
	// the connection

	this.connection.sendUTF(WebSocketStream.COMMAND_END, flushCallback)
	done()

	console.log('WebSocketStream sent END command to the receiver')

	function flushCallback(error) {
		if (error) return console.error('WebSocket Error when Sending End Command:', error.message)
	}
}

function messageHandler(message) {
	var data

	// if the message is binary, it is the source stream data
	if (data = message.binaryData) return this.push(data)

	// if the message is text, it is the internal commands of WebSocketStream
	var command = message.utf8Data.match(/^(\w+)\s*(.*)$/)

	if (command) {
		// process the command
		console.log('Received Command:', command[1], command[2])
		switch(command[1]) {
			case WebSocketStream.COMMAND_END: // end of source stream is reached
				return this.end()
			default:
		}
	}

	return this.emit('error', new Error("Unrecognized Internal Command:" + command))
}

function closeHandler() {
	this.end()
	this.emit('close')
}

function errorHandler(error) {
	this.emit('error', error)
}

