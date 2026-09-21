export function Avatar({ name, color, size = 'normal', showOnline = true }) {
  const initials = name
    ? name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
    : '?';

  return (
    <div
      className={`avatar ${size === 'large' ? 'large' : ''} ${showOnline ? 'avatar-online' : ''}`}
      style={{ background: color || '#6366f1' }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}

export function getDeviceIcon(deviceType) {
  switch (deviceType) {
    case 'mobile': return '📱';
    case 'tablet': return '📟';
    default: return '💻';
  }
}

export function getFileIcon(filename = '', type = '') {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📄';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📋';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'cpp', 'c'].includes(ext)) return '💾';
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  return '📁';
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
