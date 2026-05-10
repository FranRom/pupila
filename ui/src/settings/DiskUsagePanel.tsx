// [05] Disk usage panel — bytes/files for data/raw, data/applications,
// data/archive.

import { useMemo } from 'react';
import { formatBytes } from '../format.ts';
import { Section, SkeletonRows } from './shared.tsx';
import type { DiskBucket, DiskUsage } from './types.ts';

interface DiskUsagePanelProps {
  disk: DiskUsage | null;
}

export function DiskUsagePanel({ disk }: DiskUsagePanelProps) {
  const totalDisk = disk?.total.bytes ?? 0;
  const diskBuckets = useMemo(() => {
    if (!disk) return null;
    return [
      { key: 'raw', label: 'data/raw', bucket: disk.raw, note: 'per-source raw dumps' },
      {
        key: 'applications',
        label: 'data/applications',
        bucket: disk.applications,
        note: 'AI Apply markdown packages',
      },
      {
        key: 'archive',
        label: 'data/archive',
        bucket: disk.archive,
        note: 'month-end snapshots',
      },
    ];
  }, [disk]);
  return (
    <Section
      index="05"
      title="Disk usage"
      subtitle="Local artifacts under data/."
      meta={
        disk ? (
          <span className="settings-meta-pill mono">
            {formatBytes(disk.total.bytes)} · {disk.total.files} files
          </span>
        ) : null
      }
    >
      {!disk ? (
        <SkeletonRows count={3} />
      ) : (
        <ul className="disk-list">
          {diskBuckets?.map((b) => (
            <DiskRow
              key={b.key}
              label={b.label}
              bucket={b.bucket}
              note={b.note}
              totalBytes={totalDisk}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

interface DiskRowProps {
  label: string;
  bucket: DiskBucket;
  note: string;
  totalBytes: number;
}

function DiskRow({ label, bucket, note, totalBytes }: DiskRowProps) {
  const pct = totalBytes > 0 ? Math.max(2, Math.round((bucket.bytes / totalBytes) * 100)) : 0;
  return (
    <li className="disk-row">
      <div className="disk-row-head">
        <span className="disk-label mono">{label}</span>
        <span className="disk-size">{formatBytes(bucket.bytes)}</span>
        <span className="disk-files muted">{bucket.files} files</span>
      </div>
      <div className="disk-bar" aria-hidden>
        <div className="disk-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="disk-note muted">{note}</span>
    </li>
  );
}
