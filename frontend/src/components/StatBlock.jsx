export default function StatBlock({ label, value, trend, color }) {
    return (
        <div className="stat-block">
            <span className="stat-label">{label}</span>
            <div className="stat-value-row">
                {trend && (
                    <span className={`stat-trend ${trend}`}>
                        {trend === 'up' ? '↑' : '↓'}
                    </span>
                )}
                <span className="stat-value" style={{ color: color || 'inherit' }}>{value}</span>
            </div>
        </div>
    );
}
