require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { InfluxDB } = require('@influxdata/influxdb-client');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Validate environment variables
const INFLUX_URL = process.env.INFLUX_URL;
const INFLUX_TOKEN = process.env.INFLUX_TOKEN;
const INFLUX_ORG = process.env.INFLUX_ORG;
const INFLUX_BUCKET = process.env.INFLUX_BUCKET;

if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG || !INFLUX_BUCKET) {
    console.error("CRITICAL ERROR: Missing required InfluxDB environment variables (INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET).");
    process.exit(1);
}

console.log(`Connecting to InfluxDB at ${INFLUX_URL}...`);
const client = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const queryApi = client.getQueryApi(INFLUX_ORG);
console.log(`InfluxDB Query API initialized for Org: ${INFLUX_ORG}`);

// Integrated Alerting Thresholds
const THRESHOLDS = {
    cpu: 90,
    mem: 85,
    threads: 150,
    slow_queries: 10,
    disk_latency: 50 // ms
};

const si = require('systeminformation');
const os = require('os');
const { spawn } = require('child_process');

// Windows Disk IO Telemetry Fallback daemon
let winDiskIO = { rIO_sec: 0, wIO_sec: 0 };
let typeperfProcess = null;
let pollInFlight = false;

if (os.platform() === 'win32') {
    typeperfProcess = spawn('typeperf', ['\\PhysicalDisk(_Total)\\Disk Read Bytes/sec', '\\PhysicalDisk(_Total)\\Disk Write Bytes/sec']);
    typeperfProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.includes(',') && !line.includes('PDH-CSV')) {
                const parts = line.split(',');
                if (parts.length >= 3) {
                    const r = parseFloat(parts[1].replace(/"/g, ''));
                    const w = parseFloat(parts[2].replace(/"/g, ''));
                    if (!isNaN(r)) winDiskIO.rIO_sec = r;
                    if (!isNaN(w)) winDiskIO.wIO_sec = w;
                }
            }
        }
    });
    typeperfProcess.on('error', () => { console.error("Failed to spawn typeperf for disk metrics"); });
}

function emitAlert(level, node, metric, value, threshold, msg) {
    io.emit('alert', {
        level,
        node,
        metric,
        value,
        threshold,
        msg,
        timestamp: new Date().toISOString()
    });
}

let metricsInterval = setInterval(async () => {
    if (pollInFlight) {
        return;
    }

    pollInFlight = true;
    let metrics = {};

    try {
        // 1. Collect Local Monitoring Server Metrics (System Overview)
        try {
            const [cpu, mem, netStats, diskIO, cpuInfo, processes] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                si.networkStats(),
                si.disksIO(),
                si.cpu(),
                si.processes()
            ]);

            let rx = 0, tx = 0;
            if (netStats && netStats.length > 0) {
                netStats.forEach(iface => {
                    const name = (iface.iface || '').toLowerCase();
                    // Filter out loopback, WSL, VirtualBox, VMWare, and VPN Tap adapters to ensure we only sum the primary physical Wi-Fi/Ethernet adapters
                    if (name !== 'lo' && !name.includes('loopback') && !name.includes('virtual') && !name.includes('wsl') && !name.includes('veth') && !name.includes('vmware') && !name.includes('tap')) {
                        rx += iface.rx_sec || 0;
                        tx += iface.tx_sec || 0;
                    }
                });
            }
            
            let finalDiskRead = os.platform() === 'win32' ? winDiskIO.rIO_sec : (diskIO ? diskIO.rIO_sec : 0);
            let finalDiskWrite = os.platform() === 'win32' ? winDiskIO.wIO_sec : (diskIO ? diskIO.wIO_sec : 0);

            // Get CPU speed in GHz
            const cpuSpeed = cpuInfo.speed ? cpuInfo.speed / 1000 : 0;

            metrics['system-overview'] = {
                cpu_total: cpu.currentLoad,
                host_cpu_speed: cpuSpeed,
                mem_usage: (mem.active / mem.total) * 100,
                host_mem_available: mem.available,
                host_mem_cached: mem.cached || 0,
                host_mem_committed: mem.active,
                host_mem_commit_limit: mem.total,
                disk_read_bytes: finalDiskRead,
                disk_write_bytes: finalDiskWrite,
                net_sent_bytes: tx,
                net_recv_bytes: rx,
                threads_running: 0,
                slow_queries: 0,
                innodb_pool_usage: 0,
                lock_time: 0,
                host_uptime: os.uptime(),
                host_process_count: processes.all,
                host_thread_count: cpu.cpus ? cpu.cpus.length : 0
            };

            // Add dummy per-core for visual parity (or real if needed)
            cpu.cpus.forEach((c, i) => {
                metrics['system-overview'][`cpu_core_${i}`] = c.load;
            });
        } catch (e) {
            console.error("Local telemetry failed:", e.message);
        }

        // 2. Query Remote Node Metrics
        const fluxQuery = `
            from(bucket: "${INFLUX_BUCKET}")
            |> range(start: -30s)
            |> filter(fn: (r) => r._measurement == "system_metrics" or r._measurement == "mysql_metrics")
            |> filter(fn: (r) => exists r.node)
            |> group(columns: ["_measurement", "_field", "node"])
            |> last()
        `;

        for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
            const o = tableMeta.toObject(values);
            if (!o.node) continue;
            if (!metrics[o.node]) metrics[o.node] = {};
            metrics[o.node][o._field] = o._value;

            if (o._measurement === "system_metrics" && o._field.startsWith("cpu_core_")) {
                metrics[o.node][o._field] = o._value;
            }
        }

        if (Object.keys(metrics).length > 0) {
            io.emit('metrics_stream', metrics);

            // Alerting Engine (Global)
            Object.keys(metrics).forEach(node => {
                const data = metrics[node];
                if (data.cpu_total > THRESHOLDS.cpu) {
                    emitAlert('critical', node, 'cpu', data.cpu_total, THRESHOLDS.cpu, `${node} CPU CRITICAL: ${parseInt(data.cpu_total)}%`);
                } else if (data.mem_usage > THRESHOLDS.mem) {
                    emitAlert('warning', node, 'memory', data.mem_usage, THRESHOLDS.mem, `${node} Memory Warning: ${parseInt(data.mem_usage)}%`);
                }
                if (data.slow_queries > THRESHOLDS.slow_queries) {
                    emitAlert('critical', node, 'mysql', data.slow_queries, THRESHOLDS.slow_queries, `${node} Slow Query Spike detected!`);
                }
                if (data.threads_running > THRESHOLDS.threads) {
                    emitAlert('warning', node, 'mysql', data.threads_running, THRESHOLDS.threads, `${node} High Thread Count: ${data.threads_running}`);
                }
                if (data.host_disk_latency > THRESHOLDS.disk_latency) {
                    emitAlert('warning', node, 'disk', data.host_disk_latency, THRESHOLDS.disk_latency, `${node} Disk Latency High: ${parseInt(data.host_disk_latency)}ms`);
                }
            });
        }
    } catch (err) {
        console.error('Error querying InfluxDB:', err.message);
    } finally {
        pollInFlight = false;
    }
}, 1000);

// Basic health check
app.get('/', (req, res) => res.send('MySQL Monitoring Backend Active (Pure Real-Time Mode)'));

// Health endpoint for monitoring
app.get('/health', async (req, res) => {
    try {
        const healthResponse = await fetch(`${INFLUX_URL}/health`);
        if (!healthResponse.ok) {
            throw new Error(`InfluxDB health check returned ${healthResponse.status}`);
        }
        res.json({
            status: 'healthy',
            influxdb: 'connected',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(503).json({
            status: 'unhealthy',
            influxdb: 'disconnected',
            error: err.message
        });
    }
});

const PORT = parseInt(process.env.PORT || '4000', 10);
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend listening on port ${PORT} (Real-Time Only)`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
});

// Graceful shutdown handler
function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    
    // Clear the metrics interval
    if (metricsInterval) {
        clearInterval(metricsInterval);
    }
    
    // Kill typeperf process on Windows
    if (typeperfProcess) {
        typeperfProcess.kill();
        console.log('Typeperf process terminated.');
    }
    
    // Close all socket connections
    io.close(() => {
        console.log('Socket.IO connections closed.');
    });
    
    // Close the HTTP server
    server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
    });
    
    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
