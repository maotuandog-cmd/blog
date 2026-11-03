# 企业微信（Wine）安装与启动说明

> 记录时间：2026-11-02  
> 环境：Ubuntu 26.04，GNOME + Wayland（XWayland `:0`），操作用户 `root`，桌面会话用户 `maotuan`  
> 目标：在 Linux 上通过 Wine 直接运行 Windows 版企业微信

---

## 1. 背景与方案选择

需求：在 Linux 上直接跑 Windows 的 `.exe`（以企业微信为例）。

当时对比了三种方式：

| 方案 | 说明 | 结论 |
|------|------|------|
| RDP / RemoteApp | 在已有 `win11` 虚拟机里跑，Linux 侧像原生窗口 | 兼容性最好，但依赖虚拟机 |
| **Wine 直接跑 exe** | Linux 本机安装 Wine 后运行安装包 | **实际采用** |
| deepin-wine / 星火商店封装 | 社区封装版 | 未采用 |

最终选择 Wine，并为企业微信建立独立前缀，避免污染默认 Wine 环境。

---

## 2. 当前运行环境一览

| 项目 | 值 |
|------|----|
| Wine | `10.0`（Ubuntu 包 `10.0~repack-12ubuntu1`，含 wine32/wine64） |
| 独立前缀 | `/root/.wine-wecom`（`WINEARCH=win64`） |
| 安装包 | `/root/Downloads/WeCom_Setup.exe`（约 629MB，NSIS） |
| 企业微信版本 | `5.0.13.6005` |
| 程序路径 | `C:\Program Files (x86)\WXWork\WXWork.exe` |
| 启动脚本 | `/root/wecom.sh` |
| 桌面快捷方式 | `/root/桌面/企业微信.desktop` |
| 运行日志 | `/tmp/wecom.log` |
| 中文字体映射 | `/root/.wine-wecom/zh-fonts.reg` |

---

## 3. 安装过程

### 3.1 启用 32 位架构并安装 Wine

企业微信是 32 位程序，需要 `i386` 支持：

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y \
  wine wine32:i386 wine64 winetricks \
  fonts-wqy-microhei fonts-wqy-zenhei fonts-noto-cjk \
  cabextract
wine --version
# wine-10.0 (Ubuntu 10.0~repack-12ubuntu1)
```

### 3.2 初始化独立 Wine 前缀

```bash
export WINEPREFIX=/root/.wine-wecom
export WINEARCH=win64
export WINEDEBUG=-all
export LANG=zh_CN.UTF-8
export DISPLAY=:0   # 安装当时使用的是可用图形显示

wineboot -i
```

说明：每个 Windows 程序建议使用独立 `WINEPREFIX`，出问题可直接删除该目录重建，不影响其它程序。

### 3.3 下载官方安装包

```bash
mkdir -p /root/Downloads
cd /root/Downloads
curl -sSL -o WeCom_Setup.exe \
  "https://work.weixin.qq.com/wework_admin/commdownload?platform=win&from=wwindex"
ls -lh WeCom_Setup.exe
# 约 629M，实际文件名对应版本 WeCom_5.0.13.6005
```

### 3.4 配置中文字体替换（防乱码）

写入并导入 `/root/.wine-wecom/zh-fonts.reg`，把 `微软雅黑`、`宋体`、`MS Shell Dlg` 等映射到文泉驿字体，例如：

```reg
REGEDIT4

[HKEY_LOCAL_MACHINE\Software\Microsoft\Windows NT\CurrentVersion\FontSubstitutes]
"MS Shell Dlg"="WenQuanYi Micro Hei"
"MS Shell Dlg 2"="WenQuanYi Micro Hei"
"Microsoft YaHei"="WenQuanYi Micro Hei"
"微软雅黑"="WenQuanYi Micro Hei"
"SimSun"="WenQuanYi Micro Hei"
"宋体"="WenQuanYi Micro Hei"
"SimHei"="WenQuanYi Zen Hei"
```

```bash
export WINEPREFIX=/root/.wine-wecom
wine regedit /root/.wine-wecom/zh-fonts.reg
```

### 3.5 静默安装企业微信

安装包为 NSIS 格式，支持 `/S` 静默安装：

```bash
export WINEPREFIX=/root/.wine-wecom WINEDEBUG=-all LANG=zh_CN.UTF-8
wine /root/Downloads/WeCom_Setup.exe /S
# 等待安装完成
find "$WINEPREFIX/drive_c" -iname "WXWork.exe"
# 期望路径：.../Program Files (x86)/WXWork/WXWork.exe
```

### 3.6 创建启动脚本与桌面入口

`/root/wecom.sh`：

```bash
#!/usr/bin/env bash
export WINEPREFIX="$HOME/.wine-wecom"
export WINEDEBUG=-all
export LANG=zh_CN.UTF-8
export XMODIFIERS=@im=ibus GTK_IM_MODULE=ibus QT_IM_MODULE=ibus
exec wine "C:\\Program Files (x86)\\WXWork\\WXWork.exe" "$@"
```

说明：

- `LANG=zh_CN.UTF-8`：中文界面
- `XMODIFIERS/@im=ibus`：接入系统 ibus，便于在企业微信里输入中文
- `WINEDEBUG=-all`：减少无关日志噪音

桌面快捷方式：`/root/桌面/企业微信.desktop`（也可从应用菜单搜索「企业微信」）。

---

## 4. 日常启动与退出

### 启动

```bash
# 推荐
DISPLAY=:0 bash /root/wecom.sh

# 或后台并写日志
DISPLAY=:0 nohup bash /root/wecom.sh > /tmp/wecom.log 2>&1 &
```

也可双击桌面「企业微信」图标（注意桌面项里写的是 `wine-stable`，若本机只有 `wine` 命令，请优先用 `wecom.sh`）。

### 退出 / 彻底关掉 Wine 前缀

```bash
export WINEPREFIX=/root/.wine-wecom
/usr/lib/x86_64-linux-gnu/wine/wineserver -k
```

> 注意：`PATH` 里不一定有 `wineserver` 命令，完整路径更稳妥。

---

## 5. 遇到的问题与处理

### 5.1 安装阶段

| 问题 | 现象 / 原因 | 处理 |
|------|-------------|------|
| 缺 32 位支持 | 企业微信是 32 位，仅装 wine64 不够 | `dpkg --add-architecture i386` 并安装 `wine32:i386` |
| 中文乱码风险 | Wine 默认缺中文字体映射 | 安装文泉驿 / Noto CJK，并用 `zh-fonts.reg` 做字体替换 |
| 安装包体积大 | 官方安装包约 629MB | 用官方下载链接，确认文件完整后再静默安装 |
| 图形显示 | 安装/启动需要可用的 `DISPLAY` | 使用桌面会话的 XWayland 显示（如 `:0` / 当时的 `:2`） |

安装完成后首次启动曾成功显示扫码登录页，中文显示正常。

### 5.2 运行阶段：「等待响应」

#### 现象

GNOME 弹出「企业微信 等待响应 / 强制退出」。窗口有时仍能画出聊天列表，但桌面判定其无响应。

#### 排查结论

1. Mutter 存活检测超时为 **5 秒**（`org.gnome.mutter check-alive-timeout`）。
2. 实测 `_NET_WM_PING`：
   - 主窗口「企业微信」：**10 秒无回复**
   - 同环境下 `WeMail`：**约 5 ms 回复**
3. 主 UI 线程长期停在 `futex_do_wait`；Wine 调用栈大致为：  
   `user32 消息循环 → DuiLib → WXWork → msvcp140(_Mtx_lock) → ntdll 等待`
4. 启动日志出现：

   ```text
   wine: Unhandled page fault ... starting debugger...
   ```

   且前缀默认 `AeDebug` 为：

   ```text
   Auto=1
   Debugger=winedbg --auto %ld %ld
   ```

   子线程 page fault 后会自动挂上 `winedbg`，加重 UI 线程卡顿，导致无法回复窗口管理器 ping，从而被 GNOME 判为「等待响应」。

5. 其它次要噪音（非本次主因，但存在）：
   - GPU：`Passthrough is not supported, GL is disabled`
   - `WSALookupServiceBegin failed`、证书校验告警
   - `ntlm_auth was not found`（缺 winbind/ntlm 支持提示）
   - root 的 Wine 进程跑在 `maotuan` 的 Wayland/XWayland 会话上

#### 处理动作

关闭自动调试器，避免崩溃时自动挂调试器：

```bash
export WINEPREFIX=/root/.wine-wecom
wine reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\AeDebug" /v Auto /t REG_SZ /d 0 /f
wine reg add "HKLM\Software\Wow6432Node\Microsoft\Windows NT\CurrentVersion\AeDebug" /v Auto /t REG_SZ /d 0 /f
```

然后彻底退出并重启：

```bash
export WINEPREFIX=/root/.wine-wecom
/usr/lib/x86_64-linux-gnu/wine/wineserver -k
DISPLAY=:0 nohup bash /root/wecom.sh > /tmp/wecom.log 2>&1 &
```

#### 修复后验证

- 主窗口 `_NET_WM_PING`：**约 5 ms 稳定回复**（修复前 10 秒无回复）
- 本次日志：**未再出现** `page fault` / `starting debugger`
- GNOME 一般不再误报「等待响应」

### 5.3 排查过程中的附带坑

| 问题 | 说明 |
|------|------|
| `wineserver: 未找到命令` | 需用完整路径 `/usr/lib/x86_64-linux-gnu/wine/wineserver` |
| `winedbg` 附加后进程异常退出 | 调试用 `bt all` 会打断正在运行的企业微信，排查后需重新启动 |
| 桌面 `.desktop` 使用 `wine-stable` | 本机包提供的命令是 `wine`；日常请优先用 `/root/wecom.sh` |

---

## 6. 已知限制（Wine 下企业微信）

以下功能在 Wine 下通常不稳定或不可用，重要场景建议改用 `win11` 虚拟机 + RDP：

- 截图
- 音视频会议 / 屏幕共享
- 部分自动升级后可能打不开（升级失败时可删前缀重装）

相对较稳的：普通聊天、基础文件收发、扫码登录。

---

## 7. 常用维护命令

```bash
# 看进程
pgrep -af -i wxwork

# 看日志
tail -f /tmp/wecom.log

# 确认 AeDebug 已关闭自动调试
export WINEPREFIX=/root/.wine-wecom
wine reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\AeDebug"

# 重装前缀（慎用：会清掉该前缀内的企业微信数据）
# /usr/lib/x86_64-linux-gnu/wine/wineserver -k
# rm -rf /root/.wine-wecom
# 然后按第 3 节重新初始化与安装
```

---

## 8. 在 Linux 上跑其它 Windows exe 的通用套路

```bash
# 1) 独立前缀
export WINEPREFIX=~/.wine-xxx WINEARCH=win64
wineboot -i

# 2) 缺运行库时再补（按程序需要）
# winetricks dotnet48 vcrun2019

# 3) 安装 / 启动
wine ~/Downloads/xxx_Setup.exe /S    # 很多 NSIS 安装包支持静默安装
wine "C:\\Program Files\\xxx\\xxx.exe"
```

---

## 9. 相关文件索引

| 路径 | 用途 |
|------|------|
| `/root/wecom.sh` | 推荐启动脚本 |
| `/root/桌面/企业微信.desktop` | 桌面快捷方式 |
| `/root/.wine-wecom/` | Wine 独立前缀 |
| `/root/.wine-wecom/zh-fonts.reg` | 中文字体替换 |
| `/root/Downloads/WeCom_Setup.exe` | 官方安装包备份 |
| `/tmp/wecom.log` | 最近一次启动日志 |

---

## 10. 小结

1. 已在本机用 **Wine 10.0 + 独立前缀 `~/.wine-wecom`** 装好企业微信 `5.0.13.6005`。  
2. 日常启动用 **`/root/wecom.sh`**。  
3. 「等待响应」主因是 **UI 线程卡住 + AeDebug 自动挂调试器**；已将 `AeDebug.Auto` 设为 `0` 并验证 ping 恢复。  
4. 会议/截图等高级功能仍建议走 Windows 虚拟机。
