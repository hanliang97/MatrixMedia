---
title: 快速开始
description: 下载安装矩媒 MatrixMedia，并了解 GUI、CLI、HTTP API 与 MCP 的上手路径。
---

# 快速开始

## 下载

| 渠道                   | 地址                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| GitHub Releases        | [github.com/hanliang97/MatrixMedia/releases](https://github.com/hanliang97/MatrixMedia/releases) |
| Gitee Releases（国内） | [gitee.com/gzlingyi_0/pubtw/releases](https://gitee.com/gzlingyi_0/pubtw/releases/)              |

支持 **Windows**、**macOS**、**Linux**（x64 / arm64）。Linux 提供多种安装包，见下文。

## Windows

下载 `MatrixMedia-<version>-win-x64.exe`，双击安装即可。

## macOS

下载 `MatrixMedia-<version>-mac-x64.dmg`，拖入「应用程序」。首次打开若提示无法验证，在「系统设置 → 隐私与安全性」点击「仍要打开」。

## Linux

Linux 提供四种安装包，按发行版选择：

| 包格式                     | 适用发行版                  | 安装命令                                       |
| -------------------------- | --------------------------- | ---------------------------------------------- |
| `MatrixMedia-<ver>-linux-x64.AppImage` | 通用（免安装）    | `chmod +x *.AppImage && ./MatrixMedia-*.AppImage` |
| `MatrixMedia-<ver>-linux-x64.deb`      | Debian / Ubuntu  | `sudo dpkg -i MatrixMedia-*.deb`               |
| `MatrixMedia-<ver>-linux-x64.rpm`      | Fedora / RHEL / openSUSE | `sudo rpm -i MatrixMedia-*.rpm`           |
| `MatrixMedia-<ver>-linux-x64.tar.gz`   | 便携版（任意发行版，CLI 友好） | `tar -xzf MatrixMedia-*.tar.gz -C ~/mm && cd ~/mm && ./matrixmedia` |

> arm64 设备（如树莓派、ARM 服务器）请下载文件名含 `arm64` 的对应包。

### 依赖

deb / rpm 安装会自动拉取依赖。若用 AppImage 或 tar.gz 遇到无法启动，通常缺少 Electron 运行库，按发行版补齐：

```bash
# Debian / Ubuntu
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
  libatspi2.0-0 libdrm2 libgbm1

# Fedora / RHEL
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils \
  at-spi2-atk libdrm mesa-libgbm
```

### Linux 走 CLI

很多 Linux 用户无图形环境，只想用 CLI。便携包解压后直接调用：

```bash
tar -xzf MatrixMedia-<version>-linux-x64.tar.gz -C ~/matrixmedia
cd ~/matrixmedia

# 查看帮助
./matrixmedia cli --help

# 抖音登录（终端二维码）
./matrixmedia cli login -p dy --phone 13800138000

# 发布
./matrixmedia cli publish --help

# 账号状态 / 历史
./matrixmedia cli accounts --json
./matrixmedia cli history --json
```

为方便使用，可加入 `PATH`：

```bash
sudo ln -sf "$PWD/matrixmedia" /usr/local/bin/matrixmedia
# 之后可直接
matrixmedia cli publish --help
```

完整 CLI 说明见 [CLI 参考](/reference/cli)。

## 图形界面

1. 安装并启动应用
2. 在侧栏各平台完成账号登录
3. 使用本地视频发布 / 批量设置进行矩阵分发

打开应用后可在「项目详情」页查看 HTTP / MCP / CLI 接入说明。

## 命令行（CLI）

同一可执行文件支持 CLI。典型流程：

```bash
# 抖音登录（终端二维码）
matrixmedia cli login -p dy --phone 13800138000

# 发布（示例，参数以 --help 为准）
matrixmedia cli publish --help
```

完整说明见 [CLI 参考](/reference/cli)。

## HTTP API

GUI 启动后，本机默认监听 `http://127.0.0.1:30088`，可通过 `POST /publish` 触发发布。

详见 [HTTP API](/reference/http-api)。

## MCP（AI 工具接入）

仓库内置 `mcp/` 子包，可被 Claude Desktop、Cursor 等通过 stdio 调用。

详见 [MCP](/reference/mcp)。

## 教程视频

[B 站教程](https://www.bilibili.com/video/BV1fiX5BzEb7)

## 更多文档

- 国内 Wiki：[Gitee Wiki](https://gitee.com/gzlingyi_0/pubtw/wikis/pages?sort_id=14772656&doc_id=7335804)
- 源码仓库：[GitHub · MatrixMedia](https://github.com/hanliang97/MatrixMedia)
- 官网文档：[hanliang97.github.io/MatrixMedia](https://hanliang97.github.io/MatrixMedia/)
