> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Authentication on Self-Managed Deployments

**Note:**

Starting in MongoDB 8.0, LDAP authentication and authorization is deprecated. LDAP is available and will continue to operate without changes throughout the lifetime of MongoDB 8. LDAP will be removed in a future major release.

For details, see [LDAP Deprecation.](/docs/manual/core/LDAP-deprecation#std-label-ldap-deprecation)

Authentication is the process of verifying the identity of a client. When access control ([authorization](/docs/manual/core/authorization#std-label-authorization)) is enabled, MongoDB requires all clients to authenticate themselves to determine their access.

Authentication and [authorization](/docs/manual/core/authorization#std-label-authorization) are distinct:

- **Authentication** verifies the identity of a [user.](/docs/manual/core/security-users#std-label-users)

- **Authorization** determines the verified user's access to resources and operations.

You can [configure authentication through the UI](https://www.mongodb.com/docs/atlas/atlas-ui-authentication/) for deployments hosted in [MongoDB Atlas.](https://www.mongodb.com/docs/atlas)

## Getting Started

To get started using access control, follow these tutorials:

- [Enable Access Control on Self-Managed Deployments](/docs/manual/tutorial/enable-authentication#std-label-enable-access-control)

- [Create a User on Self-Managed Deployments](/docs/manual/tutorial/create-users#std-label-create-users)

- [Authenticate a User with Self-Managed Deployments](/docs/manual/tutorial/authenticate-a-user#std-label-authentication-auth-as-user)

## Authentication Mechanisms

|  | SCRAM | X.509 | Kerberos | LDAP | OIDC | AWS-IAM |
| --- | --- | --- | --- | --- | --- | --- |
| MongoDB Community | ✓ | ✓ |  |  |  | |
| MongoDB Enterprise | ✓ | ✓ | ✓ | ✓ | ✓ | |
| MongoDB Atlas (M10 and above) | ✓ | ✓ |  | ✓ | ✓ | ✓ |
| MongoDB Atlas (Free and Flex Tiers) | ✓ | ✓ |  |  |  | ✓ |
| MongoDB Atlas (Flex) | ✓ | ✓ |  |  |  | ✓ |

### SCRAM Authentication

[Salted Challenge Response Authentication Mechanism (SCRAM)](/docs/manual/core/security-scram) is the default authentication mechanism for MongoDB.

For more information on SCRAM and MongoDB, see:

- [SCRAM Authentication](/docs/manual/core/security-scram#std-label-authentication-scram)

- [Use SCRAM to Authenticate Clients on Self-Managed Deployments](/docs/manual/tutorial/configure-scram-client-authentication#std-label-scram-client-authentication)

### X.509 Certificate Authentication

MongoDB supports [X.509 certificate authentication](/docs/manual/core/security-x.509) for client authentication and internal authentication of the members of replica sets and sharded clusters. X.509 certificate authentication requires a secure [TLS/SSL connection.](/docs/manual/tutorial/configure-ssl)

To use MongoDB with X.509, you must use valid certificates generated and signed by a certificate authority. The client X.509 certificates must meet the [client certificate requirements.](/docs/manual/core/security-x.509#std-label-client-x509-certificates-requirements)

For more information on X.509 and MongoDB, see:

- [X.509 Certificate Authentication](/docs/manual/core/security-x.509#std-label-security-auth-x509)

- [Use X.509 to Authenticate Clients on Self-Managed MongoDB](/docs/manual/tutorial/configure-x509-client-authentication#std-label-x509-client-authentication)

### Kerberos Authentication

[MongoDB Enterprise](http://www.mongodb.com/products/mongodb-enterprise-advanced) supports [Kerberos Authentication](/docs/manual/core/kerberos#std-label-security-kerberos). Kerberos is an industry standard authentication protocol for large client/server systems that provides authentication using short-lived tokens that are called tickets.

To use MongoDB with Kerberos, you must have a properly configured Kerberos deployment, configured [Kerberos service principals](/docs/manual/core/kerberos#std-label-kerberos-service-principal) for MongoDB, and a [Kerberos user principal](/docs/manual/core/kerberos#std-label-kerberos-user-principal) added to MongoDB.

For more information on Kerberos and MongoDB, see:

- [Kerberos Authentication](/docs/manual/core/kerberos#std-label-security-kerberos)

- [Configure MongoDB with Kerberos Authentication on Linux](/docs/manual/tutorial/control-access-to-mongodb-with-kerberos-authentication)

- [Configure MongoDB with Kerberos Authentication on Windows](/docs/manual/tutorial/control-access-to-mongodb-windows-with-kerberos-authentication)

### LDAP Proxy Authentication

[MongoDB Enterprise](http://www.mongodb.com/products/mongodb-enterprise-advanced) and [MongoDB Atlas](https://www.mongodb.com/atlas/database) support [LDAP Proxy Authentication](/docs/manual/core/security-ldap#std-label-security-ldap) proxy authentication through a Lightweight Directory Access Protocol (LDAP) service.

For more information on LDAP and MongoDB, see:

- [LDAP Proxy Authentication](/docs/manual/core/security-ldap#std-label-security-ldap)

- [Authenticate Using SASL and LDAP with Active Directory](/docs/manual/tutorial/configure-ldap-sasl-activedirectory)

- [Authenticate Using Self-Managed SASL and LDAP with OpenLDAP](/docs/manual/tutorial/configure-ldap-sasl-openldap)

- [Authenticate Using Active Directory with Native LDAP](/docs/manual/tutorial/authenticate-nativeldap-activedirectory)

These mechanisms allow MongoDB to integrate into your existing authentication system.

### OpenID Connect Authentication

MongoDB Enterprise supports OpenID Connect authentication. OpenID Connect is an authentication layer built on top of OAuth2. You can use OpenID Connect to configure single sign-on between your MongoDB database and a third-party IdP (Identity Provider).

For more information on OpenID Connect and MongoDB, see:

- [OpenID Connect Authentication](/docs/manual/core/oidc/security-oidc#std-label-authentication-oidc)

- [Configure MongoDB with OpenID Connect](/docs/manual/core/oidc/workforce/configure-oidc#std-label-configure-oidc)

- [OpenID Connect](https://auth0.com/docs/authenticate/protocols/openid-connect-protocol)

## Internal / Membership Authentication

In addition to verifying the identity of a client, MongoDB can require members of replica sets and sharded clusters to [authenticate their membership](/docs/manual/core/security-internal-authentication#std-label-inter-process-auth) to their respective replica set or sharded cluster.
