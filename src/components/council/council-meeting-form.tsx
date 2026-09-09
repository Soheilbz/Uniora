"use client";

import { CouncilAttendanceEditor } from "@/components/council/council-attendance-editor";
import { EntityForm, type EntityFormProps } from "@/components/engine/entity-form";
import type { DirectoryEntry, RosterSeat } from "@/modules/council/roster.ts";

type CouncilMeetingFormProps = Omit<EntityFormProps, "customGroupSlots"> & {
  seats: RosterSeat[];
  directory: DirectoryEntry[];
  initialParticipants?: string[];
  initialAbsentees?: string[];
  initialSubstitutions?: Record<string, string>;
};

/**
 * Keeps the custom attendance renderer on the client boundary.
 * A server page may pass a Server Action and serializable data to EntityForm,
 * but it cannot pass an inline render function into a Client Component.
 */
export function CouncilMeetingForm({
  seats,
  directory,
  initialParticipants = [],
  initialAbsentees = [],
  initialSubstitutions = {},
  ...formProps
}: CouncilMeetingFormProps) {
  return (
    <EntityForm
      {...formProps}
      customGroupSlots={{
        attendance: ({ fieldError }) => (
          <CouncilAttendanceEditor
            seats={seats}
            directory={directory}
            initialParticipants={initialParticipants}
            initialAbsentees={initialAbsentees}
            initialSubstitutions={initialSubstitutions}
            error={fieldError("absentees")}
          />
        ),
      }}
    />
  );
}
