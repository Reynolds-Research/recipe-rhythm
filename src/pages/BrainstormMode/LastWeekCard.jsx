export default function LastWeekCard({ items }) {
  return (
    <div>
      <p className="section-heading mb-3">Last week's meals</p>
      <div className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm">
        {items.map(({ day, name }) => (
          <div key={day} className="flex items-center gap-3 py-3">
            <span className="text-sm font-bold text-gray-700 w-8 flex-shrink-0 uppercase tracking-wider">
              {day.toUpperCase()}
            </span>
            <span className={`text-base flex-1 ${name ? 'text-gray-900' : 'text-gray-500 italic'}`}>
              {name || '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
