import { Button, Input, Label, Select } from "@/components/ui";
import { toDateInput, type DateRange } from "@/lib/date-range";

/**
 * GET-form date-range filter shared by report pages. Works without JS: pick a
 * preset (or "Custom" + dates) and Apply. The page re-reads searchParams.
 */
export function DateFilter({ basePath, range }: { basePath: string; range: DateRange }) {
  return (
    <form action={basePath} className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="preset">Period</Label>
        <Select id="preset" name="preset" defaultValue={range.preset} className="w-40">
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="custom">Custom…</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="from">From</Label>
        <Input id="from" type="date" name="from" defaultValue={toDateInput(range.from)} className="w-40" />
      </div>
      <div>
        <Label htmlFor="to">To</Label>
        <Input id="to" type="date" name="to" defaultValue={toDateInput(range.to)} className="w-40" />
      </div>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
