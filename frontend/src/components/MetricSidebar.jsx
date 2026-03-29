import React from 'react';
import TMChart from './TMChart';

const METRIC_TYPES = [
    { id: 'cpu', label: 'CPU', color: '#00b38c' },
    { id: 'memory', label: 'Memory', color: '#8b71d9' },
    { id: 'mysql', label: 'MySQL', color: '#d9a500' },
    { id: 'disk', label: 'Disk', color: '#3da8e6' },
    { id: 'network', label: 'Network', color: '#d97700' },
];

export default function MetricSidebar({ selectedNode, selectedMetric, onSelectMetric, getMetricValue, tick }) {
    const visibleMetrics = selectedNode === 'system-overview'
        ? METRIC_TYPES.filter((metric) => metric.id !== 'mysql')
        : METRIC_TYPES;

    return (
        <div className="sidebar metric-list">
            <div className="sidebar-scrollable">
                {visibleMetrics.map(m => {
                    const rawVal = getMetricValue(selectedNode, m.id) || 0;
                    let displayVal = Math.round(rawVal);
                    let suffix = '';

                    if (m.id === 'cpu' || m.id === 'memory') {
                        suffix = '%';
                    } else if (m.id === 'disk') {
                        displayVal = rawVal < 10 ? rawVal.toFixed(2) : rawVal.toFixed(1);
                        suffix = ' MB/s';
                    } else if (m.id === 'network') {
                        if (rawVal < 1) { // Less than 1 Mbps
                            displayVal = Math.round(rawVal * 1000);
                            suffix = ' Kbps';
                        } else {
                            displayVal = rawVal.toFixed(2);
                            suffix = ' Mbps';
                        }
                    }

                    return (
                        <div
                            key={m.id}
                            className={`sidebar-item metric-item ${selectedMetric === m.id ? 'active' : ''}`}
                            onClick={() => onSelectMetric(m.id)}
                        >
                            <div className="metric-preview-col">
                                <TMChart type={m.id} currentValue={rawVal} color={m.color} isMini={true} tick={tick} nodeId={selectedNode} />
                            </div>
                            <div className="metric-details-col">
                                <div className="m-label">{m.label}</div>
                                <div className="m-value">{displayVal}{suffix}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
