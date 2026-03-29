package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
	influxdb2 "github.com/influxdata/influxdb-client-go/v2"
	"github.com/influxdata/influxdb-client-go/v2/api"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
)

// MySQLNode represents a discovered MySQL container
type MySQLNode struct {
	ContainerName string
	ContainerID   string
	NodeName      string
	Port          int
	DSN           string
	DB            *sql.DB
	PrevIO        *NodePrevIO
}

// NodePrevIO stores previous I/O counters for rate calculation per node
type NodePrevIO struct {
	diskRead, diskWrite uint64
	netRx, netTx  uint64
	timestamp     time.Time
	mu            sync.Mutex
}

// DockerStats holds container resource usage
type DockerStats struct {
	CPUPercent float64
	MemUsage   uint64
	MemLimit   uint64
	MemPercent float64
	NetRx      uint64
	NetTx      uint64
	BlockRead  uint64
	BlockWrite uint64
}

// Global state
var (
	activeNodes   = make(map[string]*MySQLNode)
	activeNodesMu sync.RWMutex
	writeAPI      api.WriteAPI
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// Configuration from environment
	influxURL := getEnv("INFLUX_URL", "http://localhost:8086")
	influxToken := os.Getenv("INFLUX_TOKEN")
	if influxToken == "" {
		log.Fatal("INFLUX_TOKEN environment variable is required")
	}
	influxOrg := getEnv("INFLUX_ORG", "capstone")
	influxBucket := getEnv("INFLUX_BUCKET", "metrics")
	mysqlUser := getEnv("MYSQL_USER", "root")
	mysqlPass := getEnv("MYSQL_PASS", "root")
	pollInterval := getEnvInt("POLL_INTERVAL", 1)
	discoveryInterval := getEnvInt("DISCOVERY_INTERVAL", 10)

	// Connect to InfluxDB
	client := influxdb2.NewClient(influxURL, influxToken)
	defer client.Close()
	writeAPI = client.WriteAPI(influxOrg, influxBucket)

	// Handle write errors
	go func() {
		for err := range writeAPI.Errors() {
			log.Printf("InfluxDB write error: %v", err)
		}
	}()

	fmt.Println("╔═══════════════════════════════════════════════════════╗")
	fmt.Println("║   NodeFlux Multi-Node MySQL Monitor                   ║")
	fmt.Println("║   Auto-discovers and monitors all MySQL containers    ║")
	fmt.Println("╚═══════════════════════════════════════════════════════╝")
	fmt.Printf("InfluxDB: %s | Org: %s | Bucket: %s\n", influxURL, influxOrg, influxBucket)
	fmt.Printf("Poll: %ds | Discovery: %ds\n\n", pollInterval, discoveryInterval)

	// Graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Println("\nShutting down gracefully...")
		cancel()
	}()

	// Initial discovery
	discoverMySQLContainers(mysqlUser, mysqlPass)

	// Start discovery loop in background
	go func() {
		ticker := time.NewTicker(time.Duration(discoveryInterval) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				discoverMySQLContainers(mysqlUser, mysqlPass)
			}
		}
	}()

	// Main metrics collection loop
	ticker := time.NewTicker(time.Duration(pollInterval) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// Cleanup
			activeNodesMu.Lock()
			for _, node := range activeNodes {
				if node.DB != nil {
					node.DB.Close()
				}
			}
			activeNodesMu.Unlock()
			writeAPI.Flush()
			fmt.Println("Shutdown complete.")
			return
		case <-ticker.C:
			collectAllMetrics()
		}
	}
}

// discoverMySQLContainers finds all running MySQL containers
func discoverMySQLContainers(mysqlUser, mysqlPass string) {
	// Run docker ps to find all containers, then filter for MySQL
	cmd := exec.Command("docker", "ps", "--format", "{{.ID}}|{{.Names}}|{{.Ports}}|{{.Image}}")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("Docker discovery error: %v", err)
		return
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	discoveredIDs := make(map[string]bool)

	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) < 4 {
			continue
		}

		containerID := parts[0]
		containerName := parts[1]
		portsStr := parts[2]
		image := parts[3]

		// Filter for MySQL images only
		if !strings.Contains(strings.ToLower(image), "mysql") {
			continue
		}

		discoveredIDs[containerID] = true

		// Check if already tracked
		activeNodesMu.RLock()
		_, exists := activeNodes[containerID]
		activeNodesMu.RUnlock()

		if exists {
			continue
		}

		// Parse port mapping (e.g., "0.0.0.0:3306->3306/tcp, 33060/tcp")
		port := parseHostPort(portsStr)
		if port == 0 {
			log.Printf("Could not determine port for container %s", containerName)
			continue
		}

		// Create DSN and try to connect
		dsn := fmt.Sprintf("%s:%s@tcp(127.0.0.1:%d)/", mysqlUser, mysqlPass, port)
		db, err := sql.Open("mysql", dsn)
		if err != nil {
			log.Printf("Failed to create connection for %s: %v", containerName, err)
			continue
		}

		// Test connection
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err = db.PingContext(ctx)
		cancel()

		if err != nil {
			log.Printf("Cannot connect to %s on port %d: %v", containerName, port, err)
			db.Close()
			continue
		}

		// Configure connection pool
		db.SetMaxOpenConns(3)
		db.SetMaxIdleConns(1)
		db.SetConnMaxLifetime(5 * time.Minute)

		node := &MySQLNode{
			ContainerID:   containerID,
			ContainerName: containerName,
			NodeName:      containerName,
			Port:          port,
			DSN:           dsn,
			DB:            db,
			PrevIO:        &NodePrevIO{timestamp: time.Now()},
		}

		activeNodesMu.Lock()
		activeNodes[containerID] = node
		activeNodesMu.Unlock()

		log.Printf("✓ Discovered new MySQL node: %s (port %d)", containerName, port)
	}

	// Remove nodes that no longer exist
	activeNodesMu.Lock()
	for id, node := range activeNodes {
		if !discoveredIDs[id] {
			log.Printf("✗ Node removed: %s", node.ContainerName)
			if node.DB != nil {
				node.DB.Close()
			}
			delete(activeNodes, id)
		}
	}
	activeNodesMu.Unlock()
}

// parseHostPort extracts the host port from Docker port mapping string
func parseHostPort(portsStr string) int {
	// Match pattern like "0.0.0.0:3306->3306/tcp"
	re := regexp.MustCompile(`0\.0\.0\.0:(\d+)->3306/tcp`)
	matches := re.FindStringSubmatch(portsStr)
	if len(matches) >= 2 {
		port, _ := strconv.Atoi(matches[1])
		return port
	}

	// Try alternate pattern :::3307->3306/tcp
	re2 := regexp.MustCompile(`:::(\d+)->3306/tcp`)
	matches2 := re2.FindStringSubmatch(portsStr)
	if len(matches2) >= 2 {
		port, _ := strconv.Atoi(matches2[1])
		return port
	}

	return 0
}

// collectAllMetrics collects metrics for all active nodes
func collectAllMetrics() {
	activeNodesMu.RLock()
	nodes := make([]*MySQLNode, 0, len(activeNodes))
	for _, node := range activeNodes {
		nodes = append(nodes, node)
	}
	activeNodesMu.RUnlock()

	if len(nodes) == 0 {
		return
	}

	// Get host info (shared across all nodes)
	hostInfo, _ := host.Info()
	cpuInfo, _ := cpu.Info()
	cpuSpeed := 0.0
	cpuModel := "Unknown"
	if len(cpuInfo) > 0 {
		cpuSpeed = cpuInfo[0].Mhz
		cpuModel = cpuInfo[0].ModelName
	}

	// Collect metrics for each node concurrently
	var wg sync.WaitGroup
	for _, node := range nodes {
		wg.Add(1)
		go func(n *MySQLNode) {
			defer wg.Done()
			collectNodeMetrics(n, hostInfo, cpuSpeed, cpuModel)
		}(node)
	}
	wg.Wait()
}

// collectNodeMetrics collects and sends metrics for a single node
func collectNodeMetrics(node *MySQLNode, hostInfo *host.InfoStat, cpuSpeed float64, cpuModel string) {
	// Get Docker container stats
	stats, err := getDockerStats(node.ContainerName)
	if err != nil {
		log.Printf("[%s] Docker stats error: %v", node.NodeName, err)
		return
	}

	// Calculate network rates
	node.PrevIO.mu.Lock()
	elapsed := time.Since(node.PrevIO.timestamp).Seconds()
	var diskReadRate, diskWriteRate, netRecvRate, netSentRate float64
	if elapsed > 0 && node.PrevIO.timestamp.Unix() > 0 {
		if stats.BlockRead >= node.PrevIO.diskRead {
			diskReadRate = float64(stats.BlockRead-node.PrevIO.diskRead) / elapsed
		}
		if stats.BlockWrite >= node.PrevIO.diskWrite {
			diskWriteRate = float64(stats.BlockWrite-node.PrevIO.diskWrite) / elapsed
		}
		if stats.NetRx >= node.PrevIO.netRx {
			netRecvRate = float64(stats.NetRx-node.PrevIO.netRx) / elapsed
		}
		if stats.NetTx >= node.PrevIO.netTx {
			netSentRate = float64(stats.NetTx-node.PrevIO.netTx) / elapsed
		}
	}
	node.PrevIO.diskRead = stats.BlockRead
	node.PrevIO.diskWrite = stats.BlockWrite
	node.PrevIO.netRx = stats.NetRx
	node.PrevIO.netTx = stats.NetTx
	node.PrevIO.timestamp = time.Now()
	node.PrevIO.mu.Unlock()

	// Get MySQL-specific metrics
	mysqlMetrics := getMySQLMetrics(node)

	// Generate synthetic per-core data
	numCores := 4
	allCpuPercent := make([]float64, numCores)
	for i := range allCpuPercent {
		variation := (float64(i) - float64(numCores)/2) * 5
		allCpuPercent[i] = stats.CPUPercent + variation
		if allCpuPercent[i] < 0 {
			allCpuPercent[i] = 0
		}
		if allCpuPercent[i] > 100 {
			allCpuPercent[i] = 100
		}
	}

	// Build hostname
	hostname := "unknown"
	hostProcessCount := int64(0)
	hostUptime := uint64(0)
	if hostInfo != nil {
		hostname = hostInfo.Hostname
		hostProcessCount = int64(hostInfo.Procs)
		hostUptime = hostInfo.Uptime
	}
	memAvailable := uint64(0)
	if stats.MemLimit >= stats.MemUsage {
		memAvailable = stats.MemLimit - stats.MemUsage
	}

	// Write the legacy measurements the backend and UI consume.
	systemPoint := influxdb2.NewPointWithMeasurement("system_metrics").
		AddTag("node", node.NodeName).
		AddTag("container", node.ContainerName).
		AddField("cpu_total", stats.CPUPercent).
		AddField("host_cpu_speed", cpuSpeed/1000.0).
		AddField("cpu_model", cpuModel).
		AddField("mem_usage", stats.MemPercent).
		AddField("host_mem_available", float64(memAvailable)).
		AddField("host_mem_cached", float64(0)).
		AddField("host_mem_committed", float64(stats.MemUsage)).
		AddField("host_mem_commit_limit", float64(stats.MemLimit)).
		AddField("host_process_count", float64(hostProcessCount)).
		AddField("host_thread_count", float64(len(allCpuPercent))).
		AddField("host_uptime", float64(hostUptime)).
		AddField("disk_read_bytes", diskReadRate).
		AddField("disk_write_bytes", diskWriteRate).
		AddField("net_sent_bytes", netSentRate).
		AddField("net_recv_bytes", netRecvRate).
		AddField("host_disk_latency", float64(0)).
		AddField("hostname", hostname).
		SetTime(time.Now())

	// Add per-core CPU
	for i, cpuVal := range allCpuPercent {
		systemPoint.AddField(fmt.Sprintf("cpu_core_%d", i), cpuVal)
	}

	mysqlPoint := influxdb2.NewPointWithMeasurement("mysql_metrics").
		AddTag("node", node.NodeName).
		AddTag("container", node.ContainerName).
		AddField("threads_running", getMetricFloat(mysqlMetrics, "threads_running")).
		AddField("threads_connected", getMetricFloat(mysqlMetrics, "threads_connected")).
		AddField("slow_queries", getMetricFloat(mysqlMetrics, "slow_queries")).
		AddField("innodb_pool_usage", getMetricFloat(mysqlMetrics, "innodb_pool_usage")).
		AddField("lock_time", getMetricFloat(mysqlMetrics, "lock_time")).
		SetTime(time.Now())

	writeAPI.WritePoint(systemPoint)
	writeAPI.WritePoint(mysqlPoint)

	// Console output
	fmt.Printf("[%s] CPU: %.1f%% | Mem: %.1f%% | Disk R/W: %.1f/%.1f KB/s | Net R/W: %.1f/%.1f KB/s\n",
		node.NodeName, stats.CPUPercent, stats.MemPercent,
		diskReadRate/1024, diskWriteRate/1024,
		netRecvRate/1024, netSentRate/1024)
}

// getMySQLMetrics queries MySQL for database-specific metrics
func getMySQLMetrics(node *MySQLNode) map[string]interface{} {
	metrics := make(map[string]interface{})

	if node.DB == nil {
		return metrics
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Get global status
	rows, err := node.DB.QueryContext(ctx, "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Queries','Slow_queries','Innodb_buffer_pool_pages_total','Innodb_buffer_pool_pages_free','Bytes_received','Bytes_sent','Connections','Uptime','Innodb_row_lock_time')")
	if err != nil {
		log.Printf("[%s] MySQL query error: %v", node.NodeName, err)
		return metrics
	}
	defer rows.Close()

	statusMap := make(map[string]string)
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err == nil {
			statusMap[name] = value
		}
	}

	// Parse values
	if v, ok := statusMap["Threads_connected"]; ok {
		if i, err := strconv.Atoi(v); err == nil {
			metrics["threads_connected"] = i
		}
	}
	if v, ok := statusMap["Threads_running"]; ok {
		if i, err := strconv.Atoi(v); err == nil {
			metrics["threads_running"] = i
		}
	}
	if v, ok := statusMap["Queries"]; ok {
		if i, err := strconv.ParseInt(v, 10, 64); err == nil {
			metrics["queries"] = i
		}
	}
	if v, ok := statusMap["Slow_queries"]; ok {
		if i, err := strconv.ParseInt(v, 10, 64); err == nil {
			metrics["slow_queries"] = i
		}
	}
	if v, ok := statusMap["Connections"]; ok {
		if i, err := strconv.ParseInt(v, 10, 64); err == nil {
			metrics["connections_total"] = i
		}
	}
	if v, ok := statusMap["Uptime"]; ok {
		if i, err := strconv.ParseInt(v, 10, 64); err == nil {
			metrics["uptime"] = i
		}
	}
	if v, ok := statusMap["Innodb_row_lock_time"]; ok {
		if i, err := strconv.ParseInt(v, 10, 64); err == nil {
			metrics["lock_time"] = i
		}
	}

	// Calculate InnoDB buffer pool usage
	total, _ := strconv.ParseFloat(statusMap["Innodb_buffer_pool_pages_total"], 64)
	free, _ := strconv.ParseFloat(statusMap["Innodb_buffer_pool_pages_free"], 64)
	if total > 0 {
		metrics["innodb_pool_usage"] = ((total - free) / total) * 100
	}

	return metrics
}

// getDockerStats retrieves container stats from Docker
func getDockerStats(containerName string) (*DockerStats, error) {
	cmd := exec.Command("docker", "stats", containerName, "--no-stream", "--format",
		"{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}")

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("docker stats failed: %v", err)
	}

	line := strings.TrimSpace(string(output))
	parts := strings.Split(line, "|")
	if len(parts) < 5 {
		return nil, fmt.Errorf("unexpected docker stats format: %s", line)
	}

	stats := &DockerStats{}

	// Parse CPU percentage (e.g., "1.50%")
	cpuStr := strings.TrimSuffix(parts[0], "%")
	stats.CPUPercent, _ = strconv.ParseFloat(cpuStr, 64)

	// Parse memory usage (e.g., "150MiB / 1GiB")
	memParts := strings.Split(parts[1], " / ")
	if len(memParts) == 2 {
		stats.MemUsage = parseSize(strings.TrimSpace(memParts[0]))
		stats.MemLimit = parseSize(strings.TrimSpace(memParts[1]))
	}

	// Parse memory percentage
	memPercStr := strings.TrimSuffix(parts[2], "%")
	stats.MemPercent, _ = strconv.ParseFloat(memPercStr, 64)

	// Parse network I/O (e.g., "1.5kB / 2.3kB")
	netParts := strings.Split(parts[3], " / ")
	if len(netParts) == 2 {
		stats.NetRx = parseSize(strings.TrimSpace(netParts[0]))
		stats.NetTx = parseSize(strings.TrimSpace(netParts[1]))
	}

	// Parse block I/O (e.g., "10MB / 5MB")
	blockParts := strings.Split(parts[4], " / ")
	if len(blockParts) == 2 {
		stats.BlockRead = parseSize(strings.TrimSpace(blockParts[0]))
		stats.BlockWrite = parseSize(strings.TrimSpace(blockParts[1]))
	}

	return stats, nil
}

// parseSize converts Docker size strings to bytes
func parseSize(s string) uint64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "0B" {
		return 0
	}

	multipliers := map[string]uint64{
		"B":   1,
		"kB":  1000,
		"KB":  1000,
		"KiB": 1024,
		"MB":  1000 * 1000,
		"MiB": 1024 * 1024,
		"GB":  1000 * 1000 * 1000,
		"GiB": 1024 * 1024 * 1024,
		"TB":  1000 * 1000 * 1000 * 1000,
		"TiB": 1024 * 1024 * 1024 * 1024,
	}

	for suffix, mult := range multipliers {
		if strings.HasSuffix(s, suffix) {
			numStr := strings.TrimSuffix(s, suffix)
			num, err := strconv.ParseFloat(numStr, 64)
			if err != nil {
				return 0
			}
			return uint64(num * float64(mult))
		}
	}

	// Try parsing as plain number
	num, _ := strconv.ParseUint(s, 10, 64)
	return num
}

// Helper functions
func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func getMetricInt(metrics map[string]interface{}, key string) int64 {
	switch v := metrics[key].(type) {
	case int:
		return int64(v)
	case int64:
		return v
	case float64:
		return int64(v)
	default:
		return 0
	}
}

func getMetricFloat(metrics map[string]interface{}, key string) float64 {
	switch v := metrics[key].(type) {
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case float64:
		return v
	default:
		return 0
	}
}
