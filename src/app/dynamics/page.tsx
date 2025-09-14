// src/app/dynamics/page.tsx
// Server component wrapper for the Dynamics dashboard.

import { DynamicsPageView } from "@/modules/dynamics";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "CryptoPi  Dynamics" };

export default function DynamicsPage() {
  // Keep the page wrapper minimal; DynamicsPageView renders the top HomeBar.
  return <DynamicsPageView />;
}

