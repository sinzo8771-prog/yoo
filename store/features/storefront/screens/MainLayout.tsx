import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import MotionPreference from "@/components/ui/MotionPreference";
import { Metadata } from "next"
import InteractiveLink from "@/features/storefront/modules/common/components/interactive-link"
import StorefrontServer from "./StorefrontServer"

export async function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <StorefrontServer
      prefetchUser={true}
      prefetchCart={true}
      prefetchCollections={true}
      prefetchCategories={true}
    >
      <MotionPreference />
      {/* Accessibility: skip link is the first Tab stop (Task 3, step 3) */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
    </StorefrontServer>
  )
}

export const MainNotFoundMetadata: Metadata = {
  title: "404",
  description: "Something went wrong",
}

export function MainNotFound() {
  return (
    <div className="flex flex-col gap-4 items-center justify-center min-h-[calc(100vh-64px)]">
      <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
      <p className="text-xs font-normal text-foreground">
        The page you tried to access does not exist.
      </p>
      <InteractiveLink href="/">Go to frontpage</InteractiveLink>
    </div>
  )
}
