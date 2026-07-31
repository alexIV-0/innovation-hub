import { redirect } from "next/navigation"

export default function DangerRedirect() {
  redirect("/account/profile")
}
