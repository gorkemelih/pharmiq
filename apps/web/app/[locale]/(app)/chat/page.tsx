import { setRequestLocale } from "next-intl/server";
import { ChatInterface } from "@/components/chat/ChatInterface";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <ChatInterface />;
}
