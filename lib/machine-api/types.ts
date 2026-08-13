import type { z } from "zod"
import type { NextResponse } from "next/server"
import type { StorageApiAuth } from "@/lib/storage/auth"

export type MachineActionHandler = {
  schema: z.ZodType<unknown>
  run: (auth: StorageApiAuth, props: unknown) => Promise<NextResponse>
}

export function defineAction<S extends z.ZodTypeAny>(
  schema: S,
  run: (
    auth: StorageApiAuth,
    props: z.output<S>,
  ) => Promise<NextResponse>,
): MachineActionHandler {
  return {
    schema,
    run: (auth, props) => run(auth, props as z.output<S>),
  }
}
