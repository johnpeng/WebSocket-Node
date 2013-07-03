"use strict"

module.exports = {
	now: now
	, args: args
	, notfound: notfound
}

function now() { return Date.now().toLocaleString() }

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