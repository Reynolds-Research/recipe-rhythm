import Skeleton from './Skeleton'

export default function SkeletonRecipeCard() {
  return (
    <div className="card">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-5 w-5 shrink-0" />
      </div>
    </div>
  )
}
