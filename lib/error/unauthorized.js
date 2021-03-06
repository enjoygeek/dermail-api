'use strict';

module.exports = function Unauthorized(message, extra) {
	Error.captureStackTrace(this, this.constructor);
	this.name = this.constructor.name;
	this.status = 401;
	this.message = message;
	this.extra = extra;
};

require('util').inherits(module.exports, Error);
