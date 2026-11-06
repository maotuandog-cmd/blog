下面把这次 `/opt/obsidian` 本地项目推送到 GitHub 的问题整理成一份完整的故障处理记录，包括问题背景、故障原因、处理过程、解决方案和后续规范。

# Git 本地项目推送 GitHub 故障处理记录

## 一、问题背景

用户希望将 Ubuntu 本地目录 `/opt/obsidian` 中的项目文件推送到 GitHub 仓库：

- GitHub 用户：`maotuandog-cmd`
    
- GitHub 仓库：`blog`
    
- 仓库地址：`https://github.com/maotuandog-cmd/blog.git`
    
- 本地操作目录：`/opt/obsidian`
    
- 当前执行用户：`root`
    
- 本地目标分支：`main`
    
- 远程目标分支：`main`
    
- 操作系统：Ubuntu Linux
    

目标操作：

```
git add .
git commit -m "update blog"
git push -u origin main
```

整个过程中遇到了两个不同阶段的问题。

## 二、故障一：GitHub 身份认证失败

Authentication Failed

### 1. 故障现象

执行：

```
git push -u origin main
```

出现：

```
Username for 'https://github.com': maotuandog@gmail.com
Password for 'https://github.com':

remote: Invalid username or token.
Password authentication is not supported for Git operations.
fatal: Authentication failed
```

### 2. 原因分析

GitHub 已经不支持通过普通账号密码进行 Git HTTPS 操作。

以下方式不能正常使用：

```
Username：GitHub 邮箱
Password：GitHub 登录密码
```

需要使用以下两种认证方式之一：

|认证方式|说明|推荐程度|
|---|---|---|
|SSH Key|公钥认证，无需每次输入密码|推荐|
|Personal Access Token|HTTPS + Token 认证|可用|

### 3. 解决方案：配置 SSH Key

#### 第一步：生成 SSH 密钥

当前终端为 root 用户，因此密钥生成在 `/root/.ssh/` 下。

```
ssh-keygen -t ed25519 -C "maotuandog@gmail.com"
```

一路回车即可。

生成：

```
/root/.ssh/id_ed25519
/root/.ssh/id_ed25519.pub
```

#### 第二步：查看公钥

```
cat /root/.ssh/id_ed25519.pub
```

复制公钥内容。

#### 第三步：添加到 GitHub

访问：

[https://github.com/settings/ssh/new](https://github.com/settings/ssh/new?utm_source=chatgpt.com)

填写：

```
Title: Ubuntu ASUS
Key type: Authentication Key
Key: 粘贴 SSH 公钥
```

保存。

#### 第四步：测试 SSH 连接

```
ssh -T git@github.com
```

成功时会出现类似：

```
Hi maotuandog-cmd! You've successfully authenticated...
```

#### 第五步：修改 Git 远程仓库地址

```
cd /opt/obsidian

git remote set-url origin git@github.com:maotuandog-cmd/blog.git
```

检查：

```
git remote -v
```

预期结果：

```
origin  git@github.com:maotuandog-cmd/blog.git (fetch)
origin  git@github.com:maotuandog-cmd/blog.git (push)
```

至此，SSH 身份认证问题解决。

## 三、故障二：Git Push 被拒绝

Rejected - Fetch First

### 1. 故障现象

再次执行：

```
git push -u origin main
```

返回：

```
To github.com:maotuandog-cmd/blog.git
 ! [rejected]        main -> main (fetch first)

error: 无法推送一些引用到
'github.com:maotuandog-cmd/blog.git'

hint: Updates were rejected because the remote contains work
that you do not have locally.
```

### 2. 原因分析

这次不是认证问题。

SSH 已经成功，GitHub 已经识别当前身份。

真正的问题是：

远程仓库存在本地没有的提交记录。

例如：

```
本地仓库：

A --- B --- C
          main

远程仓库：

X
|
main
```

本地和远程拥有不同的提交历史。

常见原因：

- 创建 GitHub 仓库时勾选了 README。
    
- 创建 GitHub 仓库时自动生成了 LICENSE。
    
- 远程仓库已经有人提交过代码。
    
- 本地仓库通过 `git init` 独立初始化，和远程历史没有关联。
    

Git 为了避免覆盖远程提交，拒绝了 Push。

### 3. 推荐解决方案：合并远程提交

首先查看本地状态：

```
cd /opt/obsidian

git status
```

查看本地提交记录：

```
git log --oneline --graph --all -10
```

查看远程提交：

```
git ls-remote origin
```

然后拉取远程分支：

```
git pull origin main --allow-unrelated-histories
```

这里的参数：

```
--allow-unrelated-histories
```

表示允许合并两个原本没有共同提交历史的 Git 仓库。

如果没有冲突：

```
git push -u origin main
```

如果出现冲突：

```
git status
```

查看冲突文件，手动编辑并解决冲突。

然后：

```
git add .
git commit -m "Merge remote main"
git push -u origin main
```

这样可以保留本地和远程已有内容。

### 4. 另一种方案：强制使用本地版本

如果已经确认远程内容不需要保留，可以：

```
git push -u origin main --force-with-lease
```

但要注意：

- 可能覆盖远程已有提交。
    
- 可能导致远程其他人的提交丢失。
    
- 不适合多人协作仓库。
    
- 执行前必须确认远程内容。
    

当前建议优先采用合并方案，不要直接强制推送。

## 四、完整故障处理流程

以后遇到类似情况，可以按照下面的流程排查。

## Git Push 故障排查流程

1. 检查本地 Git 仓库
    
    ```
    git status
    git remote -v
    git branch
    ```
    
2. 检查 SSH 认证
    
    ```
    ssh -T git@github.com
    ```
    
    如果认证失败，检查 SSH Key 和 GitHub 公钥配置。
    
3. 检查远程提交
    
    ```
    git ls-remote origin
    git log --oneline --graph --all -10
    ```
    
4. 处理远程提交冲突
    
    ```
    git pull origin main --allow-unrelated-histories
    ```
    
5. 解决文件冲突（如果有）
    
    ```
    git status
    git add .
    git commit -m "Resolve merge conflicts"
    ```
    
6. 推送代码
    
    ```
    git push -u origin main
    ```
    

## 五、以后日常更新代码的标准命令

当本地仓库和远程仓库已经建立正常关联后，日常更新使用：

```
cd /opt/obsidian

# 查看修改
git status

# 添加文件
git add .

# 提交修改
git commit -m "update blog"

# 获取远程最新提交并变基
git pull --rebase origin main

# 推送
git push origin main
```

如果只是想推送当前本地代码，且确认没有其他远程更新，也可以直接 `git push`。

## 六、运维角度的几个重要建议

考虑到你当前是在 Ubuntu 上以 root 身份操作，建议特别注意以下事项。

|项目|建议|
|---|---|
|Git 认证|优先使用 SSH Key|
|SSH 私钥|权限设置为 `600`|
|SSH 公钥|可以添加到 GitHub|
|Git 操作用户|长期建议使用普通用户，而不是 root|
|远程冲突|优先 pull/rebase 或合并|
|强制推送|必须确认远程内容可以被覆盖|
|敏感文件|不要提交 `.env`、密码、Token、私钥|
|`.gitignore`|提前排除缓存、日志、临时文件和依赖目录|

特别注意：

```
chmod 700 /root/.ssh
chmod 600 /root/.ssh/id_ed25519
chmod 644 /root/.ssh/id_ed25519.pub
```

如果后续改为普通用户操作，需要重新配置该用户的 SSH Key 和项目目录权限。

## 七、最终结论

本次问题实际上分为两个独立故障：

|故障|原因|解决方式|
|---|---|---|
|Authentication failed|使用 GitHub 账号密码认证|配置 SSH Key|
|Rejected - Fetch first|远程仓库存在本地没有的提交|拉取并合并远程提交|

目前可以确认 SSH 认证已经成功，但第二个 Push 被拒绝的问题尚未确认解决。

下一步建议先执行：

```
cd /opt/obsidian

git status
git log --oneline --graph --all -10
git ls-remote origin
```

根据输出决定如何合并，避免覆盖远程内容。

这份记录可以作为以后处理 Linux 环境下 GitHub 推送失败的标准 SOP。