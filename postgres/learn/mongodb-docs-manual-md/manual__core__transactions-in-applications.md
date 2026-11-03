> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

<!--
Tab options on this page. Append to the .md URL to filter:
  ?tabs=<id,...>   select specific tabs (e.g. ?tabs=nodejs,shell)
  ?allTabs=true    include every tab
  (no param)       default: one tab per tabset

Available tabs:
  drivers: c, cpp, csharp, go, java-sync, motor, nodejs, perl, php, python, ruby, scala
-->

# Drivers API

## Callback API vs Core API

The [Callback API:](/docs/manual/core/transactions-in-applications#std-label-txn-callback-api)

- Starts a transaction, executes the specified operations, and commits (or aborts on error).

- Automatically incorporates error handling logic for [`TransientTransactionError`](/docs/manual/core/transactions-in-applications#std-label-transient-transaction-error) and [`UnknownTransactionCommitResult`.](/docs/manual/core/transactions-in-applications#std-label-unknown-transaction-commit-result)

The [Core API:](/docs/manual/core/transactions-in-applications#std-label-txn-core-api)

- Requires explicit call to start the transaction and commit the transaction.

- Does not incorporate error handling logic for [`TransientTransactionError`](/docs/manual/core/transactions-in-applications#std-label-transient-transaction-error) and [`UnknownTransactionCommitResult`](/docs/manual/core/transactions-in-applications#std-label-unknown-transaction-commit-result), and instead provides the flexibility to incorporate custom error handling for these errors.

## Callback API

The callback API incorporates logic:

- To retry the transaction as a whole if the transaction encounters a [`TransientTransactionError`](/docs/manual/core/transactions-in-applications#std-label-transient-transaction-error) error.

- To retry the commit operation if the commit encounters an [`UnknownTransactionCommitResult`](/docs/manual/core/transactions-in-applications#std-label-unknown-transaction-commit-result) error.

Starting in MongoDB 6.2, the server does not retry the transaction if it receives a [`TransactionTooLargeForCache`](/docs/manual/core/transactions-in-applications#std-label-transactionTooLargeForCache-error) error.

### Example

***

➤ Use the **Select your language** drop-down menu in the upper-right to set the language of the examples on this page.

***

### Node.js

**Important:**

- Use the MongoDB driver for your MongoDB version.

- When using drivers, each operation in the transaction must pass the session to each operation.

- Operations in a transaction use [transaction-level read concern](/docs/manual/core/transactions#std-label-transactions-read-concern), [transaction-level write concern](/docs/manual/core/transactions#std-label-transactions-write-concern), and [transaction-level read preference.](/docs/manual/core/transactions#std-label-transactions-read-preference)

- You can create collections in transactions implicitly or explicitly. See [Create Collections and Indexes in a Transaction.](/docs/manual/core/transactions#std-label-transactions-create-collections-indexes)

The example uses the new callback API for working with transactions, which starts a transaction, executes the specified operations, and commits (or aborts on error). The new callback API incorporates retry logic for [`TransientTransactionError`](/docs/manual/core/transactions-in-applications#std-label-transient-transaction-error) or [`UnknownTransactionCommitResult`](/docs/manual/core/transactions-in-applications#std-label-unknown-transaction-commit-result) commit errors.

```javascript

  // For a replica set, include the replica set name and a seedlist of the members in the URI string; e.g.
  // const uri = 'mongodb://mongodb0.example.com:27017,mongodb1.example.com:27017/?replicaSet=myRepl'
  // For a sharded cluster, connect to the mongos instances; e.g.
  // const uri = 'mongodb://mongos0.example.com:27017,mongos1.example.com:27017/'

  const client = new MongoClient(uri);
  await client.connect();

  // Prereq: Create collections.

  await client
    .db('mydb1')
    .collection('foo')
    .insertOne({ abc: 0 }, { writeConcern: { w: 'majority' } });

  await client
    .db('mydb2')
    .collection('bar')
    .insertOne({ xyz: 0 }, { writeConcern: { w: 'majority' } });

  // Step 1: Start a Client Session
  const session = client.startSession();

  // Step 2: Optional. Define options to use for the transaction
  const transactionOptions = {
    readPreference: 'primary',
    readConcern: { level: 'local' },
    writeConcern: { w: 'majority' }
  };

  // Step 3: Use withTransaction to start a transaction, execute the callback, and commit (or abort on error)
  // Note: The callback for withTransaction MUST be async and/or return a Promise.
  try {
    await session.withTransaction(async () => {
      const coll1 = client.db('mydb1').collection('foo');
      const coll2 = client.db('mydb2').collection('bar');

      // Important:: You must pass the session to the operations

      await coll1.insertOne({ abc: 1 }, { session });
      await coll2.insertOne({ xyz: 999 }, { session });
    }, transactionOptions);
  } finally {
    await session.endSession();
    await client.close();
  }
```

## Core API

The core transaction API does not incorporate retry logic for errors labeled:

- [`TransientTransactionError`](/docs/manual/core/transactions-in-applications#std-label-transient-transaction-error). If an operation in a transaction returns an error labeled [`TransientTransactionError`](/docs/manual/core/transactions-in-applications#std-label-transient-transaction-error), the transaction as a whole can be retried.

  To handle [`TransientTransactionError`](/docs/manual/core/transactions-in-applications#std-label-transient-transaction-error), applications should explicitly incorporate retry logic for the error.

- [`UnknownTransactionCommitResult`](/docs/manual/core/transactions-in-applications#std-label-unknown-transaction-commit-result). If the commit returns an error labeled [`UnknownTransactionCommitResult`](/docs/manual/core/transactions-in-applications#std-label-unknown-transaction-commit-result), the commit can be retried.

  To handle [`UnknownTransactionCommitResult`](/docs/manual/core/transactions-in-applications#std-label-unknown-transaction-commit-result), applications should explicitly incorporate retry logic for the error.

### Example

***

➤ Use the **Select your language** drop-down menu in the upper-right to set the language of the examples on this page.

***

The following example incorporates logic to retry the transaction for transient errors and retry the commit for unknown commit error:

### Node.js

**Important:**

To associate read and write operations with a transaction, you **must** pass the session to each operation in the transaction.

```javascript
async function commitWithRetry(session) {
  try {
    await session.commitTransaction();
    console.log('Transaction committed.');
  } catch (error) {
    if (error.hasErrorLabel('UnknownTransactionCommitResult')) {
      console.log('UnknownTransactionCommitResult, retrying commit operation ...');
      await commitWithRetry(session);
    } else {
      console.log('Error during commit ...');
      throw error;
    }
  }
}

async function runTransactionWithRetry(txnFunc, client, session) {
  try {
    await txnFunc(client, session);
  } catch (error) {
    console.log('Transaction aborted. Caught exception during transaction.');

    // If transient error, retry the whole transaction
    if (error.hasErrorLabel('TransientTransactionError')) {
      console.log('TransientTransactionError, retrying transaction ...');
      await runTransactionWithRetry(txnFunc, client, session);
    } else {
      throw error;
    }
  }
}

async function updateEmployeeInfo(client, session) {
  session.startTransaction({
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
    readPreference: 'primary'
  });

  const employeesCollection = client.db('hr').collection('employees');
  const eventsCollection = client.db('reporting').collection('events');

  await employeesCollection.updateOne(
    { employee: 3 },
    { $set: { status: 'Inactive' } },
    { session }
  );
  await eventsCollection.insertOne(
    {
      employee: 3,
      status: { new: 'Inactive', old: 'Active' }
    },
    { session }
  );

  try {
    await commitWithRetry(session);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  }
}

return client.withSession(session =>
  runTransactionWithRetry(updateEmployeeInfo, client, session)
);
```

## Driver Versions

- [C 1.15.0](http://mongoc.org/libmongoc/)

- [C# 2.9.0](https://mongodb.github.io/mongo-csharp-driver/)

- [Go 1.1](https://godoc.org/go.mongodb.org/mongo-driver/mongo)

- [Java 3.11.0](https://mongodb.github.io/mongo-java-driver/)

- [Node 3.3.0](https://mongodb.github.io/node-mongodb-native/)

- [Perl 2.2.0](https://metacpan.org/author/MONGODB)

- [Python](https://pymongo.readthedocs.io/en/stable/index.html)

- [Ruby 2.10.0](https://www.mongodb.com/docs/ruby-driver/current/)

- [Scala 2.7.0](https://mongodb.github.io/mongo-scala-driver/)

## Transaction Error Handling

Regardless of the database system, whether MongoDB or relational databases, applications should take measures to handle errors during transaction commits and incorporate retry logic for transactions.

### `TransientTransactionError`

The *individual* write operations inside the transaction are not retryable, regardless of the value of [`retryWrites`](/docs/manual/reference/connection-string-options#mongodb-urioption-urioption.retryWrites). If an operation encounters an error [associated with the label](https://github.com/mongodb/specifications/blob/master/source/transactions/transactions.rst#error-labels) `"TransientTransactionError"`, such as when the primary steps down, the transaction as a whole can be retried.

- The callback API incorporates retry logic for `"TransientTransactionError"`.

- The core transaction API does not incorporate retry logic for `"TransientTransactionError"`. To handle `"TransientTransactionError"`, applications should explicitly incorporate retry logic for the error. To view an example that incorporates retry logic for transient errors, see [Core API Example.](/docs/manual/core/transactions-in-applications#std-label-txn-core-api-retry)

### `UnknownTransactionCommitResult`

Commit operations are [retryable write operations](/docs/manual/core/retryable-writes#std-label-retryable-writes). If the commit operation encounters an error, MongoDB drivers retry the commit regardless of the value of [`retryWrites`.](/docs/manual/reference/connection-string-options#mongodb-urioption-urioption.retryWrites)

If the commit operation encounters an error labeled `"UnknownTransactionCommitResult"`, the commit can be retried.

- The callback API incorporates retry logic for `"UnknownTransactionCommitResult"`.

- The core transaction API does not incorporate retry logic for `"UnknownTransactionCommitResult"`. To handle `"UnknownTransactionCommitResult"`, applications should explicitly incorporate retry logic for the error. To view an example that incorporates retry logic for unknown commit errors, see [Core API Example.](/docs/manual/core/transactions-in-applications#std-label-txn-core-api-retry)

### `TransactionTooLargeForCache`

**New in version 6.2**

Starting in MongoDB 6.2, the server does not retry the transaction if it receives a `TransactionTooLargeForCache` error. This error means the cache is too small and a retry is likely to fail.

The default value for the [`transactionTooLargeForCacheThreshold`](/docs/manual/reference/parameters#mongodb-parameter-param.transactionTooLargeForCacheThreshold) threshold is `0.75`. The server returns `TransactionTooLargeForCache` instead of retrying the transaction when the transaction uses more than 75% of the cache.

In earlier versions of MongoDB, the server returns `TemporarilyUnavailable` or `WriteConflict` instead of `TransactionTooLargeForCache`.

Use the [`setParameter`](/docs/manual/reference/command/setParameter#mongodb-dbcommand-dbcmd.setParameter) command to modify the error threshold.

## Additional Information

### `mongosh` Example

The following [`mongosh`](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh) methods are available for transactions:

- [`Session.startTransaction()`](/docs/manual/reference/method/Session.startTransaction#mongodb-method-Session.startTransaction)

- [`Session.commitTransaction()`](/docs/manual/reference/method/Session.commitTransaction#mongodb-method-Session.commitTransaction)

- [`Session.abortTransaction()`](/docs/manual/reference/method/Session.abortTransaction#mongodb-method-Session.abortTransaction)

**Note:**

The [`mongosh`](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh) example omits retry logic and robust error handling for simplicity's sake. For a more practical example of incorporating transactions in applications, see [Transaction Error Handling](/docs/manual/core/transactions-in-applications#std-label-transactions-retry) instead.

```javascript
// Create collections:
db.getSiblingDB("mydb1").foo.insertOne(
    {abc: 0},
    { writeConcern: { w: "majority", wtimeout: 2000 } }
)
db.getSiblingDB("mydb2").bar.insertOne(
   {xyz: 0},
   { writeConcern: { w: "majority", wtimeout: 2000 } }
)

// Start a session.
session = db.getMongo().startSession( { readPreference: { mode: "primary" } } );

coll1 = session.getDatabase("mydb1").foo;
coll2 = session.getDatabase("mydb2").bar;

// Start a transaction
session.startTransaction( { readConcern: { level: "local" }, writeConcern: { w: "majority" } } );

// Operations inside the transaction
try {
   coll1.insertOne( { abc: 1 } );
   coll2.insertOne( { xyz: 999 } );
} catch (error) {
   // Abort transaction on error
   session.abortTransaction();
   throw error;
}

// Commit the transaction using write concern set at transaction start
session.commitTransaction();

session.endSession();
```
