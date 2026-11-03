> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Partial Indexes

Partial indexes only index the documents in a collection that meet a specified filter expression. Partial indexes have lower storage requirements and reduced performance costs for index creation and maintenance.

## Create a Partial Index

To create a `partial` index, use the [`db.collection.createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) method with the `partialFilterExpression` option. The `partialFilterExpression` option accepts a document that specifies the filter condition using:

- equality expressions (i.e. `field: value` or using the [`$eq`](/docs/manual/reference/operator/query/eq#mongodb-query-op.-eq) operator)

- [`$exists: true`](/docs/manual/reference/operator/query/exists#mongodb-query-op.-exists) expression

- [`$gt`](/docs/manual/reference/operator/query/gt#mongodb-query-op.-gt), [`$gte`](/docs/manual/reference/operator/query/gte#mongodb-query-op.-gte), [`$lt`](/docs/manual/reference/operator/query/lt#mongodb-query-op.-lt), [`$lte`](/docs/manual/reference/operator/query/lte#mongodb-query-op.-lte) expressions

- [`$type`](/docs/manual/reference/operator/query/type#mongodb-query-op.-type) expressions

- [`$and`](/docs/manual/reference/operator/query/and#mongodb-query-op.-and) operator

- [`$or`](/docs/manual/reference/operator/query/or#mongodb-query-op.-or) operator

- [`$in`](/docs/manual/reference/operator/query/in#mongodb-query-op.-in) operator

- [`$geoWithin`](/docs/manual/reference/operator/query/geoWithin#mongodb-query-op.-geoWithin) operator

- [`$geoIntersects`](/docs/manual/reference/operator/query/geoIntersects#mongodb-query-op.-geoIntersects) operator

For example, the following operation creates a compound index that indexes only the documents where the `genre` field is `Drama`:

```javascript
db.movies.createIndex(
   { title: 1 },
   { partialFilterExpression: { genres: "Drama" } }
)
```

You can specify a `partialFilterExpression` option for all MongoDB [index types](/docs/manual/core/indexes/index-types#std-label-index-types). When specifying a `partialFilterExpression` for a TTL index on a time series collection, you can only filter on the collection `metaField`.

**See also:**

To learn how to manage indexes in MongoDB Compass, see [Manage Indexes.](/docs/manual/tutorial/manage-indexes#std-label-manage-indexes)

## Behavior

### Query Coverage

MongoDB does not use the partial index for a query or sort operation if using the index results in an incomplete result set.

To use the partial index, a query must contain the filter expression (or a modified filter expression that specifies a subset of the filter expression) as part of its query condition.

For example, given the following index:

```javascript
db.users.createIndex(
   { name: 1 },
   { partialFilterExpression: { password: { $exists: true } } }
)
```

The following query can use the index since the query predicate includes the condition `password: { $exists: true }` that matches documents matched by the index filter expression `password: { $exists: true
}`:

```javascript
db.users.find( { name: "Ned Stark", password: { $exists: true } } )
```

However, the following query cannot use the partial index on the `name` field because using the index results in an incomplete result set. Specifically, the query predicate includes the condition `password: { $exists: false }` while the index has the filter `password: { $exists:
true }`. That is, the query `{ name: "Ned Stark", password: { $exists: false }
}` matches more documents (users without passwords) than the index covers.

```javascript
db.users.find( { name: "Ned Stark", password: { $exists: false } } )
```

Similarly, the following query cannot use the partial index because the query predicate does not include the filter expression and using the index would return an incomplete result set.

```javascript
db.users.find( { name: "Ned Stark" } )
```

### Comparison with Sparse Indexes

Use partial indexes instead of [sparse indexes](/docs/manual/core/index-sparse#std-label-index-type-sparse) for more precise control over which documents to index:

- Sparse indexes include or exclude documents *solely* based on the presence of the indexed field (or multiple fields, for sparse compound indexes).

- Partial indexes include or exclude documents based on the filter expression. The expression can include fields other than index keys, and can specify conditions other than a field existing.

For example, a partial index can implement the same behavior as a sparse index. This partial index supports the same queries as a sparse index on the `name` field:

```javascript
db.users.createIndex(
   { name: 1 },
   { partialFilterExpression: { name: { $exists: true } } }
)
```

However, a partial index can also filter on fields other than the index key. For example, a partial index on the `name` field can check for the existence of the `email` field:

```javascript
db.users.createIndex(
   { name: 1 },
   { partialFilterExpression: { email: { $exists: true } } }
)

```

For the query optimizer to choose this partial index, the query predicate must include a condition on the `name` field as well as a *non-null* match on the `email` field.

For example, the following query can use the index because it includes both a condition on the `name` field and a non-null match on the `email` field:

```javascript
db.users.find( { name: "Ned Stark", email: { $regex: /gameofthron\.es$/ } } )
```

However, the following query cannot use the index because it includes a null match on the `email` field, which is not permitted by the filter expression `{ email: { $exists: true } }`:

```javascript
db.users.find( { name: "Ned Stark", email: { $exists: false } } )
```

### Partial TTL Indexes

Partial indexes can also be TTL indexes. Partial TTL indexes match the specified filter expression and expire only those documents. For details, see [Expire Documents with Filter Conditions.](/docs/manual/tutorial/expire-data#std-label-partial-ttl-index-example)

## Restrictions

- You cannot specify both the `partialFilterExpression` option and the `sparse` option.

- `_id` indexes cannot be partial indexes.

- Shard key indexes cannot be partial indexes.

- If you are using [Client-Side Field Level Encryption](/docs/manual/core/csfle#std-label-manual-csfle-feature) or [Queryable Encryption](/docs/manual/core/queryable-encryption#std-label-qe-manual-feature-qe), a `partialFilterExpression` cannot reference an encrypted field.

### Equivalent Indexes

Starting in MongoDB 7.3, you cannot create equivalent indexes, which are partial indexes with the same index keys and the same partial expressions that use a [collation.](/docs/manual/reference/collation#std-label-collation)

For databases in MongoDB 7.3 with existing equivalent indexes, the indexes are retained but only the first equivalent index is used in queries. This is the same behavior as MongoDB versions earlier than 7.3.

For example, you can't create two indexes that only differ in the text case in the partial filter expression.

## Examples

The examples on this page use data from the [sample\_mflix sample dataset](/docs/manual/sample-data/sample-mflix#std-label-sample-mflix). For details on how to load this dataset into your self-managed MongoDB deployment, see [Load the sample dataset](/docs/manual/sample-data/load-sample-data-local#std-label-sample-dataset-local). If you made any modifications to the sample databases, you may need to drop and recreate the databases to run the examples on this page.

### Create a Partial Index On A Collection

The following example adds a partial index on the `title` and `genres` fields. The operation only indexes documents where the `rating` field is `PG`:

```javascript
db.movies.createIndex(
   { title: 1, genres: 1 },
   { partialFilterExpression: { rated: "PG" } }
)
```

The following query on the `movies` collection uses the partial index to return the writers of the all movies titled "The Three Musketeers":

```javascript
db.movies.find( { title: "The Three Musketeers", genres: ["Action", "Adventure", "Comedy"], rated: "PG" }, { writers: 1 } )
```

However, the following query cannot use the partial index because the query predicate does not include the `rating` filter:

```javascript
db.movies.find( { genres: "Drama" }, { title: 1 } ).limit(5)
```

### Partial Index with Unique Constraint

Partial indexes only index the documents in a collection that meet a specified filter expression. If you specify both the `partialFilterExpression` and a [unique constraint](/docs/manual/core/index-unique#std-label-index-type-unique), the unique constraint only applies to the documents that meet the filter expression. A partial index with a unique constraint does not prevent the insertion of documents that do not meet the unique constraint if the documents do not meet the filter criteria.

The following operation on the `users` collection creates an index that specifies a [unique constraint](/docs/manual/core/index-unique#std-label-index-type-unique) on the `email` field and a partial filter expression `password: { $exists: true }`.

```javascript
db.users.createIndex(
   { name: 1 },
   { name: "name_partial_unique_idx", unique: true, partialFilterExpression: { password: { $exists: true } } }
)
```

The index prevents the insertion of documents that have both an email address that already exists in the collection and an existing `password` field.

However, the following documents with duplicate email addresses are allowed since the unique constraint only applies to documents with a `password` The index prevents inserting a document if it has a password and its email address already exists in the collection. However, since the unique `email` constraint only applies to documents with a `password` field, you can still insert documents with duplicate email addresses if they have no password:

```javascript
db.users.insertMany( [
   // This document does NOT have a password field, so it's NOT indexed
   // The unique constraint does not apply to it
   { name: "Jon Snow", email: "jon1@example.com" },
   
   // This document has a password field, so it IS indexed
   // The unique constraint applies to it
   { name: "Sansa Stark", email: "sansa@example.com", password: "password123" },
   
   // This document does NOT have a password field, so it's NOT indexed
   // We can insert it even though it has the same name as the first document
   // This demonstrates that the unique constraint only applies to indexed documents
   { name: "Jon Snow", email: "jon2@example.com" }
] )
```
