export default function Logo({ className = "w-6 h-6" }) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg viewBox="0 0 24 24" fill="#f97316" className="w-full h-full">
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-white font-serif font-bold text-[0.45em] pb-[0.05em]">S</span>
    </div>
  )
}
