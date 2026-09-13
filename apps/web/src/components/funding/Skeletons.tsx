interface SkeletonProps {
  className?: string;
}

function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-muted ${className}`}
      aria-hidden="true"
    />
  );
}

export function PipelineTableSkeleton({ compact = false }: { compact?: boolean }) {
  const rowH = compact ? "h-8" : "h-10";
  return (
    <div className="w-full overflow-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="p-2 text-sm font-semibold text-foreground">
              <Skeleton className="h-4 w-24" />
            </th>
            <th className="p-2 text-sm font-semibold text-foreground">
              <Skeleton className="h-4 w-16" />
            </th>
            <th className="p-2 text-sm font-semibold text-foreground">
              <Skeleton className="h-4 w-28" />
            </th>
            <th className="p-2 text-sm font-semibold text-foreground">
              <Skeleton className="h-4 w-20" />
            </th>
            <th className="p-2 text-sm font-semibold text-foreground">
              <Skeleton className="h-4 w-16" />
            </th>
            <th className="p-2 text-sm font-semibold text-foreground">
              <Skeleton className="h-4 w-24" />
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }).map((_, i) => (
            <tr key={i} className="border-b border-border">
              <td className={`p-2 ${rowH}`}>
                <Skeleton className="h-4 w-32" />
              </td>
              <td className={`p-2 ${rowH}`}>
                <Skeleton className="h-5 w-20 rounded-full" />
              </td>
              <td className={`p-2 ${rowH}`}>
                <Skeleton className="h-4 w-40" />
              </td>
              <td className={`p-2 ${rowH}`}>
                <Skeleton className="h-4 w-24" />
              </td>
              <td className={`p-2 ${rowH}`}>
                <Skeleton className="h-5 w-16 rounded-full" />
              </td>
              <td className={`p-2 ${rowH}`}>
                <Skeleton className="h-4 w-28" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
