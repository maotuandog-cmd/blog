# 企业微信 OAuth 回调失败排查：证书不匹配 + 可信域名

> 排查日期：2026-09-01
> 涉及系统：DCP（`bhzyxy.edu.cn`）企业微信扫码登录

## 一、问题现象

两个报错，看起来是两件事，实际同源。

**报错 1 —— 企业微信授权页**

```text
redirect_uri需使用应用可信域名
```

对应的授权请求：

```text
https://open.weixin.qq.com/connect/oauth2/authorize
  ?appid=<企业ID>
  &agentid=<应用ID>
  &redirect_uri=https%3A%2F%2Fejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn%2FDCP%2Fnonlogin%2FweixinWork%2FauthCallbak%2F...
```

**报错 2 —— curl 访问该域名**

```text
curl: (60) SSL: no alternative certificate subject name matches
      target hostname 'ejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn'
```

## 二、诊断过程与实测结果

### 1. DNS 解析 —— 三个域名指向同一台服务器

```bash
dig +short ejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn
dig +short dcp.bhzyxy.edu.cn
dig +short b2b.bhzyxy.edu.cn
```

实测输出：

```text
ejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn  →  219.159.199.88
dcp.bhzyxy.edu.cn                        →  219.159.199.88
b2b.bhzyxy.edu.cn                        →  219.159.199.88
```

**结论：DNS 没配错。** 三者落在同一个 IP，说明 `*.b2b.bhzyxy.edu.cn` 是泛解析，
和 `dcp` 共用同一个反代入口。这一步直接排除了「DNS 指错服务器」这个方向。

### 2. 证书内容 —— 只签了一个域名

```bash
openssl s_client \
  -connect ejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn:443 \
  -servername ejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn \
  </dev/null 2>/dev/null |
openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

实测输出（**两个域名返回的是完全同一张证书**，有效期字节级一致）：

```text
subject = CN=dcp.bhzyxy.edu.cn
issuer  = C=US, O=Let's Encrypt, CN=YR1
notBefore = Aug 26 06:07:22 2026 GMT
notAfter  = Nov 24 06:07:21 2026 GMT

X509v3 Subject Alternative Name:
    DNS:dcp.bhzyxy.edu.cn      ← 仅此一个，无泛域名
```

### 3. 两个域名的实际可用性对比

```bash
curl -sS -o /dev/null -w 'http=%{http_code}\n' \
  https://ejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn/
curl -sS -o /dev/null -w 'http=%{http_code} redirect=%{redirect_url}\n' \
  https://dcp.bhzyxy.edu.cn/
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://dcp.bhzyxy.edu.cn/DCP/
```

实测：

| 访问地址 | 结果 |
|---|---|
| `https://ejwxipxj9d0rahk58uwek.b2b...` | **TLS 校验失败**（curl 60） |
| `https://dcp.bhzyxy.edu.cn/` | `302` → `https://dcp.bhzyxy.edu.cn/DCP/` |
| `https://dcp.bhzyxy.edu.cn/DCP/` | `401`（应用存活，要求认证） |

**结论：`dcp.bhzyxy.edu.cn` 才是 DCP 系统的正规入口**，根路径直接 302 跳 `/DCP/`。

## 三、根本原因

```text
企业微信
   ↓ redirect_uri 用了随机子域
https://ejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn/DCP/...
   ↓ DNS 泛解析（*.b2b）
219.159.199.88  ← 与 dcp.bhzyxy.edu.cn 同一台
   ↓ TLS 握手，服务器只有一张证书
证书 SAN = dcp.bhzyxy.edu.cn        ✗ 不含随机子域
   ↓
客户端：我要访问 A，服务器证明自己是 B  →  校验失败
```

一句话：**这个随机子域只在 DNS 层被指过来了，TLS 层从来没有为它签过证书。**
Let's Encrypt 证书是 8/26 新签的，说明续期正常 —— 运维一直只维护 `dcp` 这一个域名，
随机子域是系统/文档里错用的地址。

两个报错的因果关系：`redirect_uri` 用了一个**根本没有合法 HTTPS 的域名**，
它既过不了浏览器的证书校验，也不可能被配成企业微信可信域名（配了也无法通过归属校验）。

## 四、解决方案

### 推荐：把 redirect_uri 改回 `dcp.bhzyxy.edu.cn`

现有证书**已经完全匹配**这个域名，零改造成本：

```text
redirect_uri = https://dcp.bhzyxy.edu.cn/DCP/nonlogin/weixinWork/authCallbak/...
企业微信可信域名 = dcp.bhzyxy.edu.cn
```

### 为什么不建议「申请泛域名证书」这条路

`*.b2b.bhzyxy.edu.cn` 确实能匹配 `ejwxipxj9d0rahk58uwek.b2b.bhzyxy.edu.cn`（通配符匹配一级标签），
**但它只能解决报错 2，解决不了报错 1**：

- 企业微信「可信域名」**不支持通配符**，必须逐个填写具体域名；
- 且每个域名都要通过**归属校验**（下载 `WW_verify_xxxx.txt` 放到该域名根目录，
  能被 `https://域名/WW_verify_xxxx.txt` 访问到才生效）。

所以如果是「一租户一随机子域」的架构，逐个配可信域名不可行。
正确做法是 **OAuth 回调统一走一个固定域名**（即 `dcp.bhzyxy.edu.cn`），
回调成功后再由后端跳转回租户子域。

### 排查清单（按此顺序，先证 HTTPS 再动企业微信）

```text
1. 域名能解析              → dig +short <域名>
2. 证书 SAN 包含该域名      → openssl s_client ... | openssl x509 -ext subjectAltName
3. 该域名 HTTPS 可正常访问   → curl -sSI https://<域名>/   （不要加 -k）
4. 企业微信可信域名已配置    → 应用 → 网页授权及 JS-SDK
5. 归属校验文件可访问        → curl https://<域名>/WW_verify_xxxx.txt
6. redirect_uri 使用该域名
```

前三步不过，第 4 步一定失败。

## 五、易踩坑记录

- **`curl -k` 只是绕过校验，不解决问题。** 加 `-k` 能通，只证明 HTTP 服务活着；
  企业微信跳转走的是浏览器，浏览器不会 `-k`。
- **可信域名填域名，不填 URL。** 填 `dcp.bhzyxy.edu.cn`，
  不是 `https://dcp.bhzyxy.edu.cn/DCP/...`。
- **`authCallbak` 拼写**（少个 `c`）疑似后端接口名笔误。若后端确实是这个拼写就别动；
  本次报错发生在企业微信校验阶段，还没走到后端，与此无关。
- **多应用混淆。** 系统里有多个自建应用时，可信域名配到了另一个 `agentid` 上，
  同样报 `redirect_uri需使用应用可信域名`。
- **不要外传授权 URL 里的 `sig` / `nonce` / `ts`**，那是签名参数。

## 六、本次用到的命令速查

```bash
# 解析
dig +short <域名>

# 看证书 subject / issuer / 有效期 / SAN
openssl s_client -connect <域名>:443 -servername <域名> </dev/null 2>/dev/null |
  openssl x509 -noout -subject -issuer -dates -ext subjectAltName

# 只看 HTTP 状态码与跳转目标
curl -sS -o /dev/null -w 'http=%{http_code} redirect=%{redirect_url}\n' https://<域名>/

# 服务器侧核对 Nginx（若可登录该服务器）
sudo nginx -T | grep -n -E 'server_name|ssl_certificate'
```
