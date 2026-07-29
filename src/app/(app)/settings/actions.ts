"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit, diffFields } from "@/lib/audit";
import { getSettings, saveSettings } from "@/lib/settings";
import { settingsSchema } from "@/lib/validation";
import { zodToFieldErrors, toFormError, type FormState } from "@/lib/forms";

/** Director-editable settings (§14). Every change is audit-logged (§12). */
export async function saveSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageSettings);

    const parsed = settingsSchema.safeParse({
      slowDays: String(formData.get("slowDays") ?? ""),
      frozenDays: String(formData.get("frozenDays") ?? ""),
      xyzXMaxPct: String(formData.get("xyzXMaxPct") ?? ""),
      xyzYMaxPct: String(formData.get("xyzYMaxPct") ?? ""),
      uzsPerUsd: String(formData.get("uzsPerUsd") ?? ""),
      sessionTimeoutHours: String(formData.get("sessionTimeoutHours") ?? ""),
      orderNumberFormat: String(formData.get("orderNumberFormat") ?? ""),
      salespersonEnabled: String(formData.get("salespersonEnabled") ?? ""),
    });
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    const before = await getSettings();

    await db.transaction(async (tx) => {
      await saveSettings(parsed.data, tx);
      const diff = diffFields(
        before as unknown as Record<string, unknown>,
        parsed.data as unknown as Record<string, unknown>,
        Object.keys(parsed.data),
      );
      if (diff) {
        await writeAudit(
          {
            userId: actor.id,
            entity: "settings",
            action: "update",
            label: "Settings",
            oldValue: diff.old,
            newValue: diff.new,
          },
          tx,
        );
      }
    });

    // Thresholds change stock classification and dashboards everywhere.
    revalidatePath("/", "layout");
    return { ok: true, message: "settings.saved" };
  } catch (error) {
    return toFormError(error);
  }
}
