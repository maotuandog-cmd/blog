> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Unique Indexes

A unique index ensures that the indexed fields do not store duplicate values, and that a value appears at most once for a given field. A unique compound index ensures that any given combination of the index key values appears at most once. By default, MongoDB creates a unique index on the [\_id](/docs/manual/core/document#std-label-document-id-field) field during the creation of a collection.

You can [create and manage unique indexes in the UI](https://www.mongodb.com/docs/atlas/atlas-ui/indexes/) for deployments hosted in [MongoDB Atlas.](https://www.mongodb.com/docs/atlas)

## Create a Unique Index

To create a unique index, use the [`db.collection.createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) method with the `unique` option set to `true`.

```javascript
db.collection.createIndex( <key and index type specification>, { unique: true } )
```

### Unique Index on a Single Field

For example, to create a unique index on the `email` field of the `users` collection, use the following operation in [`mongosh`:](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh)

```javascript
db.users.createIndex( { "email": 1 }, { unique: true } )
```

### Unique Compound Index

You can also enforce a unique constraint on the combination of index key values for a [compound index.](/docs/manual/core/indexes/index-types/index-compound#std-label-index-type-compound)

For example, to create a unique index on `name`, `email`, and `password` fields of the `users` collection, use the following operation in [`mongosh`:](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh)

```javascript
db.users.createIndex( { name: 1, email: 1, password: 1 }, { unique: true } )
```

Create a unique compound [multikey](/docs/manual/core/indexes/index-types/index-multikey#std-label-index-type-multikey) index on `email` and `name`:

```javascript
db.users.createIndex( { "email": 1, "name": 1 }, { unique: true } )
```

The unique index permits the insertion of the following documents into the collection since the index enforces uniqueness for the *combination* of `email` and `name` values:

```javascript
db.users.insertMany( [
   { name: "Catelyn Stark", email: [ "catelyn@gameofthron.es", "sean_bean@gameofthron.es" ], password: "$2b$12$hash2" },
   { name: "Arya Stark", email: [ "catelyn@gameofthron.es" ], password: "$2b$12$hash3" }
] )
```

Even though both documents have `"catelyn@gameofthron.es"` in their `email` arrays, the operation succeeds because the *combination* of each email value with the `name` field is unique.

**See also:**

- [Unique Constraint Across Separate Documents](/docs/manual/core/index-unique#std-label-unique-separate-documents)

- [Missing Document Field in a Unique Single-Field Index](/docs/manual/core/index-unique#std-label-unique-index-and-missing-field)

## Behavior

### Restrictions

MongoDB cannot create a [unique index](/docs/manual/core/index-unique#std-label-index-type-unique) on the specified index field(s) if the collection already contains data that would violate the unique constraint for the index.

You cannot specify a unique constraint on a [hashed index.](/docs/manual/core/indexes/index-types/index-hashed#std-label-index-type-hashed)

### Building Unique Index on Replica Sets and Sharded Clusters

For replica sets and sharded clusters, using a [rolling procedure](/docs/manual/tutorial/build-indexes-on-replica-sets#std-label-index-build-on-replica-sets) to create a unique index requires that you stop all writes to the collection during the procedure. If you cannot stop all writes to the collection during the procedure, do not use the rolling procedure. Instead, to build your unique index on the collection you must either:

- Run `db.collection.createIndex()` on the primary for a replica set

- Run `db.collection.createIndex()` on the [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) for a sharded cluster

### Unique Constraint Across Separate Documents

The unique index prevents different documents in the collection from having the same value for the indexed key.

Because the constraint applies to separate documents, for a unique [multikey](/docs/manual/core/indexes/index-types/index-multikey#std-label-index-type-multikey) index, a document may have array elements that result in repeating index key values as long as the index key values for that document do not duplicate those of another document. In this case, the repeated index entry is inserted into the index only once.

For example, create a unique compound multikey index on `email` and `name`:

```javascript
db.users.createIndex( { "email": 1, "name": 1 }, { unique: true } )
```

The unique index permits the insertion of the following document into the collection if no other document in the collection has an index key value of `{ "email": "arya@winterfell.com", "name": null }`.

```javascript
db.users.insertOne( { _id: ObjectId("59b99db4cfa9a34dcd7885b9"), email: [ "arya@winterfell.com", "arya@gameofthron.es" ] } )

```

### Missing Document Field in a Unique Single-Field Index

If a document has a `null` or missing value for the indexed field in a unique single-field index, the index stores a `null` value for that document. Because of the unique constraint, a single-field unique index can only contain one document that contains a `null` value in its index entry. If there is more than one document with a `null` value in its index entry, the index build fails with a duplicate key error.

For example, a collection has a unique single-field index on `email`:

```javascript
db.users.createIndex( { "email": 1 }, { unique: true } )
```

The unique index allows the insertion of a document without the `email` field if the collection does not already contain a document missing the `email` field:

```javascript
db.users.insertOne( { name: "Arya Stark" } )
```

However, you cannot insert a second document without the `email` field if the collection already contains a document missing the `email` field. A second operation that attempts to insert another document without the `email` field fails to insert the document because of the violation of the unique constraint on `email` field.

### Unique Partial Indexes

If you use both the `partialFilterExpression` and a unique constraint, the unique constraint only applies to documents that meet the filter expression. For an example, see [Partial Index with Unique Constraint.](/docs/manual/core/index-partial#std-label-partial-index-with-unique-constraints)

### Sharded Clusters and Unique Indexes

You cannot specify a unique constraint on a [hashed index.](/docs/manual/core/indexes/index-types/index-hashed#std-label-index-type-hashed)

For a ranged sharded collection, only the following indexes can be [unique:](/docs/manual/core/index-unique#std-label-index-type-unique)

- the index on the shard key

- a [compound index](/docs/manual/reference/glossary#std-term-compound-index) where the shard key is a [prefix](/docs/manual/core/indexes/index-types/index-compound#std-label-compound-index-prefix)

- The default `_id` index; however, the `_id` index only enforces the uniqueness constraint **per shard** if the `_id` field is not the shard key.

Additionally, if there is a collation on the index key, you can only ensure uniqueness if the collation is simple.

**Important:**

Sharded clusters do not enforce the uniqueness constraint on `_id` fields across the cluster when the `_id` field is not the shard key.

If the `_id` field is not the shard key, the uniqueness constraint only applies to the shard that stores the document. This means that two or more documents can have the same `_id` value, provided they occur on different shards.

For example, consider a sharded collection with shard key `{x:
    1}` that spans two shards A and B. Because the `_id` key is not the shard key, the collection could have a document with `_id` value `1` in shard A and another document with `_id` value `1` in shard B.

In cases where the `_id` field is not the shard key, MongoDB expects applications to ensure the uniqueness of `_id` values across the shards, for example, by using a unique identifier to populate the `_id` field.

The unique index constraints mean that:

- For a to-be-sharded collection, you cannot shard the collection if the collection has multiple unique indexes unless the shard key is the prefix for all the unique indexes.

- For an already-sharded collection, you cannot create unique indexes on other fields unless the shard key is included as the prefix.

- A unique index stores a null value for a document missing the indexed field; that is a missing index field is treated as another instance of a `null` index key value. For more information, see [Missing Document Field in a Unique Single-Field Index.](/docs/manual/core/index-unique#std-label-unique-index-and-missing-field)

To maintain uniqueness on a field that is not your shard key, see [Unique Constraints on Arbitrary Fields.](/docs/manual/tutorial/unique-constraints-on-arbitrary-fields#std-label-shard-key-arbitrary-uniqueness)

### Sparse and Non-Sparse Unique Indexes

Starting in MongoDB 5.0, [unique sparse](/docs/manual/core/index-sparse#std-label-sparse-unique-index) and [unique non-sparse](/docs/manual/core/indexes/index-properties#std-label-unique-index) indexes with the same [key pattern](/docs/manual/reference/method/db.collection.createIndexes#std-label-key_patterns) can exist on a single collection.

#### Unique and Sparse Index Creation

This example creates multiple indexes with the same key pattern and different `sparse` options:

```javascript
db.users.createIndex( { password : 1 }, { name: "unique_index", unique: true } )
```

```javascript
db.users.createIndex( { password : 1 }, { name: "unique_sparse_index", unique: true, sparse: true } )
```

#### Basic and Sparse Index Creation

You can also create basic indexes with the same key pattern with and without the sparse option:

```javascript
db.users.createIndex( { password : 1 }, { name: "sparse_index", sparse: true } )
```

```javascript
db.users.createIndex( { password : 1 }, { name: "basic_index" } )
```

### Basic and Unique Indexes With Duplicate Key Patterns

Basic and unique indexes can exist with the same [key pattern.](/docs/manual/reference/method/db.collection.createIndexes#std-label-key_patterns)

For example, you can create both of the following indexes that use the same key pattern:

```javascript
db.users.createIndex( { email : 1 }, { name: "basic_index" } )
```

```javascript
db.users.createIndex( { email : 1 }, { name: "unique_index", unique: true } )
```
