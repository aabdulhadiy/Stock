import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "./wizard";

export default async function ImportPage() {
  await requireDirector();
  const t = await getT();
  return (
    <>
      <PageHeader title={t("import.title")} subtitle={t("import.subtitle")} />
      <ImportWizard />
    </>
  );
}
