var r = require('rethinkdb'),
	config = require('../config'),
	knox = require('knox'),
	async = require('async'),
	crypto = require('crypto'),
	s3 = knox.createClient(config.s3);

var onS3 = {};
var inDB = [];
var pendingDelete = [];

s3.list({ prefix: 'raw' }, function(err, data){
	if (err) {
		throw err;
	}
	r.connect(config.rethinkdb).then(function(conn) {
		async.waterfall([
			function(done) {
				async.each(data.Contents, function(file, cb) {
					var key = file.Key;
					var checksum = key.substring(key.indexOf("/") + 1).toLowerCase();
					onS3[checksum] = key;
					async.setImmediate(function () {
						cb();
					})
				}, function(err) {
					done();
				});
			},
			function(done) {
				r
				.table('messages')
				.run(conn)
				.then(function(cursor) {
					return cursor.toArray();
				})
				.then(function(results) {
					async.each(results, function(res, cb) {
						if (res.connection) {
							var tmpPath = res.connection.tmpPath;
							var hash = crypto.createHash('md5')
							hash.update(tmpPath);
							var md5 = hash.digest('hex');
							inDB.push(md5);
						}
						cb();
					}, function(err) {
						done();
					});
				})
			}
		], function(err) {
			async.each(Object.keys(onS3), function(file, cb) {
				if (inDB.indexOf(file) === -1) {
					console.log(file + ' exists on S3 but DB has no record:', onS3[file]);
					pendingDelete.push(onS3[file]);
				}
				async.setImmediate(function () {
					cb();
				})
			}, function(err) {
				s3.deleteMultiple(pendingDelete, function(err, res){
					if (err)
						console.log(err);
				});
				conn.close();
			});
		})
	});
})
