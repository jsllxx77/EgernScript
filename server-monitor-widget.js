const DEFAULT_TITLE = 'Server Monitor';
const DEFAULT_PORT = 22;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_DISK_PATH = '/';
const STORAGE_PREFIX = 'server-monitor-widget';

export default async function (ctx) {
  const config = readConfig(ctx.env || {});
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
  return {
    title: config.title,
    status: 'OK',
    statusColor: '#22C55E',
    iface: metrics.iface,
    uptime: metrics.uptime,
    load: metrics.load,
    memory: metrics.memoryText,
    disk: metrics.diskText,
    inbound: traffic.inbound,
    outbound: traffic.outbound,
    refreshedAt: new Date().toISOString(),
  };
}

function renderWidget(view, family) {
  if (family === 'accessoryInline') {
    return renderAccessoryInline(view);
  }
  if (family === 'accessoryCircular') {
    return renderAccessoryCircular(view);
  }
  if (family === 'accessoryRectangular') {
    return renderAccessoryRectangular(view);
  }
  return renderDefaultWidget(view);
}

function renderDefaultWidget(view) {
  return {
    type: 'widget',
    backgroundColor: { light: '#0F172A', dark: '#020617' },
    padding: 14,
    gap: 10,
    children: [
      {
        type: 'stack',
        direction: 'row',
        children: [
          textNode(view.title, 'headline', '#FFFFFF', 'bold'),
          { type: 'spacer' },
          badgeNode(view.status, view.statusColor),
        ],
      },
      {
        type: 'stack',
        direction: 'column',
        gap: 6,
        children: [
          metricRow('STATUS', 'online'),
          metricRow('UPTIME', view.uptime),
          metricRow('CPU 1/5/15', view.load),
          metricRow('MEM', view.memory),
          metricRow('DISK', view.disk),
          metricRow('NET IN', view.inbound),
          metricRow('NET OUT', view.outbound),
        ],
      },
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'row',
        children: [
          textNode(`IF ${view.iface}`, 'caption2', '#94A3B8'),
          { type: 'spacer' },
          {
            type: 'date',
            date: view.refreshedAt,
            format: 'relative',
            font: { size: 'caption2' },
            textColor: '#94A3B8',
          },
        ],
      },
    ],
  };
}

function renderAccessoryInline(view) {
  return {
    type: 'widget',
    children: [
      textNode(
        `${view.title} ${view.status} ${view.inbound} in ${view.outbound} out`,
        'caption2',
        '#FFFFFF',
        'semibold'
      ),
    ],
  };
}

function renderAccessoryCircular(view) {
  return {
    type: 'widget',
    padding: 8,
    gap: 2,
    children: [
      textNode('NET', 'caption2', '#94A3B8', 'semibold'),
      textNode(view.inbound, 'caption2', '#FFFFFF', 'bold'),
      textNode(view.outbound, 'caption2', '#CBD5E1'),
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
        children: [
          textNode(view.title, 'caption1', '#FFFFFF', 'bold'),
          { type: 'spacer' },
          textNode(view.status, 'caption2', view.statusColor, 'semibold'),
        ],
      },
      textNode(`Up ${view.uptime}`, 'caption2', '#CBD5E1'),
      textNode(`In ${view.inbound} / Out ${view.outbound}`, 'caption2', '#CBD5E1'),
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
    backgroundColor: { light: '#3F1D1D', dark: '#2A0D0D' },
    padding: 14,
    gap: 8,
    children: [
      {
        type: 'stack',
        direction: 'row',
        children: [
          textNode(title, 'headline', '#FFFFFF', 'bold'),
          { type: 'spacer' },
          badgeNode('ERR', '#EF4444'),
        ],
      },
      textNode(message, 'caption1', '#FECACA'),
      {
        type: 'date',
        date: view.refreshedAt,
        format: 'relative',
        font: { size: 'caption2' },
        textColor: '#FCA5A5',
      },
    ],
  };
}

function metricRow(label, value) {
  return {
    type: 'stack',
    direction: 'row',
    children: [
      textNode(label, 'caption1', '#94A3B8', 'semibold'),
      { type: 'spacer' },
      textNode(value, 'caption1', '#FFFFFF', 'semibold'),
    ],
  };
}

function badgeNode(text, color) {
  return {
    type: 'text',
    text,
    font: { size: 'caption2', weight: 'bold' },
    textColor: color,
  };
}

function textNode(text, size, color, weight) {
  const node = {
    type: 'text',
    text,
    font: { size },
    textColor: color,
  };

  if (weight) {
    node.font.weight = weight;
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
