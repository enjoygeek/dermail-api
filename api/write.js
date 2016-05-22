var reservedFolderNames = [
	'inbox',
	'trash',
	'sent',
	'spam'
];
var noChildrenAllowed = [
	'trash',
	'sent'
];
var allowTruncate = [
	'trash',
	'spam'
]
var express = require('express'),
	router = express.Router(),
	passport = require('passport'),
	Promise = require('bluebird'),
	helper = require('../lib/helper'),
	shortid = require('shortid');

shortid.worker(process.pid % 16);

var auth = helper.auth.middleware;

router.post('/updateMail', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId || '';
	var messageId = req.body.messageId || '';
	var action = req.body.action || '';
	var data = {};

	if (!messageId) {
		return next(new Error('Message ID Required.'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Error('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	switch (action.toLowerCase()) {
		case 'star':
			data.isStar = true;
			break;
		case 'unstar':
			data.isStar = false;
			break;
		case 'read':
			data.isRead = true;
			break;
		case 'unread':
			data.isRead = false;
			break;
		case 'folder':
			var folderId = req.body.folderId;
			if (!folderId) {
				return next(new Error('Folder ID Required'));
			}
			return helper.auth.accountFolderMapping(r, accountId, folderId)
			.then(function(folder) {
				data.folderId = folderId;
				return doUpdateMail(r, messageId, accountId, data)
			})
			.then(function(result) {
				res.status(200).send(result);
			})
			.catch(function(e) {
				return next(e);
			})

			break;
		case 'trash':
			return helper.folder.getInternalFolder(r, accountId, 'Trash')
			.then(function(trashFolder) {
				data.folderId = trashFolder;
				return doUpdateMail(r, messageId, accountId, data)
				.then(function(result) {
					return res.status(200).send(trashFolder);
				})
			})
			.catch(function(e) {
				return next(e);
			})
			break;
		case 'spam':
			return helper.folder.getInternalFolder(r, accountId, 'Spam')
			.then(function(spamFolder) {
				data.folderId = spamFolder;
				return doUpdateMail(r, messageId, accountId, data)
			})
			.then(function(result) {
				// TO-DO: Train the SPAM filter
				res.status(200).send(result);
			})
			.catch(function(e) {
				return next(e);
			})
			break;
		case 'notspam':
			return helper.folder.getInternalFolder(r, accountId, 'Inbox')
			.then(function(inboxFolder) {
				data.folderId = inboxFolder;
				return doUpdateMail(r, messageId, accountId, data)
				.then(function(result) {
					// TO-DO: Tell the SPAM filter that this is not a spam
					res.status(200).send(inboxFolder);
				})
			})
			.catch(function(e) {
				return next(e);
			})
			break;
		default:
			return next(new Error('Not implemented.'));
			break;
	}

	return doUpdateMail(r, messageId, accountId, data)
	.then(function(result) {
		res.status(200).send(result);
	})
	.catch(function(e) {
		return next(e);
	})
});

router.post('/updateFolder', auth, function(req, res, next) {

	var r = req.r;
	var messageQ = req.Q;
	var config = req.config;

	var userId = req.user.userId;
	var accountId = req.body.accountId;
	var parent = (req.body.parent === '/root' ? null : req.body.parent);
	var action = req.body.action;
	var data = {};
	data.displayName = req.body.displayName || '';
	data.description = req.body.description || '';
	data.parent = parent;
	data.mutable = true;

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Error('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	if (action !== 'truncateFolder' && reservedFolderNames.indexOf(data.displayName.toLowerCase().trim()) !== -1) { // Some display names are reserved
		return next(new Error('Cannot use reserved folder names.'));
	}

	if (data.displayName === '' || data.description === '') {
		return next(new Error('Name and description cannot be empty.'));
	}

	switch (action) {
		case 'truncateFolder':
			var folderId = req.body.folderId;
			return helper.auth.accountFolderMapping(r, accountId, folderId)
			.then(function(folder) {
				if (allowTruncate.indexOf(folder.displayName.toLowerCase().trim()) === -1) {
					throw new Error('Only "SPAM" and "Trash" folders can be truncated.');
				}
				return r
				.table('messages')
				.between([folderId, r.minval], [folderId, r.maxval], {index: 'folderDate'})
				.pluck('messageId', 'headers', 'attachments')
				.run(r.conn)
				.then(function(cursor) {
					return cursor.toArray();
				})
			})
			.then(function(messages) {
				return messageQ.add({
					type: 'truncateFolder',
					payload: {
						userId: userId,
						messages: messages
					}
				}, config.Qconfig);
			})
			.then(function() {
				return res.status(200).send({message: 'Action "truncateFolder" queued.'});
			})
			.catch(function(e) {
				return next(e);
			})
			break;
		case 'deleteFolder':
			var folderId = req.body.folderId;

			return helper.auth.accountFolderMapping(r, accountId, folderId)
			.then(function() {
				return r
				.table('folders')
				.getAll(accountId, {index: 'accountId'})
				.filter({
					parent: folderId
				})
				.count()
				.run(r.conn)
			})
			.then(function(childrenCount) {
				if (childrenCount !== 0) {
					throw new Error('Folder contains children.');
				}
				return helper.folder.getInternalFolder(r, accountId, 'Trash')
			})
			.then(function(trashFolder) {
				return batchMoveToTrashAndRemoveFolder(r, folderId, trashFolder)
			})
			.then(function(result) {
				return res.status(200).send({message: 'Folder deleted.'});
			})
			.catch(function(e) {
				return next(e);
			})
			break;
		case 'updateFolder':
			var folderId = req.body.folderId;
			if (!folderId) {
				return next(new Error('Folder ID Required'));
			}

			return helper.auth.accountFolderMapping(r, accountId, folderId)
			.then(function(folder) {
				// Sanity check
				if (folder.mutable === false) {
					throw new Error('Folder not mutable.');
				}
				if (parent === null) {
					return doUpdateFolder(r, folderId, data)
				}else{
					return helper.auth.accountFolderMapping(r, accountId, parent)
					.then(parentTest)
					.then(function() {
						return doUpdateFolder(r, folderId, data)
					})
				}
			})
			.then(function(result) {
				return res.status(200).send({message: 'Folder updated.'});
			})
			.catch(function(e) {
				return next(e);
			})
			break;
		case 'addFolder':
			data.accountId = accountId;
			if (data.parent === null) {
				return doAddFolder(r, data)
				.then(function(result) {
					res.status(200).send(result);
				})
				.catch(function(e) {
					return next(e);
				})
			}else{
				return helper.auth.accountFolderMapping(r, accountId, data.parent)
				.then(parentTest)
				.then(function() {
					return doAddFolder(r, data)
				})
				.then(function(result) {
					res.status(200).send(result);
				})
				.catch(function(e) {
					return next(e);
				})
			}
			break;
		default:
			return next(new Error('Not implemented.'));
			break;
	}

});

router.post('/pushSubscriptions', auth, function(req, res, next) {

	var r = req.r;
	var config = req.config;

	var userId = req.user.userId;
	var action = req.body.action;
	var payload = req.body.payload;

	var object = JSON.parse(payload);

	switch (action) {
		case 'subscribe':
		return r
		.table('pushSubscriptions')
		.get(userId)
		.run(r.conn)
		.then(function(result) {
			if (result === null) {
				return r
				.table('pushSubscriptions')
				.insert({
					userId: userId,
					subscriptions: [object]
				})
				.run(r.conn)
				.then(function(result) {
					return res.status(200).send();
				})
			}else{
				return r
				.table('pushSubscriptions')
				.get(userId)
				.update({
					subscriptions: r.row('subscriptions').append(object)
				})
				.run(r.conn)
				.then(function(result) {
					return res.status(200).send();
				})
			}
		})
		break;
		case 'unsubscribe':
		return r
		.table('pushSubscriptions')
		.get(userId)
		.run(r.conn)
		.then(function(result) {
			if (result === null) {
				return res.status(500).send({message: 'No subscription found.'})
			}else{
				return r
				.table('pushSubscriptions')
				.get(userId)
				.getField('subscriptions')
				.run(r.conn)
				.then(function(result) {
					result = result.filter(function(f) {
						return f['endpoint'] !== object.endpoint;
					})
					return r.table('pushSubscriptions')
					.get(userId)
					.update({
						subscriptions: result
					})
					.run(r.conn)
					.then(function(result) {
						return res.status(200).send();
					})
				})
			}
		})
		break;
		case 'test':
		return helper.notification.sendNotification(r, config.gcm_api_key, {
			header: 'Test',
			body: 'This is a test!',
			accountId: null
		}, object).then(function() {
			return res.status(200).send();
		})
		break;
		default:
		return next(new Error('Not implemented.')); // Early surrender: account does not belong to user
		break;
	}
});

router.post('/modifyFilter', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;
	var filterId = req.body.filterId;

	var op = req.body.op;

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Error('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	switch (op) {
		case 'add':
			var criteria = req.body.criteria;
			var action = req.body.action;
			var existing = req.body.existing;

			var arrayOfFrom = !!!criteria.from ? null : criteria.from.toLowerCase().replace(/\s+/g,'').split(',');
			var arrayOfTo = !!!criteria.to ? null : criteria.to.toLowerCase().replace(/\s+/g,'').split(',');
			var subject = !!!criteria.subject ? null : criteria.subject.toLowerCase().replace(/\s+/g,'').split(',');
			var contain = !!!criteria.contain ? null : criteria.contain.toLowerCase().replace(/\s+/g,'').split(',');
			var exclude = !!!criteria.exclude ? null : criteria.exclude.toLowerCase().replace(/\s+/g,'').split(',');

			var folderId = action.folder;

			var doAddFilter = function() {
				var id = shortid.generate();
				return r // First we add the filter
				.table('filters')
				.insert({
					filterId: id,
					accountId: accountId,
					pre: {
						from: arrayOfFrom,
						to: arrayOfTo,
						subject: subject,
						contain: contain,
						exclude: exclude
					},
					post: action
				})
				.run(r.conn)
				.then(function() {
					return r // Then we searchWithFilter()
					.table('messages')
					.getAll(accountId, {index: 'accountId'})
					.map(function(doc) {
						return doc.merge(function() {
							return {
								'to': doc('to').concatMap(function(to) { // It's like a subquery
									return [r.table('addresses').get(to).without('accountId', 'addressId', 'internalOwner')]
								}),
								'from': doc('from').concatMap(function(from) { // It's like a subquery
									return [r.table('addresses').get(from).without('accountId', 'addressId', 'internalOwner')]
								})
							}
						})
					})
					.pluck('from', 'to', 'subject', 'text', 'messageId', 'accountId')
					.run(r.conn)
					.then(function(cursor) {
						return cursor.toArray();
					})
				})
				.then(function(result) {
					return helper.filter.applyFilters(result, arrayOfFrom, arrayOfTo, subject, contain, exclude)
				})
				.then(function(filtered) {
					return Promise.map(filtered, function(message) {
						return Promise.map(Object.keys(action), function(key) {
							if (!!existing[key]) {
								return helper.filter.applyAction(r, key, action[key], message);
							}
						})
					})
				})
				.then(function() {
					return res.status(200).send();
				})
				.catch(function(e) {
					return next(e);
				})
			};

			if (folderId !== 'default') {
				// Never trust the user
				return helper.auth.accountFolderMapping(r, accountId, folderId)
				.then(function() {
					return doAddFilter();
				})
				.catch(function(e) {
					return next(new Error('Unspeakable horror.')); // Early surrender: account does not belong to user
				})
			}else{
				return helper.folder.getInternalFolder(r, accountId, 'Inbox')
				.then(function(inboxId) {
					action.folder = inboxId;
					return doAddFilter();
				})
				.catch(function(e) {
					return next(e);
				})
			}
			break;
		case 'delete':
			return r
			.table('filters')
			.get(filterId)
			.run(r.conn)
			.then(function(filter) {
				if (filter === null) {
					return next(new Error('Filter does not exist.'));
				}
				if (filter.accountId !== accountId) {
					return next(new Error('Unspeakable horror.')); // Early surrender: account does not belong to user
				}
				return r
				.table('filters')
				.get(filterId)
				.delete()
				.run(r.conn)
				.then(function() {
					return res.status(200).send();
				})
			})
			.catch(function(e) {
				return next(e);
			});
			break;
		default:
		return next(new Error('Not implemented.'));
		break;
	}
})

router.post('/updateDomain', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var domainId = req.body.domainId;

	if (!!!domainId) {
		return next(new Error('Domain ID Required'));
	}

	var action = req.body.action;

	return r
	.table('domains')
	.get(domainId)
	.run(r.conn)
	.then(function(domain) {
		if (domain === null) {
			throw new Error('Domain does not exist.');
		}
		if (domain.domainAdmin !== userId) {
			throw new Error('Only the domain admin can modify the domain.');
		}
	})
	.then(function() {
		switch (action) {
			case 'updateAlias':

			var alias = req.body.alias;

			// remove whitespace only element, and remove non-fqdn domains
			alias = alias.filter(function(str) {
				return /\S/.test(str) && /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(str);
			});

			return r
			.table('domains')
			.get(domainId)
			.update({
				alias: alias
			})
			.run(r.conn)

			break;

			default:
			throw new Error('Not implemented.');
			break;
		}
	})
	.then(function() {
		return res.status(200).send({message: 'Domain updated.'});
	})
	.catch(function(e) {
		return next(e);
	});

});

var batchMoveToTrashAndRemoveFolder = Promise.method(function(r, fromFolder, trashFolder) {
	return r
	.table('messages')
	.between([fromFolder, r.minval], [fromFolder, r.maxval], {index: 'folderDate'})
	.update({
		folderId: trashFolder
	})
	.run(r.conn)
	.then(function() {
		return r
		.table('folders')
		.get(fromFolder)
		.delete()
		.run(r.conn)
		.then(function(result) {
			return result;
		})
	})
})

var doAddFolder = Promise.method(function(r, data) {
	var id = shortid.generate();
	data.folderId = id;
	return r
	.table('folders')
	.insert(data)
	.run(r.conn)
	.then(function(result) {
		return result;
	})
})

var doUpdateFolder = Promise.method(function(r, folderId, data) {
	return r
	.table('folders')
	.get(folderId)
	.update(data)
	.run(r.conn)
	.then(function(result) {
		return result;
	})
})

var doUpdateMail = Promise.method(function(r, messageId, accountId, data) {
	return helper.auth.messageAccountMapping(r, messageId, accountId)
	.then(function() {
		return r
		.table('messages')
		.get(messageId)
		.update(data)
		.run(r.conn)
		.then(function(result) {
			return result;
		})
	})
})

var parentTest = Promise.method(function(parent) {
	if (noChildrenAllowed.indexOf(parent.displayName.toLowerCase().trim()) !== -1) { // Some folders do not allow children
		throw new Error('Cannot nest under this folder.');
	}else{
		return true;
	}
})

module.exports = router;
