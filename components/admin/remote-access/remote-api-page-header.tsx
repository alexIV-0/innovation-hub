"use client"

import { useI18n } from "@/components/account/i18n"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { RemoteAccessSubnav } from "./remote-access-subnav"

export function RemoteApiPageHeader() {
  const { t } = useI18n()
  return (
    <AdminPageHeader
      eyebrow={t.adminRemoteEyebrow}
      title={t.adminRemoteApiTitle}
      description={t.adminRemoteApiDesc}
      actions={<RemoteAccessSubnav />}
    />
  )
}
