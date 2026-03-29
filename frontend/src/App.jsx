import React, { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import TopBar from './components/TopBar';
import NodeSidebar from './components/NodeSidebar';
import MetricSidebar from './components/MetricSidebar';
import MainPanel from './components/MainPanel';
import AlertFeed from './components/AlertFeed';
import DeepDiveDrawer from './components/DeepDiveDrawer';
import './App.css';

const socket = io('http://localhost:4000');

const METRIC_CONFIGS = {
  cpu: { label: 'CPU', color: '#00b38c' },
  memory: { label: 'Memory', color: '#8b71d9' },
  mysql: { label: 'MySQL', color: '#d9a500' },
  disk: { label: 'Disk', color: '#3da8e6' },
  network: { label: 'Network', color: '#d97700' },
};

export default function App() {
  const [nodes, setNodes] = useState({});
  const [globalTick, setGlobalTick] = useState(0);
  const [selectedNode, setSelectedNode] = useState('system-overview');
  const [viewContext, setViewContext] = useState('system'); // 'system' or 'node'
  const [selectedMetric, setSelectedMetric] = useState('cpu');
  const [alerts, setAlerts] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  // Apply theme class to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const toggleTheme = () => setDarkMode(prev => !prev);

  useEffect(() => {
    setIsConnected(socket.connected);

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('metrics_stream', (data) => {
      setNodes((prev) => ({ ...prev, ...data }));
      setGlobalTick(t => t + 1);
    });

    socket.on('alert', (alertData) => {
      setAlerts(prev => [alertData, ...prev].slice(0, 10));
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('metrics_stream');
      socket.off('alert');
    }
  }, []);

  const handleSelectNode = (id) => {
    setSelectedNode(id);
    setViewContext(id === 'system-overview' ? 'system' : 'node');
    if (id === 'system-overview' && selectedMetric === 'mysql') {
      setSelectedMetric('cpu');
    }
  };

  const formatBytes = useCallback((bytes) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  const formatUptime = useCallback((seconds) => {
    if (!seconds || seconds <= 0) return '0:00:00:00';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d}:${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, []);

  const getMetricValue = (nodeId, type) => {
    const data = nodes[nodeId] || {};
    switch (type) {
      case 'cpu': return data.cpu_total || 0;
      case 'memory': return data.mem_usage || 0;
      case 'mysql': return data.threads_running || 0;
      case 'disk': return ((data.disk_read_bytes || 0) + (data.disk_write_bytes || 0)) / (1024 * 1024);
      case 'network': return (((data.net_recv_bytes || 0) + (data.net_sent_bytes || 0)) * 8) / (1000 * 1000);
      default: return 0;
    }
  };

  const handleAlertClick = (node, metric) => {
    handleSelectNode(node);
    if (metric) setSelectedMetric(metric);
    setIsDrawerOpen(true);
  };

  return (
    <div className="app-container">
      <TopBar
        nodes={nodes}
        isConnected={isConnected}
        darkMode={darkMode}
        onToggleTheme={toggleTheme}
        onOpenDetails={() => setIsDrawerOpen(true)}
      />

      <div className="main-content-row">
        {/* Unified Sidebar */}
        <NodeSidebar
          nodes={nodes}
          selectedNode={selectedNode}
          onSelectNode={handleSelectNode}
          viewContext={viewContext}
          tick={globalTick}
        />

        <div className="metric-panel-col">
          <MetricSidebar
            selectedNode={selectedNode}
            selectedMetric={selectedMetric}
            onSelectMetric={setSelectedMetric}
            getMetricValue={getMetricValue}
            tick={globalTick}
          />
          <AlertFeed alerts={alerts} onAlertClick={handleAlertClick} />
        </div>

        {/* Animation Wrapper for transitions */}
        <div className="main-panel-view" key={selectedNode}>
          <MainPanel
            selectedNode={selectedNode}
            selectedMetric={selectedMetric}
            metricData={nodes[selectedNode] || {}}
            metricConfig={METRIC_CONFIGS[selectedMetric]}
            formatBytes={formatBytes}
            formatUptime={formatUptime}
            tick={globalTick}
          />
        </div>
      </div>

      <DeepDiveDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        node={selectedNode}
        metric={selectedMetric}
        data={nodes[selectedNode] || {}}
      />

      {!isConnected && (
        <div className="reconnect-overlay">
          <div className="reconnect-spinner"></div>
          <div className="reconnect-msg">Reconnecting to performance console...</div>
        </div>
      )}
    </div>
  );
}
