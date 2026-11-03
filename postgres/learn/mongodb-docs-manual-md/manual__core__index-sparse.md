> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Sparse Indexes

Sparse indexes in MongoDB differ from [block-level](http://en.wikipedia.org/wiki/Database_index#Sparse_index) sparse indexes in other databases. Sparse indexes only contain entries for documents that have the indexed field, even if the index field contains a null value. The index skips over any document that is missing the indexed field. The index is "sparse" because it does not include all documents of a collection. By contrast, non-sparse indexes contain all documents in a collection, storing null values for those documents that do not contain the indexed field.

**Important:**

[Partial indexes](/docs/manual/core/index-partial#std-label-partial-sparse-index-comparison) can function as sparse indexes, but also support filter expressions for conditions beyond whether a field exists. Use a partial index for greater control if you need precise filtering.

## Create a Sparse Index

To create a sparse index, use the [`db.collection.createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) method with the `sparse` option set to `true`.

For example, the following operation in [`mongosh`](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh) creates a sparse index on the `plot` field of the `movies` collection:

```javascript
db.movies.createIndex( { "plot": 1 }, { sparse: true } )
```

The index does not index documents that do not include the `plot` field.

## Behavior

### Sparse Index and Incomplete Results

If a sparse index would result in an incomplete result set for queries and sort operations, MongoDB will not use that index unless a [`hint()`](/docs/manual/reference/method/cursor.hint#mongodb-method-cursor.hint) explicitly specifies the index. See [Sparse Index On A Collection Cannot Return Complete Results](/docs/manual/core/index-sparse#std-label-sparse-index-incomplete-results) for an example.

If you include a [`hint()`](/docs/manual/reference/method/cursor.hint#mongodb-method-cursor.hint) that specifies a [sparse index](/docs/manual/core/index-sparse#std-label-index-type-sparse) when you perform a [`count()`](/docs/manual/reference/method/cursor.count#mongodb-method-cursor.count) of all documents in a collection (i.e. with an empty query predicate), the sparse index is used even if the sparse index results in an incorrect count.

For example, create a sparse index on the `rated` field on the `movies` collection.

```javascript
db.movies.createIndex( { rated: 1 }, { sparse: true } )
```

If you count the number of documents in the `movies` collection and include a hint that specifies that sparse index, the operation returns only the documents that contain the `rated` field.

```javascript
db.movies.countDocuments( {}, { hint: { rated: 1 } } )
```

To obtain the correct count of the number of documents in the `movies` collection, do not [`hint()`](/docs/manual/reference/method/cursor.hint#mongodb-method-cursor.hint) with a [sparse index](/docs/manual/core/index-sparse#std-label-index-type-sparse) when performing a count of all documents in a collection.

```javascript
db.movies.countDocuments()
```

### Indexes that are Sparse by Default

The following index types are always sparse:

- [2d](/docs/manual/core/indexes/index-types/geospatial/2d#std-label-2d-index)

- [2dsphere (version 2)](/docs/manual/core/indexes/index-types/geospatial/2dsphere#std-label-2dsphere-v2)

- [Text](/docs/manual/core/indexes/index-types/index-text#std-label-index-feature-text)

- [Wildcard](/docs/manual/core/indexes/index-types/index-wildcard#std-label-wildcard-index-core)

### Sparse Compound Indexes

Compound indexes can contain different types of sparse indexes. The combination of index types determines how the compound index matches documents.

This table summarizes the behavior of a compound index that contains different types of sparse indexes:

| Compound Index Components | Compound Index Behavior |
| --- | --- |
| Ascending indexesDescending indexes | Only indexes documents that contain a value for at least one of the keys. |
| Ascending indexesDescending indexes[Geospatial indexes](/docs/manual/geospatial-queries#std-label-index-feature-geospatial) | Only indexes a document when it contains a value for one of the `geospatial` fields. Does not index documents in the ascending or descending indexes. |
| Ascending indexesDescending indexes[Text indexes](/docs/manual/core/indexes/index-types/index-text#std-label-index-feature-text) | Only indexes a document when it matches one of the `text` fields. Does not index documents in the ascending or descending indexes. |

### Sparse and Unique Properties

An index that is both sparse and [unique](/docs/manual/core/index-unique#std-label-index-type-unique) prevents a collection from having documents with duplicate values for a field but allows multiple documents that omit the key.

## Examples

### Create a Sparse Index On A Collection

The following example creates a sparse index on the `password` field:

```javascript
db.users.createIndex( { password: 1 } , { sparse: true } )
```

Then, the following query on the `users` collection uses the sparse index to return the documents that have the `password` field:

```javascript
db.users.find( { password: { $exists: true } } ).sort({ password: 1 }).limit(5)
```

If a document does not contain the `password` field, the query does not return that document.

### Sparse Index On A Collection Cannot Return Complete Results

Consider the `movies` collection where some documents do not have a `plot` field.

The following example creates a sparse index on the `plot` field:

```javascript
db.movies.createIndex( { "plot": 1 }, { sparse: true } )
```

Consider the following query to return **all** documents in the `movies` collection, sorted by the `plot` field:

```javascript
db.movies.find().sort( { plot: -1 } )
```

Even though the sort is by the indexed field, if some documents in the `movies` collection do not have a `plot` field, MongoDB does **not** select the sparse index to fulfill the query in order to return complete results.

To use the sparse index, explicitly specify the index with [`hint()`:](/docs/manual/reference/method/cursor.hint#mongodb-method-cursor.hint)

```javascript
db.movies.find().sort( { plot: -1 } ).hint( { plot: 1 } ).limit(5)
```

This query only returns documents in the `movies` collection that contain the `plot` field.

**See also:**

- [`explain()`](/docs/manual/reference/method/cursor.explain#mongodb-method-cursor.explain)

- [Interpret Explain Plan Results](/docs/manual/tutorial/analyze-query-plan)

### Sparse Index with Unique Constraint

The following operation creates an index with a [unique constraint](/docs/manual/core/index-unique#std-label-index-type-unique) and sparse filter on the `password` field in the `users`:

```javascript
db.users.createIndex( { password: 1 } , { sparse: true, unique: true } )
```

This index permits inserting documents that either have unique values for the `password` field, or don't include a `password` field. For the example documents in the `users` collection, the index permits the following [insert operations:](/docs/manual/tutorial/insert-documents)

```javascript
db.users.insertMany( [
   { "name": "Jon Snow", "email": "jon@gameofthron.es", "password": "$2b$12$newHashedPassword1234567890ABC" },
   { "name": "Sansa Stark", "email": "sansa@gameofthron.es", "password": "$2b$12$anotherNewPassword1234567890DEF" },
   { "name": "Bran Stark", "email": "bran@gameofthron.es" }
] )
```

However, the index doesn't allow inserting documents that have email addresses that already exist in the collection.

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
