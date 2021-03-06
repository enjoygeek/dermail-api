## dermail-api

Dermail-API the "central hub" of the Dermail system. It:
1. Receives emails from Dermail-MTA
2. Handles mail distribution
3. Handles filtering
4. Serves HTTP API

*Though the HTTP API is not RESTful*

## Authentication

Dermail-API uses two method of authentication:
1. JWT (for user-facing HTTP requests)
2. Symmetric key "remoteSecret" (for internal services)

JWT will be returned by the API after initial login (/__VERSION__/login).
Symmetric key (remoteSecret) needs to be configured beforehand.

## Endpoint version

As of 1.7.0, the endpoint version is arbitrary and is left for future backward compatibility.

## Definition

Say you have an email address "user@domain.com"

"Account" refers to "user",
"Domain" refers to "domain.com", and
"Complete Account" refers to "user@domain.com"

Sometimes "Complete Account" and "Account" are *synonymous*.

## Authentication

**These calls require JWT header:**
- GET /__VERSION__/read/ping (Health Check, also used to check if JWT token is valid)
- GET /__VERSION__/read/s3 (Returns S3 endpoint and bucket)
- GET /__VERSION__/read/getAccounts (Returns a list of Complete Accounts)
- POST /__VERSION__/read/getAccount (Returns a Complete Account)
- POST /__VERSION__/read/getFoldersInAccount (Returns a list of folders in an Account)
- POST /__VERSION__/read/getFolder (Returns a Folder)
- POST /__VERSION__/read/getMailsInFolder (Returns a list of emails in a Folder)
- POST /__VERSION__/read/getUnreadCountInAccount (Returns unread counts of all folders in an account)
- POST /__VERSION__/read/getMail (Returns a Message)
- POST /__VERSION__/read/getAddress (Returns friendlyName of an email address)
- POST /__VERSION__/read/getFilters (Returns a list of Filters of an Account)
- POST /__VERSION__/read/searchWithFilter (Returns a list of Messages which match the criteria)
- POST /__VERSION__/read/searchMailsInAccount (Returns a list of Messages which the content and subject fuzzy-match the query string)
- POST /__VERSION__/write/modifyFilter (Add or delete a Filter)
- POST /__VERSION__/write/updateMail (Star, Read, Folder)
- POST /__VERSION__/write/updateFolder (Add, Edit, Remove, Truncate)
- POST /__VERSION__/write/pushSubscriptions (Web-push notifications)
- POST /__VERSION__/relay/sendMail (Queue email to be sent)

**These calls require remoteSecret:**
- POST /__VERSION__/rx/get-s3 (Returns complete S3 credentials)
- POST /__VERSION__/rx/check-recipient (Check if recipient is in Account list)
- POST /__VERSION__/rx/store (Receives and store email from Dermail-MTA)

**These calls do not require authentication:**
- GET /__VERSION__/read/getPayload (Endpoint for service worker to fetch payload when encrypted payload is not supported)
- GET /__VERSION__/safe/inline/* (Redirects to inline attachments)
- GET /__VERSION__/safe/image/* (Sanitize image requests)
- GET /__VERSION__/safe/href/* (Sanitize link redirects)
- POST /__VERSION__/login (Returns JWT if authenticated)

## Endpoints

`GET /__VERSION__/read/ping`
- pre: none
- post: "pong" is returned in the body

---

`GET /__VERSION__/read/s3`
- pre: none
- post:

```JSON
{
  "endpoint": "ENDPOINT",
  "bucket": "BUCKET"
}
```
---

`GET /__VERSION__/read/getAccounts`
- pre: none
- post: A list of accounts is return

```JSON
[{
	"account": "user",
	"accountId": "UNIQUE_ID",
	"domainId": "UNIQUE_ID",
	"alias": [],
	"domain": "domain.com"
}]
```
---

`POST /__VERSION__/read/getAccount`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID"
}
```

- post: The detail of an Account is returned

```JSON
{
  "account": "user",
  "accountId": "UNIQUE_ID",
  "domain": "domain.com"
}
```
---

`POST /__VERSION__/read/getFoldersInAccount`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID"
}
```

- post: The list of Folders in the Account is returned
	- "parent" field is the folderID of the parent folder; null means it is at the root
	- "count" is the number of unread messages in the Folder

```JSON
[{
	"accountId": "UNIQUE_ID",
	"description": "Main Inbox",
	"displayName": "Inbox",
	"folderId": "UNIQUE_ID",
	"mutable": false,
	"parent": null
}]
```
---

**Pro tips: use this function to build the tree:**

```javascript
function buildTree(list) {
	var idAttr = 'folderId';
	var parentAttr = 'parent';
	var childrenAttr = 'child';
	var root = [];
	var lookup = {};
	list.forEach(function(obj) {
		lookup[obj[idAttr]] = obj;
		obj[childrenAttr] = [];
	});
	list.forEach(function(obj) {
		if (obj[parentAttr] != null) {
			lookup[obj[parentAttr]][childrenAttr].push(obj);
		} else {
			root.push(obj);
		}
	});
	return root;
}
```
---

`POST /__VERSION__/read/getUnreadCountInAccount`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID"
}
```

- post: The unreadCount of all folders in the account is returned

```JSON
[{
	"count": 0,
	"folderId": "UNIQUE_ID"
}]
```
---

`POST /__VERSION__/read/getFolder`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID",
	"folderId": "UNIQUE_ID"
}
```

- post: The detail of a Folder is returned

```JSON
[{
	"accountId": "UNIQUE_ID",
	"count": 0,
	"description": "Main Inbox",
	"displayName": "Inbox",
	"folderId": "UNIQUE_ID",
	"mutable": false,
	"parent": null
}]
```
---

`POST /__VERSION__/read/getMailsInFolder`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID",
	"folderId": "UNIQUE_ID"
}
```

- Optional "slice" object will return messages *after* "slice.date":

```JSON
{
	"accountId": "UNIQUE_ID",
	"folderId": "UNIQUE_ID",
	"slice": {
		"date": "2016-04-28T19:14:24.322Z",
		"perPage": 10
	}
}
```

- post: The Messages in the Folder are returned

```JSON
[{
	"accountId": "UNIQUE_ID",
	"attachments": [],
	"date": "2016-04-28T19:14:24.322Z",
	"folderId": "UNIQUE_ID",
	"from": [{
		"account": "JohnDoe",
		"domain": "domain.com",
		"friendlyName": "John Doe"
	}],
	"isRead": true,
	"isStar": false,
	"messageId": "UNIQUE_ID",
	"subject": "SUBJECT",
	"text": "TEXT",
	"to": [{
		"account": "user",
		"domain": "domain.com",
		"friendlyName": "Jenny Jackson"
	}]
}]
```
---

`POST /__VERSION__/read/getMail`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID",
	"messageId": "UNIQUE_ID"
}
```

- post: The Message is returned

```JSON
{
	"accountId": "UNIQUE_ID",
	"attachments": [],
	"date": "2016-04-28T19:14:24.322Z",
	"folderId": "UNIQUE_ID",
	"from": [{
		"account": "JohnDoe",
		"domain": "domain.com",
		"friendlyName": "John Doe"
	}],
	"headers": {
		"content-type": "multipart/alternative; boundary=\"=-9C2Rh/ZCbrAuupgeVDu8\"",
		"date": "Thu, 28 Apr 2016 19:13:10 +0000",
		"dkim-signature": "",
		"domainkey-signature": "",
		"from": "John Doe <JohnDoe@domain.com>",
		"headerId": "e4bff45b-2d51-4934-ac83-cb0e74de3447",
		"message-id": "",
		"mime-version": "1.0",
		"subject": "SUBJECT",
		"to": "user@domain.com"
	},
	"html": "HTML",
	"isRead": true,
	"isStar": false,
	"messageId": "UNIQUE_ID",
	"subject": "What's new in April  at OVH...",
	"to": [{
		"account": "user",
		"domain": "domain.com",
		"friendlyName": "Jenny Jackson"
	}]
}
```
---

`POST /__VERSION__/read/getAddress`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID",
	"email": "JohnDoe@domain.com"
}
```

- post: The friendlyName associated with the email to this Account

```JSON
{
  "friendlyName": "John Doe"
}
```
---

`POST /__VERSION__/read/getFilters`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID"
}
```

- post: The list of Filters associated with the Account is returned

```JSON
[{
	"accountId": "UNIQUE_ID",
	"filterId": "UNIQUE_ID",
	"post": {
		"doNotNotify": true,
		"folder": {
			"accountId": "UNIQUE_ID",
			"description": "Unsolicited",
			"displayName": "Spam",
			"folderId": "UNIQUE_ID",
			"mutable": false,
			"parent": null
		},
		"markRead": true
	},
	"pre": {
		"contain": ["me", "you", "photos", "english"],
		"exclude": null,
		"from": null,
		"subject": null,
		"to": null
	}
}]
```

- "pre" is the criteria
- "post" is the action
	- "doNotNotify" denotes disable notification for emails that meet the criteria
	- "folder" denotes the destination Folder
	- "markRead" denotes if it should be marked read

---

`POST /__VERSION__/read/searchWithFilter`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID",
	"criteria": {
		"contain": ["me", "you", "photos", "english"],
		"exclude": null,
		"from": null,
		"subject": null,
		"to": null
	}
}
```

- post: The list of Messages that match the criteria associated with the Account

```JSON
[{
	"folder": {
		"accountId": "UNIQUE_ID",
		"description": "Main Inbox",
		"displayName": "Inbox",
		"folderId": "UNIQUE_ID",
		"mutable": false,
		"parent": null
	},
	"messageId": "UNIQUE_ID",
	"subject": "SUBJECT"
}]
```
---

`POST /__VERSION__/read/searchMailsInAccount`
- pre:

```JSON
{
    "accountId": "UNIQUE_ID",
	"searchString": "me"
}
```

- post: The list of Messages that match the criteria associated with the Account

```JSON
[{
	"folderId": "UNIQUE_ID",
	"messageId": "UNIQUE_ID",
	"subject": "SUBJECT"
}]
```
---

`POST /__VERSION__/write/modifyFilter`
- pre:

**TODO**

- post: The list of Messages that match the criteria associated with the Account

**TODO**
---
