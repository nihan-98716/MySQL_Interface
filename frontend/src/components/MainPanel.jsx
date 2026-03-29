import React from 'react';
import TMChart from './TMChart';
import StatBlock from './StatBlock';

export default function MainPanel({
    selectedNode,
    selectedMetric,
    metricData,
    metricConfig,
    formatBytes,
    formatUptime,
    tick
}) {
    const nodeName = selectedNode || 'No Node Selected';
    const isOverview = selectedNode === 'system-overview';
    const rawVal = getMetricValue(selectedNode, selectedMetric, metricData) || 0;

    let displayVal = '';
    let suffix = '';

    if (selectedMetric === 'cpu' || selectedMetric === 'memory') {
        displayVal = Math.round(rawVal);
        suffix = '%';
    } else if (selectedMetric === 'disk') {
        displayVal = rawVal < 10 ? rawVal.toFixed(2) : rawVal.toFixed(1);
        suffix = ' MB/s';
    } else if (selectedMetric === 'network') {
        const bps = ((metricData?.net_recv_bytes || 0) + (metricData?.net_sent_bytes || 0)) * 8;
        if (bps < 1000000) {
            displayVal = (bps / 1000).toFixed(0);
            suffix = ' Kbps';
        } else {
            displayVal = (bps / 1000000).toFixed(2);
            suffix = ' Mbps';
        }
    } else {
        displayVal = Math.round(rawVal);
    }

    return (
        <div className="main-panel">
            <header className="panel-header">
                <div className="panel-title-row">
                    <span className="node-id">{nodeName}</span>
                    <span className="separator">—</span>
                    <span className="metric-id" style={{ color: metricConfig.color }}>
                        {selectedMetric.toUpperCase()}
                    </span>
                </div>
                <div className="panel-usage-row">
                    {isOverview ? 'Host machine telemetry' : 'Per-container MySQL node telemetry'}
                </div>
            </header>

            <div className="graph-viewer">
                <div className="graph-top-label">
                    {displayVal}{suffix}
                </div>
                <div className="main-chart-wrapper">
                    <TMChart
                        key={`${selectedNode}-${selectedMetric}`}
                        type={selectedMetric}
                        currentValue={getMetricValue(selectedNode, selectedMetric, metricData)}
                        color={metricConfig.color}
                        tick={tick}
                        nodeId={selectedNode}
                    />
                </div>
                <div className="graph-footer">60 seconds</div>
            </div>

            <div className="performance-stats-grid">
                {renderStats(selectedMetric, metricData, formatBytes, formatUptime, metricConfig.color)}
            </div>
        </div>
    );
}

function getMetricValue(node, type, data) {
    if (!data) return 0;
    switch (type) {
        case 'cpu': return data.cpu_total || 0;
        case 'memory': return data.mem_usage || 0;
        case 'mysql': return data.threads_running || 0;
        case 'disk': return ((data.disk_read_bytes || 0) + (data.disk_write_bytes || 0)) / (1024 * 1024);
        case 'network': return (((data.net_recv_bytes || 0) + (data.net_sent_bytes || 0)) * 8) / (1000 * 1000);
        default: return 0;
    }
}

function renderStats(type, data, formatBytes, formatUptime, accentColor) {
    if (type === 'cpu') {
        return (
            <>
                <StatBlock label="Utilization" value={`${Math.round(data.cpu_total || 0)}%`} color={accentColor} />
                <StatBlock label="Speed" value={`${(data.host_cpu_speed || 0).toFixed(2)} GHz`} color={accentColor} />
                <StatBlock label="Processes" value={data.host_process_count || 0} color={accentColor} />
                <StatBlock label="Threads" value={data.host_thread_count || 0} color={accentColor} />
                <StatBlock label="Up time" value={formatUptime(data.host_uptime)} color={accentColor} />
            </>
        );
    }
    if (type === 'memory') {
        return (
            <>
                <StatBlock label="In use" value={`${Math.round(data.mem_usage || 0)}%`} color={accentColor} />
                <StatBlock label="Available" value={formatBytes(data.host_mem_available)} color={accentColor} />
                <StatBlock label="Committed" value={`${formatBytes(data.host_mem_committed)} / ${formatBytes(data.host_mem_commit_limit)}`} color={accentColor} />
                <StatBlock label="Cached" value={formatBytes(data.host_mem_cached)} color={accentColor} />
            </>
        );
    }
    if (type === 'mysql') {
        return (
            <>
                <StatBlock label="Active Threads" value={data.threads_running || 0} color={accentColor} />
                <StatBlock label="Slow Queries" value={data.slow_queries || 0} color={accentColor} />
                <StatBlock label="InnoDB Pool" value={`${Math.round(data.innodb_pool_usage || 0)}%`} color={accentColor} />
                <StatBlock label="Row Locks" value={`${Math.round(data.lock_time || 0)}ms`} color={accentColor} />
            </>
        );
    }
    if (type === 'disk') {
        const readBytes = data.disk_read_bytes || 0;
        const writeBytes = data.disk_write_bytes || 0;
        const totalBytes = readBytes + writeBytes;
        return (
            <>
                <StatBlock label="Read speed" value={`${formatBytes(readBytes)}/s`} color={accentColor} />
                <StatBlock label="Write speed" value={`${formatBytes(writeBytes)}/s`} color={accentColor} />
                <StatBlock label="Total throughput" value={`${formatBytes(totalBytes)}/s`} color={accentColor} />
                <StatBlock label="I/O state" value={totalBytes > 0 ? 'Active' : 'Idle'} color={accentColor} />
            </>
        );
    }
    if (type === 'network') {
        const formatNet = (bytes) => {
            const bps = bytes * 8;
            if (bps < 1000000) return `${(bps / 1000).toFixed(0)} Kbps`;
            return `${(bps / 1000000).toFixed(2)} Mbps`;
        };
        const sentBytes = data.net_sent_bytes || 0;
        const recvBytes = data.net_recv_bytes || 0;
        const totalBytes = sentBytes + recvBytes;
        return (
            <>
                <StatBlock label="Send" value={formatNet(sentBytes)} color={accentColor} />
                <StatBlock label="Receive" value={formatNet(recvBytes)} color={accentColor} />
                <StatBlock label="Total bandwidth" value={formatNet(totalBytes)} color={accentColor} />
                <StatBlock label="Link state" value={totalBytes > 0 ? "Active" : "Idle"} color={accentColor} />
            </>
        );
    }
}
