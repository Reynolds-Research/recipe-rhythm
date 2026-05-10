export default function Skeleton({ className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`bg-gray-200 rounded motion-safe:animate-pulse ${className}`.trim()}
    />
  )
}
