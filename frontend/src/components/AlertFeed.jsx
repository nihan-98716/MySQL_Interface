import React from 'react';

export default function AlertFeed({ alerts, onAlertClick }) {
    const parseAlertNode = (msg) => {
        const match = msg.match(/^([^\s]+)/);
        return match ? match[1] : null;
    };

    const parseAlertMetric = (msg) => {
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes('cpu')) return 'cpu';
        if (lowerMsg.includes('memory') || lowerMsg.includes('mem')) return 'memory';
        if (lowerMsg.includes('slow query') || lowerMsg.includes('mysql')) return 'mysql';
        if (lowerMsg.includes('disk')) return 'disk';
        if (lowerMsg.includes('network') || lowerMsg.includes('net')) return 'network';
        return 'cpu';
    };

    const getAlertIcon = (level) => {
        if (level === 'critical') return '🔴';
        if (level === 'warning') return '🟡';
        return '🟢';
    };

    const getTimeAgo = (timestamp) => {
        if (!timestamp) return 'now';
        const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        return `${Math.floor(seconds / 3600)}h ago`;
    };

    const handleAlertClick = (alert) => {
        if (onAlertClick) {
            const node = alert.node || parseAlertNode(alert.msg || '');
            const metric = alert.metric || parseAlertMetric(alert.msg || '');
            onAlertClick(node, metric);
        }
    };

    return (
        <div className="alert-feed">
            <div className="alert-feed-header">
                <div className="alert-feed-title">ALERT FEED</div>
                <div className="alert-count-badge">
                    {alerts.length > 0 && <span className={`badge ${alerts.some(a => a.level === 'critical') ? 'critical' : 'warning'}`}>{alerts.length}</span>}
                </div>
            </div>
            <div className="alert-feed-scroll">
                {alerts.map((a, i) => (
                    <div 
                        key={i} 
                        className={`alert-card ${a.level}`}
                        onClick={() => handleAlertClick(a)}
                        style={{ animationDelay: `${i * 50}ms` }}
                    >
                        <div className="alert-card-left">
                            <span className={`alert-icon ${a.level}`}>{getAlertIcon(a.level)}</span>
                        </div>
                        <div className="alert-card-content">
                            <div className="alert-msg">{a.msg}</div>
                            <div className="alert-meta">
                                <span className={`alert-level-tag ${a.level}`}>{a.level?.toUpperCase()}</span>
                                <span className="alert-time">{getTimeAgo(a.timestamp)}</span>
                            </div>
                        </div>
                        <div className="alert-card-action">
                            <span className="alert-arrow">→</span>
                        </div>
                    </div>
                ))}
                {alerts.length === 0 && (
                    <div className="alert-empty">
                        <span className="empty-icon">✓</span>
                        <span className="empty-text">All Systems Healthy</span>
                    </div>
                )}
            </div>
        </div>
    );
}
