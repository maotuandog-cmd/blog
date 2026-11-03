> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Role-Based Access Control in Self-Managed Deployments

MongoDB employs Role-Based Access Control (RBAC) to govern access to a MongoDB system. A user is granted one or more [roles](/docs/manual/core/authorization#std-label-roles) that determine the user's access to database resources and operations. Outside of role assignments, the user has no access to the system.

## Enable Access Control

MongoDB does not enable access control by default. You can enable authorization using the [`--auth`](/docs/manual/reference/program/mongod#std-option-mongod.--auth) or the [`security.authorization`](/docs/manual/reference/configuration-options#mongodb-setting-security.authorization) setting. Enabling [internal authentication](/docs/manual/core/security-internal-authentication) also enables client authorization. Once access control is enabled, users must [authenticate](/docs/manual/core/authentication#std-label-authentication) themselves.

## Roles

A role grants privileges to perform the specified [actions](/docs/manual/reference/privilege-actions#std-label-security-user-actions) on a [resource](/docs/manual/reference/resource-document). Each privilege is either specified explicitly in the role or inherited from another role or both.

### Access

Roles never limit privileges. If a user has two roles, the role with the greater access takes precedence.

For example, if you grant the [`read`](/docs/manual/reference/built-in-roles#mongodb-authrole-read) role on a database to a user that already has the [`readWriteAnyDatabase`](/docs/manual/reference/built-in-roles#mongodb-authrole-readWriteAnyDatabase) role, the `read` grant does **not** revoke write access on the database.

To revoke a role from a user, use the [`revokeRolesFromUser`](/docs/manual/reference/command/revokeRolesFromUser#mongodb-dbcommand-dbcmd.revokeRolesFromUser) command.

### Authentication Restrictions

Roles can impose authentication restrictions on users, requiring them to connect from specified source and destination IP address ranges.

For more information, see [Authentication Restrictions.](/docs/manual/reference/command/createRole#std-label-create-role-auth-restrictions)

### Privileges

A privilege consists of a specified resource and the actions permitted on the resource.

A [resource](/docs/manual/reference/resource-document#std-label-resource-document) is a database, collection, set of collections, or the cluster. If the resource is the cluster, the affiliated actions affect the state of the system rather than a specific database or collection. For information on the resource documents, see [Resource Document on Self-Managed Deployments.](/docs/manual/reference/resource-document)

An [action](/docs/manual/reference/privilege-actions#std-label-security-user-actions) specifies the operation allowed on the resource. For available actions see [Privilege Actions.](/docs/manual/reference/privilege-actions)

### Inherited Privileges

A role can include one or more existing roles in its definition, in which case the role inherits all the privileges of the included roles.

A role can inherit privileges from other roles in its database. A role created on the `admin` database can inherit privileges from roles in any database.

### View Role's Privileges

You can view the privileges for a role by issuing the [`rolesInfo`](/docs/manual/reference/command/rolesInfo#mongodb-dbcommand-dbcmd.rolesInfo) command with the `showPrivileges` and `showBuiltinRoles` fields both set to `true`.

## Users and Roles

Assign roles when you create users or update existing users to grant or revoke roles. To list all user management methods, see [User Management](/docs/manual/reference/method#std-label-user-management-methods)

A user assigned a role receives all the privileges of that role. A user can have multiple roles. By assigning to the user roles in various databases, a user created in one database can have permissions to act on other databases.

**Note:**

The first user created in the database must be a user administrator who has the privileges to manage other users. See [Enable Access Control on Self-Managed Deployments.](/docs/manual/tutorial/enable-authentication)

## Built-In Roles and User-Defined Roles

MongoDB provides [built-in roles](/docs/manual/reference/built-in-roles#std-label-built-in-roles) that provide a set of privileges commonly needed in a database system.

If these built-in roles cannot provide the desired set of privileges, you can create and modify [user-defined roles.](/docs/manual/core/security-user-defined-roles)

## LDAP Authorization

**Note:**

Starting in MongoDB 8.0, LDAP authentication and authorization is deprecated. LDAP is available and will continue to operate without changes throughout the lifetime of MongoDB 8. LDAP will be removed in a future major release.

For details, see [LDAP Deprecation.](/docs/manual/core/LDAP-deprecation#std-label-ldap-deprecation)

MongoDB Enterprise supports querying an LDAP server for the LDAP groups the authenticated user is a member of. MongoDB maps the Distinguished Names (DN) of each returned group to [roles](/docs/manual/core/authorization#std-label-roles) on the `admin` database. MongoDB authorizes the user based on the mapped roles and their associated privileges. See [LDAP Authorization](/docs/manual/core/security-ldap-external#std-label-security-ldap-external) for more information.
