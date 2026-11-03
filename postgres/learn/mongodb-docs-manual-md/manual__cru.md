> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# MongoDB CRUD Operations

CRUD operations *create*, *read*, *update*, and *delete* [documents.](/docs/manual/core/document#std-label-bson-document-format)

You can connect with driver methods and perform CRUD operations for deployments hosted in the following environments:

You can [perform CRUD operations in the UI](https://www.mongodb.com/docs/atlas/atlas-ui/documents/) for deployments hosted in [MongoDB Atlas.](https://www.mongodb.com/docs/atlas)

## Create Operations

Create or insert operations add new [documents](/docs/manual/core/document#std-label-bson-document-format) to a [collection](/docs/manual/core/databases-and-collections#std-label-collections). If the collection does not currently exist, insert operations will create the collection.

MongoDB provides the following methods to insert documents into a collection:

- [`db.collection.insertOne()`](/docs/manual/reference/method/db.collection.insertOne#mongodb-method-db.collection.insertOne)

- [`db.collection.insertMany()`](/docs/manual/reference/method/db.collection.insertMany#mongodb-method-db.collection.insertMany)

In MongoDB, insert operations target a single [collection](/docs/manual/reference/glossary#std-term-collection). All write operations in MongoDB are [atomic](/docs/manual/core/write-operations-atomicity) on the level of a single [document.](/docs/manual/core/document#std-label-bson-document-format)

![The components of a MongoDB insertOne operations.](/images/crud-annotated-mongodb-insertOne.bakedsvg.svg)

For examples, see [Create Documents.](/docs/manual/tutorial/insert-documents)

## Read Operations

Read operations retrieve [documents](/docs/manual/core/document#std-label-bson-document-format) from a [collection](/docs/manual/core/databases-and-collections#std-label-collections); i.e. query a collection for documents. MongoDB provides the following methods to read documents from a collection:

- [`db.collection.find()`](/docs/manual/reference/method/db.collection.find#mongodb-method-db.collection.find)

You can specify [query filters or criteria](/docs/manual/tutorial/query-documents#std-label-read-operations-query-argument) that identify the documents to return.

![The components of a MongoDB find operation.](/images/crud-annotated-mongodb-find.bakedsvg.svg)

For examples, see:

- [Read Documents](/docs/manual/tutorial/query-documents)

- [Query on Embedded/Nested Documents](/docs/manual/tutorial/query-embedded-documents)

- [Query an Array](/docs/manual/tutorial/query-arrays)

- [Query an Array of Embedded Documents](/docs/manual/tutorial/query-array-of-documents)

## Update Operations

Update operations modify existing [documents](/docs/manual/core/document#std-label-bson-document-format) in a [collection](/docs/manual/core/databases-and-collections#std-label-collections). MongoDB provides the following methods to update documents of a collection:

- [`db.collection.updateOne()`](/docs/manual/reference/method/db.collection.updateOne#mongodb-method-db.collection.updateOne)

- [`db.collection.updateMany()`](/docs/manual/reference/method/db.collection.updateMany#mongodb-method-db.collection.updateMany)

- [`db.collection.replaceOne()`](/docs/manual/reference/method/db.collection.replaceOne#mongodb-method-db.collection.replaceOne)

In MongoDB, update operations target a single collection. All write operations in MongoDB are [atomic](/docs/manual/core/write-operations-atomicity) on the level of a single document.

You can specify criteria, or filters, that identify the documents to update. These [filters](/docs/manual/core/documents-other-uses#std-label-document-query-filter) use the same syntax as read operations.

![The components of a MongoDB updateMany operation.](/images/crud-annotated-mongodb-updateMany.bakedsvg.svg)

For examples, see [Update Documents.](/docs/manual/tutorial/update-documents)

## Delete Operations

Delete operations remove documents from a collection. MongoDB provides the following methods to delete documents of a collection:

- [`db.collection.deleteOne()`](/docs/manual/reference/method/db.collection.deleteOne#mongodb-method-db.collection.deleteOne)

- [`db.collection.deleteMany()`](/docs/manual/reference/method/db.collection.deleteMany#mongodb-method-db.collection.deleteMany)

In MongoDB, delete operations target a single [collection](/docs/manual/reference/glossary#std-term-collection). All write operations in MongoDB are [atomic](/docs/manual/core/write-operations-atomicity) on the level of a single document.

You can specify criteria, or filters, that identify the documents to remove. These [filters](/docs/manual/core/documents-other-uses#std-label-document-query-filter) use the same syntax as read operations.

![The components of a MongoDB deleteMany operation.](/images/crud-annotated-mongodb-deleteMany.bakedsvg.svg)

For examples, see [Delete Documents.](/docs/manual/tutorial/remove-documents)

## Bulk Write

MongoDB provides the ability to perform write operations in bulk. For details, see [Bulk Write Operations.](/docs/manual/core/bulk-write-operations)
