import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n";
import { getSettings } from "@/lib/settings";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  Table,
  Td,
  Th,
  PageHeader,
} from "@/components/ui";
import { roleKey } from "@/lib/labels";
import { LOCALE_NAMES } from "@/i18n/config";
import { UserCreateForm, UserRowActions } from "./forms";

export default async function UsersPage() {
  const current = await requireDirector();
  const t = await getT();
  const [rows, settings] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader title={t("user.title")} />

      {!settings.salespersonEnabled && (
        <div className="mb-5">
          <Alert variant="info">{t("settings.salespersonHint")}</Alert>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:order-2">
          <CardHeader>
            <CardTitle>{t("user.new")}</CardTitle>
          </CardHeader>
          <UserCreateForm />
        </Card>

        <Card className="lg:col-span-2 lg:order-1">
          <Table>
            <thead>
              <tr>
                <Th>{t("user.name")}</Th>
                <Th>{t("user.login")}</Th>
                <Th>{t("user.role")}</Th>
                <Th>{t("user.locale")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("common.createdAt")}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">
                    {u.name}
                    {u.id === current.sub && (
                      <span className="ml-2 text-xs text-muted">({t("auth.signedInAs")})</span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{u.login}</Td>
                  <Td>
                    <Badge color={u.role === "DIRECTOR" ? "indigo" : "slate"}>
                      {t(roleKey(u.role))}
                    </Badge>
                  </Td>
                  <Td className="text-muted">{LOCALE_NAMES[u.locale]}</Td>
                  <Td>
                    <Badge color={u.active ? "green" : "red"}>
                      {u.active ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{formatDate(u.createdAt)}</Td>
                  <Td>
                    <UserRowActions
                      user={{
                        id: u.id,
                        name: u.name,
                        login: u.login,
                        role: u.role,
                        locale: u.locale,
                        active: u.active,
                      }}
                      isSelf={u.id === current.sub}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
