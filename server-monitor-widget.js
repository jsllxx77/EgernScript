const DEFAULT_TITLE = 'Server Monitor';
const DEFAULT_PORT = 22;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_DISK_PATH = '/';
const STORAGE_PREFIX = 'server-monitor-widget';

export default async function (ctx) {
  const env = ctx.env || {};
  if (isMinimalDebugEnabled(env)) {
    return renderMinimalDebugWidget(firstNonEmpty(env.TITLE, env.title) || DEFAULT_TITLE);
  }
  if (isStaticDebugEnabled(env)) {
    return renderStaticDebugWidget(firstNonEmpty(env.TITLE, env.title) || DEFAULT_TITLE, ctx.widgetFamily);
  }

  const config = readConfig(env);
  let session;

  try {
    session = await ctx.ssh.connect(buildSshConfig(config));

    const result = await session.exec(buildProbeCommand(config));
    if (result.code !== 0) {
      throw new Error(readExecText(result.stderr) || `remote command failed (${result.code})`);
    }

    const probe = parseProbeOutput(readExecText(result.stdout));
    if (probe.error) {
      throw new Error(probe.error);
    }

    const metrics = normalizeProbe(probe);
    const traffic = updateTrafficRate(ctx, config, metrics);
    const view = buildViewModel(config, metrics, traffic);

    return renderWidget(view, ctx.widgetFamily);
  } catch (error) {
    return renderErrorWidget(config.title, normalizeError(error), ctx.widgetFamily);
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (_) {}
    }
  }
}

function isMinimalDebugEnabled(env) {
  const value = firstNonEmpty(env.DEBUG_MINIMAL, env.debug_minimal, env.debugMinimal).toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function isStaticDebugEnabled(env) {
  const value = firstNonEmpty(env.DEBUG_STATIC, env.debug_static, env.debugStatic).toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function readConfig(env) {
  const host = firstNonEmpty(env.HOST, env.host);
  const username = firstNonEmpty(env.USERNAME, env.USER, env.user);
  const password = firstNonEmpty(env.PASSWORD, env.password);
  const privateKey = firstNonEmpty(env.PRIVATE_KEY, env.privateKey, env.key);
  const passphrase = firstNonEmpty(env.PASSPHRASE, env.passphrase);
  const iface = firstNonEmpty(env.IFACE, env.iface);
  const title = firstNonEmpty(env.TITLE, env.title) || DEFAULT_TITLE;
  const diskPath = firstNonEmpty(env.DISK_PATH, env.disk_path) || DEFAULT_DISK_PATH;
  const port = parseInteger(firstNonEmpty(env.PORT, env.port), DEFAULT_PORT);
  const timeout = parseInteger(firstNonEmpty(env.TIMEOUT_MS, env.timeout), DEFAULT_TIMEOUT_MS);

  if (!host) {
    throw new Error('missing HOST');
  }
  if (!username) {
    throw new Error('missing USERNAME');
  }
  if (!password && !privateKey) {
    throw new Error('set PASSWORD or PRIVATE_KEY');
  }

  return {
    host,
    port,
    username,
    password,
    privateKey,
    passphrase,
    iface,
    title,
    diskPath,
    timeout,
  };
}

function buildSshConfig(config) {
  const sshConfig = {
    host: config.host,
    port: config.port,
    username: config.username,
    timeout: config.timeout,
  };

  if (config.password) {
    sshConfig.password = config.password;
  }
  if (config.privateKey) {
    sshConfig.privateKey = config.privateKey;
  }
  if (config.passphrase) {
    sshConfig.passphrase = config.passphrase;
  }

  return sshConfig;
}

function buildProbeCommand(config) {
  const quotedIface = shellQuote(config.iface || '');
  const quotedDiskPath = shellQuote(config.diskPath);

  return [
    'set -eu',
    `IFACE=${quotedIface}`,
    `DISK_PATH=${quotedDiskPath}`,
    'if [ -z "$IFACE" ]; then IFACE="$(ip route show default 2>/dev/null | awk \'/default/ {print $5; exit}\')"; fi',
    'if [ -z "$IFACE" ]; then IFACE="$(ls /sys/class/net 2>/dev/null | awk \'$1 != "lo" {print; exit}\')"; fi',
    'if [ -z "$IFACE" ]; then printf "error=%s\\n" "unable to resolve network interface"; exit 0; fi',
    'UPTIME="$(uptime -p 2>/dev/null || true)"',
    'if [ -z "$UPTIME" ] && [ -r /proc/uptime ]; then UPTIME="$(cut -d. -f1 /proc/uptime)"; fi',
    'LOAD="$(cut -d" " -f1-3 /proc/loadavg 2>/dev/null || true)"',
    'MEM="$(free -m 2>/dev/null | awk \'/^Mem:/ {printf "%s %s %.0f", $2, $3, ($3/$2)*100}\')"',
    'if [ -z "$MEM" ] && [ -r /proc/meminfo ]; then MEM="$(awk \'/MemTotal:/ {t=$2} /MemAvailable:/ {a=$2} END {if (t > 0) {u=(t-a)/1024; printf "%d %d %.0f", t/1024, u, ((t-a)/t)*100}}\' /proc/meminfo)"; fi',
    'DISK="$(df -h "$DISK_PATH" 2>/dev/null | awk \'NR==2 {printf "%s %s %s", $2, $3, $5}\')"',
    'RX="$(cat "/sys/class/net/$IFACE/statistics/rx_bytes" 2>/dev/null || echo 0)"',
    'TX="$(cat "/sys/class/net/$IFACE/statistics/tx_bytes" 2>/dev/null || echo 0)"',
    'printf "iface=%s\\n" "$IFACE"',
    'printf "uptime=%s\\n" "$UPTIME"',
    'printf "load=%s\\n" "$LOAD"',
    'printf "mem=%s\\n" "$MEM"',
    'printf "disk=%s\\n" "$DISK"',
    'printf "rx=%s\\n" "$RX"',
    'printf "tx=%s\\n" "$TX"',
  ].join('; ');
}

function parseProbeOutput(stdout) {
  const data = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const index = line.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    data[key] = value;
  }
  return data;
}

function normalizeProbe(probe) {
  const memory = parseMemory(probe.mem);
  const disk = parseDisk(probe.disk);

  return {
    iface: probe.iface || '--',
    uptime: formatUptime(probe.uptime),
    load: formatLoad(probe.load),
    memoryText: memory,
    diskText: disk,
    rxBytes: parseInteger(probe.rx, 0),
    txBytes: parseInteger(probe.tx, 0),
  };
}

function updateTrafficRate(ctx, config, metrics) {
  const key = [STORAGE_PREFIX, config.host, config.username, metrics.iface].join(':');
  const now = Date.now();
  let previous = null;

  try {
    previous = ctx.storage.getJSON(key);
  } catch (_) {}

  try {
    ctx.storage.setJSON(key, {
      at: now,
      iface: metrics.iface,
      rxBytes: metrics.rxBytes,
      txBytes: metrics.txBytes,
    });
  } catch (_) {}

  if (!previous || previous.iface !== metrics.iface) {
    return { inbound: '--', outbound: '--' };
  }

  const elapsedSeconds = (now - Number(previous.at || 0)) / 1000;
  const rxDelta = metrics.rxBytes - Number(previous.rxBytes || 0);
  const txDelta = metrics.txBytes - Number(previous.txBytes || 0);

  if (elapsedSeconds < 1 || rxDelta < 0 || txDelta < 0) {
    return { inbound: '--', outbound: '--' };
  }

  return {
    inbound: formatBytesPerSecond(rxDelta / elapsedSeconds),
    outbound: formatBytesPerSecond(txDelta / elapsedSeconds),
  };
}

function buildViewModel(config, metrics, traffic) {
  const memoryPrimary = usagePrimary(metrics.memoryText);
  const memorySecondary = usageSecondary(metrics.memoryText);
  const diskPrimary = usagePrimary(metrics.diskText);
  const diskSecondary = usageSecondary(metrics.diskText);

  return {
    title: config.title,
    status: '在线',
    statusColor: '#63D2A1',
    iface: metrics.iface,
    uptime: metrics.uptime,
    load: metrics.load,
    memory: metrics.memoryText,
    disk: metrics.diskText,
    inbound: traffic.inbound,
    outbound: traffic.outbound,
    inboundCompact: compactRate(traffic.inbound),
    outboundCompact: compactRate(traffic.outbound),
    trafficLine: `↓ ${traffic.inbound}    ↑ ${traffic.outbound}`,
    memoryLine: `内存 ${metrics.memoryText}`,
    loadLine: `负载 ${metrics.load}`,
    diskLine: `磁盘 ${metrics.diskText}`,
    uptimeLine: `运行 ${metrics.uptime}`,
    ifaceLine: `网卡 ${metrics.iface}`,
    memoryPrimary,
    memorySecondary,
    diskPrimary,
    diskSecondary,
    uptimeCompact: compactUptime(metrics.uptime),
    refreshedAt: new Date().toISOString(),
  };
}

function renderWidget(view, family) {
  if (family === 'systemSmall') {
    return renderSmallWidget(view);
  }
  if (family === 'systemLarge' || family === 'systemExtraLarge') {
    return renderLargeWidget(view);
  }
  if (family === 'accessoryInline') {
    return renderAccessoryInline(view);
  }
  if (family === 'accessoryCircular') {
    return renderAccessoryCircular(view);
  }
  if (family === 'accessoryRectangular') {
    return renderAccessoryRectangular(view);
  }
  return renderMediumWidget(view);
}

function renderMediumWidget(view) {
  return {
    type: 'widget',
    url: 'egern://',
    backgroundColor: { light: '#1C1C1E', dark: '#1C1C1E' },
    padding: 12,
    gap: 10,
    children: [
      renderMediumHeaderSafe(view),
      {
        type: 'stack',
        direction: 'column',
        gap: 10,
        children: [
          {
            type: 'stack',
            direction: 'row',
            gap: 8,
            children: [
              mediumTextMetricCard('流量', `↓ ${view.inboundCompact}`, `↑ ${view.outboundCompact}`),
              mediumTextMetricCard('内存', view.memoryPrimary, view.memorySecondary),
            ],
          },
          {
            type: 'stack',
            direction: 'row',
            gap: 8,
            children: [
              mediumTextMetricCard('负载', view.load, '1 / 5 / 15'),
              mediumTextMetricCard('磁盘', view.diskPrimary, view.diskSecondary),
            ],
          },
        ],
      },
      renderMediumFooterSafe(view),
    ],
  };
}

function renderLargeWidget(view) {
  return {
    type: 'widget',
    backgroundColor: { light: '#F2F2F7', dark: '#1C1C1E' },
    padding: 14,
    gap: 10,
    children: [
      renderHeader(view),
      renderHeroPanel(view),
      renderInfoPanels(view),
      renderFooter(view),
    ],
  };
}

function renderStaticDebugWidget(title, family) {
  const debugView = {
    title,
    status: '静态',
    statusColor: '#63D2A1',
    iface: 'debug0',
    uptime: '1d 2h',
    load: '0.12 0.08 0.05',
    memory: '4.2G/23G (18%)',
    disk: '12G/40G (30%)',
    inbound: '123 KB/s',
    outbound: '159 KB/s',
    inboundCompact: '123K/s',
    outboundCompact: '159K/s',
    trafficLine: '↓ 123 KB/s    ↑ 159 KB/s',
    memoryLine: '内存 4.2G/23G (18%)',
    loadLine: '负载 0.12 0.08 0.05',
    diskLine: '磁盘 12G/40G (30%)',
    uptimeLine: '运行 1d 2h',
    ifaceLine: '网卡 debug0',
    memoryPrimary: '4.2G/23G',
    memorySecondary: '18%',
    diskPrimary: '12G/40G',
    diskSecondary: '30%',
    uptimeCompact: '1d 2h',
    refreshedAt: new Date().toISOString(),
  };

  return renderWidget(debugView, family);
}

function renderMinimalDebugWidget(title) {
  return {
    type: 'widget',
    backgroundColor: '#1C1C1E',
    padding: 16,
    gap: 8,
    children: [
      {
        type: 'text',
        text: title,
        font: { size: 'headline', weight: 'semibold' },
        textColor: '#FFFFFF',
      },
      {
        type: 'text',
        text: 'DEBUG_MINIMAL',
        font: { size: 'body', weight: 'semibold' },
        textColor: '#7DD3FC',
      },
      {
        type: 'text',
        text: '如果桌面能显示这三行，说明黑屏不是基础 widget 渲染问题。',
        font: { size: 'caption1' },
        textColor: '#C7C7CC',
      },
    ],
  };
}

function renderSmallWidget(view) {
  return {
    type: 'widget',
    backgroundColor: { light: '#F2F2F7', dark: '#1C1C1E' },
    padding: 12,
    gap: 8,
    children: [
      renderHeader(view),
      panelNode([
        headerLabel('实时流量'),
        textNode(view.trafficLine, 'subheadline', colors.primary, 'semibold', {
          maxLines: 2,
          minScale: 0.7,
        }),
        textNode(view.memoryLine, 'caption1', colors.secondary, undefined, {
          maxLines: 1,
          minScale: 0.8,
        }),
      ], 'panelStrong'),
      panelNode([
        infoLine('负载', view.load, 'sf-symbol:speedometer'),
        infoLine('磁盘', view.disk, 'sf-symbol:internaldrive'),
      ], 'panelSoft'),
      renderFooter(view),
    ],
  };
}

function renderAccessoryInline(view) {
  return {
    type: 'widget',
    children: [
      textNode(
        `${view.title} ${view.status} ↓${view.inbound} ↑${view.outbound}`,
        'caption2',
        colors.primary,
        'semibold'
      ),
    ],
  };
}

function renderAccessoryCircular(view) {
  return {
    type: 'widget',
    padding: 8,
    gap: 3,
    children: [
      symbolNode('sf-symbol:arrow.down.forward.circle.fill', view.statusColor, 14),
      textNode(view.inbound, 'caption2', colors.primary, 'bold'),
      textNode(view.outbound, 'caption2', colors.secondary),
    ],
  };
}

function renderAccessoryRectangular(view) {
  return {
    type: 'widget',
    padding: 10,
    gap: 4,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          symbolNode('sf-symbol:server.rack', colors.secondary, 12),
          textNode(view.title, 'caption1', colors.primary, 'bold', { maxLines: 1, minScale: 0.8 }),
          { type: 'spacer' },
          textNode(view.status, 'caption2', view.statusColor, 'semibold'),
        ],
      },
      textNode(view.trafficLine, 'caption2', colors.primary, 'semibold', { maxLines: 1, minScale: 0.7 }),
      textNode(view.uptimeLine, 'caption2', colors.secondary, undefined, { maxLines: 1, minScale: 0.8 }),
    ],
  };
}

function renderErrorWidget(title, message, family) {
  const view = {
    title,
    status: 'ERR',
    statusColor: '#EF4444',
    iface: '--',
    uptime: '--',
    load: '--',
    memory: '--',
    disk: '--',
    inbound: '--',
    outbound: '--',
    refreshedAt: new Date().toISOString(),
    message,
  };

  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [textNode(`${title} ERR ${message}`, 'caption2', '#FFFFFF', 'semibold')],
    };
  }

  return {
    type: 'widget',
    backgroundColor: { light: '#F2F2F7', dark: '#1C1C1E' },
    padding: 14,
    gap: 8,
    children: [
      renderErrorHeader(title),
      panelNode(
        [
          textNode(message, 'caption1', '#FFB4B4', undefined, {
            maxLines: 3,
            minScale: 0.75,
          }),
        ],
        'panelError'
      ),
      renderFooter(view, '#FFB4B4'),
    ],
  };
}

function renderHeader(view) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 8,
    children: [
      symbolNode('sf-symbol:server.rack', colors.icon, 15),
      {
        type: 'stack',
        direction: 'column',
        gap: 1,
        children: [
          textNode(view.title, 'headline', colors.primary, 'semibold', {
            maxLines: 1,
            minScale: 0.75,
          }),
          textNode(view.ifaceLine, 'caption2', colors.secondary, undefined, {
            maxLines: 1,
            minScale: 0.8,
          }),
        ],
      },
      { type: 'spacer' },
      badgeNode(view.status, view.statusColor),
    ],
  };
}

function renderMediumHeaderSafe(view) {
  return {
    type: 'stack',
    direction: 'row',
    children: [
      textNode(view.title, 'subheadline', SAFE_TEXT_MAIN, 'semibold', {
        maxLines: 1,
        minScale: 0.7,
      }),
      { type: 'spacer' },
      textNode(view.status, 'caption1', SAFE_STATUS_OK, 'semibold'),
    ],
  };
}

function renderHeroPanel(view) {
  return panelNode(
    [
      headerLabel('实时流量'),
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 8,
        children: [
          symbolNode('sf-symbol:arrow.down.forward.circle.fill', '#7DD3FC', 16),
          textNode(view.inbound, 'title3', colors.primary, 'semibold', {
            maxLines: 1,
            minScale: 0.65,
          }),
          { type: 'spacer' },
          symbolNode('sf-symbol:arrow.up.forward.circle.fill', '#A7F3D0', 16),
          textNode(view.outbound, 'title3', colors.primary, 'semibold', {
            maxLines: 1,
            minScale: 0.65,
          }),
        ],
      },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          symbolNode('sf-symbol:memorychip', colors.secondary, 13),
          textNode(view.memoryLine, 'caption1', colors.secondary, undefined, {
            maxLines: 1,
            minScale: 0.8,
          }),
        ],
      },
    ],
    'panelStrong'
  );
}

function renderInfoPanels(view) {
  return {
    type: 'stack',
    direction: 'column',
    gap: 8,
    children: [
      panelNode(
        [
          headerLabel('系统概况'),
          infoLine('负载', view.load, 'sf-symbol:speedometer'),
          infoLine('运行', view.uptime, 'sf-symbol:timer'),
        ],
        'panelSoft'
      ),
      panelNode(
        [
          headerLabel('资源'),
          infoLine('磁盘', view.disk, 'sf-symbol:internaldrive'),
          infoLine('网卡', view.iface, 'sf-symbol:cable.connector'),
        ],
        'panelMuted'
      ),
    ],
  };
}

function renderFooter(view, color) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      symbolNode('sf-symbol:clock', color || colors.secondary, 11),
      {
        type: 'date',
        date: view.refreshedAt,
        format: 'relative',
        font: { size: 'caption2' },
        textColor: color || colors.secondary,
      },
    ],
  };
}

function renderMediumFooterSafe(view) {
  return {
    type: 'stack',
    direction: 'row',
    children: [
      textNode(view.uptimeCompact, 'caption2', SAFE_TEXT_SUB, undefined, {
        maxLines: 1,
        minScale: 0.65,
      }),
      { type: 'spacer' },
      textNode(view.iface, 'caption2', SAFE_TEXT_SUB, undefined, {
        maxLines: 1,
        minScale: 0.65,
      }),
      { type: 'spacer' },
      textNode('已刷新', 'caption2', SAFE_TEXT_SUB),
    ],
  };
}

function renderErrorHeader(title) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 8,
    children: [
      symbolNode('sf-symbol:exclamationmark.triangle.fill', '#FF6B6B', 15),
      textNode(title, 'headline', colors.primary, 'semibold'),
      { type: 'spacer' },
      badgeNode('异常', '#FF6B6B'),
    ],
  };
}

function panelNode(children, tone) {
  const style = panelStyles[tone];
  return {
    type: 'stack',
    direction: 'column',
    gap: style.gap,
    padding: style.padding,
    backgroundColor: style.backgroundColor,
    borderRadius: style.borderRadius,
    borderWidth: 1,
    borderColor: style.borderColor,
    children,
  };
}

function compactMetricCard(label, primary, secondary, symbol) {
  return {
    type: 'stack',
    direction: 'column',
    gap: 3,
    flex: 1,
    padding: 8,
    height: 58,
    backgroundColor: panelStyles.panelSoft.backgroundColor,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: panelStyles.panelSoft.borderColor,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 5,
        children: [
          symbolNode(symbol, colors.secondary, 11),
          textNode(label, 'caption2', colors.tertiary, 'semibold', {
            maxLines: 1,
            minScale: 0.8,
          }),
        ],
      },
      textNode(primary, 'caption1', colors.primary, 'semibold', {
        maxLines: 1,
        minScale: 0.55,
      }),
      textNode(secondary, 'caption2', colors.secondary, undefined, {
        maxLines: 1,
        minScale: 0.7,
      }),
    ],
  };
}

function mediumTextMetricCard(label, primary, secondary) {
  return {
    type: 'stack',
    direction: 'column',
    gap: 2,
    flex: 1,
    children: [
      textNode(label, 'caption2', SAFE_TEXT_SUB, 'semibold', {
        maxLines: 1,
        minScale: 0.8,
      }),
      textNode(primary, 'caption1', SAFE_TEXT_MAIN, 'semibold', {
        maxLines: 1,
        minScale: 0.55,
      }),
      textNode(secondary, 'caption2', SAFE_TEXT_SUB, undefined, {
        maxLines: 1,
        minScale: 0.65,
      }),
    ],
  };
}

function headerLabel(text) {
  return textNode(text, 'caption2', colors.tertiary, 'semibold', {
    maxLines: 1,
    minScale: 0.8,
  });
}

function infoLine(label, value, symbol) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      symbolNode(symbol, colors.secondary, 12),
      textNode(label, 'caption1', colors.secondary),
      { type: 'spacer' },
      textNode(value, 'caption1', colors.primary, 'semibold', {
        maxLines: 1,
        minScale: 0.65,
      }),
    ],
  };
}

function badgeNode(text, color) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 4,
    padding: [4, 8, 4, 8],
    backgroundColor: { light: '#FFFFFF', dark: '#2C2C2E' },
    borderRadius: 999,
    borderWidth: 1,
    borderColor: { light: '#E5E7EB', dark: '#3A3A3C' },
    children: [
      symbolNode('sf-symbol:dot.radiowaves.left.and.right', color, 10),
      textNode(text, 'caption2', color, 'semibold'),
    ],
  };
}

function symbolNode(src, color, size) {
  return {
    type: 'image',
    src,
    color,
    width: size,
    height: size,
  };
}

function textNode(text, size, color, weight, extra) {
  const node = {
    type: 'text',
    text,
    font: { size },
    textColor: color,
  };

  if (weight) {
    node.font.weight = weight;
  }

  if (extra) {
    Object.assign(node, extra);
  }

  return node;
}

function formatUptime(value) {
  if (!value) {
    return '--';
  }

  if (/^\d+$/.test(value)) {
    return formatSeconds(Number(value));
  }

  return value.replace(/^up\s+/, '') || '--';
}

function formatLoad(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1]} ${parts[2]}`;
  }

  return '--';
}

function parseMemory(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 3) {
    return '--';
  }

  const totalMb = parseInteger(parts[0], 0);
  const usedMb = parseInteger(parts[1], 0);
  const percent = parts[2].endsWith('%') ? parts[2] : `${parts[2]}%`;

  if (!totalMb) {
    return '--';
  }

  return `${formatMegabytes(usedMb)}/${formatMegabytes(totalMb)} (${percent})`;
}

function parseDisk(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 3) {
    return '--';
  }

  return `${parts[1]}/${parts[0]} (${parts[2]})`;
}

function formatMegabytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0M';
  }

  if (value >= 1024) {
    const gb = value / 1024;
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)}G`;
  }

  return `${Math.round(value)}M`;
}

function formatSeconds(totalSeconds) {
  const units = [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ];

  let remaining = Math.max(0, Math.floor(totalSeconds));
  const parts = [];

  for (const [label, size] of units) {
    if (remaining >= size) {
      const amount = Math.floor(remaining / size);
      remaining -= amount * size;
      parts.push(`${amount}${label}`);
    }
    if (parts.length === 2) {
      break;
    }
  }

  if (!parts.length) {
    parts.push(`${remaining}s`);
  }

  return parts.join(' ');
}

function formatBytesPerSecond(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '--';
  }

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
  let index = 0;
  let current = value;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }

  const precision = current >= 100 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(precision)} ${units[index]}`;
}

function compactRate(value) {
  if (!value || value === '--') {
    return '--';
  }

  return String(value)
    .replace(/\s+/g, '')
    .replace('KB/s', 'K/s')
    .replace('MB/s', 'M/s')
    .replace('GB/s', 'G/s')
    .replace('TB/s', 'T/s')
    .replace('B/s', 'B/s');
}

function usagePrimary(value) {
  const match = String(value || '').match(/^(.+?) \((.+)\)$/);
  if (match) {
    return match[1];
  }
  return value || '--';
}

function usageSecondary(value) {
  const match = String(value || '').match(/^(.+?) \((.+)\)$/);
  if (match) {
    return match[2];
  }
  return '--';
}

function compactUptime(value) {
  if (!value || value === '--') {
    return '--';
  }

  return String(value)
    .replace(/, /g, ' ')
    .replace(/\bdays?\b/g, 'd')
    .replace(/\bhours?\b/g, 'h')
    .replace(/\bminutes?\b/g, 'm')
    .replace(/\bseconds?\b/g, 's')
    .replace(/\s+/g, ' ')
    .trim();
}

function readExecText(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeError(error) {
  if (!error) {
    return 'unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

const colors = {
  primary: { light: '#111827', dark: '#F5F5F7' },
  secondary: { light: '#6B7280', dark: '#A1A1AA' },
  tertiary: { light: '#9CA3AF', dark: '#8E8E93' },
  icon: { light: '#6B7280', dark: '#C7C7CC' },
};

const panelStyles = {
  panelStrong: {
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: { light: '#FFFFFF', dark: '#2C2C2E' },
    borderColor: { light: '#E5E7EB', dark: '#3A3A3C' },
  },
  panelSoft: {
    gap: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: { light: '#FFFFFF', dark: '#2A2A2D' },
    borderColor: { light: '#E5E7EB', dark: '#3A3A3C' },
  },
  panelMuted: {
    gap: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: { light: '#FFFFFF', dark: '#3A3A3C' },
    borderColor: { light: '#E5E7EB', dark: '#4A4A4F' },
  },
  panelError: {
    gap: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: { light: '#FFF1F2', dark: '#3A1F23' },
    borderColor: { light: '#FECDD3', dark: '#5B2B32' },
  },
};

const SAFE_TEXT_MAIN = '#FFFFFF';
const SAFE_TEXT_SUB = '#8E8E93';
const SAFE_STATUS_OK = '#34C759';
