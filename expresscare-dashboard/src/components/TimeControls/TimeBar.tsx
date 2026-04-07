import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';

export default function TimeBar() {
  const {
    timelineOffsetHours,
    isPlaying,
    setTimelineOffset,
    setPlaying,
  } = useDashboardStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setTimelineOffset(
          useDashboardStore.getState().timelineOffsetHours >= 24
            ? 0
            : useDashboardStore.getState().timelineOffsetHours + 0.5,
        );
      }, 1500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, setTimelineOffset]);

  const isLive = timelineOffsetHours === 0;

  const formatTime = (hours: number) => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + hours * 60);
    return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="absolute top-0 left-0 right-0 z-[1000] h-12 bg-panel/90 backdrop-blur-sm border-b border-border flex items-center px-4 gap-4">
      {/* LIVE indicator */}
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            isLive ? 'bg-live animate-pulse-dot' : 'bg-text-muted'
          }`}
        />
        <span className="text-[11px] mono text-text-secondary">
          {isLive ? 'LIVE' : formatTime(timelineOffsetHours)}
        </span>
      </div>

      {/* Time slider */}
      <div className="flex-1 flex items-center gap-2">
        <span className="text-[10px] text-text-muted mono">Now</span>
        <input
          type="range"
          min={0}
          max={24}
          step={0.5}
          value={timelineOffsetHours}
          onChange={(e) => setTimelineOffset(parseFloat(e.target.value))}
          className="flex-1 h-1 appearance-none bg-border rounded-full accent-accent cursor-pointer"
        />
        <span className="text-[10px] text-text-muted mono">+24h</span>
      </div>

      {/* Play/pause */}
      <button
        onClick={() => setPlaying(!isPlaying)}
        className="px-3 py-1 text-[11px] mono bg-elevated border border-border rounded hover:bg-border transition-colors"
      >
        {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>

      {/* Reset to live */}
      {!isLive && (
        <button
          onClick={() => {
            setTimelineOffset(0);
            setPlaying(false);
          }}
          className="px-2 py-1 text-[10px] mono text-accent hover:underline"
        >
          ← Live
        </button>
      )}
    </div>
  );
}
