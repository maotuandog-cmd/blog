> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Replica Set Elections

[Replica sets](/docs/manual/reference/glossary#std-term-replica-set) use elections to determine which set member becomes [primary](/docs/manual/reference/glossary#std-term-primary). Replica sets can trigger an election in response to a variety of events, such as:

- Adding a new node to the replica set,

- [`initiating a replica set`,](/docs/manual/reference/method/rs.initiate#mongodb-method-rs.initiate)

- performing replica set maintenance using methods such as [`rs.stepDown()`](/docs/manual/reference/method/rs.stepDown#mongodb-method-rs.stepDown) or [`rs.reconfig()`](/docs/manual/reference/method/rs.reconfig#mongodb-method-rs.reconfig), and

- the [secondary](/docs/manual/reference/glossary#std-term-secondary) members losing connectivity to the primary for more than the configured [`timeout`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings.electionTimeoutMillis) (10 seconds by default).

In the following diagram, the primary node was unavailable for longer than the [`configured timeout`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings.electionTimeoutMillis) and triggers the [automatic failover](/docs/manual/replication#std-label-replication-auto-failover) process. One of the remaining secondaries calls for an election to select a new primary and automatically resume normal operations.

![Election in a three-member replica set after the primary becomes unreachable; a secondary is elected.](/images/replica-set-trigger-election.bakedsvg.svg)

The replica set cannot process write operations until the election completes successfully. The replica set can continue to serve read queries if such queries are configured to [run on secondaries.](/docs/manual/core/read-preference#std-label-replica-set-read-preference)

The median time before a cluster elects a new primary should not typically exceed 12 seconds, assuming default [`replica configuration settings`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings). This includes time required to mark the primary as [unavailable](/docs/manual/replication#std-label-replication-auto-failover) and call and complete an [election](/docs/manual/core/replica-set-elections#std-label-replica-set-elections). You can tune this time period by modifying the [`settings.electionTimeoutMillis`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings.electionTimeoutMillis) replication configuration option. Factors such as network latency may extend the time required for replica set elections to complete, which in turn affects the amount of time your cluster may operate without a primary. These factors are dependent on your particular cluster architecture.

Your application connection logic should include tolerance for automatic failovers and the subsequent elections. MongoDB drivers can detect the loss of the primary and automatically [retry certain write operations](/docs/manual/core/retryable-writes#std-label-retryable-writes) a single time, providing additional built-in handling of automatic failovers and elections:

Compatible drivers enable retryable writes by default

## Factors and Conditions that Affect Elections

### Replication Election Protocol

Replication [`protocolVersion: 1`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.protocolVersion) reduces replica set failover time and accelerates the detection of multiple simultaneous primaries.

You can use [`catchUpTimeoutMillis`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings.catchUpTimeoutMillis) to prioritize between faster failovers and preservation of [`w:1`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-number-) writes.

For more information on `pv1`, see [Self-Managed Replica Set Protocol Version.](/docs/manual/reference/replica-set-protocol-versions)

### Heartbeats

Replica set members send heartbeats (pings) to each other every two seconds. If a heartbeat does not return within 10 seconds, the other members mark the delinquent member as inaccessible.

### Member Priority

After a replica set has a stable primary, the election algorithm will make a "best-effort" attempt to have the secondary with the highest [`priority`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) available call an election. Member priority affects both the timing and the outcome of elections. Secondaries with higher priority call elections sooner and are more likely to win. However, a lower priority instance can be elected as primary for brief periods, even if a higher priority secondary is available. Replica set members continue to call elections until the highest priority member available becomes primary.

Members with a priority value of `0` cannot become primary and do not seek election. For details, see [Priority 0 Replica Set Members.](/docs/manual/core/replica-set-priority-0-member)

### Mirrored Reads

MongoDB provides [mirrored reads](/docs/manual/replication#std-label-mirrored-reads) to pre-warm electable secondary members' cache with the most recently accessed data. With mirrored reads, the primary can mirror a subset of [operations](/docs/manual/replication#std-label-mirrored-reads-supported-operations) that it receives and send them to a subset of electable secondaries. Pre-warming the cache of a secondary can help restore performance more quickly after an election.

For details, see [Mirrored Reads.](/docs/manual/replication#std-label-mirrored-reads)

### Loss of a Data Center

With a distributed replica set, the loss of a data center may affect the ability of the remaining members in other data center or data centers to elect a primary.

If possible, distribute the replica set members across data centers to maximize the likelihood that even with a loss of a data center, one of the remaining replica set members can become the new primary.

**See also:**

[Replica Sets Distributed Across Two or More Data Centers](/docs/manual/core/replica-set-architecture-geographically-distributed)

### Network Partition

A [network partition](/docs/manual/reference/glossary#std-term-network-partition) may segregate a primary into a partition with a minority of nodes. When the primary detects that it can only see a minority of voting nodes in the replica set, the primary steps down and becomes a secondary. Independently, a member in the partition that can communicate with a [`majority`](/docs/manual/reference/command/replSetGetStatus#mongodb-data-replSetGetStatus.majorityVoteCount) of the voting nodes (including itself) holds an election to become the new primary.

## Voting Members

The replica set member configuration setting [`members[n].votes`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.votes) and member [`state`](/docs/manual/reference/command/replSetGetStatus#mongodb-data-replSetGetStatus.members-n-.state) determine whether a member votes in an election.

- All replica set members that have their [`members[n].votes`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.votes) setting equal to 1 vote in elections. To exclude a member from voting in an [election](/docs/manual/reference/glossary#std-term-election), change the value of the member's [`members[n].votes`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.votes) configuration to `0`.

  - Non-voting (i.e. [`votes`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.votes) is `0`) members must have [`priority`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) of 0.

  - Members with [`priority`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) greater than 0 cannot have 0 [`votes`.](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.votes)

- Only voting members in the following states are eligible to vote:

  - [`PRIMARY`](/docs/manual/reference/replica-states#mongodb-replstate-replstate.PRIMARY)

  - [`SECONDARY`](/docs/manual/reference/replica-states#mongodb-replstate-replstate.SECONDARY)

  - [`STARTUP2`](/docs/manual/reference/replica-states#mongodb-replstate-replstate.STARTUP2) (unless the member was newly added to the replica set)

  - [`RECOVERING`](/docs/manual/reference/replica-states#mongodb-replstate-replstate.RECOVERING)

  - [`ARBITER`](/docs/manual/reference/replica-states#mongodb-replstate-replstate.ARBITER)

  - [`ROLLBACK`](/docs/manual/reference/replica-states#mongodb-replstate-replstate.ROLLBACK)

- The first member to receive the majority of votes becomes the new [`PRIMARY`.](/docs/manual/reference/replica-states#mongodb-replstate-replstate.PRIMARY)

- A replica set member cannot become [`PRIMARY`](/docs/manual/reference/replica-states#mongodb-replstate-replstate.PRIMARY) unless it has the highest [optime](/docs/manual/reference/glossary#std-term-optime) of any visible member in the set.

**See also:**

- [`replSetGetStatus.votingMembersCount`](/docs/manual/reference/command/replSetGetStatus#mongodb-data-replSetGetStatus.votingMembersCount)

- [`replSetGetStatus.writableVotingMembersCount`](/docs/manual/reference/command/replSetGetStatus#mongodb-data-replSetGetStatus.writableVotingMembersCount)

## Non-Voting Members

Although non-voting members do not vote in elections, these members hold copies of the replica set's data and can accept read operations from client applications.

Because a replica set can have up to [50 members](/docs/manual/reference/limits#mongodb-limit-Number-of-Members-of-a-Replica-Set), but only [7 voting members](/docs/manual/reference/limits#mongodb-limit-Number-of-Voting-Members-of-a-Replica-Set), non-voting members allow a replica set to have more than seven members.

Non-voting (i.e. [`votes`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.votes) is `0`) members must have [`priority`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) of 0.

For instance, the following nine-member replica set has seven voting members and two non-voting members.

![Diagram of a 9 member replica set with the maximum of 7 voting members.](/images/replica-set-only-seven-voting-members.bakedsvg.svg)

A non-voting member has both [`votes`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.votes) and [`priority`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) equal to `0`:

```javascript
{
   "_id" : <num>,
   "host" : <hostname:port>,
   "arbiterOnly" : false,
   "buildIndexes" : true,
   "hidden" : false,
   "priority" : 0,
   "tags" : {

   },
   "secondaryDelaySecs" : Long(0),
   "votes" : 0
}
```

**Important:**

Do **not** alter the number of votes to control which members will become primary. Instead, modify the [`members[n].priority`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) option. *Only* alter the number of votes in exceptional cases. For example, to permit more than seven members.

To configure a non-voting member, see [Configure a Non-Voting Self-Managed Replica Set Member.](/docs/manual/tutorial/configure-a-non-voting-replica-set-member)
