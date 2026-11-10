export default function Image({ src, alt, fill, unoptimized, priority, style, ...props }) {
  const sizing = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : {};
  return <img {...props} src={src} alt={alt} loading={priority ? 'eager' : props.loading} style={{ ...sizing, ...style }} />;
}
