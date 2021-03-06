var self = module.exports = {
    getLastTrainedMailWasSavedOn: function(r) {
        return r.table('bayesStore')
        .get('lastTrainedMailWasSavedOn')
        .run(r.conn)
        .then(function(last) {
            if (last === null) {
                return null;
            }
            return last.value;
        })
        .catch(function(e) {
            return null;
        })
    },
    getOwnAddresses: function(r) {
        return r.table('accounts')
        .concatMap(function(z) {
            return r.branch(z.hasFields('addresses'), z('addresses')('address'), [])
        })
        .run(r.conn)
        .then(function(cursor) {
            return cursor.toArray();
        })
        .then(function(addresses) {
            return addresses.map(function(addr) {
                return addr.toLowerCase();
            })
        })
    },
    acquireLock: function(r, timestamp) {
        return r.table('bayesStore')
        .insert({
            key: 'trainLock',
            value: typeof timestamp === 'undefined' ? true : timestamp
        }, {
            conflict: 'error'
        })
        .run(r.conn)
        .then(function(result) {
            if (result.errors > 0) return false;
            return true;
        })
        .catch(function(e) {
            return false;
        })
    },
    releaseLock: function(r) {
        return r.table('bayesStore')
        .get('trainLock')
        .delete()
        .run(r.conn)
        .then(function(result) {
            if (result.errors > 0) return false;
            return true;
        })
        .catch(function(e) {
            return false;
        })
    },
    dne: function(r, userId) {
        return require('./notification').sendAlert(r, userId, 'error', 'Filter needs to be trained initially.')
    }
}
