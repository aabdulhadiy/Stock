import { getT } from "@/i18n/server";
import { LoginForm } from "./login-form";
import { LocaleSwitcher } from "@/components/locale-switcher";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const t = await getT();
  const { from } = await searchParams;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{t("auth.signInTitle")}</h1>
            <p className="text-sm text-muted mt-0.5">{t("auth.signInSubtitle")}</p>
          </div>
          <LocaleSwitcher />
        </div>
        <LoginForm from={from ?? ""} />
      </div>
    </div>
  );
}
