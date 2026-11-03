> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Storage

The [storage engine](/docs/manual/core/storage-engines#std-label-storage-engines) is the primary component of MongoDB responsible for managing data. MongoDB provides a variety of storage engines, allowing you to choose one most suited to your application.

The [journal](/docs/manual/reference/glossary#std-term-journal) is a log that helps the database recover in the event of a hard shutdown. There are several configurable options that allows the journal to strike a balance between performance and reliability that works for your particular use case.

[GridFS for Self-Managed Deployments](/docs/manual/core/gridfs) is a versatile storage system that is suited to handling large files, such as those exceeding the 16 MB document size limit.
