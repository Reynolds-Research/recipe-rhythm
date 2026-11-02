import { Search, X } from 'lucide-react'

/**
 * Controlled search box for recipe search. Presentational only: the caller
 * owns the query and runs `searchRecipes` (src/lib/recipeSearch.js).
 *
 * Escape and the × button both clear it. Text is 16px at every breakpoint so
 * iOS doesn't zoom on focus.
 *
 * @param {{
 *   value: string,
 *   onChange: (next: string) => void,
 *   placeholder?: string,
 *   className?: string,
 * }} props
 */
export default function RecipeSearchInput({ value, onChange, placeholder = 'Search recipes', className = '' }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && value) {
      e.preventDefault()
      e.stopPropagation()
      onChange('')
    }
  }

  return (
    <div className={`relative ${className}`}>
      <Search
        size={18}
        aria-hidden="true"
        className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-700 pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label="Search recipes"
        enterKeyHint="search"
        autoComplete="off"
        className="input-base sm:text-base min-h-[44px] pl-11 pr-12 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-gray-700 hover:text-brand-700 transition-colors"
        >
          <X size={18} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
