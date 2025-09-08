"use client";

import React from "react";
import dynamic from "next/dynamic";
import HeadlessSampler from "@/lab/legacy/components/HeadlessSampler"
// Lazy-load to keep TTI snappy
const Dashboard = dynamic(() => import("@/lab/legacy/components/Dashboard"), { ssr: false });

export default function PageLab() {
  // Later we can wire the pair selectors; for now, BTC/USDT 30m
  return (
    <div className="max-w-6xl mx-auto p-4">
      <HeadlessSampler base="BTC" quote="USDT" win="30m" appSessionId="default" />
      <Dashboard base="BTC" quote="USDT" win="30m" appSessionId="default" />

    </div>
  );
}
