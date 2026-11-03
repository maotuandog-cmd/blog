

```
# 检查input 表
iptables -nvL INPUT --line-numbers
ptables -nvL FORWARD --line-numbers
iptables -nvL DOCKER-USER --line-numbers
iptables -t raw -nvL --line-numbers
iptables -t nat -nvL POSTROUTING --line-numbers
iptables -t nat -nvL DOCKER --line-numbers
```

```
```
i
```

```
