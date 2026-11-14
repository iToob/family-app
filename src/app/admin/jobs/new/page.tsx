import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { getSettings } from "@/server/core";
import { categories } from "@/server/queries";
import { createJobAction } from "../../../actions";
import { ActionForm } from "@/components/forms";
import { JobFields } from "@/components/job-form";
import { PageHeader, Panel } from "@/components/ui";

export default async function NewJob() {
  const s = await requireParentSession();
  const db = getDb();
  const [cats, st] = await Promise.all([categories(db, s.actor.householdId, "JOB"), getSettings(db, s.actor.householdId)]);
  return (
    <>
      <PageHeader title="New job" back="/admin/jobs" />
      <Panel className="px-4 py-5 sm:px-6">
        <ActionForm action={createJobAction}>
          <JobFields cats={cats} guidelines={st.rewardGuidelines} />
        </ActionForm>
      </Panel>
    </>
  );
}
