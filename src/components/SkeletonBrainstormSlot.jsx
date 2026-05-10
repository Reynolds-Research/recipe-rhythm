import Skeleton from './Skeleton'

export default function SkeletonBrainstormSlot() {
  return (
    <div className="flex items-center gap-3 py-3">
      <Skeleton className="h-4 w-8 flex-shrink-0" />
      <Skeleton className="h-11 w-11 flex-shrink-0" />
      <Skeleton className="flex-1 h-4" />
    </div>
  )
}
