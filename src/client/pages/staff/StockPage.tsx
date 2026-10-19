import { AvailabilityList } from "../../components/Availability";
import { StaffLayout } from "../../components/StaffLayout";

/** المخزون: what is on, and how many are left. */
export function StockPage() {
  return (
    <StaffLayout title="المخزون" wide>
      <section className="panel">
        <AvailabilityList />
      </section>
    </StaffLayout>
  );
}
