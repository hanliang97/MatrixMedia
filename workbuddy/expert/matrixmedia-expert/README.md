# 矩矩 · 自媒体矩阵发布运营官

WorkBuddy 专家。把一条视频按各平台规则改写标题、简介和标签，通过本机的 [矩媒 MatrixMedia](https://github.com/hanliang97/MatrixMedia) 桌面端一键发布到抖音、快手、视频号、小红书、哔哩哔哩、百家号、头条、番茄视频，并检查账号登录态、复盘发布数据。

## 使用前提

- 已安装矩媒桌面端：[GitHub Releases](https://github.com/hanliang97/MatrixMedia/releases) · [Gitee Releases](https://gitee.com/gzlingyi_0/pubtw/releases)
- 抖音、视频号可在对话中扫码登录；其他平台需先在桌面端登录一次。

## 能做什么

| 场景       | 示例                                                     |
| ---------- | -------------------------------------------------------- |
| 一稿多发   | 帮我把 ~/Desktop/demo.mp4 发到抖音、视频号和小红书       |
| 定时排期   | 这三条视频分别在明天、后天、大后天晚上 8 点发到抖音      |
| 账号体检   | 检查哪些账号需要重新登录                                 |
| 数据复盘   | 复盘最近 7 天的发布数据                                  |

每次发布前，专家都会列出各平台的标题、简介、标签方案，经你确认后才执行。

## 目录

```
matrixmedia-expert/
├── .codebuddy-plugin/plugin.json   # 专家配置与市场展示信息
├── agents/matrixmedia-operator.md  # 系统提示词
├── skills/matrixmedia-publish/     # 矩媒 CLI 技能（命令与平台字段规则）
├── avatars/expert.png
└── README.md
```
