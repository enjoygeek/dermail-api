var Promise = require('bluebird'),
	passport = require('passport');

var self = module.exports = {
	userAccountMapping: Promise.method(function(r, userId, accountId) {
		return r
		.table('accounts', {readMode: 'majority'})
		.getAll([userId, accountId], {index: 'userAccountMapping'})
		.eqJoin('domainId', r.table('domains', {readMode: 'majority'}))
		.zip()
		.pluck('accountId', 'account', 'domain')
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(account) {
			return account[0];
		})
	}),
	accountFolderMapping: Promise.method(function(r, accountId, folderId) {
		return r
		.table('folders', {readMode: 'majority'})
		.getAll([accountId, folderId], {index: 'accountFolderMapping'})
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(result) {
			if (result.length === 0) {
				throw new Error('Folder does not belong to account.');
			}else{
				return result[0];
			}
		})
	}),
	messageAccountMapping: Promise.method(function(r, messageId, accountId) {
		return r
		.table('messages', {readMode: 'majority'})
		.getAll([messageId, accountId], {index: 'messageAccountMapping'})
        .map(function(doc) {
            return doc.merge(function() {
                return {
                    cc: r.branch(doc.hasFields('cc'), doc('cc'), []),
                    bcc: r.branch(doc.hasFields('bcc'), doc('bcc'), []),
                    replyTo: r.branch(doc.hasFields('replyTo'), doc('replyTo'), [])
                }
            })
        })
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(result) {
			if (result.length === 0) {
				throw new Error('Message does not belong to account.');
			}else{
				return result[0];
			}
		})
	}),
	getUser: Promise.method(function(r, userId) {
		return r
		.table('users', {readMode: 'majority'})
		.get(userId)
		.without('password')
		.merge(function(doc) {
			return {
				'accounts': r
					.table('accounts', {readMode: 'majority'})
					.getAll(
						doc('userId'),
						{
							index: 'userId'
						}
					)
					.concatMap(function(d) {
						return [ d('accountId') ]
					})
					.coerceTo('array')
			}
		})
		.run(r.conn)
	}),
	middleware: function(req, res, next) {
        passport.authenticate('jwt', function(err, user, info) {

            if (!!err) {
                return next(err);
            }

            if (!!!user) {
                return next(new Error('Token invalid.'));
            }
            req.user = user;
            return next();
        })(req, res, next);
    },
    api: function(req, res, next) {
        // Internal API call
        var config = req.config;
        if (req.headers['x-remotesecret'] === config.remoteSecret) {
            var r = req.r;
            if (!!req.body.userId) {
                return self.getUser(r, req.body.userId)
                .then(function(user) {
                    req.user = user;
                    return next();
                })
                .catch(function(e) {
                    return next(e);
                })
            }else{
                req.user = null;
                return next();
            }
        }else{
            return next(new Error('Token invalid.'));
        }
	},
    accountIdToUserId: Promise.method(function(r, accountId) {
        return r.table('accounts')
        .get(accountId)
        .run(r.conn)
        .then(function(result) {
            if (result === null) {
                throw new Error('Account does not exist.')
            }
            return result.userId;
        })
    })
}
