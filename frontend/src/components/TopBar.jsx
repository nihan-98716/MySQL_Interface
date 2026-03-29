import React from 'react';

export default function TopBar({ nodes, isConnected, darkMode, onToggleTheme, onOpenDetails }) {
    const nodeCount = Object.keys(nodes).filter(k => k !== 'system-overview').length;

    return (
        <header className="app-topbar">
            <div className="topbar-branding">
                <span className="app-name">NodeFlux</span>
                <span className="app-subtitle">Host Overview + Container Nodes</span>
            </div>

            <div className="topbar-actions">
                <div className="node-count-indicator">
                    Nodes: <strong>{nodeCount}</strong>
                </div>
                <div className={`status-indicator ${isConnected ? 'active' : ''}`}>
                    {isConnected ? '🟢 Active' : '🔴 Disconnected'}
                </div>
                <select className="time-selector" disabled title="Coming soon">
                    <option>60s</option>
                    <option>5m</option>
                    <option>15m</option>
                </select>
                <button 
                    className="theme-toggle-btn" 
                    onClick={onToggleTheme}
                    title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                    {darkMode ? '☀️' : '🌙'}
                </button>
                <button className="topbar-btn" onClick={onOpenDetails} title="View Details">View Details</button>
            </div>
        </header>
    );
}
