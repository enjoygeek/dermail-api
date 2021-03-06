var Promise = require('bluebird'),
    r = require('rethinkdb'),
    elasticsearch = require('elasticsearch'),
	config = require('./config'),
    bunyan = require('bunyan'),
	stream = require('gelf-stream'),
    discover = require('./lib/discover'),
	log;

if (!!config.graylog) {
	log = bunyan.createLogger({
		name: 'API-Fulltext',
		streams: [{
			type: 'raw',
			stream: stream.forBunyan(config.graylog.host, config.graylog.port)
		}]
	});
}else{
	log = bunyan.createLogger({
		name: 'API-Fulltext'
	});
}

if (!config.elasticsearch) {
    log.info({ message: 'Elasticsearch not configured.' });
    process.exit(0);
}

var ready = false;

discover().then(function(ip) {
    if (ip !== null) config.rethinkdb.host = ip;
    r.connect(config.rethinkdb).then(function(conn) {
        r.conn = conn;

        log.info('Process ' + process.pid + ' is running as an API-Fulltext.');

        var client = new elasticsearch.Client({
            host: config.elasticsearch + ':9200',
            requestTimeout: 1000 * 60 * 5
        });

        client.count(function (error, response, status) {
            var count = response.count;

            log.info({ message: count + ' messages on Elastic' });

            r.table('messages')
            .pluck('messageId', 'from', 'to', 'cc', 'bcc', 'attachments', 'accountId', 'subject', 'text', 'html')
            .changes({
                includeInitial: true,
                includeStates: true
            })
            .run(r.conn)
            .then(function(cursor) {
                var fetchNext = function(err, result) {
                    if (err) throw err;

                    if (result.state === 'initializing') {
                        log.info({ message: 'Initializing feeds.' });
                        return cursor.next(fetchNext);
                    }
                    if (result.state === 'ready') {
                        ready = true;
                        log.info({ message: 'Feeds ready.' });
                        return cursor.next(fetchNext);
                    }

                    if (!ready) {
                        return client.search({
                            index: 'messages',
                            body: {
                                query: {
                                    match: {
                                        _id: result.new_val.messageId
                                    }
                                }
                            }
                        }, function(err, res) {
                            if (err) throw error;
                            if (res.hits.total > 0) return cursor.next(fetchNext);
                            return client.create({
                                index: 'messages',
                                type: result.new_val.accountId,
                                id: result.new_val.messageId,
                                body: result.new_val
                            }, function(error, response) {
                                if (error) throw error;
                                cursor.next(fetchNext);
                            })
                        })
                    }

                    if (result.new_val === null && result.old_val !== null) {
                        // delete
                        return client.delete({
                            index: 'messages',
                            type: result.old_val.accountId,
                            id: result.old_val.messageId
                        }, function(error, response) {
                            if (error) throw error;
                            cursor.next(fetchNext);
                        })
                    }
                    if (result.new_val !== null && result.old_val !== null) {
                        // update
                        // `messages` doesn't really update (subject, text, html)
                        return cursor.next(fetchNext);
                    }
                    if (result.new_val !== null && result.old_val === null) {
                        // create
                        return client.create({
                            index: 'messages',
                            type: result.new_val.accountId,
                            id: result.new_val.messageId,
                            body: result.new_val
                        }, function(error, response) {
                            if (error) throw error;
                            cursor.next(fetchNext);
                        })
                    }
            	}
            	cursor.next(fetchNext);
            })
        })
    })
})
