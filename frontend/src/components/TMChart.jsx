import React, { useEffect, useRef, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler } from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler);

export default function TMChart({ type, currentValue, color, isMini = false, tick, nodeId }) {
    const chartRef = useRef(null);
    const dataPointsRef = useRef(Array(60).fill(0));
    const prevNodeRef = useRef(nodeId);
    const prevTypeRef = useRef(type);

    // Reset data when node or metric type changes
    useEffect(() => {
        if (prevNodeRef.current !== nodeId || prevTypeRef.current !== type) {
            dataPointsRef.current = Array(60).fill(0);
            prevNodeRef.current = nodeId;
            prevTypeRef.current = type;
        }
    }, [nodeId, type]);

    useEffect(() => {
        dataPointsRef.current.shift();
        dataPointsRef.current.push(currentValue);

        if (chartRef.current) {
            chartRef.current.update('none');
        }
    }, [tick, currentValue]);

    const data = {
        labels: Array(60).fill(''),
        datasets: [
            {
                data: dataPointsRef.current,
                borderColor: color,
                backgroundColor: isMini ? 'transparent' : `${color}1A`, // ~10% opacity for filled area
                borderWidth: isMini ? 1 : 1.5,
                pointRadius: 0,
                fill: true,
                tension: 0.2, // Smooth thin line graph
                borderCapStyle: 'round',
                borderJoinStyle: 'round',
            }
        ]
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
            x: {
                display: !isMini,
                grid: {
                    display: !isMini,
                    color: 'rgba(255, 255, 255, 0.05)',
                    drawTicks: false,
                },
                ticks: { display: false }
            },
            y: {
                min: 0,
                suggestedMax: (type === 'cpu' || type === 'memory' || type === 'mysql') ? 105 : (type === 'disk' ? 10 : (type === 'network' ? 5 : undefined)),
                display: !isMini,
                grid: {
                    display: !isMini,
                    color: 'rgba(255, 255, 255, 0.05)',
                    drawTicks: false,
                },
                ticks: { display: false },
                beginAtZero: true
            }
        },
        layout: {
            padding: isMini ? 0 : {
                top: 10,
                bottom: 0,
                left: 0,
                right: 0
            }
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                enabled: !isMini,
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(26, 27, 32, 0.9)',
                titleColor: '#a0a0a2',
                bodyColor: '#f5f5f5',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 1,
                padding: 10,
                displayColors: false,
                callbacks: {
                    label: (context) => {
                        const val = context.parsed.y.toFixed(1);
                        const suffix = (type === 'cpu' || type === 'memory') ? '%' : (type === 'disk' ? ' MB/s' : (type === 'network' ? ' Mbps' : ''));
                        return `Value: ${val}${suffix}`;
                    }
                }
            }
        },
        interaction: {
            mode: 'index',
            intersect: false,
        },
        hover: {
            mode: 'index',
            intersect: false,
        },
        elements: {
            line: {
                borderWidth: 1.5
            },
            point: {
                radius: 0,
                hoverRadius: 4,
                hoverBackgroundColor: color
            }
        }
    };

    return <Line ref={chartRef} data={data} options={options} />;
}
