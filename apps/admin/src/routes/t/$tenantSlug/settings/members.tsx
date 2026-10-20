import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, toaster } from "@plyrs/ui";
import {
  AddMemberDialog,
  type AddMemberFailure,
} from "../../../../components/settings/add-member-dialog";
import {
  DemoteMemberDialog,
  RemoveMemberDialog,
} from "../../../../components/settings/member-dialogs";
import { MembersTable } from "../../../../components/settings/members-table";
import { RoleCards } from "../../../../components/settings/role-cards";
import { SettingsFrame } from "../../../../components/settings/settings-frame";
import type { MemberSummary } from "../../../../lib/admin-api";
import { ApiError } from "../../../../lib/api-client";
import { errorMessage } from "../../../../lib/error-messages";
import { MEMBER_LABELS, roleLabel } from "../../../../lib/labels";
import { isDowngrade, memberRows, otherOwnerEmails } from "../../../../lib/members";
import type { Role } from "../../../../lib/permissions";
import { membersQueryOptions, meQueryOptions } from "../../../../lib/queries";

export const Route = createFileRoute("/t/$tenantSlug/settings/members")({
  component: MembersPage,
});

function addFailureOf(cause: unknown): AddMemberFailure {
  if (cause instanceof ApiError && cause.code === "user_not_found") return { kind: "unregistered" };
  if (cause instanceof ApiError && cause.code === "already_member") {
    return { kind: "already_member" };
  }
  return { kind: "other", message: errorMessage(cause, MEMBER_LABELS.addDialog.failed) };
}

function MembersPage() {
  const { tenant, api, adminApi, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  const labels = MEMBER_LABELS;
  const members = useQuery(membersQueryOptions(adminApi, tenant.id));
  const me = useQuery(meQueryOptions(api));
  const selfId = me.data?.userId;
  const list = members.data ?? [];
  const rows = memberRows(list, selfId);
  const otherOwners = otherOwnerEmails(list, selfId);

  const [isAddOpen, setAddOpen] = useState(false);
  const [addFailure, setAddFailure] = useState<AddMemberFailure>(null);
  const [demoteTarget, setDemoteTarget] = useState<{ member: MemberSummary; to: Role } | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<MemberSummary | null>(null);

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: ["members", tenant.id] });
  const invalidateTenants = () => queryClient.invalidateQueries({ queryKey: ["tenants"] });

  const add = useMutation({
    mutationFn: (input: { email: string; role: Role }) =>
      adminApi.addMember(tenant.id, input.email, input.role),
    onSuccess: (_member, input) => {
      void invalidateMembers();
      setAddOpen(false);
      setAddFailure(null);
      toaster.success(labels.added(input.email));
    },
    onError: (cause) => setAddFailure(addFailureOf(cause)),
  });

  const changeRole = useMutation({
    mutationFn: (input: { member: MemberSummary; role: Role }) =>
      adminApi.changeMemberRole(tenant.id, input.member.userId, input.role),
    onSuccess: (_result, { member, role }) => {
      void invalidateMembers();
      toaster.success(labels.roleChanged(member.email, roleLabel(role)));
      if (member.userId === selfId && isDowngrade(member.role, role)) {
        void invalidateTenants();
        void navigate({ to: "/t/$tenantSlug", params: { tenantSlug } });
      }
    },
    onError: (cause) => {
      void invalidateMembers();
      toaster.error(errorMessage(cause, labels.roleChangeFailed));
    },
    onSettled: () => setDemoteTarget(null),
  });

  const remove = useMutation({
    mutationFn: (member: MemberSummary) => adminApi.removeMember(tenant.id, member.userId),
    onSuccess: (_result, member) => {
      void invalidateMembers();
      toaster.success(labels.removed(member.email));
      if (member.userId === selfId) {
        void invalidateTenants();
        void navigate({ to: "/tenants" });
      }
    },
    onError: (cause) => {
      void invalidateMembers();
      toaster.error(errorMessage(cause, labels.removeFailed));
    },
    onSettled: () => setRemoveTarget(null),
  });

  const isBusy = add.isPending || changeRole.isPending || remove.isPending;

  return (
    <SettingsFrame
      tab="members"
      slug={tenantSlug}
      primaryAction={
        <Button
          variant="primary"
          icon={Plus}
          onPress={() => {
            setAddFailure(null);
            setAddOpen(true);
          }}
        >
          {labels.add}
        </Button>
      }
      isLoading={members.isPending}
      error={
        members.isLoadingError
          ? {
              message: errorMessage(members.error, labels.loadFailed),
              onRetry: () => void members.refetch(),
            }
          : undefined
      }
    >
      <RoleCards />
      <MembersTable
        rows={rows}
        isBusy={isBusy}
        onChangeRole={(member, role) => {
          if (isDowngrade(member.role, role)) {
            setDemoteTarget({ member, to: role });
          } else {
            changeRole.mutate({ member, role });
          }
        }}
        onRemove={setRemoveTarget}
      />
      <AddMemberDialog
        isOpen={isAddOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setAddFailure(null);
        }}
        onSubmit={(email, role) => add.mutate({ email, role })}
        isPending={add.isPending}
        failure={addFailure}
        signupUrl={`${window.location.origin}/signup`}
      />
      <DemoteMemberDialog
        target={
          demoteTarget === null
            ? null
            : {
                email: demoteTarget.member.email,
                to: demoteTarget.to,
                isSelf: demoteTarget.member.userId === selfId,
              }
        }
        otherOwners={otherOwners}
        onConfirm={() => {
          if (demoteTarget !== null) {
            changeRole.mutate({ member: demoteTarget.member, role: demoteTarget.to });
          }
        }}
        onCancel={() => setDemoteTarget(null)}
        isPending={changeRole.isPending}
      />
      <RemoveMemberDialog
        target={
          removeTarget === null
            ? null
            : { email: removeTarget.email, isSelf: removeTarget.userId === selfId }
        }
        siteName={tenant.name}
        otherOwners={otherOwners}
        onConfirm={() => {
          if (removeTarget !== null) remove.mutate(removeTarget);
        }}
        onCancel={() => setRemoveTarget(null)}
        isPending={remove.isPending}
      />
    </SettingsFrame>
  );
}
