# EgernScript

给 [Egern](https://egernapp.com/) 用的脚本仓库。  
目前包含一个通过 SSH 监控 Linux 服务器状态的小组件脚本：

- `server-monitor-widget.js`

## 功能

这个小组件会显示：

- 在线状态
- 系统运行时长
- CPU 负载
- 内存占用
- 磁盘占用
- 当前入站速度
- 当前出站速度

## 使用方法

1. 在 Egern 里新建一个 `generic` 类型脚本
2. 把仓库里的 `server-monitor-widget.js` 内容贴进去
3. 新建一个 widget，并把 `script_name` 指向这个脚本
4. 填好对应环境变量

也可以按下面这个配置思路接入：

```yaml
scriptings:
  - generic:
      name: "server-monitor-widget"
      script_url: "https://raw.githubusercontent.com/jsllxx77/EgernScript/main/server-monitor-widget.js"
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

## 注意事项

- 第一次刷新没有上一次网卡字节数，所以流量速度会显示 `--`
- 第二次刷新开始，才会显示真实入站/出站速度
- 脚本默认按 Linux 环境取数，依赖 `uptime`、`df`、`free`、`/proc`、`/sys/class/net`
- `IFACE` 不填时会优先尝试自动探测默认路由网卡

## 文件

- `server-monitor-widget.js`：Egern 服务器监控小组件脚本
