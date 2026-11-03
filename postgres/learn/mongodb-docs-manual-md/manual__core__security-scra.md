> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# SCRAM

Salted Challenge Response Authentication Mechanism (SCRAM) is the default authentication mechanism for MongoDB.

When a user [authenticates](/docs/manual/tutorial/authenticate-a-user#std-label-authentication-auth-as-user) themselves, MongoDB uses SCRAM to verify the supplied user credentials against the user's [`name`](/docs/manual/reference/system-users-collection#mongodb-data-admin.system.users.user), [`password`](/docs/manual/reference/system-users-collection#mongodb-data-admin.system.users.credentials) and [`authentication database`.](/docs/manual/reference/system-users-collection#mongodb-data-admin.system.users.db)

SCRAM is based on the IETF [RFC 5802](https://tools.ietf.org/html/rfc5802) standard that defines best practices for challenge-response authentication with passwords.

**Important:**

You cannot use both SCRAM authentication and another authentication type for the same user.

## Features

The SCRAM implementation in MongoDB provides:

- A tunable work factor (the iteration count)

- Per-user random salts

- Bi-directional authentication between server and client

### SCRAM Mechanisms

MongoDB supports the following SCRAM mechanisms:

| SCRAM Mechanism | Description |
| --- | --- |
| `SCRAM-SHA-1` | Uses the SHA-1 hashing function. To modify the iteration count for `SCRAM-SHA-1`, see [`scramIterationCount`.](/docs/manual/reference/parameters#mongodb-parameter-param.scramIterationCount) |
| `SCRAM-SHA-256` | Uses the SHA-256 hashing function. To modify the iteration count for `SCRAM-SHA-256`, see [`scramSHA256IterationCount`.](/docs/manual/reference/parameters#mongodb-parameter-param.scramSHA256IterationCount) |

When you create or update a SCRAM user, you can indicate:

- the SCRAM mechanism to use

- whether the server or the client digests the password

When you use `SCRAM-SHA-256`, MongoDB requires server-side password hashing, which means that the server digests the password. For more information, see [`db.createUser()`](/docs/manual/reference/method/db.createUser#mongodb-method-db.createUser) and [`db.updateUser()`.](/docs/manual/reference/method/db.updateUser#mongodb-method-db.updateUser)

## Driver Support

The minimum driver versions that support `SCRAM` are:

| Driver Language | Version | Driver Language | Version |
| --- | --- | --- | --- |
| [C](https://www.mongodb.com/docs/drivers/c/) | [1.1.0](https://github.com/mongodb/mongo-c-driver/releases) | [PHP](https://www.mongodb.com/docs/drivers/php/) | [1.0](https://pecl.php.net/package/mongodb) |
| [C++](https://www.mongodb.com/docs/drivers/cxx/) | [1.0.0](https://github.com/mongodb/mongo-cxx-driver/releases) | [Python](https://www.mongodb.com/docs/drivers/python/) | [2.8](https://pypi.python.org/pypi/pymongo/) |
| [C#](https://www.mongodb.com/docs/drivers/csharp/) | [1.10](https://github.com/mongodb/mongo-csharp-driver/releases) | [Perl](https://www.mongodb.com/docs/drivers/perl/) | [1.0.0](https://metacpan.org/release/MongoDB) |
| [Go](https://www.mongodb.com/docs/drivers/go/) | [1.0.0](https://github.com/mongodb/mongo-go-driver/releases) | [Ruby](https://www.mongodb.com/docs/drivers/ruby/) | [1.12](https://rubygems.org/gems/mongo) |
| [Java](https://www.mongodb.com/docs/drivers/java/) | [2.13](https://github.com/mongodb/mongo-java-driver/releases) | [Rust](https://www.mongodb.com/docs/drivers/rust/) | [1.0.0](https://github.com/mongodb/mongo-rust-driver/releases) |
| [Motor](https://www.mongodb.com/docs/drivers/python/) | [0.4](https://pypi.python.org/pypi/motor/) | [Scala](https://www.mongodb.com/docs/drivers/scala/) | [2.8.0](https://github.com/mongodb/casbah/releases) |
| [Node.js](https://www.mongodb.com/docs/drivers/node/) | [1.4.29](https://github.com/mongodb/node-mongodb-native/releases) | [Swift](https://www.mongodb.com/docs/drivers/swift/) | [1.0.0](https://github.com/mongodb/mongo-swift-driver/releases) |

## Additional Information

If you use [SCRAM-SHA-1:](/docs/manual/reference/parameters#std-label-authentication-parameters)

- [md5](/docs/manual/reference/glossary#std-term-md5) is necessary but is not used for cryptographic purposes, and

- if you use [FIPS mode](/docs/manual/tutorial/configure-fips#std-label-fips-overview), then instead of [SCRAM-SHA-1](/docs/manual/reference/parameters#std-label-authentication-parameters) use:

  - [SCRAM-SHA-256,](/docs/manual/core/security-scram#std-label-authentication-scram)

  - [Kerberos,](/docs/manual/core/kerberos#std-label-security-kerberos)

  - [LDAP](/docs/manual/core/security-ldap#std-label-security-ldap), or

  - [X.509](/docs/manual/core/security-x.509#std-label-security-auth-x509)
