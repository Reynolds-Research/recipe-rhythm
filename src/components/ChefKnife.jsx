export default function ChefKnife({ size = 20, strokeWidth = 2, className = "" }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth={strokeWidth} 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <g transform="rotate(-45 12 12)">
        <path d="M6 9h15.5a.5.5 0 0 1 .5.5 6.5 6.5 0 0 1-6.5 6.5H6z"/>
        <path d="M2 10v4h4v-4z"/>
        <line x1="6" y1="9" x2="6" y2="17" />
      </g>
    </svg>
  )
}
