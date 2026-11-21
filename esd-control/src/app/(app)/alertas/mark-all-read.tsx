"use client";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/core";
import { markNotificationsReadAction } from "@/components/shell/shell-actions";

export function MarkAllRead() {
  const router = useRouter();
  return <Button size="sm" variant="ghost" icon={CheckCheck} onClick={async () => { await markNotificationsReadAction("all"); router.refresh(); }}>Marcar leídas</Button>;
}
