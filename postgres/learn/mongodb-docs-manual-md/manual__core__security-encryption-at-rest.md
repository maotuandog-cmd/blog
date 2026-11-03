> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Encryption at Rest

Encryption at rest, when used in conjunction with transport encryption and security policies that protect relevant accounts, passwords, and encryption keys, can help ensure compliance with security and privacy standards, including HIPAA, PCI-DSS, and FERPA.

## Encrypted Storage Engine

**Note: Enterprise Feature**

Available in MongoDB Enterprise only.

**Important: Available for the WiredTiger Storage Engine only.**

MongoDB Enterprise 3.2 introduces a native encryption option for the WiredTiger storage engine. This feature allows MongoDB to encrypt data files such that only parties with the decryption key can decode and read the data.

### Encryption Process

**Note:**

MongoDB Enterprise on Windows no longer supports `AES256-GCM` as a block cipher for encryption at rest. This usage is only supported on Linux.

If encryption is enabled, the default encryption mode that MongoDB Enterprise uses is the `AES256-CBC` (or 256-bit Advanced Encryption Standard in Cipher Block Chaining mode) via OpenSSL. AES-256 uses a symmetric key, meaning the same key to encrypt and decrypt text. MongoDB Enterprise for Linux also supports authenticated encryption `AES256-GCM` (or 256-bit Advanced Encryption Standard in Galois/Counter Mode).

The Encrypted Storage Engine uses the certified cryptography provider of the underlying operating system to perform cryptographic operations. For example, a MongoDB installation on a Linux operating system uses the OpenSSL `libcrypto` FIPS-140 module.

To run MongoDB in a FIPS-compliant mode:

1. Configure the operating system to run in FIPS-enforcing mode.

2. Configure MongoDB to enable the [`net.tls.FIPSMode`](/docs/manual/reference/configuration-options#mongodb-setting-net.tls.FIPSMode) setting.

3. Restart the `mongod` or `mongos`.

4. Check the server log file to confirm that FIPS mode is enabled. If FIPS mode is enabled, the message `FIPS 140-2 mode activated` appears in the log file.

For more information, see [Configure MongoDB for FIPS.](/docs/manual/tutorial/configure-fips#std-label-configure-mdb-for-fips)

**Note: AES256-GCM and Filesystem Backups**

For [encrypted storage engines](/docs/manual/core/security-encryption-at-rest#std-label-encrypted-storage-engine) that use `AES256-GCM` encryption mode, `AES256-GCM` requires that every process use a unique counter block value with the key.

For [encrypted storage engine](/docs/manual/core/security-encryption-at-rest#std-label-encrypted-storage-engine) configured with `AES256-GCM` cipher:

- Restoring from Hot Backup

  If you restore from files taken through "hot" backup while the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) is running, MongoDB detects "dirty" keys on startup and automatically rolls over the database key to avoid IV (Initialization Vector) reuse.

- Restoring from Cold Backup

  However, if you restore from files taken through "cold" backup while the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) is not running, MongoDB does not detect "dirty" keys on startup, and reuse of IV voids confidentiality and integrity guarantees.

  To avoid the reuse of the keys after restoring from a cold filesystem snapshot, MongoDB adds a new command-line option [`--eseDatabaseKeyRollover`](/docs/manual/reference/program/mongod#std-option-mongod.--eseDatabaseKeyRollover). When started with the [`--eseDatabaseKeyRollover`](/docs/manual/reference/program/mongod#std-option-mongod.--eseDatabaseKeyRollover) option, the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instance rolls over the database keys configured with `AES256-GCM` cipher and exits.

The data encryption process includes:

- Generating a master key.

- Generating keys for each database.

- Encrypting data with the database keys.

- Encrypting the database keys with the master key.

The encryption occurs transparently in the storage layer, meaning all data files are fully encrypted from a filesystem perspective, and data only exists in an unencrypted state in memory and during transmission.

To encrypt all of MongoDB's network traffic, you can use TLS/SSL (Transport Layer Security/Secure Sockets Layer). See [Configure MongoDB Instances for TLS/SSL Encryption](/docs/manual/tutorial/configure-ssl) and [TLS/SSL Configuration for Clients.](/docs/manual/tutorial/configure-ssl-clients)

### Key Management

**Important: Secure management of the encryption keys is critical.**

The database keys are internal to the server and are only paged to disk in an encrypted format. MongoDB never pages the master key to disk under any circumstances.

Only the master key is external to the server (which means it is kept separate from the data and the database keys), and requires external management. To manage the master key, MongoDB's encrypted storage engine supports two key management options:

- Integration with a third party key management appliance via the Key Management Interoperability Protocol (KMIP). **Recommended**

  **Note:**

  For an integration with a third-party key management appliance using the KMIP (Key Management Interoperability Protocol), you should allow the following KMIP operations:

  - Create (`operation_create`)

  - Get (`operation_get`)

  - Activate (`operation_activate`)

  - GetAttributes (`operation_get_attributes`)

  - Encrypt (`operation_encrypt`)

  - Decrypt (`operation_decrypt`)

  MongoDB requires the Encrypt and Decrypt operations with the default KMIP configuration. If you set [`security.kmip.useLegacyProtocol`](/docs/manual/reference/configuration-options#mongodb-setting-security.kmip.useLegacyProtocol) to `true` in the MongoDB server [configuration file](/docs/manual/reference/configuration-options#std-label-configuration-options), MongoDB uses the KMIP 1.0/1.1 protocol, which does not require these operations.

- Local key management via a keyfile.

To configure MongoDB for encryption and use one of the two key management options, see [Configure Encryption.](/docs/manual/tutorial/configure-encryption)

### Encryption and Replication

Encryption is not a part of replication:

- Master keys and database keys are not replicated, and

- Data is not natively encrypted over the wire.

Although you could reuse the same key for the nodes, MongoDB recommends the use of individual keys for each node as well as the use of transport encryption.

For details, see [Rotate Encryption Keys.](/docs/manual/tutorial/rotate-encryption-key#std-label-rotate-encryption-keys)

### Audit Log

Available in MongoDB Enterprise only.

#### Use KMIP Server to Manage Keys for Encrypting the MongoDB Audit Log

Starting in MongoDB 6.0 Enterprise, you can securely manage the keys for encrypting the MongoDB audit log using an external Key Management Interoperability Protocol (KMIP) server.

KMIP simplifies the management of cryptographic keys and eliminates the use of non-standard key management processes.

The default KMIP protocol version is 1.2. You can configure MongoDB to use KMIP version 1.0 or 1.1 in the MongoDB server [configuration file.](/docs/manual/reference/configuration-options#std-label-configuration-options)

To use a KMIP server with audit log encryption, configure these settings and parameters:

- [`auditLog.auditEncryptionKeyIdentifier`](/docs/manual/reference/configuration-options#mongodb-setting-auditLog.auditEncryptionKeyIdentifier) setting

- [`auditLog.compressionMode`](/docs/manual/reference/configuration-options#mongodb-setting-auditLog.compressionMode) setting

- [`auditEncryptionHeaderMetadataFile`](/docs/manual/reference/parameters#mongodb-parameter-param.auditEncryptionHeaderMetadataFile) parameter

- [`auditEncryptKeyWithKMIPGet`](/docs/manual/reference/parameters#mongodb-parameter-param.auditEncryptKeyWithKMIPGet) parameter

For testing audit log encryption, you can also use the [`auditLog.localAuditKeyFile`](/docs/manual/reference/configuration-options#mongodb-setting-auditLog.localAuditKeyFile) setting.

Starting in MongoDB 6.0, if you need to downgrade to an earlier MongoDB version, you must first disable audit log encryption by removing [`auditLog.auditEncryptionKeyIdentifier`](/docs/manual/reference/configuration-options#mongodb-setting-auditLog.auditEncryptionKeyIdentifier) or [`auditLog.localAuditKeyFile`](/docs/manual/reference/configuration-options#mongodb-setting-auditLog.localAuditKeyFile). Existing encrypted audit logs remain encrypted, and you can keep any procedures you have developed for storage and processing of encrypted logs.

**Note:**

For audit log encryption, the audit log destination must be a file. [syslog](/docs/manual/reference/glossary#std-term-syslog) cannot be used as the destination.

#### Unencrypted Audit Log and Process Log

Use this section if you are not using a Key Management Interoperability Protocol (KMIP) server for audit log encryption.

The audit log file is not encrypted as a part of MongoDB's encrypted storage engine. A [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) running with [logging](/docs/manual/administration/monitoring#std-label-monitoring-standard-loggging) may output potentially sensitive information to log files as a part of normal operations, depending on the configured [log verbosity.](/docs/manual/reference/log-messages#std-label-log-messages-configure-verbosity)

Use the [`security.redactClientLogData`](/docs/manual/reference/configuration-options#mongodb-setting-security.redactClientLogData) setting to prevent potentially sensitive information from entering the `mongod` process log. Setting [`redactClientLogData`](/docs/manual/reference/configuration-options#mongodb-setting-security.redactClientLogData) reduces detail in the log and may complicate log diagnostics.

See the [log redaction](/docs/manual/administration/monitoring#std-label-monitoring-log-redaction) manual entry for more information.

## Application Level Encryption

Starting in MongoDB 7.0, you can use [Queryable Encryption](/docs/manual/core/queryable-encryption#std-label-qe-manual-feature-qe) to enable end-to-end encryption. For details on getting started, see [Queryable Encryption Quick Start.](/docs/manual/core/queryable-encryption/quick-start#std-label-qe-quick-start)

For a list of MongoDB's certified partners, refer to the [Partners List](https://www.mongodb.com/partners/list).
