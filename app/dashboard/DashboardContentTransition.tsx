'use client'

import { usePathname } from 'next/navigation'

/** Wraps dashboard page content so route changes get a subtle enter animation. */
export default function DashboardContentTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div
      key={pathname}
      className="page-enter h-full min-h-0"
    >
      {children}
    </div>
  )
}
