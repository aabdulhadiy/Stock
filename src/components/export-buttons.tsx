import { Button } from "@/components/ui";

/**
 * Excel / PDF download links for a dataset. Extra params (e.g. report date
 * range) ride along so the export matches what's on screen.
 */
export function ExportButtons({
  basePath,
  params,
  label = "Export",
}: {
  basePath: string;
  params?: Record<string, string | undefined>;
  label?: string;
}) {
  const href = (format: string) => {
    const sp = new URLSearchParams({ format });
    if (params) {
      for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    }
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">{label}:</span>
      <a href={href("xlsx")}>
        <Button variant="secondary" size="sm">
          Excel
        </Button>
      </a>
      <a href={href("pdf")}>
        <Button variant="secondary" size="sm">
          PDF
        </Button>
      </a>
    </div>
  );
}
