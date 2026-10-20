# EgernScript

给 [Egern](https://egernapp.com/) / Surge 用的脚本与规则仓库。

## 目录结构

| 目录 | 内容 | 说明 |
| --- | --- | --- |
| [`modules/`](modules) | `.sgmodule` / `.yaml` | 模块配置。同一功能的 Surge 版（`.sgmodule`）与 Egern 版（`.yaml`）成对存放 |
| [`rules/`](rules) | `.yaml` / `.list` | 分流规则集，作为 rule provider 或规则列表引用 |
| [`scripts/`](scripts) | `.js` | 脚本本体，由 `modules/` 里的 `script_url` / `script-path` 远程引用 |

新增文件请按上面三类放进对应目录，并同步更新本文末尾的「文件索引」。

## 服务器监控小组件

通过 SSH 监控 Linux 服务器状态，脚本位于 `scripts/server-monitor-widget.js`。

## 功能

这个小组件会显示：

- 在线状态
- 系统运行时长
- CPU 负载
- 内存占用
- 磁盘占用
- 当前入站速度
- 当前出站速度
- 磁盘读写速度（I/O）
- 网络累计流量
- 磁盘累计读写量

## 使用方法

1. 在 Egern 里新建一个 `generic` 类型脚本
2. 把仓库里的 `scripts/server-monitor-widget.js` 内容贴进去
3. 新建一个 widget，并把 `script_name` 指向这个脚本
4. 填好对应环境变量

也可以按下面这个配置思路接入：

```yaml
scriptings:
  - generic:
      name: "server-monitor-widget"
      script_url: "https://raw.githubusercontent.com/jsllxx77/EgernScript/refs/heads/main/scripts/server-monitor-widget.js"
      timeout: 20

widgets:
  - name: "server-monitor"
    script_name: "server-monitor-widget"
    env:
      HOST: "192.168.1.100"
      PORT: "22"
      USERNAME: "root"
      PRIVATE_KEY: |
        -----BEGIN OPENSSH PRIVATE KEY-----
        replace-this-with-your-private-key
        -----END OPENSSH PRIVATE KEY-----
      PASSPHRASE: ""
      IFACE: "eth0"
      TITLE: "My Server"
      DISK_PATH: "/"
      TIMEOUT_MS: "10000"
```

## 环境变量

| 变量名 | 说明 |
| --- | --- |
| `HOST` | 服务器地址 |
| `PORT` | SSH 端口，默认 `22` |
| `USERNAME` | SSH 用户名 |
| `PASSWORD` | SSH 密码，可选，和 `PRIVATE_KEY` 二选一 |
| `PRIVATE_KEY` | SSH 私钥内容，可选，和 `PASSWORD` 二选一 |
| `PASSPHRASE` | 私钥密码，可选 |
| `IFACE` | 网卡名，比如 `eth0`、`ens18`，不填会自动探测 |
| `TITLE` | 小组件标题 |
| `DISK_PATH` | 要监控的磁盘路径，默认 `/` |
| `TIMEOUT_MS` | SSH 连接超时时间，单位毫秒，默认 `10000` |

## 调试开关

排查桌面小组件问题时，可以临时加这些环境变量：

| 变量名 | 说明 |
| --- | --- |
| `DEBUG_STATIC` | 返回静态监控数据，但仍走正常 widget 布局 |
| `DEBUG_MINIMAL` | 返回最小可渲染 widget，只保留纯文本，用来排查桌面黑屏/白屏 |

调试完成后建议删除这些变量，避免影响正常显示。

## 注意事项

- 第一次刷新没有上一次网卡字节数，所以流量速度会显示 `--`
- 第二次刷新开始，才会显示真实入站/出站速度
- 为了计算真实磁盘 `I/O` 速度，脚本会额外对磁盘状态做一次 1 秒双采样，所以单次刷新会多约 1 秒等待
- 脚本默认按 Linux 环境取数，依赖 `uptime`、`df`、`free`、`/proc`、`/sys/class/net`、`/sys/block/*/stat`
- `IFACE` 不填时会优先尝试自动探测默认路由网卡
- 桌面中组件目前使用了更稳的简化布局，优先保证桌面正常渲染

## 文件索引

| 文件 | 说明 |
| --- | --- |
| [`scripts/server-monitor-widget.js`](scripts/server-monitor-widget.js) | Egern 服务器监控小组件脚本 |
| [`scripts/smzdm_checkin.js`](scripts/smzdm_checkin.js) | 什么值得买 Cookie 捕获 / 手动签到 |
| [`scripts/x_cookie_capture.js`](scripts/x_cookie_capture.js) | X（Twitter）`auth_token` + `ct0` 捕获并推送服务器 |
| [`scripts/wyy.js`](scripts/wyy.js) | 网易云 Cookie 提取并推送服务器 |
| [`modules/Redirect2Swift.sgmodule`](modules/Redirect2Swift.sgmodule) | TG 外链跳转 Swiftgram（Surge） |
| [`modules/Redirect2Swift.yaml`](modules/Redirect2Swift.yaml) | TG 外链跳转 Swiftgram（Egern） |
| [`modules/smzdm_checkin.sgmodule`](modules/smzdm_checkin.sgmodule) | 什么值得买 Cookie 获取（Surge） |
| [`modules/smzdm_cookie_capture.yaml`](modules/smzdm_cookie_capture.yaml) | 什么值得买 Cookie 获取（Egern） |
| [`modules/x_cookie_capture.sgmodule`](modules/x_cookie_capture.sgmodule) | X Cookie 捕获（Surge） |
| [`modules/x_cookie_capture.yaml`](modules/x_cookie_capture.yaml) | X Cookie 捕获（Egern） |
| [`modules/wyy.sgmodule`](modules/wyy.sgmodule) | 网易云 Cookie 提取（Surge） |
| [`rules/CustomDirect.yaml`](rules/CustomDirect.yaml) | 直连域名规则集 |
| [`rules/CustomEmby.yaml`](rules/CustomEmby.yaml) | Emby 服务器规则集 |
| [`rules/surge-reject-drop.list`](rules/surge-reject-drop.list) | 广告 / 统计域名 REJECT 列表 |
