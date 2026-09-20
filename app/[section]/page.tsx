import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { sectionIds, type SectionId } from "@/src/shared/navigation";

export function generateStaticParams() {
  return sectionIds.filter((section) => section !== "today").map((section) => ({ section }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sectionIds.includes(section as SectionId)) {
    notFound();
  }

  return <Shell section={section as SectionId} />;
}
