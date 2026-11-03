> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

<!--
Tab options on this page. Append to the .md URL to filter:
  ?tabs=<id,...>   select specific tabs (e.g. ?tabs=nodejs,shell)
  ?allTabs=true    include every tab
  (no param)       default: one tab per tabset

Available tabs:
  other tabs: linux, windows
-->

# Network and Configuration Hardening for Self-Managed Deployments

To reduce the risk exposure of the entire MongoDB system, ensure that only trusted hosts have access to MongoDB.

## MongoDB Configuration Hardening

### IP Binding

MongoDB binaries, [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos), bind to `localhost` by default.

**Warning:**

Before you bind your instance to a publicly-accessible IP address, you must secure your cluster from unauthorized access. For a complete list of security recommendations, see [Security Checklist for Self-Managed Deployments](/docs/manual/administration/security-checklist#std-label-security-checklist). At minimum, consider [enabling authentication](/docs/manual/administration/security-checklist#std-label-checklist-auth) and [hardening network infrastructure.](/docs/manual/core/security-hardening#std-label-network-config-hardening)

**Warning:**

Make sure that your [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instances are only accessible on trusted networks. If your system has more than one network interface, bind MongoDB programs to the private or internal network interface.

For more information, see [IP Binding in Self-Managed Deployments.](/docs/manual/core/security-mongodb-configuration)

## Network Hardening

### Firewalls

Firewalls allow administrators to filter and control access to a system by providing granular control over network communications. For administrators of MongoDB, the following capabilities are important: limiting incoming traffic on a specific port to specific systems and limiting incoming traffic from untrusted hosts.

On Linux systems, the `iptables` interface provides access to the underlying `netfilter` firewall. On Windows systems, `netsh` command line interface provides access to the underlying Windows Firewall. For additional information about firewall configuration, see:

- [Configure Linux iptables Firewall](/docs/manual/tutorial/configure-linux-iptables-firewall) and

- [Configure Windows netsh Firewall for Self-Managed Deployments.](/docs/manual/tutorial/configure-windows-netsh-firewall)

For best results and to minimize overall exposure, ensure that *only* traffic from trusted sources can reach [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instances and that the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instances can only connect to trusted outputs.

### Virtual Private Networks

Virtual private networks, or VPNs, make it possible to link two networks over an encrypted and limited-access trusted network. Typically, MongoDB users who use VPNs use TLS/SSL rather than IPSEC VPNs for performance issues.

Depending on configuration and implementation, VPNs provide for certificate validation and a choice of encryption protocols, which requires a rigorous level of authentication and identification of all clients. Furthermore, because VPNs provide a secure tunnel, by using a VPN connection to control access to your MongoDB instance, you can prevent tampering and "man-in-the-middle" attacks.

### Disable IP Forwarding

IP forwarding allows servers to forward packets to other systems.  Disable this feature on servers that host [`mongod`.](/docs/manual/reference/program/mongod#std-program-mongod)

### Linux

To disable IP forwarding on Linux, use the `sysctl` command:

```bash
sudo sysctl -w net.ipv4.ip_forward=0
```

To make the change persistent, edit the `/etc/sysctl.conf` file to add this line:

```conf
net.ipv4.ip_forward = 0
```
