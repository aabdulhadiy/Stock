import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "./form";

export default async function SettingsPage() {
  await requireDirector();
  const t = await getT();
  const settings = await getSettings();

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <SettingsForm settings={settings} />
    </>
  );
}
