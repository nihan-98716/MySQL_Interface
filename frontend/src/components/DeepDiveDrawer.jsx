import React, { useEffect, useMemo } from 'react';

export default function DeepDiveDrawer({ isOpen, onClose, node, metric, data }) {
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    // Dynamically detect CPU cores from data
    const coreCount = useMemo(() => {
        if (!data) return 0;
        let count = 0;
        Object.keys(data).forEach(key => {
            if (key.startsWith('cpu_core_')) {
                const coreNum = parseInt(key.replace('cpu_core_', ''), 10);
                if (!isNaN(coreNum) && coreNum >= count) {
                    count = coreNum + 1;
                }
            }
        });
        return count || 8; // Fallback to 8 if no core data
    }, [data]);

    const isOverview = node === 'system-overview';

    if (!isOpen) return null;

    return (
        <div className={`deep-dive-overlay ${isOpen ? 'open' : ''}`} onClick={onClose}>
            <div className="deep-dive-drawer" onClick={e => e.stopPropagation()}>
                <header className="drawer-header">
                    <div className="drawer-title">
                        <h3>Detailed Performance</h3>
                        <span>{node} - {metric.toUpperCase()}</span>
                        <span>{isOverview ? 'Host machine metrics' : 'Per-container node metrics'}</span>
                    </div>
                    <button className="drawer-close" onClick={onClose}>×</button>
                </header>

                <div className="drawer-content">
                    <section className="drawer-section">
                        <h4>System Overview</h4>
                        <div className="summary-list">
                            <div className="summary-row">
                                <span className="label">{isOverview ? 'Host Context' : 'Node Context'}</span>
                                <span className="value">{isOverview ? 'Host machine' : 'MySQL container node'}</span>
                            </div>
                            <div className="summary-row">
                                <span className="label">Processors</span>
                                <span className="value">{coreCount} Logical Cores</span>
                            </div>
                            <div className="summary-row">
                                <span className="label">Uptime</span>
                                <span className="value">{((data?.host_uptime || 0) / 3600 / 24).toFixed(1)} days</span>
                            </div>
                        </div>
                    </section>

                    <section className="drawer-section">
                        <h4>CPU Core Breakdown</h4>
                        <div className="core-grid">
                            {Array.from({ length: coreCount }, (_, i) => {
                                const coreUsage = data?.[`cpu_core_${i}`] || 0;
                                return (
                                    <div key={i} className="core-item">
                                        <div className="core-label">Core {i}: {Math.round(coreUsage)}%</div>
                                        <div className="core-bar-bg">
                                            <div
                                                className="core-bar-fill"
                                                style={{ width: `${Math.min(100, Math.round(coreUsage))}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {!isOverview && (
                        <section className="drawer-section">
                            <h4>Database Analytics (MySQL)</h4>
                            <div className="db-stats-list">
                                <div className="db-stat-group">
                                    <label>Connections</label>
                                    <span>Active: {data?.threads_running || 0} | Connected: {data?.threads_connected || 0}</span>
                                </div>
                                <div className="db-stat-group">
                                    <label>Slow Queries</label>
                                    <span>Total: {data?.slow_queries || 0}</span>
                                </div>
                                <div className="db-stat-group">
                                    <label>InnoDB Buffer</label>
                                    <span>Usage: {Math.round(data?.innodb_pool_usage || 0)}%</span>
                                </div>
                                <div className="db-stat-group">
                                    <label>Row Lock Time</label>
                                    <span>{Math.round(data?.lock_time || 0)} ms</span>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
