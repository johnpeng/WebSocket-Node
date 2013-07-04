"use strict"

module.exports = {
	now: now
	, args: args
	, notfound: notfound
	, errorHandler: errorHandler
}

function now() { return new Date().toLocaleString() }

function args(argv, defaults) {
	defaults = defaults || {}
	/* Parse command line options */
	var pattern = /^--(.*?)(?:=(.*))?$/

	for (var i=1; i<argv.length; i++) {
		var match = pattern.exec(argv[i])
		if (match) defaults[match[1]] = match[2] ? match[2] : true
	}
	return defaults
}

function notfound(response, message) {
    response.writeHead(404)
    response.end(message)
}

function errorHandler(message) {
	return function (error) {
		console.error(message || 'Error Handler:', error.message)
	}
}