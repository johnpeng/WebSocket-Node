var extend = require('./utils').extend;
var crypto = require('crypto');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var WebSocketFrame = require('./WebSocketFrame');
var WebSocketMessage = require('./WebSocketMessage');
var BufferList = require('./FastBufferList');

function WebSocketConnection(socket, extensions, protocol, isServer) {
    this.socket = socket;
    this.protocol = protocol;
    this.extensions = extensions;
    this.remoteAddress = socket.remoteAddress;
    
    // Determines in which direction we should apply masking
    this.isServerSide = isServer;
    
    // We re-use the same buffers for the mask and frame header for all frames
    // received on each connection to avoid a small memory allocation for each
    // frame.
    this.maskBytes = new Buffer(4);
    this.frameHeader = new Buffer(10);
    
    // the BufferList will handle the data streaming in
    this.bufferList = new BufferList();
    
    // Prepare for receiving first frame
    this.currentFrame = new WebSocketFrame(this.maskBytes, this.frameHeader);
    this.fragmentationOpcode = 0;
    this.frameQueue = [];
    
    // Various bits of connection state
    this.connected = true;
    this.waitingForCloseResponse = false;
    
    // Configuration Options
    // TODO: Make options configurable
    this.closeTimeout = 5000;
    this.maxFrameSize = 0xFFFF; // 64 KiB
    this.maxMessageSize = 0x100000; // 1 MiB

    this.socket.on('data', this.handleSocketData.bind(this));
    this.socket.on('end', this.handleSocketEnd.bind(this));
    this.socket.on('close', this.handleSocketClose.bind(this));
    
    this._closeTimerHandler = this.handleCloseTimer.bind(this);
};

WebSocketConnection.CLOSE_REASON_NORMAL = 1000;
WebSocketConnection.CLOSE_REASON_GOING_AWAY = 1001;
WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR = 1002;
WebSocketConnection.CLOSE_REASON_UNPROCESSABLE_INPUT = 1003;
WebSocketConnection.CLOSE_REASON_MESSAGE_TOO_LARGE = 1004;

util.inherits(WebSocketConnection, EventEmitter);

extend(WebSocketConnection.prototype, {
    handleSocketData: function(data) {
        this.bufferList.write(data);
        
        // currentFrame.addData returns true if all data necessary to parse
        // the frame was available.  It returns false if we are waiting for
        // more data to come in on the wire.
        while (this.currentFrame.addData(this.bufferList, this.isServerSide, this.fragmentationOpcode)) {
            
            // Handle possible parsing errors
            if (this.currentFrame.protocolError) {
                // Something bad happened.. get rid of this client.
                this.drop(WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR, this.currentFrame.dropReason);
                return;
            }
            else if (this.currentFrame.frameTooLarge) {
                this.drop(WebSocketConnection.CLOSE_REASON_MESSAGE_TOO_LARGE, this.currentFrame.dropReason);
                return;
            }
            
            this.processFrame(this.currentFrame);
            this.currentFrame = new WebSocketFrame(this.maskBytes, this.frameHeader, this.maxFrameSize);
        }
    },

    handleSocketEnd: function() {
        this.socket.end();
    },

    handleSocketClose: function(hadError) {
        this.socketHadError = hadError;
        this.connected = false;
        if (!this.closeEventEmitted) {
            this.closeEventEmitted = true;
            this.emit('close', this);
        }
    },
    
    close: function() {
        if (this.connected) {
            this.setCloseTimer();
            this.sendCloseFrame();
            this.connected = false;
        }
    },
    
    drop: function(closeReason, reasonText) {
        if (typeof(closeReason) !== 'number') {
            closeReason = WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR;
        }
        var logText = "WebSocket: Dropping Connection. Code: " + closeReason.toString(10);
        if (reasonText) {
            logText += (" - " + reasonText);
        }
        console.error((new Date()) + " " + logText);
        this.sendCloseFrame(closeReason, reasonText);
        this.connected = false;
        this.socket.end();
    },
    
    setCloseTimer: function() {
        this.clearCloseTimer();
        this.waitingForCloseResponse = true;
        this.closeTimer = setTimeout(this._closeTimerHandler, this.closeTimeout);
    },
    
    clearCloseTimer: function() {
        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.waitingForCloseResponse = false;
            this.closeTimer = null;
        }
    },
    
    handleCloseTimer: function() {
        this.closeTimer = null;
        if (this.waitingForCloseResponse) {
            this.waitingForCloseResponse = false;
            this.socket.end();
        }
    },
    
    processFrame: function(frame) {
        var i;
        var currentFrame;
        var message;
        
        switch(frame.opcode) {
            case 0x05: // WebSocketFrame.BINARY_FRAME
                if (frame.fin) {
                    this.emit('message', {
                        type: 'binary',
                        binaryData: frame.binaryPayload
                    });
                }
                else if (this.frameQueue.length === 0) {
                    // beginning of a fragmented message
                    this.frameQueue.push(frame);
                    this.fragmentationOpcode = frame.opcode;
                }
                else {
                    this.drop(WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR,
                              "Illegal BINARY_FRAME received in the middle of a fragmented message.  Expected a continuation or control frame.");
                    return;
                }
                break;
            case 0x04: // WebSocketFrame.TEXT_FRAME
                if (frame.fin) {
                    this.emit('message', {
                        type: 'utf8',
                        utf8Data: frame.utf8Payload
                    });
                }
                else if (this.frameQueue.length === 0) {
                    // beginning of a fragmented message
                    this.frameQueue.push(frame);
                    this.fragmentationOpcode = frame.opcode;
                }
                else {
                    this.drop(WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR,
                              "Illegal TEXT_FRAME received in the middle of a fragmented message.  Expected a continuation or control frame.");
                    return;
                }
                break;
            case 0x00: // WebSocketFrame.CONTINUATION
                this.frameQueue.push(frame);
                if (frame.fin) {
                    // end of fragmented message, so we process the whole
                    // message now.  We also have to decode the utf-8 data
                    // for text frames after combining all the fragments.
                    var totalLength = 0;
                    var bytesCopied = 0;
                    this.frameQueue.forEach(function (currentFrame) {
                        totalLength += currentFrame.binaryData.length;
                    });
                    var binaryData = new Buffer(totalLength);
                    this.frameQueue.forEach(function (currentFrame) {
                        currentFrame.binaryData.copy(binaryData, bytesCopied);
                        bytesCopied += currentFrame.binaryData.length;
                    });
                    frameQueue = [];
                    
                    switch (this.frameQueue[0].opcode) {
                        case 0x05: // WebSocketOpcode.BINARY_FRAME
                            emit('message', {
                                type: 'binary',
                                binaryData: binaryData
                            });
                            break;
                        case 0x04: // WebSocketOpcode.TEXT_FRAME
                            emit('message', {
                                type: 'utf8',
                                utf8Data: binaryData.toString('utf8')
                            });
                            break;
                        default:
                            this.drop(WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR,
                                      "Unexpected first opcode in fragmentation sequence: 0x" + this.frameQueue[0].opcode.toString(16));
                            return;
                    }
                }
                break;
            case 0x02: // WebSocketFrame.PING
                this.pong();
                break;
            case 0x03: // WebSocketFrame.PONG
                break;
            case 0x01: // WebSocketFrame.CONNECTION_CLOSE
                if (this.waitingForCloseResponse) {
                    // Got response to our request to close the connection.
                    // Close is complete, so we just hang up.
                    this.clearCloseTimer();
                    this.waitingForCloseResponse = false;
                    this.socket.end();
                }
                else {
                    // Got request from other party to close connection.
                    // Send back acknowledgement and then hang up.
                    if (frame.closeStatus !== WebSocketConnection.CLOSE_REASON_NORMAL) {
                        var logCloseError;
                        switch(frame.closeStatus) {
                            case WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR:
                                logCloseError = "Remote peer closed connection: Protocol Error";
                                break;
                            case WebSocketConnection.CLOSE_REASON_MESSAGE_TOO_LARGE:
                                logCloseError = "Remote peer closed connection: Received Message Too Large";
                                break;
                            case WebSocketConnection.CLOSE_REASON_UNPROCESSABLE_INPUT:
                                logCloseError = "Remote peer closed connection: Unprocessable Input";
                                break;
                            case WebSocketConnection.CLOSE_REASON_GOING_AWAY:
                                logCloseError = "Remote peer closed connection: Going Away";
                                break;
                            default:
                                logCloseError = "Remote peer closed connection: Status code " + frame.closeStatus.toString(10);
                                break;
                        }
                        if (frame.utf8Payload) {
                            logCloseError += (" - Description Provided: " + frame.utf8Payload);
                        }
                        console.error((new Date()) + " " + logCloseError);
                    }
                    this.sendCloseFrame(WebSocketConnection.CLOSE_REASON_NORMAL);
                    this.socket.end();
                }
                break;
            default:
                this.drop(WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR,
                          "Unrecognized Opcode: 0x" + frame.opcode.toString(16));
                break;
        }
    },
    
    sendUTF: function(data) {
        if (this.connected && this.socket.writable) {
            var frame = new WebSocketFrame();
            frame.fin = true;
            frame.opcode = 0x04; // WebSocketOpcode.TEXT_FRAME
            frame.utf8Payload = data;
            this.socket.write(frame.toBuffer(!this.isServerSide));
        }
    },
    
    sendBytes: function(data) {
        if (this.connected && this.socket.writable) {
            var frame = new WebSocketFrame();
            frame.fin = true;
            frame.opcode = 0x05; // WebSocketOpcode.BINARY_FRAME
            frame.binaryPayload = data;
            this.socket.write(frame.toBuffer(!this.isServerSide));
        }
    },
    
    ping: function() {
        if (this.connected && this.socket.writable) {
            var frame = new WebSocketFrame();
            frame.fin = true;
            frame.opcode = 0x02; // WebSocketOpcode.PING
            this.socket.write(frame.toBuffer(!this.isServerSide));
        }
    },
    
    pong: function() {
        if (this.connected && this.socket.writable) {
            var frame = new WebSocketFrame();
            frame.fin = true;
            frame.opcode = 0x03; // WebSocketOpcode.PONG
            this.socket.write(frame.toBuffer(!this.isServerSide));
        }
    },
    
    sendCloseFrame: function(reasonCode, reasonText) {
        if (this.connected && this.socket.writable) {
            var reasonLength = 0;
            if (typeof(reasonCode) !== 'number') {
                reasonCode = WebSocketConnection.CLOSE_REASON_NORMAL;
            }
            if (typeof(reasonText) === 'string') {
                reasonLength = Buffer.byteLength(reasonText, 'utf8');
            }
            var frame = new WebSocketFrame();
            frame.fin = true;
            frame.opcode = 0x01; // WebSocketOpcode.CONNECTION_CLOSE
            frame.closeStatus = reasonCode;
            frame.utf8Payload = reasonText;
            
            this.socket.write(frame.toBuffer(!this.isServerSide));
        }
    }
});

module.exports = WebSocketConnection;