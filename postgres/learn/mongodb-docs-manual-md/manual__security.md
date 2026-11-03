> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Security

MongoDB provides various features, such as authentication, access control, encryption, to secure your MongoDB deployments. Some key security features include:

| Authentication | Authorization | TLS/SSL | Enterprise Only | Encryption |
| --- | --- | --- | --- | --- |
| [Authentication on Self-Managed Deployments](/docs/manual/core/authentication) [Database Users](/docs/manual/reference/database-users) [SCRAM](/docs/manual/core/security-scram) [x.509](/docs/manual/core/security-x.509) | [Role-Based Access Control in Self-Managed Deployments](/docs/manual/core/authorization) [Enable Access Control on Self-Managed Deployments](/docs/manual/tutorial/enable-authentication) [Manage Users and Roles on Self-Managed Deployments](/docs/manual/tutorial/manage-users-and-roles) | [TLS/SSL (Transport Encryption)](/docs/manual/core/security-transport-encryption) [Configure MongoDB Instances for TLS/SSL Encryption](/docs/manual/tutorial/configure-ssl) [TLS/SSL Configuration for Clients](/docs/manual/tutorial/configure-ssl-clients) | [Kerberos Authentication on Self-Managed Deployments](/docs/manual/core/kerberos) [Self-Managed LDAP Proxy Authentication](/docs/manual/core/security-ldap) [Authentication and Authorization with OIDC/OAuth 2.0](/docs/manual/core/oidc/security-oidc) [Auditing](/docs/manual/core/auditing) [Log Redaction](/docs/manual/reference/log-messages#std-label-log-message-log-redaction) | [Queryable Encryption](/docs/manual/core/queryable-encryption#std-label-qe-manual-feature-qe) [Client-Side Field Level Encryption](/docs/manual/core/csfle#std-label-manual-csfle-feature) [Encryption at Rest](/docs/manual/core/security-encryption-at-rest#std-label-security-encryption-at-rest) [TLS/SSL (Transport Encryption)](/docs/manual/core/security-transport-encryption#std-label-transport-encryption) |

## Secure Your MongoDB Atlas Deployments

MongoDB Atlas, the fully managed service for MongoDB deployments in the cloud, comes preconfigured with secure default settings. Atlas also provides the following key security features:

| Security Feature | Description |
| --- | --- |
| Authentication and Authorization | In Atlas, you configure database users to access your deployments. Atlas provides various ways to perform user authentication and authorization, including LDAP, OIDC, and X.509. To learn more, see [Configure Authentication and Authorization.](https://www.mongodb.com/docs/atlas/security/config-db-auth/) |
| Encryption | By default, Atlas encrypts all data stored in your deployments and uses TLS/SSL to encrypt the connections to your databases. To add another layer of security, you can configure [Encryption at Rest using Customer Key Management.](https://www.mongodb.com/docs/atlas/security-kms-encryption/) |
| IP Access List | Atlas allows connections only from addresses specified in the IP access list. To learn how to manage client connections in Atlas, see [Configure IP Access List Entries.](https://www.mongodb.com/docs/atlas/security/ip-access-list/) |
| Cloud Provider Support | Atlas supports network peering connections and private endpoints to secure your deployments hosted on AWS, Azure, and Google Cloud. To learn more, see [Set Up a Network Peering Connection](https://www.mongodb.com/docs/atlas/security-vpc-peering/) and [Configure Private Endpoints.](https://www.mongodb.com/docs/atlas/security-configure-private-endpoints/) |

For a full list of security features in Atlas, see [Security Features for Clusters.](https://www.mongodb.com/docs/atlas/setup-cluster-security/)

## Report Suspected Security Bugs

If you suspect you have [identified a security bug](https://www.mongodb.com/company/contact/mongodb-vulnerability-disclosure-policy) on any MongoDB products, please submit the issue using our [Security Bug Submission Form](https://www.mongodb.com/bug-submission-form).
