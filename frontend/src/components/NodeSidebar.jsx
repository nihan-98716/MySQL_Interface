import React from 'react';
import TMChart from './TMChart';

export default function NodeSidebar({ nodes, selectedNode, onSelectNode, tick }) {
    // Calculate overall system health
    const nodeKeys = Object.keys(nodes).filter(k => k !== 'system-overview');
    const overallHealth = nodeKeys.length === 0 ? 'ok' : 
        nodeKeys.some(k => (nodes[k]?.cpu_total || 0) >= 90) ? 'crit' :
        nodeKeys.some(k => (nodes[k]?.cpu_total || 0) >= 80) ? 'warn' : 'ok';

    return (
        <div className="sidebar node-list">
            <div className="sidebar-group-title">SYSTEM</div>
            <div className="sidebar-scrollable">
                <div
                    className={`sidebar-item system-item ${selectedNode === 'system-overview' ? 'active' : ''}`}
                    onClick={() => onSelectNode('system-overview')}
                >
                    <div className="node-status-col">
                        <span className={`health-indicator ${overallHealth}`}>
                            <span className="health-indicator-dot"></span>
                            <span className="health-indicator-ring"></span>
                        </span>
                    </div>
                    <div className="node-info-col">
                        <div className="name-row">Host Overview</div>
                        <div className="node-stats-row">
                            <span className="stat-pair">Machine-wide metrics</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="sidebar-group-title">MYSQL CONTAINER NODES</div>
            <div className="sidebar-scrollable">
                {nodeKeys.map(nodeId => {
                    const data = nodes[nodeId];
                    const cpu = Math.round(data.cpu_total || 0);
                    const mem = Math.round(data.mem_usage || 0);

                    let health = 'ok';
                    if (cpu >= 90 || mem >= 95) health = 'crit';
                    else if (cpu >= 80 || mem >= 85) health = 'warn';

                    return (
                        <div
                            key={nodeId}
                            className={`sidebar-item node-item ${selectedNode === nodeId ? 'active' : ''} ${health === 'crit' ? 'crit' : ''}`}
                            onClick={() => onSelectNode(nodeId)}
                        >
                            <div className="node-graph-col">
                                <div className="sidebar-sparkline">
                                    <TMChart type="cpu" currentValue={cpu} color="#00b38c" isMini={true} tick={tick} nodeId={nodeId} />
                                </div>
                            </div>
                            <div className="node-info-col">
                                <div className="node-label-row">
                                    <span className="node-name">{nodeId}</span>
                                    <span className={`health-indicator ${health}`}>
                                        <span className="health-indicator-dot"></span>
                                        {health !== 'ok' && <span className="health-indicator-ring"></span>}
                                    </span>
                                </div>
                                <div className="node-stats-row">
                                    <span className="stat-pair">CPU: <span className={`val ${cpu >= 80 ? 'warn' : ''} ${cpu >= 90 ? 'crit' : ''}`}>{cpu}%</span></span>
                                    <span className="stat-pair">MEM: <span className={`val ${mem >= 85 ? 'warn' : ''} ${mem >= 95 ? 'crit' : ''}`}>{mem}%</span></span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
