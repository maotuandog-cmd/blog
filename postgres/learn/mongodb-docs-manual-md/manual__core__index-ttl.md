> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# TTL Indexes

**Note:**

If you are removing documents to save on storage costs, consider [Online Archive](https://www.mongodb.com/docs/atlas/online-archive/manage-online-archive/) in [MongoDB Atlas](https://www.mongodb.com/cloud). Online Archive automatically archives infrequently accessed data to fully-managed S3 buckets for cost-effective data tiering.

["Time-to-live" (TTL)](/docs/manual/reference/glossary#std-term-TTL) indexes are special single-field indexes that MongoDB can use to automatically remove documents from a collection after a certain amount of time or at a specific clock time. Data expiration is useful for certain types of information like machine generated event data, logs, and session information that only need to persist in a database for a finite amount of time.

You can [create and manage TTL indexes in the UI](/docs/manual/tutorial/expire-data#std-label-expire-data-atlas-ui) for deployments hosted in [MongoDB Atlas.](https://www.mongodb.com/docs/atlas)

## Create a TTL Index

**Warning:**

After you create a TTL index, it might have a very large number of qualifying documents to delete at once. This large workload might cause performance issues on the server. To avoid these issues, plan to create the index during off hours, or delete qualifying documents in batches before you create the index for future documents.

To create a TTL index, use [`createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex). Specify an index field that is either a [date type](/docs/manual/reference/bson-types#std-label-document-bson-type-date) or an array that contains date type values. Use the `expireAfterSeconds` option to specify a TTL value in seconds.

The TTL index `expireAfterSeconds` value must be within `0` and `2147483647` inclusive.

For example, to create a TTL index on the `lastModifiedDate` field of the `eventlog` collection with a TTL value of `3600` seconds, use the following operation in [`mongosh`:](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh)

```javascript
db.eventlog.createIndex(
   { "lastModifiedDate": 1 },
   { expireAfterSeconds: 3600 }
)
```

Starting in MongoDB 7.0, you can create partial TTL indexes on [time series collections](/docs/manual/core/timeseries-collections#std-label-manual-timeseries-landing). These indexes use the collection `timeField` as the key field, and require a [partial filter expression](/docs/manual/core/index-partial#std-label-index-type-partial) on the  `metaField`.

Time series collections include an optional `expireAfterSeconds` field. If you don't set `expireAfterSeconds`, a TTL index with a `partialFilterExpression` lets you set an expiration period for documents that match the filter. If you do set `expireAfterSeconds`, a partial TTL index lets you set a different, shorter expiration period for matching documents. You can only create a `partialFilterExpression` on the `metaField`.

**Important:**

If the `expireAfterSeconds` value of the collection is lower than the `expireAfterSeconds` of the partial TTL index, the collection deletes documents after the shorter time, so the TTL index has no effect.

This weather data time series collection deletes documents after 24 hours:

```javascript
db.createCollection(
   "weather24h",
   {
      timeseries: {
         timeField: "timestamp",
         metaField: "sensor",
         granularity: "hours"
      },
      expireAfterSeconds: 86400
   }
)
```

This TTL index deletes documents from the MongoDB NYC headquarters weather sensor after 1 hour, instead of 24 hours:

```javascript
db.weather24h.createIndex(
  { "timestamp": 1 },
  {
     partialFilterExpression: {
        "sensor": { $eq: "40.761873, -73.984287" }
     },
     expireAfterSeconds: 3600
  }
)
```

## Convert a non-TTL single-field Index into a TTL Index

Starting in MongoDB 5.1, you can add the `expireAfterSeconds` option to an existing single-field index. To change a non-TTL single-field index to a TTL index, use the [`collMod`](/docs/manual/reference/command/collMod#mongodb-dbcommand-dbcmd.collMod) database command:

```javascript
db.runCommand({
  "collMod": <collName>,
  "index": {
    "keyPattern": <keyPattern>,
    "expireAfterSeconds": <number>
  }
})
```

The following example converts a non-TTL single-field index with the pattern `{ "lastModifiedDate": 1 }` into a TTL index:

```javascript
db.runCommand({
  "collMod": "tickets",
  "index": {
    "keyPattern": { "lastModifiedDate": 1 },
    "expireAfterSeconds": 100
  }
})
```

## Change the `expireAfterSeconds` value for a TTL Index

To change the `expireAfterSeconds` value for a TTL Index, use the [`collMod`](/docs/manual/reference/command/collMod#mongodb-dbcommand-dbcmd.collMod) database command:

```javascript
db.runCommand({
  "collMod": <collName>,
  "index": {
    "keyPattern": <keyPattern>,
    "expireAfterSeconds": <number>
  }
})
```

The following example changes the `expireAfterSeconds` value for an index with the pattern `{ "lastModifiedDate": 1 }` on the `tickets` collection:

```javascript
db.runCommand({
  "collMod": "tickets",
  "index": {
    "keyPattern": { "lastModifiedDate": 1 },
    "expireAfterSeconds": 100
  }
})
```

**Important:**

Consider the following before updating the `expireAfterSeconds` parameter of a TTL index:

- Changing the `expireAfterSeconds` parameter **does not** trigger a complete index rebuild. However, reducing the `expireAfterSeconds` value can make many documents eligible for immediate deletion, potentially causing performance issues due to the increased delete operations.

- The recommended approach is to manually delete documents in small batches before updating the TTL index. This helps control the impact on your cluster.

- Deleting many documents can fragment storage files, additionally impacting performance. You may need to run the [compact](/docs/manual/reference/privilege-actions#mongodb-authaction-compact) command on your collection or perform a [Initial Sync](/docs/manual/core/replica-set-sync#std-label-replica-set-initial-sync) to reclaim space and optimize storage.

## Behavior

### Expiration of Data

TTL indexes expire documents after the specified number of seconds has passed since the indexed field value.

If the field is an array, and there are multiple date values in the index, MongoDB uses *lowest* (earliest) date value in the array to calculate the expiration threshold.

For time series collections, TTL indexes also remove a bucket of data when all documents inside it expire. This is equal to the upper timestamp limit of the bucket, plus the `expireAfterSeconds` value. For example, if a bucket covers data up until `2023-03-27T18:29:59Z` and `expireAfterSeconds` is 300, the TTL index expires the bucket after `2023-03-27T18:34:59Z`.

If the indexed field in a document doesn't contain one or more date values, the document will not expire.

If a document does not contain the indexed field, the document will not expire.

### Delete Operations

A background thread in [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) reads the values in the index and removes expired [documents](/docs/manual/reference/glossary#std-term-document) from the collection.

In-progress delete operations performed by the TTL thread appear in [`db.currentOp()`](/docs/manual/reference/method/db.currentOp#mongodb-method-db.currentOp) output. As the TTL thread deletes documents, it increments the [`metrics.ttl.deletedDocuments`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.metrics.ttl.deletedDocuments) server status metric.

Starting in MongoDB 6.1:

- To improve efficiency, MongoDB may batch multiple document deletions together.

- The [`explain`](/docs/manual/reference/command/explain#mongodb-dbcommand-dbcmd.explain) command [results](/docs/manual/reference/explain-results#std-label-explain-results) contain a new `BATCHED_DELETE` stage for batched document deletions.

#### Deletion Process

The TTL background deletion process checks each TTL index for expired documents. For each TTL index, the background process deletes documents until one of the following conditions is met:

- The process deletes 50000 documents from the current index.

- The process spends one second deleting documents from the current index.

- All expired documents are deleted from the current index.

Then, the process moves on to the next index. After the process goes through each TTL index once, the current sub-pass is complete and a new sub-pass begins to check for remaining expired documents. A pass is complete when the TTL monitor has deleted all possible candidate documents from all TTL indexes.

**Important:**

The TTL deletion process is a single-threaded background task, meaning that TTL deletions are not concurrent and may take longer under heavy workloads or when processing a large amount of expired documents.

Additionally, the process stops the current deletion loop every 60 seconds to prevent spending too much time on a single large delete. When this happens, the current sub-pass ends and a new sub-pass begins.

Passes and sub-passes are tracked in the [`metrics.ttl.passes`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.metrics.ttl.passes) and [`metrics.ttl.subPasses`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.metrics.ttl.subPasses) server status metrics, respectively.

#### Timing of the Delete Operation

MongoDB begins removing expired documents or time series buckets as soon as the index finishes building on the [primary](/docs/manual/reference/glossary#std-term-primary). For more information on the index build process, see [Index Builds on Populated Collections.](/docs/manual/core/index-creation#std-label-index-operations)

The TTL index does not guarantee that expired data is deleted immediately upon expiration. There may be a delay between the time that a document expires and the time that MongoDB removes the document from the database.

The background task that removes expired documents runs *every 60
seconds*. As a result, documents may remain in a collection during the period between the expiration of the document and the running of the background task. MongoDB starts deleting documents 0 to 60 seconds after the index completes.

Because the duration of the removal operation depends on the workload of your [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instance, expired data may exist for some time *beyond* the 60 second period between runs of the background task.

The delete operations initiated by the TTL task run in the foreground, like other deletes.

#### Replica Sets

On [replica set](/docs/manual/reference/glossary#std-term-replica-set) members, the TTL background thread *only* deletes documents when a member is in state [primary](/docs/manual/reference/glossary#std-term-primary). The TTL background thread is idle when a member is in state [secondary](/docs/manual/reference/glossary#std-term-secondary). [Secondary](/docs/manual/reference/glossary#std-term-secondary) members replicate deletion operations from the primary.

### Support for Queries

A TTL index supports queries in the same way non-TTL indexes do.

### mongod in Standalone Mode

The TTL monitor stops when `mongod` runs in standalone mode and the `system.local.replset` collection contains data.

## TTL and Schema validation

Even though TTL indexes do not require schema validation, using validation can help ensure consistent behavior by standardizing the existence and format of the date field used for expiration.

For example, you can use schema validation to enforce the presence of a `lastModifiedDate` field and ensure its value adheres to a valid date format:

```javascript
db.createCollection(
   "eventlog",
   {
      validator: {
         $jsonSchema: {
            bsonType: "object",
            required: [ "lastModifiedDate" ],
            properties: {
               lastModifiedDate: {
                  bsonType: "date",
                  description: "Must be a valid date."
               }
            }
         }
      }
   }
)
```

The validation ensures:

- Every document in the `eventlog` collection includes the `lastModifiedDate` field.

- The `lastModifiedDate` field contains a valid date value.

**See also:**

[Schema Validation.](/docs/manual/core/schema-validation#std-label-schema-validation-document)

## Restrictions

- TTL indexes are single-field indexes. [Compound indexes](/docs/manual/core/indexes/index-types/index-compound#std-label-index-type-compound) do not support TTL and ignore the `expireAfterSeconds` option.

- The `_id` field does not support TTL indexes.

- Starting in MongoDB 7.0, you can create a [partial TTL index](/docs/manual/core/index-partial#std-label-partial-ttl-indexes) on a [time series collection](/docs/manual/core/timeseries-collections#std-label-manual-timeseries-landing)'s `metaField`. In earlier MongoDB versions, you can only create a TTL index for a time series collection's `timeField`.

- You cannot use [`createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) to change the value of `expireAfterSeconds` of an existing index. Instead, use the [`collMod`](/docs/manual/reference/command/collMod#mongodb-dbcommand-dbcmd.collMod) database command. For details, see [Change the `expireAfterSeconds` value for a TTL Index.](/docs/manual/core/index-ttl#std-label-change-ttl-expireafterseconds-value)

- If a non-TTL single-field index already exists for a field, you cannot create a TTL index on the same field because you cannot create indexes that have the same key specification and differ only by the options. To [change a non-TTL single-field index to a TTL index](/docs/manual/core/index-ttl#std-label-convert-non-ttl-single-field-index-into-ttl), use the [`collMod`](/docs/manual/reference/command/collMod#mongodb-dbcommand-dbcmd.collMod) database command.
