import type { Metadata } from "next";
import { Console } from "@/components/console/console";

export const metadata: Metadata = { title: "Nimbus Console — operator view" };

export default function DashboardPage() {
  return <Console />;
}
