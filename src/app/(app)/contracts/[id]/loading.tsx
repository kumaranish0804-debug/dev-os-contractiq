import { Skeleton } from '@/components/ui/Skeleton';

export default function ContractLoading() {
  return (
    <main aria-busy="true" className="flex flex-col gap-6 px-4 py-8 lg:px-28 lg:py-12">
      <span className="sr-only">Loading contract…</span>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-80 max-w-full" />
      <Skeleton className="h-10 w-full" />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[55fr_45fr]">
        <Skeleton className="h-[60vh] rounded-lg" />
        <Skeleton className="h-[60vh] rounded-lg" />
      </div>
    </main>
  );
}
