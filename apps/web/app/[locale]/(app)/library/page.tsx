import { setRequestLocale } from "next-intl/server";
import { LibraryClient } from "@/components/library/LibraryClient";

export default async function LibraryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <LibraryClient />
      </div>
    </div>
  );
}
