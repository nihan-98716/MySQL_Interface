# NodeFlux - Multi-Node MySQL Monitoring Dashboard

<div align="center">

**Real-time monitoring solution for distributed MySQL database clusters**

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18.x-blue.svg)](https://reactjs.org/)
[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8.svg)](https://golang.org/)
[![Docker](https://img.shields.io/badge/Docker-Required-2496ED.svg)](https://docker.com/)

</div>

---

## 📋 Overview

NodeFlux is a comprehensive monitoring dashboard designed for multi-node MySQL database environments. It provides real-time visibility into system metrics, database performance, and resource utilization across all MySQL instances in your cluster.

### Key Features

- **Auto-Discovery**: Automatically detects new MySQL containers within 10 seconds
- **Real-Time Metrics**: 1-second refresh rate for all monitored data points
- **Multi-Node Support**: Monitor unlimited MySQL instances from a single dashboard
- **Container-Specific Stats**: True per-container CPU/Memory via Docker stats
- **Smart Alerting**: Configurable thresholds with visual indicators
- **Dark/Light Theme**: Toggle between viewing modes

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              React Dashboard (Port 3000)                ││
│  │   • Real-time charts  • Node selector  • Alerts panel   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Socket.IO (WebSocket)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SERVICE LAYER                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │           Node.js Backend (Port 4000)                   ││
│  │   • InfluxDB queries  • Alert evaluation  • Socket.IO   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              │ InfluxDB Query (Flux)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       DATA LAYER                            │
│  ┌───────────────┐         ┌────────────────────────────┐   │
│  │  InfluxDB     │◄────────│    Go Monitoring Agent     │   │
│  │  (Port 8086)  │  Write  │  • Auto-discovery          │   │
│  └───────────────┘         │  • MySQL metrics           │   │
│                            │  • Docker stats            │   │
│                            └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Monitor
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   INFRASTRUCTURE LAYER                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  MySQL #1   │  │  MySQL #2   │  │  MySQL #N   │  ...     │
│  │  Port 3306  │  │  Port 3307  │  │  Port 330X  │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Monitored Metrics

### System Metrics (per container)
| Metric | Description | Unit |
|--------|-------------|------|
| CPU Usage | Container CPU utilization | % |
| Memory Usage | Container memory consumption | % / MB |
| Disk Read/Write | I/O throughput rate | bytes/sec |
| Network In/Out | Network traffic rate | bytes/sec |

### MySQL Metrics
| Metric | Description | Unit |
|--------|-------------|------|
| Queries per Second | Query throughput rate | qps |
| Active Connections | Current connection count | count |
| Threads Running | Active thread count | count |
| InnoDB Buffer Pool | Buffer pool usage | % |
| Slow Queries | Queries exceeding threshold | count |

---

## 🚀 Quick Start

### Prerequisites

- **Docker Desktop** (for MySQL and InfluxDB containers)
- **Node.js 18+** (for backend and frontend)
- **Go 1.21+** (for building the agent)

### 1. Clone and Setup

```powershell
# Clone the repository
git clone <repository-url>
cd mysql-monitoring-capstone

# Start infrastructure (InfluxDB + MySQL containers)
docker-compose up -d
```

### 2. Configure Environment

Create `backend/.env`:
```env
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=<your-influxdb-token>
INFLUX_ORG=capstone
INFLUX_BUCKET=metrics
PORT=4000
```

Create `agent/.env`:
```env
INFLUX_TOKEN=<your-influxdb-token>
INFLUX_URL=http://localhost:8086
INFLUX_ORG=capstone
MYSQL_USER=root
MYSQL_PASS=root
```

### 3. Start Services

```powershell
# Terminal 1: Start Backend
cd backend
npm install
npm start

# Terminal 2: Start Frontend
cd frontend
npm install
npm run dev

# Terminal 3: Start Agent
cd agent
go build -o agent.exe .
.\agent.exe
```

### Single-command startup

```powershell
.\start-nodeflux.ps1
```

To stop the full stack:

```powershell
.\stop-nodeflux.ps1
```

### 4. Access Dashboard

Open **http://localhost:3000** in your browser.

---

## 🐳 Docker Commands

### Start Infrastructure
```bash
docker-compose up -d
```

### Add Additional MySQL Node
```bash
docker run -d \
  --name capstone_mysql_3 \
  --network mysql-monitoring-capstone_default \
  -e MYSQL_ROOT_PASSWORD=root \
  -p 3308:3306 \
  mysql:8.0
```

### View Container Logs
```bash
docker logs -f capstone_mysql_1
docker logs -f capstone_influxdb
```

### Stop All Containers
```bash
docker-compose down
```

---

## 📁 Project Structure

```
mysql-monitoring-capstone/
├── frontend/                 # React + Vite Dashboard
│   ├── src/
│   │   ├── components/       # React components
│   │   │   ├── NodeSidebar.jsx
│   │   │   ├── MetricSidebar.jsx
│   │   │   ├── MainPanel.jsx
│   │   │   ├── TMChart.jsx
│   │   │   ├── AlertFeed.jsx
│   │   │   └── DeepDiveDrawer.jsx
│   │   ├── App.jsx           # Main application
│   │   └── App.css           # Global styles
│   └── package.json
│
├── backend/                  # Node.js + Express + Socket.IO
│   ├── server.js             # Main server
│   ├── package.json
│   └── .env                  # Environment config
│
├── agent/                    # Go Monitoring Agent
│   ├── main.go               # Multi-node auto-discovery agent
│   ├── go.mod
│   └── .env.example          # Environment template
│
├── images/                   # Architecture diagrams
│   ├── fig_3_1_system_architecture.png
│   ├── fig_3_2_data_flow_diagram.png
│   └── ...
│
├── docker-compose.yml        # Infrastructure definition
├── NodeFlux_Project_Report.docx  # Project documentation
└── README.md                 # This file
```

---

## ⚙️ Configuration

### Alert Thresholds (backend/server.js)

```javascript
const alertThresholds = {
    cpu: 80,           // CPU usage > 80%
    memory: 85,        // Memory usage > 85%
    disk: 90,          // Disk usage > 90%
    connections: 100,  // MySQL connections > 100
    disk_latency: 50,  // Disk latency > 50ms
    threads: 50        // Running threads > 50
};
```

### Agent Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `INFLUX_TOKEN` | (required) | InfluxDB authentication token |
| `INFLUX_URL` | `http://localhost:8086` | InfluxDB server URL |
| `INFLUX_ORG` | `capstone` | InfluxDB organization |
| `MYSQL_USER` | `root` | MySQL username |
| `MYSQL_PASS` | `root` | MySQL password |
| `POLL_INTERVAL` | `1s` | Metrics collection interval |
| `DISCOVERY_INTERVAL` | `10s` | Container discovery interval |

---

## 🔧 Development

### Building the Agent

```powershell
cd agent
go mod tidy
go build -o agent.exe .
```

### Running Tests

```powershell
# Frontend tests
cd frontend && npm test

# Backend tests (if available)
cd backend && npm test
```

### Hot Reload Development

```powershell
# Frontend with Vite hot reload
cd frontend && npm run dev

# Backend with nodemon (if installed)
cd backend && npx nodemon server.js
```

---

## 🛠️ Troubleshooting

### Agent Not Discovering Containers

1. Ensure Docker is running
2. Check agent has Docker access:
   ```bash
   docker ps
   ```
3. Verify MySQL containers have ports exposed

### Metrics Not Appearing

1. Check InfluxDB is running:
   ```bash
   curl http://localhost:8086/health
   ```
2. Verify agent logs for errors
3. Check backend connection to InfluxDB

### WebSocket Connection Failed

1. Ensure backend is running on port 4000
2. Check browser console for CORS errors
3. Verify no firewall blocking WebSocket

---

## 📈 Performance

- **Agent CPU overhead**: < 1% per monitored container
- **Memory footprint**: ~30 MB for agent process
- **Network bandwidth**: ~5 KB/s per node
- **Dashboard latency**: < 100ms end-to-end

