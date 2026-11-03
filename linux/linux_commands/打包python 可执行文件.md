在 Ubuntu 上，你可以使用 **PyInstaller** 将这个 Python 脚本打包成一个独立的、双击或直接在终端运行的可执行文件（无需让其他电脑也安装 Python 或各种依赖库）。

  

以下是具体的打包步骤：

  

### 1. 安装 PyInstaller 工具

在你的 Ubuntu 终端中运行以下命令安装 PyInstaller：

  

Bash

```
pip3 install pyinstaller
```

_(如果提示 `pip3` 找不到，可以先运行 `sudo apt install python3-pip`)_

  

### 2. 执行打包命令

确保你在终端中处于 `chess_app.py` 文件所在的目录，然后运行以下命令：

  

Bash

```
pyinstaller --onefile --windowed chess_app.py
```

**参数解释：**

  

- `--onefile`：将所有依赖库、Python 解释器和你的代码全部打包压缩成 **单独的一个文件**。
    
      
    
- `--windowed`（或 `--noconsole`）：告诉系统这是一个 GUI 图形界面程序。当你双击运行或启动它时，**不会弹出一个黑色的终端背景窗口**。
    
      
    

### 3. 找到并运行你的可执行文件

打包过程大约需要 10 到 30 秒。完成后，你的当前目录下会多出几个文件夹（`build`、`dist` 和一个 `.spec` 文件）。

  

你要的最终可执行文件在 **`dist`** 文件夹中：

  

1. 进入 `dist` 目录：
    
      
    
    Bash
    
    ```
    cd dist
    ```
    
2. 赋予它可执行权限（通常 PyInstaller 已经默认赋予了，保险起见再加一次）：
    
      
    
    Bash
    
    ```
    chmod +x chess_app
    ```
    
3. 运行它：
    
      
    
    Bash
    
    ```
    ./chess_app
    ```
    

### 4. （可选）清理临时文件

打包成功后，外层的 `build` 文件夹和 `chess_app.spec` 文件只是打包时的临时缓存，可以安全删除。你只需要保留 `dist/chess_app` 这个文件，并可以把它随意拷贝到其他 Ubuntu 机器上直接运行！